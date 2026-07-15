import type { AccessScope, SessionTokenClaims } from '@formation-chat-core/protocol';
import { jwtVerify, SignJWT } from 'jose';

const algorithm = 'HS256';
const audience = 'formation-chat-core-public';
const issuer = 'formation-chat-core';
const scopes: AccessScope[] = [
  'conversations:read',
  'conversations:write',
  'events:read',
  'inputs:write',
];

export interface TokenSubject {
  tenantId: string;
  siteId: string;
  principalId: string;
  sessionId: string;
}

export class SessionTokenService {
  readonly #key: Uint8Array;

  constructor(
    secret: string,
    private readonly ttlSeconds: number,
  ) {
    this.#key = new TextEncoder().encode(secret);
  }

  async issue(
    subject: TokenSubject,
    now = new Date(),
  ): Promise<{ token: string; claims: SessionTokenClaims }> {
    const issuedAtSeconds = Math.floor(now.getTime() / 1000);
    const expiresAtSeconds = issuedAtSeconds + this.ttlSeconds;
    const claims: SessionTokenClaims = {
      ...subject,
      scopes: [...scopes],
      issuedAt: new Date(issuedAtSeconds * 1000).toISOString(),
      expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
    };
    const token = await new SignJWT(claims)
      .setProtectedHeader({ alg: algorithm, typ: 'JWT' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject(subject.principalId)
      .setIssuedAt(issuedAtSeconds)
      .setExpirationTime(expiresAtSeconds)
      .sign(this.#key);
    return { token, claims };
  }

  async verify(
    token: string,
    expected?: Pick<TokenSubject, 'tenantId' | 'siteId'>,
  ): Promise<SessionTokenClaims> {
    const { payload } = await jwtVerify(token, this.#key, {
      algorithms: [algorithm],
      audience,
      issuer,
    });
    const claims = payload as unknown as SessionTokenClaims;
    if (
      typeof claims.tenantId !== 'string' ||
      typeof claims.siteId !== 'string' ||
      typeof claims.principalId !== 'string' ||
      typeof claims.sessionId !== 'string' ||
      !Array.isArray(claims.scopes) ||
      (expected && (claims.tenantId !== expected.tenantId || claims.siteId !== expected.siteId))
    ) {
      throw new Error('Invalid session token.');
    }
    return claims;
  }
}
