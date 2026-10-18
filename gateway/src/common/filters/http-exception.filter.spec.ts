import {
  ArgumentsHost,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

function run(exception: unknown) {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ url: '/v1/test' }),
    }),
  } as unknown as ArgumentsHost;
  new HttpExceptionFilter().catch(exception, host);
  return {
    status,
    body: (json.mock.calls[0] as [unknown])[0] as Record<string, unknown>,
  };
}

describe('HttpExceptionFilter', () => {
  it('renders the standard error envelope', () => {
    const { status, body } = run(new NotFoundException('Article not found'));

    expect(status).toHaveBeenCalledWith(404);
    expect(body).toMatchObject({
      success: false,
      message: 'Article not found',
      path: '/v1/test',
    });
    expect(body).not.toHaveProperty('code');
  });

  it('forwards a machine-readable code', () => {
    const { body } = run(
      new ForbiddenException({
        message: 'Silakan ganti password terlebih dahulu.',
        code: 'AUTHOR_PASSWORD_CHANGE_REQUIRED',
      }),
    );

    expect(body).toMatchObject({
      message: 'Silakan ganti password terlebih dahulu.',
      code: 'AUTHOR_PASSWORD_CHANGE_REQUIRED',
    });
  });

  it('hides unexpected errors behind a 500', () => {
    const { status, body } = run(new Error('db password in stack'));

    expect(status).toHaveBeenCalledWith(500);
    expect(body.message).toBe('Internal server error');
  });

  it('logs only the name and code of unexpected errors, never the message', () => {
    const logError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const error = Object.assign(new Error('Invalid value "aku sedih"'), {
      code: 'P2000',
    });

    run(error);

    expect(logError.mock.calls[0][0]).toMatchObject({
      err: { name: 'Error', code: 'P2000' },
    });
    expect(JSON.stringify(logError.mock.calls)).not.toContain('aku sedih');
    logError.mockRestore();
  });
});
