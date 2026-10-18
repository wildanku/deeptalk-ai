import { BadRequestException, Injectable } from '@nestjs/common';
import { UserEmitter } from '../common/emitter/user-emitter.service';
import { ContentService, type ActivePersona } from '../content/content.service';
import { personaView } from '../content/persona-view';
import type { ai_sessions } from '../generated/prisma/client';
import { RedisService } from '../redis/redis.service';
import { SessionsService } from '../sessions/sessions.service';

/** `null` = Quick Chat (the router picks a persona from the first message). */
type PersonaChoice = string | null;
export type SessionLocale = 'id' | 'en';
export const DEFAULT_SESSION_LOCALE: SessionLocale = 'id';

const PENDING_TTL_SECONDS = 3_600;
const pendingKey = (userId: string) => `pending-persona:${userId}`;
/** Outlives any session (active-time and idle limits end one within hours). */
const SESSION_NICKNAME_TTL_SECONDS = 2 * 86_400;
const sessionNicknameKey = (sessionId: string) =>
  `session-nickname:${sessionId}`;

interface PendingSettings {
  persona_id: string | null;
  locale?: SessionLocale;
  nickname?: string | null;
}

/**
 * `session.state` (02 §6.2) and persona selection. The choice made before the first message
 * (`session.start`) is kept in Redis, so it holds across tabs, devices, and instances.
 */
@Injectable()
export class SessionStateService {
  constructor(
    private readonly sessions: SessionsService,
    private readonly content: ContentService,
    private readonly redis: RedisService,
    private readonly emitter: UserEmitter,
  ) {}

  async pendingSettings(userId: string): Promise<{
    personaId: PersonaChoice;
    locale: SessionLocale;
    nickname: string | null;
  }> {
    const stored = await this.redis.getJson<PendingSettings>(
      pendingKey(userId),
    );
    return {
      personaId: stored?.persona_id ?? null,
      locale: stored?.locale ?? DEFAULT_SESSION_LOCALE,
      nickname: stored?.nickname ?? null,
    };
  }

  /**
   * The nickname chosen before the first message, for this session only: the account's own
   * nickname in v3 is left as it is (an AI-only name stays out of counseling and booking).
   */
  async bindNickname(sessionId: string, nickname: string): Promise<void> {
    await this.redis.setJson(
      sessionNicknameKey(sessionId),
      { nickname },
      SESSION_NICKNAME_TTL_SECONDS,
    );
  }

  async sessionNickname(sessionId: string): Promise<string | null> {
    const stored = await this.redis
      .getJson<{ nickname: string }>(sessionNicknameKey(sessionId))
      .catch(() => null);
    return stored?.nickname ?? null;
  }

  async pendingChoice(userId: string): Promise<PersonaChoice> {
    return (await this.pendingSettings(userId)).personaId;
  }

  /** `session.start`: before the first message it records the choice; during a session it switches. */
  async start(
    userId: string,
    personaId: PersonaChoice,
    locale: SessionLocale = DEFAULT_SESSION_LOCALE,
    nickname: string | null = null,
  ): Promise<void> {
    if (personaId !== null) await this.requirePersona(personaId);
    const active = await this.sessions.findActive(userId);
    if (active && personaId !== null) {
      await this.switch(userId, personaId);
      return;
    }
    const pending: PendingSettings = {
      persona_id: personaId,
      locale,
      nickname,
    };
    await this.redis.setJson(pendingKey(userId), pending, PENDING_TTL_SECONDS);
    await this.broadcast(userId);
  }

  /** `persona.switch`: applies from the next turn. */
  async switch(userId: string, personaId: string): Promise<void> {
    const persona = await this.requirePersona(personaId);
    const active = await this.sessions.findActive(userId);
    if (active) {
      await this.sessions.setPersona(
        active.id,
        {
          id: persona.id,
          version: persona.version,
          topics: persona.card.focus_topics,
        },
        null,
      );
    } else {
      const { locale, nickname } = await this.pendingSettings(userId);
      const pending: PendingSettings = {
        persona_id: personaId,
        locale,
        nickname,
      };
      await this.redis.setJson(
        pendingKey(userId),
        pending,
        PENDING_TTL_SECONDS,
      );
    }
    await this.broadcast(userId);
  }

  async clearPending(userId: string): Promise<void> {
    await this.redis.del(pendingKey(userId));
  }

  async view(userId: string, session?: ai_sessions | null) {
    const current =
      session === undefined ? await this.sessions.findActive(userId) : session;
    const quota = await this.sessions.quota(userId);
    const personaId = current
      ? current.persona_id
      : await this.pendingChoice(userId);
    const persona = personaId ? await this.content.persona(personaId) : null;
    return {
      session_id: current?.id ?? null,
      status: current?.status ?? 'none',
      active_seconds: current?.active_seconds ?? 0,
      active_limit_seconds: this.sessions.activeLimitSeconds,
      risk_level: current?.max_risk_level ?? 'normal',
      persona: persona ? personaView(persona) : null,
      quick_chat: !personaId,
      router_reason: current?.router_reason ?? null,
      quota,
    };
  }

  async broadcast(userId: string, session?: ai_sessions | null): Promise<void> {
    this.emitter.emit(
      userId,
      'session.state',
      await this.view(userId, session),
    );
  }

  private async requirePersona(personaId: string): Promise<ActivePersona> {
    const persona = await this.content.persona(personaId);
    if (!persona) throw new BadRequestException('Persona tidak tersedia');
    return persona;
  }
}
