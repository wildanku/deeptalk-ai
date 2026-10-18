import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import type { Environment } from '../config/env.schema';

type Caller = 'v3' | 'scheduler' | 'tasks';

const CALLERS: Record<
  Caller,
  {
    env: 'INBOUND_WEBHOOK_TOKEN' | 'SCHEDULER_TOKEN' | 'TASKS_TOKEN';
    header: string;
  }
> = {
  // deeptalk-api-v3 → gateway (handoff summary reads; account-lifecycle webhooks in Phase 4).
  v3: { env: 'INBOUND_WEBHOOK_TOKEN', header: 'x-ai-gateway-token' },
  scheduler: { env: 'SCHEDULER_TOKEN', header: 'x-scheduler-token' },
  // Cloud Tasks (or the local driver) → gateway, 02 §6.3.
  tasks: { env: 'TASKS_TOKEN', header: 'x-tasks-token' },
};

const CALLER_KEY = 'internalCaller';

export const InternalCaller = (caller: Caller) =>
  SetMetadata(CALLER_KEY, caller);

function safeEqual(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Service-to-service calls into `/v1/internal/*`. Unconfigured → 503 (fail closed). */
@Injectable()
export class InternalTokenGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService<Environment, true>,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const caller = this.reflector.getAllAndOverride<Caller | undefined>(
      CALLER_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!caller) throw new UnauthorizedException();
    const { env, header } = CALLERS[caller];
    const expected = this.config.get(env, { infer: true });
    if (!expected)
      throw new ServiceUnavailableException(
        'Internal endpoint is not configured',
      );
    const request = context.switchToHttp().getRequest<Request>();
    if (!safeEqual(request.header(header), expected)) {
      throw new UnauthorizedException('Invalid service token');
    }
    return true;
  }
}
