import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/env.schema';
import { RedisService } from '../redis/redis.service';

export interface V3Psikolog {
  id: string;
  name: string;
  avatar: string | null;
  specialists: string[];
  year_experience: number | null;
}

/** One bookable psikolog from the public directory (`GET /v2/user/find/psikologs`). */
export interface V3DirectoryEntry extends V3Psikolog {
  gender: string | null;
  /** `null` until the psikolog has a counseling review. */
  rating: { rate: number; total: number } | null;
  /** Cheapest counseling price (IDR) across chat, video call, and face to face. */
  price_from: number | null;
}

export interface V3Assessment {
  id: string;
  name: string;
  is_free: boolean;
  description: string | null;
  category: string | null;
}

export interface V3UserProfile {
  nickname: string;
  birth_date: string | null;
  gender: string | null;
}

export interface V3UserAssessment {
  name: string;
  completed_at: string;
  result_category: string | null;
}

export interface V3Booking {
  user_id: string;
  psikolog_id: string;
  status: string;
  counseling_datetime: string | null;
}

export interface V3Notification {
  notification_key: string;
  audience: 'user' | 'psikolog';
  recipient_id: string;
  title: string;
  body: string;
  data: Record<string, string>;
}

/** A `users` row removed in v3 (02 §9.3), from `GET /v2/internal/ai/account-events`. */
export interface V3AccountEvent {
  /** v3 `deleted_data.id` — increasing, used as the pull cursor. */
  id: string;
  kind: 'delete' | 'merge';
  user_id: string;
  /** The surviving account for `merge`. */
  target_user_id: string | null;
  occurred_at: string | null;
}

/** The upstream answered, but not with what we needed (4xx/5xx, malformed). */
export class V3Error extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
  ) {
    super(`deeptalk-api-v3 ${path} answered ${status}`);
    this.name = 'V3Error';
  }
}

const PUBLIC_CACHE_SECONDS = 300;
/**
 * After a failed directory refresh, turns skip the directory (empty pool) for this long instead
 * of each waiting on up to ten page timeouts of their own.
 */
const DIRECTORY_FAILED_KEY = 'v3:psikolog-directory:failed';
const DIRECTORY_FAILED_SECONDS = 30;
/** v3 caps `offset` (page size) at 100; ten pages bound the load for one directory refresh. */
const DIRECTORY_PAGE_SIZE = 100;
const DIRECTORY_MAX_PAGES = 10;

interface RawDirectoryItem {
  psikolog_id: string;
  profile_unavailable?: boolean;
  price?: Record<string, number | null> | null;
  rating?: { counseling?: { rate?: number; total?: number } | null } | null;
  psikolog: {
    name?: string;
    avatar?: string | null;
    gender?: string | null;
    specialists?: { name: string }[] | null;
    year_experience?: number | null;
  } | null;
}

function toPsikolog(raw: RawDirectoryItem): V3Psikolog | null {
  if (raw.profile_unavailable || !raw.psikolog?.name) return null;
  return {
    id: raw.psikolog_id,
    name: raw.psikolog.name.trim(),
    avatar: raw.psikolog.avatar ?? null,
    specialists: (raw.psikolog.specialists ?? []).map((item) => item.name),
    year_experience: raw.psikolog.year_experience ?? null,
  };
}

function toDirectoryEntry(raw: RawDirectoryItem): V3DirectoryEntry | null {
  const psikolog = toPsikolog(raw);
  if (!psikolog) return null;
  const counseling = raw.rating?.counseling;
  const prices = Object.values(raw.price ?? {}).filter(
    (value): value is number => typeof value === 'number' && value > 0,
  );
  return {
    ...psikolog,
    gender: raw.psikolog?.gender ?? null,
    rating:
      counseling && typeof counseling.rate === 'number' && counseling.total
        ? { rate: counseling.rate, total: counseling.total }
        : null,
    price_from: prices.length ? Math.min(...prices) : null,
  };
}

/**
 * HTTP client for deeptalk-api-v3 (02 §5). Public directory/catalog reads are cached in Redis
 * for 5 minutes; internal calls carry `x-ai-service-token`. The agent never calls v3 — every
 * tool that needs v3 data runs here.
 */
@Injectable()
export class V3Client {
  private readonly logger = new Logger(V3Client.name);
  private readonly baseUrl: string | undefined;
  private readonly directoryUrl: string | undefined;
  private readonly serviceToken: string | undefined;
  private readonly loading = new Map<string, Promise<unknown>>();

  constructor(
    config: ConfigService<Environment, true>,
    private readonly redis: RedisService,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    const url = config.get('DEEPTALK_API_URL', { infer: true });
    this.baseUrl = url ? `${url.replace(/\/+$/, '')}/v2` : undefined;
    const directory = config.get('PSIKOLOG_DIRECTORY_API_URL', { infer: true });
    this.directoryUrl = directory
      ? `${directory.replace(/\/+$/, '')}/v2`
      : this.baseUrl;
    this.serviceToken = config.get('AI_SERVICE_TOKEN', { infer: true });
  }

  /** `null` when the psikolog does not exist or their profile is unavailable. */
  async psikolog(id: string): Promise<V3Psikolog | null> {
    return this.cachedPublic(`v3:psikolog:${id}`, async () => {
      const data = await this.request<RawDirectoryItem>(
        `/user/find/psikolog/${encodeURIComponent(id)}`,
        { directory: true },
      );
      return data ? toPsikolog(data) : null;
    });
  }

  /**
   * Every bookable psikolog, best rated first — the pool for recommendations. One cached
   * snapshot for all users (public data); an unreachable directory is an empty pool.
   */
  async psikologDirectory(): Promise<V3DirectoryEntry[]> {
    if (await this.redis.exists(DIRECTORY_FAILED_KEY).catch(() => false))
      return [];
    const entries = await this.cachedPublic(
      'v3:psikolog-directory',
      async () => {
        const all: V3DirectoryEntry[] = [];
        for (let page = 1; page <= DIRECTORY_MAX_PAGES; page += 1) {
          const data = await this.request<{
            items: RawDirectoryItem[];
            meta?: { last_page?: number };
          }>(
            `/user/find/psikologs?sort_by=rating&offset=${DIRECTORY_PAGE_SIZE}&page=${page}`,
            { directory: true },
          );
          for (const item of data?.items ?? []) {
            const entry = toDirectoryEntry(item);
            if (entry) all.push(entry);
          }
          if (!data?.items?.length || page >= (data.meta?.last_page ?? page))
            break;
        }
        return all;
      },
    ).catch(async (error: unknown) => {
      await this.redis
        .setJson(
          DIRECTORY_FAILED_KEY,
          { failed: true },
          DIRECTORY_FAILED_SECONDS,
        )
        .catch(() => undefined);
      throw error;
    });
    return entries ?? [];
  }

  /** `null` when the product is no longer in the catalog. */
  async assessment(id: string): Promise<V3Assessment | null> {
    return this.cachedPublic(`v3:assessment:${id}`, async () => {
      const data = await this.request<{
        id: string;
        name: string;
        is_free?: boolean;
        description?: string | null;
        category?: { name?: string } | null;
      }>(`/user/find/assessments/${encodeURIComponent(id)}`);
      if (!data) return null;
      return {
        id: data.id,
        name: data.name,
        is_free: Boolean(data.is_free),
        description: data.description ?? null,
        category: data.category?.name ?? null,
      };
    });
  }

  userProfile(userId: string): Promise<V3UserProfile | null> {
    return this.request(`/internal/ai/users/${encodeURIComponent(userId)}`, {
      internal: true,
    });
  }

  async userAssessments(userId: string): Promise<V3UserAssessment[]> {
    return (
      (await this.request<V3UserAssessment[]>(
        `/internal/ai/users/${encodeURIComponent(userId)}/assessments`,
        { internal: true },
      )) ?? []
    );
  }

  booking(bookingId: string): Promise<V3Booking | null> {
    return this.request(
      `/internal/ai/bookings/${encodeURIComponent(bookingId)}`,
      {
        internal: true,
      },
    );
  }

  /** Account deletions and merges with `deleted_data.id` greater than `afterId`, oldest first. */
  async accountEvents(
    afterId: string,
    limit: number,
  ): Promise<V3AccountEvent[]> {
    const query = new URLSearchParams({
      after_id: afterId,
      limit: String(limit),
    });
    const data = await this.request<{ events: V3AccountEvent[] }>(
      `/internal/ai/account-events?${query.toString()}`,
      { internal: true },
    );
    return data?.events ?? [];
  }

  async notify(notifications: V3Notification[]): Promise<void> {
    if (notifications.length === 0) return;
    await this.request('/internal/ai/notifications', {
      internal: true,
      method: 'POST',
      body: { notifications },
    });
  }

  private async cachedPublic<T>(
    key: string,
    load: () => Promise<T | null>,
  ): Promise<T | null> {
    const hit = await this.redis
      .getJson<{ value: T | null }>(key)
      .catch(() => null);
    if (hit) return hit.value;
    // Single flight per instance: concurrent turns on a cold cache share one upstream load.
    const running = this.loading.get(key) as Promise<T | null> | undefined;
    if (running) return running;
    const loading = (async () => {
      const value = await load();
      await this.redis
        .setJson(key, { value }, PUBLIC_CACHE_SECONDS)
        .catch(() => undefined);
      return value;
    })().finally(() => this.loading.delete(key));
    this.loading.set(key, loading);
    return loading;
  }

  /** `null` on 404; throws `V3Error` on any other failure. */
  private async request<T>(
    path: string,
    options: {
      internal?: boolean;
      /** Public directory reads go to `PSIKOLOG_DIRECTORY_API_URL` when set. */
      directory?: boolean;
      method?: 'GET' | 'POST';
      body?: unknown;
    } = {},
  ): Promise<T | null> {
    const baseUrl = options.directory ? this.directoryUrl : this.baseUrl;
    if (!baseUrl) throw new V3Error(503, path);
    if (options.internal && !this.serviceToken) throw new V3Error(503, path);
    const headers: Record<string, string> = { accept: 'application/json' };
    if (options.internal && this.serviceToken) {
      headers['x-ai-service-token'] = this.serviceToken;
    }
    if (options.body !== undefined)
      headers['content-type'] = 'application/json';
    let response: Response;
    try {
      response = await this.fetchImpl(`${baseUrl}${path}`, {
        method: options.method ?? 'GET',
        headers,
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new V3Error(0, path);
    }
    if (response.status === 404) return null;
    const body = (await response.json().catch(() => null)) as {
      success?: boolean;
      data?: T;
    } | null;
    if (!response.ok || !body || body.success === false) {
      this.logger.warn({ path, status: response.status }, 'v3 request failed');
      throw new V3Error(response.status, path);
    }
    return body.data ?? null;
  }
}
