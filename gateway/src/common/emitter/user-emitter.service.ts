import { Injectable, Logger } from '@nestjs/common';
import type { Namespace } from 'socket.io';

export const userRoom = (userId: string): string => `user:${userId}`;

/**
 * Sends an event to every socket of a user, on any instance (Redis adapter). Used by the
 * socket gateway and by background workers (session timers, outbox) alike. The namespace is
 * attached by `AiGateway` once Socket.IO is up; before that, events are dropped (a worker on
 * a just-starting instance) and clients catch up from `GET /v1/sessions/current`.
 */
@Injectable()
export class UserEmitter {
  private readonly logger = new Logger(UserEmitter.name);
  private namespace: Namespace | null = null;

  attach(namespace: Namespace): void {
    this.namespace = namespace;
  }

  emit(userId: string, event: string, payload: Record<string, unknown>): void {
    if (!this.namespace) {
      this.logger.warn({ event }, 'Socket namespace not ready; event dropped');
      return;
    }
    this.namespace.to(userRoom(userId)).emit(event, payload);
  }

  /** Disconnects every socket of a user on every instance (account deleted or merged away). */
  disconnect(userId: string): void {
    this.namespace?.in(userRoom(userId)).disconnectSockets(true);
  }
}
