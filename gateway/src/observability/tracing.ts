/**
 * OpenTelemetry tracing (02 §12.2): gateway HTTP requests, calls to the agent and v3, and one
 * `ai.turn` span per conversation turn. Must be imported before anything else in `main.ts`, so
 * the instrumentations patch `http` and `undici` before Nest loads them.
 *
 * Privacy: spans never carry conversation content. Only allow-listed attributes are exported,
 * URL paths have their IDs replaced with `:id`, query strings and span events' details are
 * dropped (02 §9.1). The agent's own ADK spans are not exported (they contain prompts).
 *
 * Env (read directly; Nest config is not loaded yet):
 *   TRACING_EXPORTER      none (default) | otlp
 *   TRACING_OTLP_ENDPOINT default https://telemetry.googleapis.com/v1/traces (Cloud Trace)
 *   TRACING_SAMPLE_RATIO  0..1, default 0.1
 */
import { trace, type Attributes } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  type ReadableSpan,
  type SpanExporter,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { GoogleAuth } from 'google-auth-library';

const ALLOWED_ATTRIBUTES = new Set([
  'http.request.method',
  'http.response.status_code',
  'http.route',
  'http.method',
  'http.status_code',
  'url.scheme',
  'url.path',
  'server.address',
  'server.port',
  'error.type',
  'nestjs.type',
  'nestjs.module',
  'nestjs.controller',
  'nestjs.callback',
]);

/**
 * Literal path segments of the gateway's routes, the agent's, and the v3 endpoints it calls.
 * Any other segment — user, psikolog, booking, session, or message IDs, whatever their shape —
 * becomes `:id`. An allow-list, because IDs do not reliably look like IDs.
 */
const ROUTE_WORDS = new Set([
  'v1',
  'v2',
  'health',
  'help',
  'personas',
  'sessions',
  'current',
  'me',
  'settings',
  'memory',
  'history',
  'onboarding',
  'consents',
  'routines',
  'logs',
  'summary',
  'handoffs',
  'link',
  'confirm',
  'messages',
  'report',
  'psikolog',
  'persona',
  'questionnaire',
  'cases',
  'draft',
  'versions',
  'eval-runs',
  'ratings',
  'approve',
  'disable',
  'enable',
  'review',
  'content',
  'submit',
  'reject',
  'safety-events',
  'reports',
  'internal',
  'users',
  'delete',
  'merge',
  'by-booking',
  'scheduler',
  'routine-reminders',
  // Cloud Tasks / Cloud Scheduler callbacks (src/tasks/).
  'tasks',
  'jobs',
  'ai-session-timers',
  'ai-outbox',
  'ai-lifecycle',
  'ai-evals',
  'ai-scheduled',
  'outbox-sweep',
  'account-sync',
  'retention',
  'ai',
  'assessments',
  'bookings',
  'notifications',
  'account-events',
  'user',
  'find',
  'turn',
  'router',
  'select',
  'safety',
  'classify',
  'session',
  'handoff',
  'eval',
  'run',
  '.well-known',
  'ai-jwks.json',
  'access',
  'availability',
  'book',
  'ai-summary',
  'socket.io',
]);

/** `/v2/internal/ai/users/DPT0000123/assessments` → `/v2/internal/ai/users/:id/assessments`. */
export function sanitizePath(path: string): string {
  return path
    .split('?')[0]
    .split('/')
    .map((segment) =>
      segment === '' || ROUTE_WORDS.has(segment) ? segment : ':id',
    )
    .join('/');
}

/** Allow-listed attributes only; `ai.*` attributes are set by our own code (enums, counts). */
export function sanitizeAttributes(attributes: Attributes): Attributes {
  const clean: Attributes = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (key.startsWith('ai.') || ALLOWED_ATTRIBUTES.has(key)) {
      clean[key] =
        key === 'url.path' && typeof value === 'string'
          ? sanitizePath(value)
          : value;
    }
  }
  return clean;
}

/** Span names may embed a path (`GET /v1/handoffs/<id>`); other names pass unchanged. */
export function sanitizeName(name: string): string {
  return name
    .split(' ')
    .map((part) => (part.startsWith('/') ? sanitizePath(part) : part))
    .join(' ');
}

/** Wraps an exporter so nothing outside the allow-list ever leaves the process. */
export class SanitizingExporter implements SpanExporter {
  constructor(private readonly inner: SpanExporter) {}

  export(
    spans: ReadableSpan[],
    done: Parameters<SpanExporter['export']>[1],
  ): void {
    const clean = spans.map(
      (span) =>
        Object.create(span, {
          attributes: { value: sanitizeAttributes(span.attributes) },
          name: { value: sanitizeName(span.name) },
          events: {
            value: span.events.map((event) => ({
              ...event,
              attributes: event.attributes?.['exception.type']
                ? { 'exception.type': event.attributes['exception.type'] }
                : {},
            })),
          },
        }) as ReadableSpan,
    );
    this.inner.export(clean, done);
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush?.() ?? Promise.resolve();
  }
}

function startTracing(): void {
  if ((process.env.TRACING_EXPORTER ?? 'none') !== 'otlp') return;
  const endpoint =
    process.env.TRACING_OTLP_ENDPOINT ??
    'https://telemetry.googleapis.com/v1/traces';
  const ratio = Math.min(
    1,
    Math.max(0, Number(process.env.TRACING_SAMPLE_RATIO ?? '0.1')),
  );
  const auth = endpoint.includes('googleapis.com')
    ? new GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      })
    : null;

  const exporter = new OTLPTraceExporter({
    url: endpoint,
    headers: auth
      ? async () => {
          const headers = await auth.getRequestHeaders();
          return Object.fromEntries(headers.entries());
        }
      : {},
  });
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      'service.name': 'deeptalk-ai-gateway',
      'gcp.project_id': process.env.GOOGLE_CLOUD_PROJECT ?? '',
    }),
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(ratio),
    }),
    spanProcessors: [new BatchSpanProcessor(new SanitizingExporter(exporter))],
  });
  provider.register();
  registerInstrumentations({
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (request) =>
          request.url?.startsWith('/v1/health') ?? false,
      }),
      new UndiciInstrumentation(),
      new NestInstrumentation(),
    ],
  });
}

startTracing();

/** Tracer for spans our code creates (`ai.turn`); a no-op when tracing is off. */
export const tracer = trace.getTracer('deeptalk-ai-gateway');
