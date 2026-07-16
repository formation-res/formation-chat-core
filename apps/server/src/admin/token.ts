import type { AdminAccessScope, AdminTokenClaims, OpaqueId } from '@formation-chat-core/protocol';
import { jwtVerify, SignJWT } from 'jose';

const algorithm = 'HS256';
const audience = 'formation-chat-core-admin';
const issuer = 'formation-chat-core';

export interface AdminTokenSubject {
  adminId: OpaqueId;
  tenantId: OpaqueId;
  siteIds: OpaqueId[];
  scopes: AdminAccessScope[];
}

export class AdminTokenService {
  readonly #key: Uint8Array;

  constructor(
    secret: string,
    private readonly ttlSeconds: number,
  ) {
    if (Buffer.byteLength(secret) < 32) throw new Error('Admin token secret is too short.');
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 86_400) {
      throw new Error('Admin token TTL is invalid.');
    }
    this.#key = new TextEncoder().encode(secret);
  }

  async issue(
    subject: AdminTokenSubject,
    now = new Date(),
  ): Promise<{ token: string; claims: AdminTokenClaims }> {
    const issuedAtSeconds = Math.floor(now.getTime() / 1000);
    const expiresAtSeconds = issuedAtSeconds + this.ttlSeconds;
    const claims: AdminTokenClaims = {
      ...subject,
      siteIds: [...subject.siteIds],
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
      .sign(this.#key);
    return { token, claims };
  }

  async verify(token: string): Promise<AdminTokenClaims> {
    const { payload } = await jwtVerify(token, this.#key, {
      algorithms: [algorithm],
      audience,
      issuer,
    });
    const claims: AdminTokenClaims = {
      adminId: payload.adminId as string,
      tenantId: payload.tenantId as string,
      siteIds: payload.siteIds as string[],
      scopes: payload.scopes as AdminAccessScope[],
      issuedAt: payload.issuedAt as string,
      expiresAt: payload.expiresAt as string,
    };
    if (
      typeof claims.adminId !== 'string' ||
      typeof claims.tenantId !== 'string' ||
      !Array.isArray(claims.siteIds) ||
      claims.siteIds.length === 0 ||
      claims.siteIds.some((siteId) => typeof siteId !== 'string') ||
      new Set(claims.siteIds).size !== claims.siteIds.length ||
      !Array.isArray(claims.scopes) ||
      claims.scopes.length === 0 ||
      claims.scopes.some((scope) => scope !== 'admin:read' && scope !== 'admin:internal') ||
      typeof claims.issuedAt !== 'string' ||
      typeof claims.expiresAt !== 'string'
    ) {
      throw new Error('Invalid admin token.');
    }
    return claims;
  }
}
