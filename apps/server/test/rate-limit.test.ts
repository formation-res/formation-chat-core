import { describe, expect, it } from 'vitest';

import { FixedWindowRateLimiter } from '../src/security/rate-limit.js';

describe('FixedWindowRateLimiter', () => {
  it('bounds requests per key and resets at the next window', () => {
    const limiter = new FixedWindowRateLimiter({ windowMs: 1_000, max: 2, maxKeys: 10 });

    expect(limiter.consume('site-a', 1_000)).toMatchObject({ allowed: true, remaining: 1 });
    expect(limiter.consume('site-a', 1_100)).toMatchObject({ allowed: true, remaining: 0 });
    expect(limiter.consume('site-a', 1_200)).toMatchObject({ allowed: false, remaining: 0 });
    expect(limiter.consume('site-b', 1_200)).toMatchObject({ allowed: true, remaining: 1 });
    expect(limiter.consume('site-a', 2_000)).toMatchObject({ allowed: true, remaining: 1 });
  });

  it('keeps its key cardinality bounded under hostile input', () => {
    const limiter = new FixedWindowRateLimiter({ windowMs: 60_000, max: 1, maxKeys: 2 });

    limiter.consume('first', 1_000);
    limiter.consume('second', 1_001);
    limiter.consume('third', 1_002);

    expect(limiter.size).toBe(2);
    expect(limiter.consume('first', 1_003).allowed).toBe(true);
  });
});
