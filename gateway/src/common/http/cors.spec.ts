import type { CustomOrigin } from '@nestjs/common/interfaces/external/cors-options.interface';
import { buildCorsOptions, parseCorsOrigins } from './cors';

function resolveOrigin(
  raw: string | undefined,
  origin: string | undefined,
): unknown {
  const options = buildCorsOptions(raw);
  let resolved: unknown;
  (options.origin as CustomOrigin)(origin, (_error, allowed) => {
    resolved = allowed;
  });
  return resolved;
}

describe('parseCorsOrigins', () => {
  it.each([undefined, '', '  ,  ', 'https://a.example.com,*'])(
    'allows any origin for %p',
    (raw) => {
      expect(parseCorsOrigins(raw)).toBe('*');
    },
  );

  it('matches exact origins, ignoring whitespace, case and a trailing slash', () => {
    const allowed = parseCorsOrigins(
      ' https://admin.example.com/ , http://localhost:5173',
    );
    if (allowed === '*') throw new Error('expected an allowlist');

    expect(allowed('https://admin.example.com')).toBe(true);
    expect(allowed('https://ADMIN.example.com')).toBe(true);
    expect(allowed('http://localhost:5173')).toBe(true);
    expect(allowed('http://admin.example.com')).toBe(false);
    expect(allowed('http://localhost:3000')).toBe(false);
    expect(allowed('https://admin.example.com.evil.io')).toBe(false);
    expect(allowed('https://evil-admin.example.com')).toBe(false);
  });

  it('matches subdomain wildcards but not the bare domain or look-alikes', () => {
    const allowed = parseCorsOrigins('https://*.example.com');
    if (allowed === '*') throw new Error('expected an allowlist');

    expect(allowed('https://admin.example.com')).toBe(true);
    expect(allowed('https://a.b.example.com')).toBe(true);
    expect(allowed('https://example.com')).toBe(false);
    expect(allowed('https://evilexample.com')).toBe(false);
    expect(allowed('https://admin.example.com.evil.io')).toBe(false);
    expect(allowed('http://admin.example.com')).toBe(false);
  });

  it.each([
    'admin.example.com',
    'https://admin.example.com/path',
    'https://*example.com',
    'ftp://example.com',
    'https://example.com:99999',
  ])('rejects malformed entry %p', (raw) => {
    expect(() => parseCorsOrigins(raw)).toThrow(/Invalid CORS origin/);
  });
});

describe('buildCorsOptions', () => {
  it('uses a static wildcard without credentials when unrestricted', () => {
    expect(buildCorsOptions(undefined)).toMatchObject({
      origin: '*',
      credentials: false,
    });
  });

  it('only allows listed origins when restricted', () => {
    const raw = 'https://admin.example.com';

    expect(resolveOrigin(raw, 'https://admin.example.com')).toBe(true);
    expect(resolveOrigin(raw, 'https://other.example.com')).toBe(false);
    expect(resolveOrigin(raw, undefined)).toBe(false);
  });
});
