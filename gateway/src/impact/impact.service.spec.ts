import type { PrismaService } from '../database/prisma.service';
import { ImpactService } from './impact.service';

const count = (value: number) => jest.fn().mockResolvedValue(value);

describe('ImpactService', () => {
  const now = new Date('2026-10-14T00:00:00Z');
  const prisma = {
    ai_sessions: {
      count: jest.fn(),
      groupBy: jest.fn().mockResolvedValue([{}, {}]),
    },
    ai_routine_proposals: { count: jest.fn() },
    ai_user_routines: {
      findMany: jest.fn().mockResolvedValue([
        // 2 items, started 30 days ago → 14 planned item-days in the last week.
        {
          id: 'r1',
          routine: { items: [{}, {}] },
          started_at: new Date('2026-09-14T00:00:00Z'),
        },
        // 1 item, started 2 days ago → 2 planned item-days.
        {
          id: 'r2',
          routine: { items: [{}] },
          started_at: new Date('2026-10-12T00:00:00Z'),
        },
      ]),
    },
    ai_routine_logs: { count: count(8) },
    ai_assessment_referrals: {
      count: jest.fn(),
      groupBy: jest.fn().mockResolvedValue([{}]),
    },
    ai_handoffs: {
      findMany: jest.fn().mockResolvedValue([
        { status: 'draft', user_id: 'a' },
        { status: 'approved', user_id: 'a' },
        { status: 'linked', user_id: 'b' },
        { status: 'viewed', user_id: 'b' },
        { status: 'declined', user_id: 'c' },
      ]),
    },
    ai_eval_ratings: { count: jest.fn() },
    ai_safety_events: {
      groupBy: jest.fn().mockResolvedValue([
        { level: 'elevated', _count: { _all: 3 } },
        { level: 'crisis', _count: { _all: 1 } },
      ]),
      count: count(2),
    },
    ai_message_reports: { count: jest.fn() },
    ai_instrument_responses: {
      groupBy: jest
        .fn()
        .mockResolvedValueOnce([
          { purpose: 'checkin', _count: { _all: 12 } },
          { purpose: 'screening', _count: { _all: 2 } },
        ])
        .mockResolvedValueOnce([{}, {}, {}]),
      count: jest.fn().mockResolvedValue(1),
    },
  };
  prisma.ai_sessions.count.mockResolvedValueOnce(5).mockResolvedValueOnce(1);
  prisma.ai_routine_proposals.count
    .mockResolvedValueOnce(4)
    .mockResolvedValueOnce(3);
  prisma.ai_assessment_referrals.count
    .mockResolvedValueOnce(10)
    .mockResolvedValueOnce(4);
  prisma.ai_eval_ratings.count
    .mockResolvedValueOnce(20)
    .mockResolvedValueOnce(19);
  prisma.ai_message_reports.count
    .mockResolvedValueOnce(2)
    .mockResolvedValueOnce(1)
    .mockResolvedValueOnce(2);

  it('computes the Konsep §8 indicators as aggregates', async () => {
    const report = await new ImpactService(
      prisma as unknown as PrismaService,
    ).report(30, now);
    expect(report.conversations).toEqual({
      sessions: 5,
      users: 2,
      crisis_sessions: 1,
    });
    expect(report.routines).toEqual({
      proposed: 4,
      accepted: 3,
      acceptance_rate: 0.75,
      active_now: 2,
      adherence_7d: 0.5, // 8 done / 16 planned
    });
    expect(report.assessments).toEqual({
      offered: 10,
      opened: 4,
      open_rate: 0.4,
      users: 1,
    });
    expect(report.psikologs).toEqual({
      proposed: 5,
      approved: 3,
      booked: 2,
      viewed: 1,
      users_booked: 1,
    });
    expect(report.safety).toEqual({
      eval_ratings: 20,
      eval_safe_rate: 0.95,
      events: { elevated: 3, crisis: 1, reviewed: 2 },
      reports: { total: 2, harmful: 1, reviewed: 2 },
    });
    expect(report.self_checks).toEqual({
      checkin: 12,
      screening: 2,
      personality: 0,
      users: 3,
      flagged: 1,
    });
    expect(JSON.stringify(report)).not.toMatch(/"user_id"/);
  });
});
