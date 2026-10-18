import { Injectable } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import { PrismaService } from '../database/prisma.service';
import type { ai_messages } from '../generated/prisma/client';
import { MessageCipher } from './crypto/message-cipher.service';

export interface StoredUserMessage {
  message: ai_messages;
  duplicate: boolean;
}

export interface PlainMessage {
  id: string;
  /** `protocol` = a crisis/elevated protocol shown instead of a persona reply. */
  role: 'user' | 'assistant' | 'protocol';
  content: string;
  created_at: Date;
  /** User messages only: lets a client resend it (idempotently) after a reload. */
  client_message_id?: string;
}

export interface AssistantMetadata {
  model: string;
  prompt_version: string;
  persona_version?: number | null;
  risk_level?: 'normal' | 'elevated' | 'crisis';
}

/** Encrypted message storage, history, and `client_message_id` idempotency (02 §6.4, §9). */
@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: MessageCipher,
  ) {}

  findByClientId(
    sessionId: string,
    clientMessageId: string,
  ): Promise<ai_messages | null> {
    return this.prisma.ai_messages.findUnique({
      where: {
        session_id_client_message_id: {
          session_id: sessionId,
          client_message_id: clientMessageId,
        },
      },
    });
  }

  /** Idempotent on `(session_id, client_message_id)`: a retry returns the stored row. */
  async storeUserMessage(
    sessionId: string,
    clientMessageId: string,
    content: string,
  ): Promise<StoredUserMessage> {
    const id = uuidv7();
    try {
      const message = await this.prisma.ai_messages.create({
        data: {
          id,
          session_id: sessionId,
          role: 'user',
          client_message_id: clientMessageId,
          content_ciphertext: new Uint8Array(
            await this.cipher.encrypt(content, id),
          ),
        },
      });
      return { message, duplicate: false };
    } catch (error) {
      if (isUniqueViolation(error)) {
        const existing = await this.findByClientId(sessionId, clientMessageId);
        if (existing) return { message: existing, duplicate: true };
      }
      throw error;
    }
  }

  async storeAssistantMessage(
    sessionId: string,
    id: string,
    content: string,
    metadata: AssistantMetadata,
  ): Promise<ai_messages> {
    return this.prisma.ai_messages.create({
      data: {
        id,
        session_id: sessionId,
        role: 'assistant',
        model: metadata.model,
        prompt_version: metadata.prompt_version,
        persona_version: metadata.persona_version ?? null,
        risk_level: metadata.risk_level,
        content_ciphertext: new Uint8Array(
          await this.cipher.encrypt(content, id),
        ),
      },
    });
  }

  /** The protocol shown instead of a persona reply; kept so history shows what the user saw. */
  async storeProtocolMessage(
    sessionId: string,
    id: string,
    content: string,
    protocolVersion: string,
  ): Promise<ai_messages> {
    return this.prisma.ai_messages.create({
      data: {
        id,
        session_id: sessionId,
        role: 'protocol',
        model: 'protocol',
        prompt_version: protocolVersion.slice(0, 64),
        risk_level: 'crisis',
        content_ciphertext: new Uint8Array(
          await this.cipher.encrypt(content, id),
        ),
      },
    });
  }

  /** Latest `limit` messages, oldest first, decrypted. */
  async recent(sessionId: string, limit: number): Promise<PlainMessage[]> {
    if (limit <= 0) return [];
    const rows = await this.prisma.ai_messages.findMany({
      where: { session_id: sessionId },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    const plain = await Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        role: row.role,
        content: await this.cipher.decrypt(row.content_ciphertext, row.id),
        created_at: row.created_at,
        ...(row.client_message_id
          ? { client_message_id: row.client_message_id }
          : {}),
      })),
    );
    return plain.reverse();
  }

  /**
   * The first user message of each session, decrypted and cut to `maxChars` — the title of a
   * session in the user's own history list. Sessions without a user message are absent.
   */
  async firstUserMessages(
    sessionIds: string[],
    maxChars: number,
  ): Promise<Map<string, string>> {
    if (sessionIds.length === 0) return new Map();
    const rows = await this.prisma.ai_messages.findMany({
      where: { session_id: { in: sessionIds }, role: 'user' },
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      distinct: ['session_id'],
    });
    const entries = await Promise.all(
      rows.map(async (row) => {
        const text = (await this.cipher.decrypt(row.content_ciphertext, row.id))
          .replace(/\s+/g, ' ')
          .trim();
        const preview =
          text.length <= maxChars
            ? text
            : `${text.slice(0, maxChars - 1).trimEnd()}…`;
        return [row.session_id, preview] as const;
      }),
    );
    return new Map(entries);
  }

  /** True when `messageId` is the newest message of its session (i.e. still unanswered). */
  async isLatest(sessionId: string, messageId: string): Promise<boolean> {
    const latest = await this.prisma.ai_messages.findFirst({
      where: { session_id: sessionId },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    return latest?.id === messageId;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}
