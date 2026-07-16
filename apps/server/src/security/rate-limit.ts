export interface FixedWindowRateLimiterOptions {
  windowMs: number;
  max: number;
  maxKeys: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
}

interface WindowState {
  count: number;
  startedAt: number;
  lastSeen: number;
}

export class FixedWindowRateLimiter {
  readonly #windows = new Map<string, WindowState>();

  constructor(private readonly options: FixedWindowRateLimiterOptions) {}

  get size(): number {
    return this.#windows.size;
  }

  consume(key: string, now = Date.now()): RateLimitResult {
    let state = this.#windows.get(key);
    if (state && now >= state.startedAt + this.options.windowMs) {
      this.#windows.delete(key);
      state = undefined;
    }

    if (!state) {
      this.#makeRoom();
      state = { count: 0, startedAt: now, lastSeen: now };
      this.#windows.set(key, state);
    }

    state.lastSeen = now;
    const allowed = state.count < this.options.max;
    if (allowed) state.count += 1;

    return {
      allowed,
      limit: this.options.max,
      remaining: Math.max(0, this.options.max - state.count),
      resetSeconds: Math.max(1, Math.ceil((state.startedAt + this.options.windowMs - now) / 1000)),
    };
  }

  #makeRoom(): void {
    if (this.#windows.size < this.options.maxKeys) return;
    let oldestKey: string | undefined;
    let oldestSeen = Number.POSITIVE_INFINITY;
    for (const [key, state] of this.#windows) {
      if (state.lastSeen < oldestSeen) {
        oldestKey = key;
        oldestSeen = state.lastSeen;
      }
    }
    if (oldestKey !== undefined) this.#windows.delete(oldestKey);
  }
}
