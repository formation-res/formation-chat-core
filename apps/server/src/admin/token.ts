import type { AdminAccessScope, AdminTokenClaims, OpaqueId } from '@formation-chat-core/protocol';
import { jwtVerify, SignJWT } from 'jose';

const algorithm = 'HS256';
const audience = 'formation-chat-core-admin';
const issuer = 'formation-chat-core';

export interface AdminTokenSubject {
  adminId: OpaqueId;
  tenantId: OpaqueId;
  email?: string;
  displayName?: string;
  scopes: AdminAccessScope[];
}

export class AdminTokenService {
  readonly #keys: Uint8Array[];

  constructor(
    secrets: string | [string, ...string[]],
    readonly ttlSeconds: number,
  ) {
    const values = typeof secrets === 'string' ? [secrets] : secrets;
    if (values.some((secret) => Buffer.byteLength(secret) < 32)) {
      throw new Error('Admin token secret is too short.');
    }
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 86_400) {
      throw new Error('Admin token TTL is invalid.');
    }
    this.#keys = values.map((secret) => new TextEncoder().encode(secret));
  }

  async issue(
    subject: AdminTokenSubject,
    now = new Date(),
  ): Promise<{ token: string; claims: AdminTokenClaims }> {
    if (!isValidSubject(subject)) throw new Error('Invalid admin token subject.');
    const issuedAtSeconds = Math.floor(now.getTime() / 1000);
    const expiresAtSeconds = issuedAtSeconds + this.ttlSeconds;
    const claims: AdminTokenClaims = {
      ...subject,
      scopes: [...subject.scopes],
      issuedAt: new Date(issuedAtSeconds * 1000).toISOString(),
      expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
    };
    const token = await new SignJWT(claims)
      .setProtectedHeader({ alg: algorithm, typ: 'JWT' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject(subject.adminId)
      .setIssuedAt(issuedAtSeconds)
      .setExpirationTime(expiresAtSeconds)
      .sign(this.#keys[0] as Uint8Array);
    return { token, claims };
  }

  async verify(token: string): Promise<AdminTokenClaims> {
    let payload: Awaited<ReturnType<typeof jwtVerify>>['payload'] | undefined;
    for (const key of this.#keys) {
      try {
        payload = (await jwtVerify(token, key, { algorithms: [algorithm], audience, issuer }))
          .payload;
        break;
      } catch {
        // Continue through the bounded rotation key ring.
      }
    }
    if (!payload) throw new Error('Invalid admin token.');
    const claims: AdminTokenClaims = {
      adminId: payload.adminId as string,
      tenantId: payload.tenantId as string,
      ...(typeof payload.email === 'string' ? { email: payload.email } : {}),
      ...(typeof payload.displayName === 'string' ? { displayName: payload.displayName } : {}),
      scopes: payload.scopes as AdminAccessScope[],
      issuedAt: payload.issuedAt as string,
      expiresAt: payload.expiresAt as string,
    };
    if (
      !isValidSubject(claims) ||
      typeof claims.issuedAt !== 'string' ||
      !Number.isFinite(Date.parse(claims.issuedAt)) ||
      typeof claims.expiresAt !== 'string' ||
      !Number.isFinite(Date.parse(claims.expiresAt))
    ) {
      throw new Error('Invalid admin token.');
    }
    return claims;
  }
}

const opaqueId = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;

function isValidSubject(subject: AdminTokenSubject): boolean {
  return (
    opaqueId.test(subject.adminId) &&
    opaqueId.test(subject.tenantId) &&
    (subject.email === undefined ||
      (subject.email.length >= 3 && subject.email.length <= 254 && subject.email.includes('@'))) &&
    (subject.displayName === undefined ||
      (subject.displayName.trim().length >= 1 && subject.displayName.length <= 160)) &&
    Array.isArray(subject.scopes) &&
    subject.scopes.length >= 1 &&
    subject.scopes.every((scope) => scope === 'admin:read' || scope === 'admin:internal') &&
    new Set(subject.scopes).size === subject.scopes.length
  );
}
