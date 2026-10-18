import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/env.schema';

export interface CrisisAlert {
  /**
   * Null for a crisis message refused by a gate before any session exists (Phase 4), or a
   * check-in/screening answer (Phase 8).
   */
  session_id: string | null;
  layer: string;
  at: string;
}

/**
 * Internal alert for every `crisis` event (02 §7.2): session ID, time, and layer only — never
 * message content or user identity. Always logged at CRITICAL (Cloud Monitoring log-based
 * alert); also posted to `ALERT_WEBHOOK_URL` (on-call channel) when configured. Follow-up
 * policy is Q5; on-call ownership is Q12.
 */
@Injectable()
export class AlertService {
  private readonly logger = new Logger('alerts');
  private readonly webhookUrl: string | undefined;

  constructor(config: ConfigService<Environment, true>) {
    this.webhookUrl = config.get('ALERT_WEBHOOK_URL', { infer: true });
  }

  async crisis(alert: CrisisAlert): Promise<void> {
    this.logger.fatal({ alert: 'ai_crisis', ...alert });
    if (!this.webhookUrl) return;
    try {
      await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: `DeepTalk AI: kejadian crisis (${alert.layer}) pada sesi ${alert.session_id ?? 'tanpa sesi'}, ${alert.at}`,
          ...alert,
        }),
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      // The CRITICAL log line above is the alert of record; the webhook is best effort.
      this.logger.error({
        alert: 'ai_crisis_webhook_failed',
        session_id: alert.session_id,
      });
    }
  }
}
