import { timingSafeEqual } from 'node:crypto';

const startedAt = new WeakMap<object, bigint>();

export class HttpMetrics {
  readonly #requests = new Map<string, number>();
  readonly #durationMs = new Map<string, number>();

  start(request: object): void {
    startedAt.set(request, process.hrtime.bigint());
  }

  finish(request: object, method: string, statusCode: number): void {
    const start = startedAt.get(request);
    if (!start) return;
    startedAt.delete(request);
    const group = `${method} ${Math.floor(statusCode / 100)}xx`;
    this.#requests.set(group, (this.#requests.get(group) ?? 0) + 1);
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    this.#durationMs.set(group, (this.#durationMs.get(group) ?? 0) + elapsedMs);
  }

  render(): string {
    const lines = [
      '# HELP chat_core_http_requests_total Completed HTTP requests.',
      '# TYPE chat_core_http_requests_total counter',
    ];
    for (const [group, count] of [...this.#requests].sort()) {
      const [method, status] = group.split(' ');
      lines.push(
        `chat_core_http_requests_total{method="${method}",status_group="${status}"} ${count}`,
      );
    }
    lines.push(
      '# HELP chat_core_http_request_duration_milliseconds_sum Total request duration.',
      '# TYPE chat_core_http_request_duration_milliseconds_sum counter',
    );
    for (const [group, duration] of [...this.#durationMs].sort()) {
      const [method, status] = group.split(' ');
      lines.push(
        `chat_core_http_request_duration_milliseconds_sum{method="${method}",status_group="${status}"} ${duration.toFixed(3)}`,
      );
    }
    return `${lines.join('\n')}\n`;
  }
}

export function matchesBearerToken(authorization: string | undefined, expected: string): boolean {
  if (!authorization?.startsWith('Bearer ')) return false;
  const actual = Buffer.from(authorization.slice(7));
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}
