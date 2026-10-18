import { HttpException, Logger, OnModuleDestroy } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { z } from 'zod';
import type { AiPrincipal } from '../auth/ai-principal';
import { AiTokenVerifier } from '../auth/ai-token-verifier.service';
import { extractBearer } from '../auth/bearer';
import { UserEmitter, userRoom } from '../common/emitter/user-emitter.service';
import { HandoffsService } from '../handoffs/handoffs.service';
import { RoutinesService } from '../routines/routines.service';
import {
  DEFAULT_SESSION_LOCALE,
  SessionStateService,
} from './session-state.service';
import { type SendAck, TurnService } from './turn.service';

interface SocketData {
  principal?: AiPrincipal;
  expiryTimer?: NodeJS.Timeout;
}

type EventMap = Record<string, (payload: Record<string, unknown>) => void>;
type AiSocket = Socket<EventMap, EventMap, EventMap, SocketData>;

export type RefreshAck =
  | { ok: true; expires_at: number }
  | { ok: false; code: string; message: string };

type Ack<T extends object = object> =
  ({ ok: true } & T) | { ok: false; code: string; message: string };

export { userRoom };

const personaChoiceSchema = z.object({
  persona_id: z.string().min(1).max(64).nullable().optional(),
  locale: z.enum(['id', 'en']).optional(),
  // What the user wants to be called in this session. It ends up in the prompt, so only
  // letters, digits, spaces and a little punctuation, at most 50 characters.
  nickname: z
    .string()
    .transform((value) => value.replace(/\s+/g, ' ').trim())
    .pipe(z.string().regex(/^[\p{L}\p{M}\p{N} .'-]{1,50}$/u))
    .nullable()
    .optional(),
});
const personaSwitchSchema = z.object({ persona_id: z.string().min(1).max(64) });
const routineDecisionSchema = z.object({
  proposal_id: z.string().uuid(),
  decision: z.enum(['accept', 'edit', 'reject']),
  routine: z
    .object({
      item_ids: z.array(z.string().min(1).max(128)).max(3).optional(),
      reminder_times: z.array(z.string()).max(3).optional(),
      timezone: z.string().max(64).optional(),
    })
    .optional(),
});

/**
 * Socket.IO namespace `/ai` for users (02 §6.2). Every socket of a user joins `user:<id>`;
 * with the Redis adapter, events reach all of them on every instance (second tab or device).
 * Psikolog tokens are refused here — psikolog features use REST.
 */
@WebSocketGateway({ namespace: '/ai', transports: ['websocket'] })
export class AiGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleDestroy
{
  @WebSocketServer() private readonly server: Namespace;
  private readonly logger = new Logger(AiGateway.name);

  constructor(
    private readonly verifier: AiTokenVerifier,
    private readonly state: SessionStateService,
    private readonly turns: TurnService,
    private readonly routines: RoutinesService,
    private readonly handoffs: HandoffsService,
    private readonly emitter: UserEmitter,
  ) {}

  afterInit(namespace: Namespace): void {
    this.emitter.attach(namespace);
  }

  async handleConnection(client: AiSocket): Promise<void> {
    const token = handshakeToken(client);
    let principal: AiPrincipal;
    try {
      if (!token) throw new Error('missing token');
      principal = await this.verifier.verify(token);
    } catch {
      return this.reject(client, 'UNAUTHORIZED', 'Token tidak valid');
    }
    if (principal.role !== 'user') {
      return this.reject(client, 'FORBIDDEN', 'Hanya untuk pengguna');
    }
    if (client.disconnected) return;
    this.authenticate(client, principal);
    await client.join(userRoom(principal.sub));

    client.emit('session.state', await this.state.view(principal.sub));
  }

  handleDisconnect(client: AiSocket): void {
    clearTimeout(client.data.expiryTimer);
  }

  /** Extends the socket with a fresh token for the same user, without reconnecting. */
  @SubscribeMessage('auth.refresh')
  async refresh(
    @ConnectedSocket() client: AiSocket,
    @MessageBody() body: unknown,
  ): Promise<RefreshAck> {
    const current = client.data.principal;
    const token =
      typeof body === 'object' && body !== null && 'token' in body
        ? body.token
        : undefined;
    if (!current || typeof token !== 'string') {
      return {
        ok: false,
        code: 'INVALID_REQUEST',
        message: 'Token wajib diisi',
      };
    }
    try {
      const next = await this.verifier.verify(token);
      if (next.sub !== current.sub || next.role !== current.role) {
        return {
          ok: false,
          code: 'FORBIDDEN',
          message: 'Token milik akun lain',
        };
      }
      this.authenticate(client, next);
      return { ok: true, expires_at: next.exp };
    } catch {
      return { ok: false, code: 'UNAUTHORIZED', message: 'Token tidak valid' };
    }
  }

  @SubscribeMessage('message.send')
  async send(
    @ConnectedSocket() client: AiSocket,
    @MessageBody() body: unknown,
  ): Promise<SendAck> {
    const principal = client.data.principal;
    if (!principal) {
      return {
        ok: false,
        code: 'UNAUTHORIZED',
        message: 'Belum terautentikasi',
      };
    }
    try {
      return await this.turns.send(principal.sub, body);
    } catch (error) {
      this.logger.error({
        err: { name: error instanceof Error ? error.name : typeof error },
      });
      return {
        ok: false,
        code: 'SEND_FAILED',
        message: 'Pesan gagal dikirim, coba lagi',
      };
    }
  }

  /** Persona choice before the first message, or Quick Chat (`persona_id` null/absent). */
  @SubscribeMessage('session.start')
  sessionStart(
    @ConnectedSocket() client: AiSocket,
    @MessageBody() body: unknown,
  ): Promise<Ack> {
    return this.guarded(client, async (userId) => {
      const parsed = personaChoiceSchema.safeParse(body ?? {});
      if (!parsed.success) return invalid();
      await this.state.start(
        userId,
        parsed.data.persona_id ?? null,
        parsed.data.locale ?? DEFAULT_SESSION_LOCALE,
        parsed.data.nickname ?? null,
      );
      return { ok: true };
    });
  }

  @SubscribeMessage('persona.switch')
  personaSwitch(
    @ConnectedSocket() client: AiSocket,
    @MessageBody() body: unknown,
  ): Promise<Ack> {
    return this.guarded(client, async (userId) => {
      const parsed = personaSwitchSchema.safeParse(body);
      if (!parsed.success) return invalid();
      await this.state.switch(userId, parsed.data.persona_id);
      return { ok: true };
    });
  }

  @SubscribeMessage('routine.decision')
  routineDecision(
    @ConnectedSocket() client: AiSocket,
    @MessageBody() body: unknown,
  ): Promise<Ack<{ routine_id: string | null }>> {
    return this.guarded(client, async (userId) => {
      const parsed = routineDecisionSchema.safeParse(body);
      if (!parsed.success) return invalid();
      const result = await this.routines.decide(
        userId,
        parsed.data.proposal_id,
        parsed.data.decision,
        parsed.data.routine,
      );
      return { ok: true, ...result };
    });
  }

  @SubscribeMessage('handoff.decision')
  handoffDecision(
    @ConnectedSocket() client: AiSocket,
    @MessageBody() body: unknown,
  ): Promise<
    Ack<{ status: string; deep_links: { web: string; app: string } | null }>
  > {
    return this.guarded(client, async (userId) => ({
      ok: true,
      ...(await this.handoffs.decide(userId, body)),
    }));
  }

  /** Authenticated handler with domain errors mapped to an `{ ok: false }` ack. */
  private async guarded<T extends object>(
    client: AiSocket,
    handler: (userId: string) => Promise<Ack<T>>,
  ): Promise<Ack<T>> {
    const principal = client.data.principal;
    if (!principal) {
      return {
        ok: false,
        code: 'UNAUTHORIZED',
        message: 'Belum terautentikasi',
      };
    }
    try {
      return await handler(principal.sub);
    } catch (error) {
      if (error instanceof HttpException) {
        const response = error.getResponse();
        const message =
          typeof response === 'object' && response && 'message' in response
            ? String(response.message)
            : error.message;
        return { ok: false, code: `HTTP_${error.getStatus()}`, message };
      }
      this.logger.error({
        err: { name: error instanceof Error ? error.name : typeof error },
      });
      return {
        ok: false,
        code: 'FAILED',
        message: 'Permintaan gagal, coba lagi',
      };
    }
  }

  onModuleDestroy(): void {
    // Tell this instance's clients to reconnect (to another instance) rather than wait for a
    // dead socket. `local` matters: without it the Redis adapter broadcasts the disconnect to
    // every instance and one deploy would drop every connected user.
    this.server?.local.disconnectSockets(true);
  }

  private authenticate(client: AiSocket, principal: AiPrincipal): void {
    client.data.principal = principal;
    clearTimeout(client.data.expiryTimer);
    const remainingMs = Math.max(0, principal.exp * 1000 - Date.now());
    client.data.expiryTimer = setTimeout(() => {
      client.emit('ai.error', {
        code: 'TOKEN_EXPIRED',
        message: 'Sesi login kedaluwarsa, sambungkan ulang',
      });
      client.disconnect(true);
    }, remainingMs);
    client.data.expiryTimer.unref();
  }

  private reject(client: AiSocket, code: string, message: string): void {
    this.logger.warn({ socket_id: client.id, code }, 'Socket rejected');
    client.emit('ai.error', { code, message });
    client.disconnect(true);
  }
}

function invalid(): { ok: false; code: string; message: string } {
  return {
    ok: false,
    code: 'INVALID_REQUEST',
    message: 'Permintaan tidak valid',
  };
}

function handshakeToken(client: AiSocket): string | null {
  const auth: unknown = client.handshake.auth;
  if (typeof auth === 'object' && auth !== null && 'token' in auth) {
    const token = auth.token;
    if (typeof token === 'string' && token.length > 0) return token;
  }
  return extractBearer(client.handshake.headers.authorization);
}
