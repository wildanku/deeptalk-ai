import { Writable } from 'node:stream';
import pino from 'pino';
import { buildPinoOptions, prettyAvailable, stripQuery } from './logger';

function capture(): { stream: Writable; lines: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  return { stream, lines: () => chunks.join('') };
}

describe('logger', () => {
  const options = buildPinoOptions({ LOG_LEVEL: 'info', NODE_ENV: 'test' });

  it('redacts conversation content and credentials', () => {
    const { stream, lines } = capture();
    const logger = pino(options, stream);

    logger.info({
      content: 'aku merasa sedih',
      message_payload: { content: 'isi pesan', delta: 'token' },
      req: { headers: { authorization: 'Bearer secret-jwt' } },
    });

    const output = lines();
    expect(output).not.toContain('aku merasa sedih');
    expect(output).not.toContain('isi pesan');
    expect(output).not.toContain('secret-jwt');
    expect(output).toContain('[REDACTED]');
  });

  it('emits Cloud Logging severity instead of a numeric level', () => {
    const { stream, lines } = capture();
    pino(options, stream).warn('quota nearly exhausted');

    expect(JSON.parse(lines())).toMatchObject({
      severity: 'WARNING',
      message: 'quota nearly exhausted',
    });
  });

  it('strips the query string from request URLs', () => {
    expect(stripQuery('/v1/handoffs/1?token=abc')).toBe('/v1/handoffs/1');
    expect(stripQuery(undefined)).toBeUndefined();
  });
  it('logs JSON in a development deployment without pino-pretty (Cloud Run dev image)', () => {
    const dev = { LOG_LEVEL: 'info', NODE_ENV: 'development' } as const;
    expect(buildPinoOptions(dev, false).transport).toBeUndefined();
    expect(buildPinoOptions(dev, true).transport).toMatchObject({
      target: 'pino-pretty',
    });
    expect(
      buildPinoOptions({ ...dev, NODE_ENV: 'production' }, true).transport,
    ).toBeUndefined();
    expect(
      prettyAvailable(() => {
        throw new Error('Cannot find module');
      }),
    ).toBe(false);
  });
});
