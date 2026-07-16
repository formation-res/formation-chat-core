import { describe, expect, it } from 'vitest';

import { sanitizeRequestLog } from '../src/security/logger.js';

describe('sanitizeRequestLog', () => {
  it('removes query values and ignores unlisted request properties', () => {
    const logged = sanitizeRequestLog({
      id: 'request-1',
      method: 'GET',
      url: '/v1/conversations?email=visitor@example.test&token=secret',
      headers: { authorization: 'Bearer secret' },
      body: { private: 'raw-value' },
    } as never);

    expect(logged).toEqual({
      id: 'request-1',
      method: 'GET',
      url: '/v1/conversations',
    });
    expect(JSON.stringify(logged)).not.toMatch(/visitor|secret|raw-value|authorization/);
  });
});
