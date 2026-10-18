import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AgentClient } from '../agent-client/agent-client.service';
import { PrismaService } from '../database/prisma.service';
import { MessageCipher } from '../messages/crypto/message-cipher.service';
import { MessagesService } from '../messages/messages.service';
import { OutboxService } from '../outbox/outbox.service';
import { toAgentHistory } from './history';

const SUMMARIES_IN_CONTEXT = 3;
const SUMMARY_SOURCE_MESSAGES = 80;

/**
 * Cross-session memory (02 §6.5): an encrypted summary per ended session, the last three of
 * which go into the next session's context. Users can switch memory off (summaries are deleted
 * and no longer made) or clear it. Crisis-session summaries are kept for safety and flagged
 * `exclude_from_training`.
 */
@Injectable()
export class MemoryService implements OnModuleInit {
  private readonly logger = new Logger(MemoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly messages: MessagesService,
    private readonly cipher: MessageCipher,
    private readonly agent: AgentClient,
    private readonly outbox: OutboxService,
  ) {}

  onModuleInit(): void {
    this.outbox.register('session_summary', async (payload) => {
      const sessionId = (payload as { session_id?: string } | null)?.session_id;
      if (sessionId) await this.summarize(sessionId);
    });
  }

  async enabled(userId: string): Promise<boolean> {
    const state = await this.prisma.ai_user_state.findUnique({
      where: { user_id: userId },
    });
    return state?.memory_enabled ?? true;
  }

  async recentSummaries(userId: string): Promise<string[]> {
    if (!(await this.enabled(userId))) return [];
    const rows = await this.prisma.ai_session_summaries.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      take: SUMMARIES_IN_CONTEXT,
    });
    const plain = await Promise.all(
      rows.map((row) =>
        this.cipher.decrypt(row.summary_ciphertext, row.session_id),
      ),
    );
    return plain.reverse();
  }

  async setEnabled(userId: string, enabled: boolean): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.ai_user_state.upsert({
        where: { user_id: userId },
        create: { user_id: userId, memory_enabled: enabled },
        update: { memory_enabled: enabled },
      });
      if (!enabled)
        await tx.ai_session_summaries.deleteMany({
          where: { user_id: userId },
        });
    });
  }

  async clear(userId: string): Promise<void> {
    await this.prisma.ai_session_summaries.deleteMany({
      where: { user_id: userId },
    });
  }

  /** Outbox handler; idempotent (one summary per session). */
  async summarize(sessionId: string): Promise<void> {
    const session = await this.prisma.ai_sessions.findUnique({
      where: { id: sessionId },
    });
    if (!session) return;
    const existing = await this.prisma.ai_session_summaries.findUnique({
      where: { session_id: sessionId },
    });
    if (existing || !(await this.enabled(session.user_id))) return;
    const history = toAgentHistory(
      await this.messages.recent(sessionId, SUMMARY_SOURCE_MESSAGES),
    );
    if (!history.some((message) => message.role === 'user')) return;
    const { summary } = await this.agent.summarize({ history });
    const ciphertext = new Uint8Array(
      await this.cipher.encrypt(summary, sessionId),
    );
    // History or the account may have been deleted while the agent was summarizing. Both
    // lock the session rows first, so re-checking under the same lock never resurrects data.
    const stored = await this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<
        { exclude_from_training: boolean }[]
      >`SELECT exclude_from_training FROM ai_sessions WHERE id = ${sessionId}::uuid FOR UPDATE`;
      if (!locked) return false;
      const [userMessages, state] = await Promise.all([
        tx.ai_messages.count({
          where: { session_id: sessionId, role: 'user' },
        }),
        tx.ai_user_state.findUnique({
          where: { user_id: session.user_id },
          select: { memory_enabled: true },
        }),
      ]);
      if (userMessages === 0 || state?.memory_enabled === false) return false;
      const { count } = await tx.ai_session_summaries.createMany({
        data: [
          {
            session_id: sessionId,
            user_id: session.user_id,
            summary_ciphertext: ciphertext,
            exclude_from_training: locked.exclude_from_training,
          },
        ],
        skipDuplicates: true,
      });
      return count === 1;
    });
    if (stored) this.logger.log({ memory: 'summary_stored' });
  }
}
