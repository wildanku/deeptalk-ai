import { validateEnvironment } from './env.schema';

const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db' };

const production = {
  ...base,
  NODE_ENV: 'production',
  AI_JWKS_URL: 'https://api.example.com/v2/.well-known/ai-jwks.json',
  DEEPTALK_API_URL: 'https://api.example.com',
  AI_SERVICE_TOKEN: 'a'.repeat(32),
  INBOUND_WEBHOOK_TOKEN: 'b'.repeat(32),
  AGENT_URL: 'https://agent.example.run.app',
  MESSAGE_KMS_KEY:
    'projects/p/locations/asia-southeast2/keyRings/r/cryptoKeys/messages',
  CORS_ORIGINS: 'https://deeptalk.co.id',
  AGENT_AUTH: 'id_token',
  SCHEDULER_TOKEN: 'c'.repeat(32),
  TASKS_DRIVER: 'cloud',
  TASKS_TOKEN: 'd'.repeat(32),
  TASKS_TARGET_URL: 'https://gateway.example.run.app',
  GOOGLE_CLOUD_PROJECT: 'p',
};

const LOCAL_KEY = Buffer.alloc(32, 7).toString('base64');

describe('validateEnvironment', () => {
  it('applies defaults for local development', () => {
    const env = validateEnvironment(base);

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(8080);
    expect(env.AI_JWT_ISSUER).toBe('deeptalk-api');
    expect(env.AI_JWT_AUDIENCE).toBe('deeptalk-ai');
    expect(env.SESSION_QUOTA_PER_MONTH).toBe(10);
    expect(env.SESSION_ACTIVE_LIMIT_SECONDS).toBe(1800);
    expect(env.AI_TRIAL_ALLOW_WITHOUT_SERVICE_CONSENT).toBe(false);
  });

  it('allows the explicit beta trial service-consent bypass', () => {
    const env = validateEnvironment({
      ...base,
      AI_TRIAL_ALLOW_WITHOUT_SERVICE_CONSENT: 'true',
    });

    expect(env.AI_TRIAL_ALLOW_WITHOUT_SERVICE_CONSENT).toBe(true);
  });

  it('accepts a complete production configuration', () => {
    expect(() => validateEnvironment(production)).not.toThrow();
  });

  it.each([
    'AI_JWKS_URL',
    'DEEPTALK_API_URL',
    'AI_SERVICE_TOKEN',
    'INBOUND_WEBHOOK_TOKEN',
    'AGENT_URL',
    'MESSAGE_KMS_KEY',
    'CORS_ORIGINS',
    'SCHEDULER_TOKEN',
    'TASKS_TOKEN',
    'TASKS_TARGET_URL',
  ])('requires %s in production', (key) => {
    const config: Record<string, unknown> = { ...production };
    delete config[key];

    expect(() => validateEnvironment(config)).toThrow(key);
  });

  it('rejects the local task driver in production', () => {
    expect(() =>
      validateEnvironment({ ...production, TASKS_DRIVER: 'local' }),
    ).toThrow('TASKS_DRIVER');
  });

  it('needs a project for Cloud Tasks', () => {
    const config: Record<string, unknown> = { ...production };
    delete config.GOOGLE_CLOUD_PROJECT;
    expect(() => validateEnvironment(config)).toThrow('GOOGLE_CLOUD_PROJECT');
  });

  it('treats empty values as unset', () => {
    const env = validateEnvironment({
      ...base,
      AI_JWKS_URL: '',
      PORT: '',
    });

    expect(env.AI_JWKS_URL).toBeUndefined();
    expect(env.PORT).toBe(8080);
  });

  it('rejects a short service token', () => {
    expect(() =>
      validateEnvironment({ ...base, AI_SERVICE_TOKEN: 'too-short' }),
    ).toThrow('AI_SERVICE_TOKEN');
  });

  it('rejects a malformed KMS key name', () => {
    expect(() =>
      validateEnvironment({ ...base, MESSAGE_KMS_KEY: 'messages' }),
    ).toThrow('MESSAGE_KMS_KEY');
  });

  it('requires agent ID tokens in production', () => {
    expect(() =>
      validateEnvironment({ ...production, AGENT_AUTH: 'none' }),
    ).toThrow('AGENT_AUTH');
  });

  it('accepts a 32-byte local message key outside production only', () => {
    expect(() =>
      validateEnvironment({ ...base, MESSAGE_LOCAL_KEY: LOCAL_KEY }),
    ).not.toThrow();
    expect(() =>
      validateEnvironment({ ...production, MESSAGE_LOCAL_KEY: LOCAL_KEY }),
    ).toThrow('MESSAGE_LOCAL_KEY');
    expect(() =>
      validateEnvironment({ ...base, MESSAGE_LOCAL_KEY: 'c2hvcnQ=' }),
    ).toThrow('32 random bytes');
  });

  it('rejects a warning threshold at or above the active limit', () => {
    expect(() =>
      validateEnvironment({
        ...base,
        SESSION_WARNING_AT_SECONDS: '1800',
        SESSION_ACTIVE_LIMIT_SECONDS: '1800',
      }),
    ).toThrow('SESSION_WARNING_AT_SECONDS');
  });
});
