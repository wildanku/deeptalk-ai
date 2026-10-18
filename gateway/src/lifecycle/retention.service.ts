import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/env.schema';
import { PrismaService } from '../database/prisma.service';

const DAY_MS = 86_400_000;

export interface RetentionResult {
  messages: number;
  summaries: number;
  safety_events: number;
  routine_logs: number;
  instrument_responses: number;
  outbox: number;
}

/**
 * Daily retention job (02 §9.3). Periods for personal data are Q10 (legal) and stay unset —
 * nothing is deleted — until decided. Only finished sessions lose messages, so a long-running
 * conversation is never cut in the middle.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Environment, true>,
  ) {}

  async run(now = new Date()): Promise<RetentionResult> {
    const cutoff = (days: number | undefined) =>
      days === undefined ? null : new Date(now.getTime() - days * DAY_MS);
    const messages = cutoff(
      this.config.get('RETENTION_MESSAGES_DAYS', { infer: true }),
    );
    const summaries = cutoff(
      this.config.get('RETENTION_SUMMARIES_DAYS', { infer: true }),
    );
    const safety = cutoff(
      this.config.get('RETENTION_SAFETY_EVENTS_DAYS', { infer: true }),
    );
    const logs = cutoff(
      this.config.get('RETENTION_ROUTINE_LOGS_DAYS', { infer: true }),
    );
    const instruments = cutoff(
      this.config.get('RETENTION_INSTRUMENT_RESPONSES_DAYS', { infer: true }),
    );
    const outbox = cutoff(
      this.config.get('OUTBOX_RETENTION_DAYS', { infer: true }),
    );

    const result: RetentionResult = {
      messages: messages
        ? await this.prisma.$executeRaw`
            DELETE FROM ai_messages m USING ai_sessions s
            WHERE m.session_id = s.id AND s.status = 'ended' AND m.created_at < ${messages}`
        : 0,
      summaries: summaries
        ? (
            await this.prisma.ai_session_summaries.deleteMany({
              where: { created_at: { lt: summaries } },
            })
          ).count
        : 0,
      safety_events: safety
        ? (
            await this.prisma.ai_safety_events.deleteMany({
              where: { created_at: { lt: safety } },
            })
          ).count
        : 0,
      routine_logs: logs
        ? (
            await this.prisma.ai_routine_logs.deleteMany({
              where: { date: { lt: logs } },
            })
          ).count
        : 0,
      instrument_responses: instruments
        ? (
            await this.prisma.ai_instrument_responses.deleteMany({
              where: { local_date: { lt: instruments } },
            })
          ).count
        : 0,
      outbox: outbox
        ? (
            await this.prisma.ai_outbox.deleteMany({
              where: {
                status: { in: ['done', 'failed'] },
                updated_at: { lt: outbox },
              },
            })
          ).count
        : 0,
    };
    this.logger.log({ retention: result });
    return result;
  }
}
