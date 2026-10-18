import { NotFoundException } from '@nestjs/common';
import type { AiPrincipal } from '../auth/ai-principal';
import type { PrismaService } from '../database/prisma.service';
import type { HandoffsService } from '../handoffs/handoffs.service';
import type { MessagesService } from '../messages/messages.service';
import type { RecommendationsService } from '../recommendations/recommendations.service';
import type { RedisService } from '../redis/redis.service';
import type { SessionStateService } from '../realtime/session-state.service';
import type { MemoryService } from './memory.service';
import { SessionsController } from './sessions.controller';
import type { SessionsService } from './sessions.service';

const USER = { sub: 'u1', role: 'user' } as unknown as AiPrincipal;

function row(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    user_id: 'u1',
    status: 'ended',
    started_at: new Date(`2026-10-16T0${id.length % 9}:00:00Z`),
    ended_at: new Date('2026-10-16T09:00:00Z'),
    end_reason: 'idle',
    persona_id: 'ps-1',
    router_reason: 'karena fokus pada stres kerja',
    ...overrides,
  };
}

describe('SessionsController (history and "Akhiri sesi")', () => {
  const prisma = {
    ai_sessions: { findMany: jest.fn(), findFirst: jest.fn() },
    ai_personas: { findMany: jest.fn() },
    ai_routine_proposals: { findMany: jest.fn() },
    ai_handoffs: { findMany: jest.fn() },
  };
  const redis = { getJson: jest.fn() };
  const state = { view: jest.fn() };
  const recommendations = { forSession: jest.fn() };
  const messages = { firstUserMessages: jest.fn(), recent: jest.fn() };
  const sessions = { close: jest.fn(), findActive: jest.fn() };
  let controller: SessionsController;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.ai_personas.findMany.mockResolvedValue([
      { id: 'ps-1', display_name: 'Mindfulness & Penerimaan' },
    ]);
    prisma.ai_routine_proposals.findMany.mockResolvedValue([]);
    recommendations.forSession.mockResolvedValue([]);
    controller = new SessionsController(
      sessions as unknown as SessionsService,
      messages as unknown as MessagesService,
      state as unknown as SessionStateService,
      {} as MemoryService,
      {} as HandoffsService,
      prisma as unknown as PrismaService,
      recommendations as unknown as RecommendationsService,
      redis as unknown as RedisService,
    );
  });

  describe('current session after a reload', () => {
    const open = row('00000000-0000-7000-8000-00000000000a', {
      status: 'active',
      last_activity_at: new Date(),
      active_seconds: 10,
    });
    const userMessage = {
      id: 'm-user',
      role: 'user',
      content: 'halo',
      created_at: new Date(),
      client_message_id: 'c-1',
    };

    beforeEach(() => {
      sessions.findActive.mockResolvedValue(open);
      state.view.mockResolvedValue({ status: 'active' });
      prisma.ai_routine_proposals.findMany.mockResolvedValue([]);
      prisma.ai_handoffs.findMany.mockResolvedValue([]);
      recommendations.forSession.mockResolvedValue([]);
    });

    it('reports the reply still being written, by ID only', async () => {
      const pending = {
        user_message_id: 'm-user',
        message_id: 'm-reply',
        started_at: '2026-10-18T01:00:00.000Z',
      };
      messages.recent.mockResolvedValue([userMessage]);
      redis.getJson.mockResolvedValue(pending);

      const current = await controller.current(USER);

      expect(redis.getJson).toHaveBeenCalledWith(`turn:inflight:${open.id}`);
      expect(current.pending_reply).toEqual(pending);
      expect(current.messages[0].client_message_id).toBe('c-1');
    });

    it('drops a marker whose reply is already stored, or when Redis is down', async () => {
      messages.recent.mockResolvedValue([
        userMessage,
        {
          id: 'm-reply',
          role: 'assistant',
          content: 'hai',
          created_at: new Date(),
        },
      ]);
      redis.getJson.mockResolvedValue({
        user_message_id: 'm-user',
        message_id: 'm-reply',
        started_at: '2026-10-18T01:00:00.000Z',
      });
      expect((await controller.current(USER)).pending_reply).toBeNull();

      redis.getJson.mockRejectedValue(new Error('down'));
      expect((await controller.current(USER)).pending_reply).toBeNull();
    });
  });

  it('lists only the user’s sessions with messages, with title and persona label', async () => {
    const rows = Array.from({ length: 21 }, (_, i) =>
      row(`00000000-0000-7000-8000-${String(i).padStart(12, '0')}`),
    );
    prisma.ai_sessions.findMany.mockResolvedValue(rows);
    messages.firstUserMessages.mockResolvedValue(
      new Map([[rows[0].id, 'Belakangan aku stres sama kerjaan']]),
    );

    const page = await controller.list(USER, {});

    expect(prisma.ai_sessions.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { user_id: 'u1', messages: { some: {} } },
        take: 21,
      }),
    );
    expect(page.items).toHaveLength(20);
    expect(page.items[0]).toMatchObject({
      preview: 'Belakangan aku stres sama kerjaan',
      persona_label: 'DeepTalk AI dengan pendekatan Mindfulness & Penerimaan',
    });
    expect(page.items[1].preview).toBeNull();
    expect(page.next_before).toBe(rows[19].started_at.toISOString());
  });

  it('answers 404 for a session that is not the user’s', async () => {
    prisma.ai_sessions.findFirst.mockResolvedValue(null);

    await expect(
      controller.detail(USER, '00000000-0000-7000-8000-000000000001'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      controller.end(USER, '00000000-0000-7000-8000-000000000001'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.ai_sessions.findFirst).toHaveBeenCalledWith({
      where: { id: '00000000-0000-7000-8000-000000000001', user_id: 'u1' },
    });
    expect(sessions.close).not.toHaveBeenCalled();
  });

  it('returns the transcript of one session', async () => {
    const session = row('s1');
    prisma.ai_sessions.findFirst.mockResolvedValue(session);
    messages.recent.mockResolvedValue([
      { id: 'm1', role: 'user', content: 'halo', created_at: new Date() },
      { id: 'm2', role: 'assistant', content: 'Hai', created_at: new Date() },
    ]);

    const detail = await controller.detail(USER, 's1');

    expect(detail.messages).toHaveLength(2);
    expect(detail.session).toMatchObject({
      id: 's1',
      preview: 'halo',
      router_reason: 'karena fokus pada stres kerja',
    });
  });

  it('returns the session’s cards, oldest first, anchored to their replies', async () => {
    prisma.ai_sessions.findFirst.mockResolvedValue(row('s1'));
    messages.recent.mockResolvedValue([]);
    prisma.ai_routine_proposals.findMany.mockResolvedValue([
      {
        id: 'rp1',
        routine: { topic: 'tidur', title: 'Tidur', items: [] },
        status: 'rejected',
        message_id: 'm4',
        created_at: new Date('2026-10-16T08:02:00Z'),
      },
    ]);
    recommendations.forSession.mockResolvedValue([
      {
        recommendation_id: 'rec1',
        message_id: 'm2',
        reason: 'r',
        psikologs: [],
        opened_psikolog_id: null,
        created_at: new Date('2026-10-16T08:01:00Z'),
      },
    ]);

    const detail = await controller.detail(USER, 's1');

    expect(detail.cards.map((c) => [c.type, c.message_id])).toEqual([
      ['recommendation', 'm2'],
      ['routine', 'm4'],
    ]);
    expect(detail.cards[1]).toMatchObject({ status: 'rejected' });
  });

  it('ends an open session as user_ended, and is idempotent once ended', async () => {
    prisma.ai_sessions.findFirst.mockResolvedValueOnce(
      row('s1', { status: 'active', ended_at: null, end_reason: null }),
    );
    await controller.end(USER, 's1');
    expect(sessions.close).toHaveBeenCalledWith('s1', 'user_ended');

    sessions.close.mockClear();
    prisma.ai_sessions.findFirst.mockResolvedValueOnce(row('s1'));
    await controller.end(USER, 's1');
    expect(sessions.close).not.toHaveBeenCalled();
  });
});
