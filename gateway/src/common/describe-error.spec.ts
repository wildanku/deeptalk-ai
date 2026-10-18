import { describeError } from './describe-error';

describe('describeError', () => {
  it('surfaces the database cause behind a Prisma P2010 without any message text', () => {
    const missingTable = Object.assign(
      new Error('relation "ai_local_tasks" does not exist'),
      {
        name: 'PrismaClientKnownRequestError',
        code: 'P2010',
        meta: {
          driverAdapterError: {
            cause: { originalCode: '42P01', originalMessage: 'secret text' },
          },
        },
      },
    );
    const unreachable = Object.assign(new Error('x'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2010',
      meta: {
        driverAdapterError: {
          cause: { kind: 'DatabaseNotReachable', host: '10.0.0.1' },
        },
      },
    });

    expect(describeError(missingTable)).toMatchObject({
      name: 'PrismaClientKnownRequestError',
      code: 'P2010',
      db_code: '42P01',
    });
    expect(describeError(unreachable)).toMatchObject({
      name: 'PrismaClientKnownRequestError',
      code: 'P2010',
      db_kind: 'DatabaseNotReachable',
    });
    expect(JSON.stringify(describeError(missingTable))).not.toContain('secret');
  });

  it('keeps the HTTP status of an upstream failure', () => {
    const agent = Object.assign(new Error('Agent answered 403'), {
      name: 'AgentUnavailableError',
      status: 403,
    });
    expect(describeError(agent)).toMatchObject({
      name: 'AgentUnavailableError',
      status: 403,
    });
  });

  it('handles plain errors and non-errors', () => {
    expect(describeError(new TypeError('boom'))).toMatchObject({
      name: 'TypeError',
    });
    expect(describeError('text')).toEqual({ name: 'string' });
  });

  it('points at the first frame in our own code, never at the message', () => {
    const error = Object.assign(new TypeError('secret text'), {
      code: 'ERR_INVALID_ARG_TYPE',
      stack: [
        'TypeError: secret text',
        '    at Cipheriv.update (node:internal/crypto/cipher:186:29)',
        '    at seal (/app/node_modules/x/index.js:1:1)',
        '    at async MemoryService.summarize (/app/dist/sessions/memory.service.js:95:28)',
        '    at /app/dist/outbox/outbox.service.js:40:7',
      ].join('\n'),
    });
    expect(describeError(error)).toEqual({
      name: 'TypeError',
      code: 'ERR_INVALID_ARG_TYPE',
      where: 'memory.service.js:95 MemoryService.summarize',
    });

    const anonymous = Object.assign(new Error('x'), {
      stack: 'Error: x\n    at /app/dist/a.js:3:1',
    });
    expect(describeError(anonymous).where).toBe('a.js:3');
  });
});
