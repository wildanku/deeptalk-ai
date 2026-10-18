import { CallHandler, ExecutionContext, StreamableFile } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { withMessage } from '../http/envelope';
import { ResponseInterceptor } from './response.interceptor';

function handlerReturning(value: unknown): CallHandler {
  return { handle: () => of(value) };
}

describe('ResponseInterceptor', () => {
  const interceptor = new ResponseInterceptor();
  const context = {} as ExecutionContext;

  it('wraps a plain value as { success: true, data }', async () => {
    const result = await firstValueFrom(
      interceptor.intercept(context, handlerReturning({ id: 1 })),
    );
    expect(result).toEqual({ success: true, data: { id: 1 } });
  });

  it('wraps a MessageEnvelope with data as { success, message, data }', async () => {
    const result = await firstValueFrom(
      interceptor.intercept(
        context,
        handlerReturning(withMessage('done', { id: 1 })),
      ),
    );
    expect(result).toEqual({ success: true, message: 'done', data: { id: 1 } });
  });

  it('wraps a MessageEnvelope without data as { success, message } only', async () => {
    const result = await firstValueFrom(
      interceptor.intercept(context, handlerReturning(withMessage('deleted'))),
    );
    expect(result).toEqual({ success: true, message: 'deleted' });
    expect('data' in (result as object)).toBe(false);
  });

  it('passes a StreamableFile through unwrapped', async () => {
    const file = new StreamableFile(Buffer.from('a,b'));
    const result = await firstValueFrom(
      interceptor.intercept(context, handlerReturning(file)),
    );
    expect(result).toBe(file);
  });
});
