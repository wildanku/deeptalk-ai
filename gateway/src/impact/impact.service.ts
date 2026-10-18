import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

const DAY_MS = 86_400_000;

export interface ImpactReport {
  window: { days: number; from: string; to: string };
  conversations: { sessions: number; users: number; crisis_sessions: number };
  routines: {
    proposed: number;
    accepted: number;
    acceptance_rate: number | null;
    active_now: number;
    /** Share of planned item-days marked done in the last 7 days, over active routines. */
    adherence_7d: number | null;
  };
  assessments: {
    offered: number;
    opened: number;
    open_rate: number | null;
    users: number;
  };
  psikologs: {
    proposed: number;
    approved: number;
    booked: number;
    viewed: number;
    users_booked: number;
  };
  safety: {
    eval_ratings: number;
    eval_safe_rate: number | null;
    events: { elevated: number; crisis: number; reviewed: number };
    reports: { total: number; harmful: number; reviewed: number };
  };
  /** Phase 8: check-in, screening, inventory — counts only, never scores. */
  self_checks: {
    checkin: number;
    screening: number;
    personality: number;
    users: number;
    /** Answers that reached a safety item (protocol shown). */
    flagged: number;
  };
}

const rate = (part: number, total: number): number | null =>
  total === 0 ? null : Math.round((part / total) * 1000) / 1000;

/**
 * Impact indicators of Konsep §8 for the dashboard: routines created and followed, referrals to
 * assessments and psikologs, and psikolog safety ratings. Aggregates only — no user IDs, no
 * content — over a rolling window.
 */
@Injectable()
export class ImpactService {
  constructor(private readonly prisma: PrismaService) {}

  async report(days: number, now = new Date()): Promise<ImpactReport> {
    const from = new Date(now.getTime() - days * DAY_MS);
    const since = { gte: from };
    const weekAgo = new Date(now.getTime() - 7 * DAY_MS);

    const [
      sessions,
      sessionUsers,
      crisisSessions,
      proposals,
      accepted,
      active,
      referralsOffered,
      referralsOpened,
      referralUsers,
      handoffs,
      ratings,
      safeRatings,
      events,
      reviewedEvents,
      reports,
      harmfulReports,
      reviewedReports,
      selfChecks,
      selfCheckUsers,
      flaggedSelfChecks,
    ] = await Promise.all([
      this.prisma.ai_sessions.count({ where: { started_at: since } }),
      this.prisma.ai_sessions.groupBy({
        by: ['user_id'],
        where: { started_at: since },
      }),
      this.prisma.ai_sessions.count({
        where: { started_at: since, max_risk_level: 'crisis' },
      }),
      this.prisma.ai_routine_proposals.count({ where: { created_at: since } }),
      this.prisma.ai_routine_proposals.count({
        where: { created_at: since, status: 'accepted' },
      }),
      this.prisma.ai_user_routines.findMany({
        where: { status: 'active' },
        select: { id: true, routine: true, started_at: true },
      }),
      this.prisma.ai_assessment_referrals.count({
        where: { offered_at: since },
      }),
      this.prisma.ai_assessment_referrals.count({
        where: { offered_at: since, opened_at: { not: null } },
      }),
      this.prisma.ai_assessment_referrals.groupBy({
        by: ['user_id'],
        where: { offered_at: since },
      }),
      this.prisma.ai_handoffs.findMany({
        where: { created_at: since },
        select: { status: true, user_id: true },
      }),
      this.prisma.ai_eval_ratings.count({ where: { rated_at: since } }),
      this.prisma.ai_eval_ratings.count({
        where: { rated_at: since, safe: true },
      }),
      this.prisma.ai_safety_events.groupBy({
        by: ['level'],
        where: { created_at: since, level: { in: ['elevated', 'crisis'] } },
        _count: { _all: true },
      }),
      this.prisma.ai_safety_events.count({
        where: {
          created_at: since,
          level: { in: ['elevated', 'crisis'] },
          reviewed_at: { not: null },
        },
      }),
      this.prisma.ai_message_reports.count({ where: { created_at: since } }),
      this.prisma.ai_message_reports.count({
        where: { created_at: since, reason: 'harmful' },
      }),
      this.prisma.ai_message_reports.count({
        where: { created_at: since, reviewed_at: { not: null } },
      }),
      this.prisma.ai_instrument_responses.groupBy({
        by: ['purpose'],
        where: { created_at: since },
        _count: { _all: true },
      }),
      this.prisma.ai_instrument_responses.groupBy({
        by: ['user_id'],
        where: { created_at: since },
      }),
      this.prisma.ai_instrument_responses.count({
        where: { created_at: since, safety_level: { not: 'normal' } },
      }),
    ]);

    // Adherence: done item-days in the last 7 days / item-days the active routines had.
    let planned = 0;
    let done = 0;
    if (active.length > 0) {
      done = await this.prisma.ai_routine_logs.count({
        where: {
          user_routine_id: { in: active.map((r) => r.id) },
          date: { gte: weekAgo },
          done: true,
        },
      });
      for (const routine of active) {
        const items = Array.isArray(
          (routine.routine as { items?: unknown[] } | null)?.items,
        )
          ? (routine.routine as { items: unknown[] }).items.length
          : 0;
        const startedDaysAgo = Math.ceil(
          (now.getTime() - routine.started_at.getTime()) / DAY_MS,
        );
        planned += items * Math.max(1, Math.min(7, startedDaysAgo));
      }
    }

    const level = (name: string) =>
      events.find((row) => row.level === name)?._count._all ?? 0;
    const purpose = (name: string) =>
      selfChecks.find((row) => row.purpose === name)?._count._all ?? 0;
    const booked = handoffs.filter(
      (h) => h.status === 'linked' || h.status === 'viewed',
    );

    return {
      window: { days, from: from.toISOString(), to: now.toISOString() },
      conversations: {
        sessions,
        users: sessionUsers.length,
        crisis_sessions: crisisSessions,
      },
      routines: {
        proposed: proposals,
        accepted,
        acceptance_rate: rate(accepted, proposals),
        active_now: active.length,
        adherence_7d: rate(done, planned),
      },
      assessments: {
        offered: referralsOffered,
        opened: referralsOpened,
        open_rate: rate(referralsOpened, referralsOffered),
        users: referralUsers.length,
      },
      psikologs: {
        proposed: handoffs.length,
        approved: handoffs.filter(
          (h) => h.status !== 'draft' && h.status !== 'declined',
        ).length,
        booked: booked.length,
        viewed: handoffs.filter((h) => h.status === 'viewed').length,
        users_booked: new Set(booked.map((h) => h.user_id)).size,
      },
      safety: {
        eval_ratings: ratings,
        eval_safe_rate: rate(safeRatings, ratings),
        events: {
          elevated: level('elevated'),
          crisis: level('crisis'),
          reviewed: reviewedEvents,
        },
        reports: {
          total: reports,
          harmful: harmfulReports,
          reviewed: reviewedReports,
        },
      },
      self_checks: {
        checkin: purpose('checkin'),
        screening: purpose('screening'),
        personality: purpose('personality'),
        users: selfCheckUsers.length,
        flagged: flaggedSelfChecks,
      },
    };
  }
}
