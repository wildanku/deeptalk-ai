import { describeError } from '../describe-error';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    const httpException =
      exception instanceof HttpException ? exception : undefined;
    const status =
      httpException?.getStatus() ?? HttpStatus.INTERNAL_SERVER_ERROR;
    if (!httpException) {
      // Name and code only: error messages (e.g. Prisma validation errors) can echo argument
      // values, which may include conversation content. Never log `exception.message`.
      this.logger.error({ err: describeError(exception) });
    }
    const body = httpException?.getResponse();
    const message =
      typeof body === 'object' && body && 'message' in body
        ? body.message
        : (httpException?.message ?? 'Internal server error');
    // A machine-readable `code` (e.g. `AUTHOR_PASSWORD_CHANGE_REQUIRED`) is forwarded when the
    // exception carries one, so clients branch on it instead of on the message text.
    const code =
      typeof body === 'object' &&
      body &&
      'code' in body &&
      typeof body.code === 'string'
        ? body.code
        : undefined;

    response.status(status).json({
      success: false,
      message,
      ...(code ? { code } : {}),
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
