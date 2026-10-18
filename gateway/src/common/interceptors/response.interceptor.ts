import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { MessageEnvelope } from '../http/envelope';

export interface ApiEnvelope<T = unknown> {
  success: true;
  message?: string;
  data?: T;
}

/** Wraps every successful controller response in the shared `{ success, message?, data }` envelope. */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiEnvelope | StreamableFile> {
    return next.handle().pipe(
      map((result: unknown) => {
        // File downloads (e.g. CSV exports) are sent as-is — wrapping would serialize the stream.
        if (result instanceof StreamableFile) return result;
        if (result instanceof MessageEnvelope) {
          const envelope: ApiEnvelope = {
            success: true,
            message: result.message,
          };
          if (result.data !== undefined) {
            envelope.data = result.data;
          }
          return envelope;
        }
        return { success: true, data: result };
      }),
    );
  }
}
