import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/env.schema';
import { PrismaService } from '../database/prisma.service';
import type { ai_personas } from '../generated/prisma/client';
import {
  CONTENT_SCHEMAS,
  type ContentBody,
  type ContentKind,
  type PersonaCard,
} from './content.schemas';

export interface ActiveContent<K extends ContentKind> {
  refId: string;
  version: number;
  status: 'approved' | 'draft' | 'in_review';
  body: ContentBody<K>;
}

export interface ActivePersona {
  id: string;
  psychologistId: string;
  displayName: string;
  version: number;
  draft: boolean;
  card: PersonaCard;
}

/**
 * Clinical content (02 §8, A12). Only `approved` versions are ever used in production.
 * With `CONTENT_ALLOW_DRAFT=true` (rejected in production) the newest draft/in-review version
 * stands in when nothing is approved, so engineering can run before psikolog content exists.
 *
 * Content is cached per instance (`CONTENT_CACHE_SECONDS`, default 60). Persona status is read uncached: disabling a persona
 * must take effect on the next turn (02 §8).
 */
@Injectable()
export class ContentService {
  private readonly logger = new Logger(ContentService.name);
  private readonly allowDraft: boolean;
  private readonly cacheTtlMs: number;
  private readonly cache = new Map<string, { at: number; value: unknown }>();

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Environment, true>,
  ) {
    this.allowDraft = config.get('CONTENT_ALLOW_DRAFT', { infer: true });
    this.cacheTtlMs =
      config.get('CONTENT_CACHE_SECONDS', { infer: true }) * 1000;
  }

  async active<K extends ContentKind>(
    kind: K,
    refId: string,
  ): Promise<ActiveContent<K> | null> {
    return (
      (await this.listActive(kind)).find((item) => item.refId === refId) ?? null
    );
  }

  /** Newest usable version per `ref_id` of a kind. */
  async listActive<K extends ContentKind>(
    kind: K,
  ): Promise<ActiveContent<K>[]> {
    return this.cached(`list:${kind}`, async () => {
      const rows = await this.prisma.ai_content_versions.findMany({
        where: {
          kind,
          status: {
            in: this.allowDraft
              ? ['approved', 'draft', 'in_review']
              : ['approved'],
          },
        },
        orderBy: [{ ref_id: 'asc' }, { version: 'desc' }],
      });
      const byRef = new Map<string, (typeof rows)[number]>();
      for (const row of rows) {
        const current = byRef.get(row.ref_id);
        // Approved beats draft regardless of version number; otherwise newest wins.
        if (
          !current ||
          (current.status !== 'approved' && row.status === 'approved')
        ) {
          byRef.set(row.ref_id, row);
        }
      }
      const result: ActiveContent<K>[] = [];
      for (const row of byRef.values()) {
        const parsed = CONTENT_SCHEMAS[kind].safeParse(row.body);
        if (!parsed.success) {
          this.logger.error(
            { kind, ref_id: row.ref_id, version: row.version },
            'Invalid content body',
          );
          continue;
        }
        result.push({
          refId: row.ref_id,
          version: row.version,
          status: row.status as ActiveContent<K>['status'],
          body: parsed.data,
        });
      }
      return result;
    });
  }

  /** Personas that are active and have a usable card (approved, or draft when allowed). */
  async activePersonas(): Promise<ActivePersona[]> {
    const personas = await this.prisma.ai_personas.findMany({
      where: { status: 'active' },
      orderBy: { display_name: 'asc' },
    });
    const resolved = await Promise.all(
      personas.map((persona) => this.resolvePersona(persona)),
    );
    return resolved.filter(
      (persona): persona is ActivePersona => persona !== null,
    );
  }

  async persona(id: string): Promise<ActivePersona | null> {
    const persona = await this.prisma.ai_personas.findUnique({ where: { id } });
    if (!persona || persona.status !== 'active') return null;
    return this.resolvePersona(persona);
  }

  private async resolvePersona(
    persona: ai_personas,
  ): Promise<ActivePersona | null> {
    const cards = await this.listActive('persona_card');
    const card = cards.find((item) => item.refId === persona.id);
    if (!card) return null;
    // `active_version` pins the approved version a psikolog signed off on.
    if (
      persona.active_version !== null &&
      card.status === 'approved' &&
      card.version !== persona.active_version
    ) {
      const pinned = await this.prisma.ai_content_versions.findUnique({
        where: {
          kind_ref_id_version: {
            kind: 'persona_card',
            ref_id: persona.id,
            version: persona.active_version,
          },
        },
      });
      const parsed =
        pinned && pinned.status === 'approved'
          ? CONTENT_SCHEMAS.persona_card.safeParse(pinned.body)
          : null;
      if (!parsed?.success) return null;
      return this.toPersona(
        persona,
        persona.active_version,
        false,
        parsed.data,
      );
    }
    return this.toPersona(
      persona,
      card.version,
      card.status !== 'approved',
      card.body,
    );
  }

  private toPersona(
    persona: ai_personas,
    version: number,
    draft: boolean,
    card: PersonaCard,
  ): ActivePersona {
    return {
      id: persona.id,
      psychologistId: persona.psychologist_id,
      displayName: persona.display_name,
      version,
      draft,
      card,
    };
  }

  /**
   * Drops this instance's cache after an approval. Other instances pick the change up within
   * `CONTENT_CACHE_SECONDS`; persona status is never cached.
   */
  invalidate(): void {
    this.cache.clear();
  }

  private async cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < this.cacheTtlMs) return hit.value as T;
    const value = await load();
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }
}
