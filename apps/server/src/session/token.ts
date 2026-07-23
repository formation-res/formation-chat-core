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
  agentRef: string;
  principalId: string;
  sessionId: string;
}

export class SessionTokenService {
  readonly #keys: Uint8Array[];

  constructor(
    secrets: string | [string, ...string[]],
    private readonly ttlSeconds: number,
  ) {
    const values = typeof secrets === 'string' ? [secrets] : secrets;
    if (values.some((secret) => Buffer.byteLength(secret) < 32)) {
      throw new Error('Session token secret is too short.');
    }
    this.#keys = values.map((secret) => new TextEncoder().encode(secret));
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
      .sign(this.#keys[0] as Uint8Array);
    return { token, claims };
  }

  async verify(
    token: string,
    expected?: Pick<TokenSubject, 'tenantId' | 'siteId'>,
  ): Promise<SessionTokenClaims> {
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
    if (!payload) throw new Error('Invalid session token.');
    const claims: SessionTokenClaims = {
      tenantId: payload.tenantId as string,
      siteId: payload.siteId as string,
      agentRef: payload.agentRef as string,
      principalId: payload.principalId as string,
      sessionId: payload.sessionId as string,
      scopes: payload.scopes as AccessScope[],
      issuedAt: payload.issuedAt as string,
      expiresAt: payload.expiresAt as string,
    };
    if (
      typeof claims.tenantId !== 'string' ||
      typeof claims.siteId !== 'string' ||
      typeof claims.agentRef !== 'string' ||
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
