export type AiRole = 'user' | 'psikolog';

/** Identity carried by a verified AI access token (deeptalk-api-v3, 02 §5.2). */
export interface AiPrincipal {
  /** `users.id` for users, psikolog-service ID for psikolog. */
  sub: string;
  role: AiRole;
  jti: string;
  /** Expiry, seconds since epoch. */
  exp: number;
}
