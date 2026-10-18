import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsBoolean, IsISO8601, IsOptional } from 'class-validator';
import { AiAuthGuard, AiRoles, CurrentPrincipal } from '../auth/ai-auth.guard';
import type { AiPrincipal } from '../auth/ai-principal';
import { PrismaService } from '../database/prisma.service';
import { HandoffsService } from '../handoffs/handoffs.service';
import {
  MessagesService,
  type PlainMessage,
} from '../messages/messages.service';
import {
  RecommendationsService,
  type RecommendationCard,
} from '../recommendations/recommendations.service';
import { SessionStateService } from '../realtime/session-state.service';
import type { RoutineSnapshot } from '../routines/routine-rules';
import { MemoryService } from './memory.service';
import { RedisService } from '../redis/redis.service';
import { type PendingReply, turnInflightKey } from './session-timers.service';
import { SessionsService } from './sessions.service';

const HISTORY_PAGE = 50;
/** Sessions per page of the user's history list. */
const SESSIONS_PAGE = 20;
/** A whole session fits: 30 active minutes rarely reach 100 turns. */
const TRANSCRIPT_LIMIT = 200;
const PREVIEW_CHARS = 90;

class SessionsQuery {
  /** Cursor: sessions started before this time. */
  @IsOptional()
  @IsISO8601()
  before?: string;
}

export interface SessionSummaryView {
  id: string;
  status: string;
  started_at: Date;
  ended_at: Date | null;
  end_reason: string | null;
  /** "DeepTalk AI dengan pendekatan …", or null for a session without a persona. */
  persona_label: string | null;
  /** The user's first message, shortened — the session's title in the history list. */
  preview: string | null;
}

class MemorySettingsDto {
  @IsBoolean()
  memory_enabled: boolean;
}

/** A card offered in a session, as the chat shows it under the reply it belongs to. */
export type SessionCardView =
  | {
      type: 'routine';
      proposal_id: string;
      routine: RoutineSnapshot;
      status: string;
      message_id: string | null;
      created_at: Date;
    }
  | (RecommendationCard & {
      type: 'recommendation';
      opened_psikolog_id: string | null;
      created_at: Date;
    });

export interface CurrentSessionView {
  session: {
    id: string;
    status: string;
    started_at: Date;
    last_activity_at: Date;
    active_seconds: number;
  } | null;
  messages: PlainMessage[];
  state: Awaited<ReturnType<SessionStateService['view']>>;
  /** Every routine and recommendation card of the session, decided or not, oldest first. */
  cards: SessionCardView[];
  /**
   * The reply still being written, so a client that reloaded mid-turn shows "replying" and
   * waits for `ai.done` instead of offering a resend. Null when no turn is running.
   */
  pending_reply: PendingReply | null;
  /** Cards still awaiting a decision, so a reconnect can show them again. */
  pending_cards: {
    routines: { proposal_id: string; routine: RoutineSnapshot }[];
    handoffs: Awaited<ReturnType<HandoffsService['view']>>[];
  };
}

/**
 * Lets a client rebuild the chat after a reconnect (e.g. a deploy moved it to another
 * instance) — any reply finished while it was offline is here.
 */
@Controller()
@UseGuards(AiAuthGuard)
@AiRoles('user')
export class SessionsController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly messages: MessagesService,
    private readonly state: SessionStateService,
    private readonly memory: MemoryService,
    private readonly handoffs: HandoffsService,
    private readonly prisma: PrismaService,
    private readonly recommendations: RecommendationsService,
    private readonly redis: RedisService,
  ) {}

  @Get('sessions/current')
  async current(
    @CurrentPrincipal() principal: AiPrincipal,
  ): Promise<CurrentSessionView> {
    const session = await this.sessions.findActive(principal.sub);
    const state = await this.state.view(principal.sub, session);
    if (!session) {
      return {
        session: null,
        messages: [],
        state,
        cards: [],
        pending_reply: null,
        pending_cards: { routines: [], handoffs: [] },
      };
    }
    const [messages, proposals, drafts, cards, pendingReply] =
      await Promise.all([
        this.messages.recent(session.id, HISTORY_PAGE),
        this.prisma.ai_routine_proposals.findMany({
          where: { session_id: session.id, status: 'proposed' },
        }),
        this.prisma.ai_handoffs.findMany({
          where: { session_id: session.id, status: 'draft' },
          select: { id: true },
        }),
        this.cards(session.id),
        this.redis
          .getJson<PendingReply>(turnInflightKey(session.id))
          .catch(() => null),
      ]);
    return {
      session: {
        id: session.id,
        status: session.status,
        started_at: session.started_at,
        last_activity_at: session.last_activity_at,
        active_seconds: session.active_seconds,
      },
      messages,
      state,
      cards,
      // Already answered (the marker can outlive the stored reply by a moment) → not pending.
      pending_reply:
        pendingReply &&
        !messages.some((message) => message.id === pendingReply.message_id)
          ? pendingReply
          : null,
      pending_cards: {
        routines: proposals.map((proposal) => ({
          proposal_id: proposal.id,
          routine: proposal.routine as unknown as RoutineSnapshot,
        })),
        handoffs: await Promise.all(
          drafts.map((draft) => this.handoffs.view(principal.sub, draft.id)),
        ),
      },
    };
  }

  /**
   * The user's own sessions that still have messages, newest first. Sessions emptied by
   * "hapus riwayat" or retention stay as quota rows but are not listed.
   */
  @Get('sessions')
  async list(
    @CurrentPrincipal() principal: AiPrincipal,
    @Query() query: SessionsQuery,
  ): Promise<{ items: SessionSummaryView[]; next_before: string | null }> {
    const rows = await this.prisma.ai_sessions.findMany({
      where: {
        user_id: principal.sub,
        messages: { some: {} },
        ...(query.before ? { started_at: { lt: new Date(query.before) } } : {}),
      },
      orderBy: [{ started_at: 'desc' }, { id: 'desc' }],
      take: SESSIONS_PAGE + 1,
    });
    const page = rows.slice(0, SESSIONS_PAGE);
    const [previews, labels] = await Promise.all([
      this.messages.firstUserMessages(
        page.map((row) => row.id),
        PREVIEW_CHARS,
      ),
      this.personaLabels(page.map((row) => row.persona_id)),
    ]);
    return {
      items: page.map((row) => this.summary(row, labels, previews)),
      next_before:
        rows.length > SESSIONS_PAGE
          ? page[page.length - 1].started_at.toISOString()
          : null,
    };
  }

  /** One of the user's sessions with its transcript; anyone else's is 404 (02 §10.2). */
  @Get('sessions/:id')
  async detail(
    @CurrentPrincipal() principal: AiPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{
    session: SessionSummaryView & { router_reason: string | null };
    messages: PlainMessage[];
    cards: SessionCardView[];
  }> {
    const session = await this.own(principal.sub, id);
    const [messages, labels, cards] = await Promise.all([
      this.messages.recent(session.id, TRANSCRIPT_LIMIT),
      this.personaLabels([session.persona_id]),
      this.cards(session.id),
    ]);
    const first = messages.find((message) => message.role === 'user');
    return {
      session: {
        ...this.summary(
          session,
          labels,
          new Map(first ? [[session.id, first.content]] : []),
        ),
        router_reason: session.router_reason,
      },
      messages,
      cards,
    };
  }

  /**
   * "Akhiri sesi": ends the user's open session now. Idempotent — an ended session answers
   * 204 too. The socket receives `session.ended` as with any other ending.
   */
  @Post('sessions/:id/end')
  @HttpCode(204)
  async end(
    @CurrentPrincipal() principal: AiPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    const session = await this.own(principal.sub, id);
    if (session.status !== 'ended') {
      await this.sessions.close(session.id, 'user_ended');
    }
  }

  private async cards(sessionId: string): Promise<SessionCardView[]> {
    const [proposals, recommendations] = await Promise.all([
      this.prisma.ai_routine_proposals.findMany({
        where: { session_id: sessionId },
        orderBy: { created_at: 'asc' },
      }),
      this.recommendations.forSession(sessionId),
    ]);
    const cards: SessionCardView[] = [
      ...proposals.map((proposal) => ({
        type: 'routine' as const,
        proposal_id: proposal.id,
        routine: proposal.routine as unknown as RoutineSnapshot,
        status: proposal.status,
        message_id: proposal.message_id,
        created_at: proposal.created_at,
      })),
      ...recommendations.map((card) => ({
        type: 'recommendation' as const,
        ...card,
      })),
    ];
    return cards.sort(
      (a, b) => a.created_at.getTime() - b.created_at.getTime(),
    );
  }

  private async own(userId: string, id: string) {
    const session = await this.prisma.ai_sessions.findFirst({
      where: { id, user_id: userId },
    });
    if (!session) throw new NotFoundException('Session not found');
    return session;
  }

  private async personaLabels(
    ids: (string | null)[],
  ): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((id): id is string => !!id))];
    if (wanted.length === 0) return new Map();
    const personas = await this.prisma.ai_personas.findMany({
      where: { id: { in: wanted } },
      select: { id: true, display_name: true },
    });
    return new Map(
      personas.map((p) => [
        p.id,
        `DeepTalk AI dengan pendekatan ${p.display_name}`,
      ]),
    );
  }

  private summary(
    row: {
      id: string;
      status: string;
      started_at: Date;
      ended_at: Date | null;
      end_reason: string | null;
      persona_id: string | null;
    },
    labels: Map<string, string>,
    previews: Map<string, string>,
  ): SessionSummaryView {
    return {
      id: row.id,
      status: row.status,
      started_at: row.started_at,
      ended_at: row.ended_at,
      end_reason: row.end_reason,
      persona_label: row.persona_id
        ? (labels.get(row.persona_id) ?? null)
        : null,
      preview: previews.get(row.id) ?? null,
    };
  }

  /** Memory settings (02 §6.5): turning memory off deletes stored summaries. */
  @Get('me/settings')
  async settings(@CurrentPrincipal() principal: AiPrincipal) {
    return { memory_enabled: await this.memory.enabled(principal.sub) };
  }

  @Patch('me/settings')
  async updateSettings(
    @CurrentPrincipal() principal: AiPrincipal,
    @Body() body: MemorySettingsDto,
  ) {
    await this.memory.setEnabled(principal.sub, body.memory_enabled);
    return { memory_enabled: body.memory_enabled };
  }

  @Delete('me/memory')
  @HttpCode(204)
  async clearMemory(@CurrentPrincipal() principal: AiPrincipal): Promise<void> {
    await this.memory.clear(principal.sub);
  }
}
