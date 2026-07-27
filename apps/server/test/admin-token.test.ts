import { describe, expect, it } from 'vitest';

import { AdminTokenService, type AdminTokenSubject } from '../src/admin/token.js';

const service = new AdminTokenService('admin-secret-0123456789abcdef0123456789abcdef', 600);

describe('AdminTokenService', () => {
  it('verifies tokens issued by the immediately previous rotation key', async () => {
    const subject: AdminTokenSubject = {
      adminId: 'operator-1',
      tenantId: 'tenant-1',
      scopes: ['admin:read'],
    };
    const previousSecret = 'previous-admin-0123456789abcdef0123456789abcdef';
    const currentSecret = 'current-admin-0123456789abcdef0123456789abcdef';
    const previous = new AdminTokenService(previousSecret, 600);
    const rotated = new AdminTokenService([currentSecret, previousSecret], 600);
    const issued = await previous.issue(subject);

    await expect(rotated.verify(issued.token)).resolves.toEqual(issued.claims);
    const fresh = await rotated.issue(subject);
    await expect(previous.verify(fresh.token)).rejects.toThrow();
  });
  it('issues and verifies tenant-bound claims', async () => {
    const issued = await service.issue({
      adminId: 'operator-1',
      tenantId: 'tenant-1',
      scopes: ['admin:read'],
    });

    await expect(service.verify(issued.token)).resolves.toEqual(issued.claims);
  });

  it('rejects invalid provisioning claims before signing', async () => {
    await expect(
      service.issue({
        adminId: 'operator-1',
        tenantId: 'tenant-1',
        scopes: [],
      }),
    ).rejects.toThrow('Invalid admin token subject.');
  });

  it('rejects expired and tampered tokens', async () => {
    const expired = await service.issue(
      {
        adminId: 'operator-1',
        tenantId: 'tenant-1',
        scopes: ['admin:read'],
      },
      new Date('2020-01-01T00:00:00Z'),
    );
    const valid = await service.issue({
      adminId: 'operator-1',
      tenantId: 'tenant-1',
      scopes: ['admin:read'],
    });

    await expect(service.verify(expired.token)).rejects.toThrow();
    const parts = valid.token.split('.');
    const signature = parts[2] as string;
    const replacement = signature[0] === 'x' ? 'y' : 'x';
    parts[2] = `${replacement}${signature.slice(1)}`;
    await expect(service.verify(parts.join('.'))).rejects.toThrow();
  });
});
