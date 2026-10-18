import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import { type LoggerOptions, stdTimeFunctions } from 'pino';
import type { Environment } from '../config/env.schema';

/**
 * Paths censored in every log line. Conversation content must never reach logs, traces,
 * metrics, or alerts (AGENT.md rule 4) — this is a safety net, not a licence to log payloads.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-ai-service-token"]',
  'req.headers["x-webhook-token"]',
  'req.body',
  'res.headers["set-cookie"]',
  'token',
  'content',
  'delta',
  'summary',
  '*.token',
  '*.content',
  '*.delta',
  '*.summary',
  '*.ai_access_token',
];

/**
 * Human-readable logs only where `pino-pretty` is installed (a developer machine). The runtime
 * image has production dependencies only, so a `development` deployment — e.g. the `dev`
 * environment on Cloud Run, which needs `NODE_ENV=development` to use DRAFT content — logs JSON
 * for Cloud Logging instead of crashing on a missing transport.
 */
export function prettyAvailable(
  resolve: (id: string) => string = require.resolve,
): boolean {
  try {
    resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
}

/** Cloud Logging reads `severity`; pino's numeric `level` is not understood. */
const SEVERITY: Record<string, string> = {
  trace: 'DEBUG',
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARNING',
  error: 'ERROR',
  fatal: 'CRITICAL',
};

export function buildPinoOptions(
  env: Pick<Environment, 'LOG_LEVEL' | 'NODE_ENV'>,
  pretty: boolean = prettyAvailable(),
): LoggerOptions {
  return {
    level: env.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    messageKey: 'message',
    // ISO `time` and no pid/hostname: Cloud Run attaches instance metadata itself.
    timestamp: stdTimeFunctions.isoTime,
    base: undefined,
    formatters: {
      level: (label) => ({ severity: SEVERITY[label] ?? 'DEFAULT' }),
    },
    ...(env.NODE_ENV === 'development' && pretty
      ? { transport: { target: 'pino-pretty', options: { singleLine: true } } }
      : {}),
  };
}

/** Request line without the query string (tokens and IDs can travel there). */
export function stripQuery(url: string | undefined): string | undefined {
  return url?.split('?')[0];
}

export function buildLoggerParams(
  env: Pick<Environment, 'LOG_LEVEL' | 'NODE_ENV'>,
): Params {
  return {
    pinoHttp: {
      ...buildPinoOptions(env),
      autoLogging: { ignore: (req) => stripQuery(req.url) === '/v1/health' },
      serializers: {
        req: (req: IncomingMessage & { id?: unknown }) => ({
          id: req.id,
          method: req.method,
          url: stripQuery(req.url),
        }),
        res: (res: ServerResponse) => ({ statusCode: res.statusCode }),
      },
    },
  };
}
