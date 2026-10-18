import { Injectable, Logger } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import type { Protocol } from '../content/content.schemas';
import { ContentService } from '../content/content.service';
import { PrismaService } from '../database/prisma.service';
import { MetricsService } from '../observability/metrics.service';
import { AlertService } from './alert.service';
import { FALLBACK_L1, FALLBACK_PROTOCOL } from './fallback';
import { checkL1, compileL1, type CompiledL1, type L1Result } from './l1';
import type { RiskLevel } from './risk';

export interface EscalationProtocol extends Protocol {
  /** `content/<version>`, or `fallback` for the engineering safety floor. */
  version: string;
}

export interface SafetyEventInput {
  sessionId: string | null;
  messageId?: string;
  layer: 'l1' | 'l2' | 'l3' | 'system' | 'instrument';
  level: RiskLevel;
  signals: string[];
}

@Injectable()
export class SafetyService {
  private readonly logger = new Logger(SafetyService.name);
  private compiled: { key: string; l1: CompiledL1 } | null = null;

  constructor(
    private readonly content: ContentService,
    private readonly prisma: PrismaService,
    private readonly alerts: AlertService,
    private readonly metrics: MetricsService,
  ) {}

  /** L1: deterministic and local (02 §7.2). Never throws — a content failure falls back. */
  async l1(text: string): Promise<L1Result> {
    return checkL1(text, await this.l1Phrases());
  }

  async protocol(level: 'elevated' | 'crisis'): Promise<EscalationProtocol> {
    try {
      const active = await this.content.active('protocol', level);
      if (active && active.body.level === level) {
        return { ...active.body, version: `content/${active.version}` };
      }
    } catch (error) {
      this.logger.error({
        err: { name: error instanceof Error ? error.name : 'unknown' },
      });
    }
    this.logger.error(
      { fallback: 'protocol', level },
      'No active protocol content; using fallback',
    );
    return { ...FALLBACK_PROTOCOL, level, version: 'fallback' };
  }

  /** Audit trail without content; every `crisis` also raises an internal alert. */
  async record(event: SafetyEventInput): Promise<void> {
    await this.prisma.ai_safety_events.create({
      data: {
        id: uuidv7(),
        session_id: event.sessionId,
        message_id: event.messageId,
        layer: event.layer,
        level: event.level,
        signals: event.signals,
      },
    });
    if (event.level === 'crisis') {
      // SLO: every crisis detection is followed by `crisis_protocol_sent` (02 §12.2).
      this.metrics.record('crisis_detected', { layer: event.layer });
      await this.alerts.crisis({
        session_id: event.sessionId,
        layer: event.layer,
        at: new Date().toISOString(),
      });
    }
  }

  private async l1Phrases(): Promise<CompiledL1> {
    try {
      const active = await this.content.active('l1_phrases', 'default');
      if (active) {
        const key = `content/${active.version}`;
        if (this.compiled?.key !== key)
          this.compiled = { key, l1: compileL1(active.body) };
        return this.compiled.l1;
      }
    } catch (error) {
      this.logger.error({
        err: { name: error instanceof Error ? error.name : 'unknown' },
      });
    }
    this.logger.error(
      { fallback: 'l1_phrases' },
      'No active L1 phrases; using fallback',
    );
    if (this.compiled?.key !== 'fallback') {
      this.compiled = { key: 'fallback', l1: compileL1(FALLBACK_L1) };
    }
    return this.compiled.l1;
  }
}
