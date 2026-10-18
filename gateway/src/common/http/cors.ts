import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

/** `true` when a request's `Origin` may read the response. */
export type OriginPredicate = (origin: string) => boolean;

const ORIGIN_ENTRY =
  /^(https?):\/\/(\*\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)*)(:\d{1,5})?\/?$/i;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toOriginPattern(entry: string): RegExp {
  const match = ORIGIN_ENTRY.exec(entry);
  if (!match || (match[4] && Number(match[4].slice(1)) > 65535)) {
    throw new Error(
      `Invalid CORS origin "${entry}": expected "*", "https://host[:port]" or "https://*.host"`,
    );
  }
  const [, scheme, wildcard, host, port = ''] = match;
  // `*.` stands for one or more subdomain labels, never the bare domain itself.
  const subdomains = wildcard ? '(?:[a-z0-9-]+\\.)+' : '';
  return new RegExp(
    `^${scheme}://${subdomains}${escapeRegExp(host)}${port}$`,
    'i',
  );
}

/**
 * Parses `CORS_ORIGINS` (comma-separated). Unset, empty, or containing `*` means any origin;
 * otherwise each entry is an exact origin (`https://admin.example.com`, optional port) or a
 * subdomain wildcard (`https://*.example.com`). Throws on a malformed entry so a typo fails
 * env validation at boot instead of silently blocking a frontend.
 */
export function parseCorsOrigins(
  raw: string | undefined,
): '*' | OriginPredicate {
  const entries = (raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries.length === 0 || entries.includes('*')) {
    return '*';
  }
  const patterns = entries.map(toOriginPattern);
  return (origin) => patterns.some((pattern) => pattern.test(origin));
}

/**
 * Single CORS policy for both HTTP (`app.enableCors`) and Socket.IO (`RedisIoAdapter`).
 * Credentials stay off: every client authenticates with a bearer token in `Authorization`,
 * never a cookie, so a cross-origin page can't ride on a victim's session either way.
 */
export function buildCorsOptions(raw: string | undefined): CorsOptions {
  const allowed = parseCorsOrigins(raw);
  return {
    origin:
      allowed === '*'
        ? '*'
        : (origin, callback) =>
            callback(null, origin !== undefined && allowed(origin)),
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    credentials: false,
    maxAge: 600,
  };
}
