import { Injectable, Logger } from '@nestjs/common';

export type MetricValue = number | boolean | string;

/**
 * Basic metrics as structured log lines (`metric` field), turned into Cloud Monitoring
 * log-based metrics. Values are counts, durations, and enums only — never content or user IDs.
 */
@Injectable()
export class MetricsService {
  private readonly logger = new Logger('metrics');

  record(metric: string, fields: Record<string, MetricValue>): void {
    this.logger.log({ metric, ...fields });
  }
}
