import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import {
  sanitizeAttributes,
  sanitizePath,
  SanitizingExporter,
} from './tracing';

describe('tracing sanitization', () => {
  it('replaces IDs in paths and drops query strings', () => {
    expect(
      sanitizePath('/v2/internal/ai/users/DPT0000123/assessments?x=1'),
    ).toBe('/v2/internal/ai/users/:id/assessments');
    expect(
      sanitizePath('/v1/handoffs/01a12694-49e3-77ab-8c9a-a0df8e781dc2/link'),
    ).toBe('/v1/handoffs/:id/link');
    expect(sanitizePath('/v1/routines/123/history')).toBe(
      '/v1/routines/:id/history',
    );
  });

  it('keeps only allow-listed attributes', () => {
    expect(
      sanitizeAttributes({
        'http.request.method': 'POST',
        'url.full': 'https://x/v2/internal/ai/users/DPT0000123?psikolog_id=P1',
        'url.query': 'psikolog_id=P1',
        'url.path': '/v1/messages/01a12694-49e3-77ab-8c9a-a0df8e781dc2/report',
        'user_agent.original': 'ua',
        'ai.path': 'agent',
      }),
    ).toEqual({
      'http.request.method': 'POST',
      'url.path': '/v1/messages/:id/report',
      'ai.path': 'agent',
    });
  });

  it('exports sanitized copies and strips event details', () => {
    const inner = { export: jest.fn(), shutdown: jest.fn() };
    const span = {
      name: 'GET /v1/handoffs/01a12694-49e3-77ab-8c9a-a0df8e781dc2',
      attributes: { 'url.full': 'secret', 'http.response.status_code': 200 },
      events: [
        {
          name: 'exception',
          attributes: {
            'exception.type': 'TypeError',
            'exception.message': 'text',
          },
        },
      ],
      spanContext: () => ({ traceId: 't', spanId: 's' }),
    } as unknown as ReadableSpan;
    new SanitizingExporter(inner).export([span], () => undefined);
    const [exported] = (inner.export.mock.calls[0] as [ReadableSpan[]])[0];
    expect(exported.name).toBe('GET /v1/handoffs/:id');
    expect(exported.attributes).toEqual({ 'http.response.status_code': 200 });
    expect(exported.events[0].attributes).toEqual({
      'exception.type': 'TypeError',
    });
    expect(exported.spanContext().traceId).toBe('t');
  });
});
