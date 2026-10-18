import { z } from 'zod';
import { parseCorsOrigins } from '../common/http/cors';

const KMS_KEY_NAME =
  /^projects\/[^/]+\/locations\/[^/]+\/keyRings\/[^/]+\/cryptoKeys\/[^/]+$/;

/**
 * Integration settings that may be left unset in local development (the dependent feature then
 * fails closed — e.g. a guard answers 503) but must be present in production.
 */
const REQUIRED_IN_PRODUCTION = [
  'AI_JWKS_URL',
  'DEEPTALK_API_URL',
  'AI_SERVICE_TOKEN',
  'INBOUND_WEBHOOK_TOKEN',
  'AGENT_URL',
  'MESSAGE_KMS_KEY',
  'CORS_ORIGINS',
  'SCHEDULER_TOKEN',
  'TASKS_TOKEN',
  'TASKS_TARGET_URL',
] as const;

const seconds = (fallback: number) =>
  z.coerce.number().int().positive().default(fallback);

export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    // Cloud Run injects PORT (8080 by default).
    PORT: z.coerce.number().int().min(1).max(65535).default(8080),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
      .default('info'),
    DEFAULT_TIMEZONE: z.string().min(1).default('Asia/Jakarta'),

    DATABASE_URL: z.string().url(),
    // Connections per instance (read by PrismaService before config loads).
    DATABASE_POOL_MAX: z.coerce.number().int().min(2).max(100).default(10),
    // Socket.IO adapter, turn locks, rate limits, caches — not a queue. On the Dokploy VM, reached
    // over the VPC (`redis://:<password>@<private-ip>:6379`).
    REDIS_URL: z.string().url().default('redis://localhost:6379'),
    // Key prefix, so this service never collides with others on a shared Redis.
    REDIS_PREFIX: z.string().min(1).default('deeptalk-ai'),

    // Background work (session timers, outbox, lifecycle, persona evaluations) — 02 §6.3.
    // `cloud` = Google Cloud Tasks calling back `POST /v1/internal/tasks/:queue`; `local` = a
    // Postgres-backed stand-in for development and E2E (rejected in production).
    TASKS_DRIVER: z.enum(['cloud', 'local']).default('local'),
    TASKS_LOCATION: z.string().min(1).default('asia-southeast2'),
    // Base URL Cloud Tasks calls back (the gateway's own HTTPS URL). Local default: this instance.
    TASKS_TARGET_URL: z.string().url().optional(),
    // `x-tasks-token` on every task callback.
    TASKS_TOKEN: z.string().min(32).optional(),

    // AI access token (ES256, issued by deeptalk-api-v3) — 02 §5.2.
    AI_JWKS_URL: z.string().url().optional(),
    AI_JWT_ISSUER: z.string().min(1).default('deeptalk-api'),
    AI_JWT_AUDIENCE: z.string().min(1).default('deeptalk-ai'),

    // deeptalk-api-v3: public + internal endpoints (`x-ai-service-token`), and the inbound
    // account-lifecycle webhook token (v3 → gateway).
    DEEPTALK_API_URL: z.string().url().optional(),
    // Public psikolog directory (`/v2/user/find/psikolog*`) when it lives elsewhere than
    // DEEPTALK_API_URL — e.g. a local v3 with an empty database reading the dev directory.
    PSIKOLOG_DIRECTORY_API_URL: z.string().url().optional(),
    AI_SERVICE_TOKEN: z.string().min(32).optional(),
    INBOUND_WEBHOOK_TOKEN: z.string().min(32).optional(),

    // Private agent service (Cloud Run, IAM invoker). `id_token` attaches a Google-signed ID
    // token for the agent URL (required in production); `none` is for a local agent only.
    AGENT_URL: z.string().url().optional(),
    AGENT_AUTH: z.enum(['none', 'id_token']).default('none'),
    // Non-streaming agent calls (summary, handoff and persona drafts, evaluation, L2-only).
    AGENT_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
    // A turn's stream up to `done`. Above the agent's own budget (PERSONA_TIMEOUT_MS + L2), so
    // a slow model ends with the agent's MODEL_TIMEOUT rather than a cut connection.
    AGENT_TURN_TIMEOUT_MS: z.coerce.number().int().positive().default(75_000),
    // Silence on the turn stream. The agent pings every 15 s, so this only catches a stream that
    // died without closing.
    AGENT_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
    // After `done`: how long card events may still follow. The reply is already stored.
    AGENT_CARDS_GRACE_MS: z.coerce.number().int().positive().default(10_000),
    // Quick Chat router; past this the least-used persona is picked (fallback, 02 §6.2).
    ROUTER_TIMEOUT_MS: z.coerce.number().int().positive().default(8_000),
    // Previous messages sent with each turn (cost and latency bound, 02 §12.3).
    TURN_HISTORY_MESSAGES: z.coerce.number().int().min(0).max(40).default(20),

    // Cloud KMS key used to encrypt message content.
    MESSAGE_KMS_KEY: z
      .string()
      .regex(KMS_KEY_NAME, 'Expected a full Cloud KMS CryptoKey resource name')
      .optional(),
    // Development only: base64 AES-256 key used instead of KMS. Rejected in production.
    MESSAGE_LOCAL_KEY: z
      .string()
      .refine(
        (value) => Buffer.from(value, 'base64').length === 32,
        'Expected 32 random bytes, base64-encoded (openssl rand -base64 32)',
      )
      .optional(),

    // Comma-separated web origins; unset = any origin (local only). Mobile apps send no Origin.
    CORS_ORIGINS: z
      .string()
      .optional()
      .superRefine((value, context) => {
        try {
          parseCorsOrigins(value);
        } catch (error) {
          context.addIssue({
            code: 'custom',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }),

    // On-call channel for crisis alerts (content-free). Optional: alerts are always logged.
    ALERT_WEBHOOK_URL: z.string().url().optional(),
    // Public help page link sent with fail-closed errors.
    HELP_URL: z
      .string()
      .url()
      .default('https://deeptalk.co.id/deeptalk-ai/bantuan'),

    // Tracing (02 §12.2) — read by `observability/tracing.ts` before Nest starts; declared here
    // so a typo fails startup. `otlp` sends to Cloud Trace's OTLP endpoint by default.
    TRACING_EXPORTER: z.enum(['none', 'otlp']).default('none'),
    TRACING_OTLP_ENDPOINT: z.string().url().optional(),
    TRACING_SAMPLE_RATIO: z.coerce.number().min(0).max(1).default(0.1),
    GOOGLE_CLOUD_PROJECT: z.string().min(1).optional(),

    // Per-instance cache of approved content. An approval reaches other instances within this.
    CONTENT_CACHE_SECONDS: z.coerce.number().int().min(0).max(600).default(60),

    // Use draft clinical content when nothing is approved yet. Development only.
    CONTENT_ALLOW_DRAFT: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),

    // Phase 9 (Konsep §7.4): training-data tooling. Off unless explicitly enabled; even then
    // every job also needs the approval gates recorded in `ai_data_gates`.
    DATASET_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    // De-identification: Sensitive Data Protection (`dlp`), or a regex stand-in for
    // development (`local`, rejected in production).
    DATASET_DEID: z.enum(['dlp', 'local']).default('local'),
    DLP_LOCATION: z.string().min(1).default('asia-southeast2'),
    // Fine-tuning is the last stage and needs at least this many reviewed items.
    DATASET_MIN_FINE_TUNING_ITEMS: z.coerce.number().int().min(1).default(1000),

    // Per-user message rate (02 §9.1). Crisis messages are never rate-limited.
    RATE_LIMIT_MESSAGES_PER_MINUTE: z.coerce
      .number()
      .int()
      .positive()
      .default(20),
    // Authenticated REST calls per user/psikolog per minute (Phase 6 security review).
    REST_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(120),
    // Cloud Scheduler → `POST /v1/internal/scheduler/*` (header `x-scheduler-token`).
    SCHEDULER_TOKEN: z.string().min(32).optional(),

    // Age gate (02 §9.2, Q4): users younger than this cannot start a conversation. The
    // default follows the proposed Q4 answer until it is decided.
    AI_MIN_AGE: z.coerce.number().int().min(13).max(21).default(18),
    // Temporary beta switch: lets eligible users start without service consent; age checks
    // remain enforced. Keep disabled for the official release.
    AI_TRIAL_ALLOW_WITHOUT_SERVICE_CONSENT: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),

    // Account lifecycle (02 §9.3): how often the v3 account-event feed is pulled. The webhook
    // from v3 is the fast path; the pull guarantees nothing is missed.
    ACCOUNT_SYNC_INTERVAL_SECONDS: seconds(300),
    // Retention (Q10). Unset = keep; set only once the legal decision exists.
    RETENTION_MESSAGES_DAYS: z.coerce.number().int().positive().optional(),
    RETENTION_SUMMARIES_DAYS: z.coerce.number().int().positive().optional(),
    RETENTION_SAFETY_EVENTS_DAYS: z.coerce.number().int().positive().optional(),
    RETENTION_ROUTINE_LOGS_DAYS: z.coerce.number().int().positive().optional(),
    RETENTION_INSTRUMENT_RESPONSES_DAYS: z.coerce
      .number()
      .int()
      .positive()
      .optional(),
    // Operational rows (IDs only), not personal-data retention.
    OUTBOX_RETENTION_DAYS: seconds(30),

    // Persona approval needs a fully rated evaluation over at least this many `eval` cases.
    PERSONA_MIN_EVAL_CASES: z.coerce.number().int().min(1).default(5),

    // Session, active time, and quota — 02 §6.3. Tunable without a code release.
    SESSION_QUOTA_PER_MONTH: z.coerce.number().int().min(0).default(10),
    SESSION_ACTIVE_LIMIT_SECONDS: seconds(1800),
    SESSION_WARNING_AT_SECONDS: seconds(1500),
    SESSION_GRACE_SECONDS: seconds(180),
    ACTIVE_GAP_CAP_SECONDS: seconds(120),
    SESSION_IDLE_TIMEOUT_SECONDS: seconds(1800),
    SESSION_MAX_WALL_CLOCK_SECONDS: seconds(10800),
  })
  .superRefine((env, context) => {
    if (env.SESSION_WARNING_AT_SECONDS >= env.SESSION_ACTIVE_LIMIT_SECONDS) {
      context.addIssue({
        code: 'custom',
        path: ['SESSION_WARNING_AT_SECONDS'],
        message: 'Must be lower than SESSION_ACTIVE_LIMIT_SECONDS',
      });
    }
    if (env.MESSAGE_KMS_KEY && env.MESSAGE_LOCAL_KEY) {
      context.addIssue({
        code: 'custom',
        path: ['MESSAGE_LOCAL_KEY'],
        message: 'Set either MESSAGE_KMS_KEY or MESSAGE_LOCAL_KEY, not both',
      });
    }
    if (env.DATASET_DEID === 'dlp' && !env.GOOGLE_CLOUD_PROJECT) {
      context.addIssue({
        code: 'custom',
        path: ['GOOGLE_CLOUD_PROJECT'],
        message: 'Required for DATASET_DEID=dlp',
      });
    }
    if (env.TASKS_DRIVER === 'cloud' && !env.GOOGLE_CLOUD_PROJECT) {
      context.addIssue({
        code: 'custom',
        path: ['GOOGLE_CLOUD_PROJECT'],
        message: 'Required for TASKS_DRIVER=cloud',
      });
    }
    if (env.NODE_ENV !== 'production') return;
    if (env.TASKS_DRIVER !== 'cloud') {
      context.addIssue({
        code: 'custom',
        path: ['TASKS_DRIVER'],
        message: 'Production uses Cloud Tasks (cloud)',
      });
    }
    if (env.DATASET_ENABLED && env.DATASET_DEID !== 'dlp') {
      context.addIssue({
        code: 'custom',
        path: ['DATASET_DEID'],
        message:
          'Production de-identification must use Sensitive Data Protection (dlp)',
      });
    }
    if (env.MESSAGE_LOCAL_KEY) {
      context.addIssue({
        code: 'custom',
        path: ['MESSAGE_LOCAL_KEY'],
        message: 'Not allowed in production; use MESSAGE_KMS_KEY',
      });
    }
    if (env.CONTENT_ALLOW_DRAFT) {
      context.addIssue({
        code: 'custom',
        path: ['CONTENT_ALLOW_DRAFT'],
        message: 'Draft clinical content is never allowed in production',
      });
    }
    if (env.AGENT_AUTH !== 'id_token') {
      context.addIssue({
        code: 'custom',
        path: ['AGENT_AUTH'],
        message: 'Must be id_token in production',
      });
    }
    for (const key of REQUIRED_IN_PRODUCTION) {
      if (env[key] === undefined || env[key] === '') {
        context.addIssue({
          code: 'custom',
          path: [key],
          message: 'Required in production',
        });
      }
    }
  });

export type Environment = z.infer<typeof envSchema>;

export function validateEnvironment(
  config: Record<string, unknown>,
): Environment {
  // `KEY=` in a .env file means "not set": drop empty strings so defaults and the
  // production-required check apply instead of failing format validation.
  const present = Object.fromEntries(
    Object.entries(config).filter(([, value]) => value !== ''),
  );
  const parsed = envSchema.safeParse(present);
  if (!parsed.success) {
    throw new Error(
      `Invalid environment configuration: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}
