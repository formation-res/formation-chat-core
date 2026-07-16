import { describe, expect, it } from 'vitest';

import { SessionTokenService } from '../src/session/token.js';

const secret = '0123456789abcdef0123456789abcdef';
const subject = {
  tenantId: 'tenant-a',
  siteId: 'site-a',
  principalId: 'principal-a',
  sessionId: 'session-a',
};

describe('SessionTokenService', () => {
  it('verifies tokens issued by the immediately previous rotation key', async () => {
    const previousSecret = 'previous-secret-0123456789abcdef0123456789abcdef';
    const currentSecret = 'current-secret-0123456789abcdef0123456789abcdef';
    const previous = new SessionTokenService(previousSecret, 600);
    const rotated = new SessionTokenService([currentSecret, previousSecret], 600);
    const issued = await previous.issue(subject);

    await expect(rotated.verify(issued.token)).resolves.toEqual(issued.claims);
    const fresh = await rotated.issue(subject);
    await expect(previous.verify(fresh.token)).rejects.toThrow();
  });
  it('issues and verifies scoped short-lived tokens', async () => {
    const tokens = new SessionTokenService(secret, 600);
    const issued = await tokens.issue(subject);

    await expect(
      tokens.verify(issued.token, { tenantId: 'tenant-a', siteId: 'site-a' }),
    ).resolves.toMatchObject(subject);
    await expect(
      tokens.verify(issued.token, { tenantId: 'tenant-a', siteId: 'site-b' }),
    ).rejects.toThrow('Invalid session token.');
  });

  it('rejects expired and tampered tokens', async () => {
    const tokens = new SessionTokenService(secret, 60);
    const expired = await tokens.issue(subject, new Date(Date.now() - 120_000));
    const [header, payload, signature] = expired.token.split('.') as [string, string, string];
    const tampered = `${header}.${payload}.${signature.startsWith('a') ? 'b' : 'a'}${signature.slice(1)}`;

    await expect(tokens.verify(expired.token)).rejects.toThrow();
    await expect(tokens.verify(tampered)).rejects.toThrow();
  });
});
