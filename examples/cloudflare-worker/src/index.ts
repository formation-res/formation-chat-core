const MAX_REQUEST_BYTES = 131_072;
const SERVICE_TOKEN_HEADER = 'X-Formation-Chat-Service-Token';
const OPAQUE_ID = '[A-Za-z0-9][A-Za-z0-9._~-]{0,127}';

const ROUTES: readonly Route[] = [
  { pattern: /^\/v1\/sessions$/, methods: ['POST'], kind: 'bootstrap' },
  { pattern: /^\/v1\/conversations$/, methods: ['GET', 'POST'], kind: 'public' },
  { pattern: new RegExp(`^/v1/conversations/${OPAQUE_ID}$`), methods: ['GET'], kind: 'public' },
  {
    pattern: new RegExp(`^/v1/conversations/${OPAQUE_ID}/messages$`),
    methods: ['GET', 'POST'],
    kind: 'public',
  },
  {
    pattern: new RegExp(`^/v1/conversations/${OPAQUE_ID}/events$`),
    methods: ['GET'],
    kind: 'public',
  },
  {
    pattern: new RegExp(`^/v1/conversations/${OPAQUE_ID}/inputs/${OPAQUE_ID}$`),
    methods: ['POST'],
    kind: 'public',
  },
  {
    pattern: new RegExp(`^/v1/conversations/${OPAQUE_ID}/(?:cancel|retry)$`),
    methods: ['POST'],
    kind: 'public',
  },
];

const FORWARDED_REQUEST_HEADERS = [
  'accept',
  'authorization',
  'content-type',
  'idempotency-key',
  'last-event-id',
] as const;
const ALLOWED_PREFLIGHT_HEADERS = new Set<string>(FORWARDED_REQUEST_HEADERS);
const FORWARDED_RESPONSE_HEADERS = [
  'cache-control',
  'content-type',
  'etag',
  'retry-after',
] as const;

interface Route {
  pattern: RegExp;
  methods: readonly string[];
  kind: 'bootstrap' | 'public';
}

interface SiteConfig {
  siteKey: string;
  allowedOrigins: readonly string[];
}

export type GatewayEnv = Pick<Env, 'CHAT_CORE_BASE_URL' | 'CHAT_SITES' | 'CHAT_CORE_SERVICE_TOKEN'>;

export interface GatewayDependencies {
  fetch(request: Request): Promise<Response>;
}

export async function handleGatewayRequest(
  request: Request,
  env: GatewayEnv,
  dependencies: GatewayDependencies = { fetch: globalThis.fetch },
): Promise<Response> {
  const correlationId = crypto.randomUUID();
  const requestUrl = new URL(request.url);
  let configuration: GatewayConfiguration;
  try {
    configuration = parseConfiguration(env);
  } catch {
    return errorResponse(
      500,
      'GATEWAY_MISCONFIGURED',
      'The gateway is unavailable.',
      correlationId,
    );
  }

  const site = configuration.sites[requestUrl.hostname.toLowerCase()];
  if (!site) return errorResponse(404, 'SITE_NOT_FOUND', 'Site not found.', correlationId);

  const origin = validatedOrigin(
    request.headers.get('origin'),
    site.allowedOrigins,
    requestUrl.origin,
    request.headers.get('sec-fetch-site'),
  );
  if (!origin) {
    return errorResponse(403, 'ORIGIN_NOT_ALLOWED', 'Origin not allowed.', correlationId);
  }

  const route = ROUTES.find(({ pattern }) => pattern.test(requestUrl.pathname));
  if (!route)
    return errorResponse(404, 'ROUTE_NOT_FOUND', 'Route not found.', correlationId, origin);

  if (request.method === 'OPTIONS') return preflightResponse(request, route, origin, correlationId);
  if (!route.methods.includes(request.method)) {
    const response = errorResponse(
      405,
      'METHOD_NOT_ALLOWED',
      'Method not allowed.',
      correlationId,
      origin,
    );
    response.headers.set('Allow', route.methods.join(', '));
    return response;
  }

  let body: string | undefined;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    if (!isJsonContentType(request.headers.get('content-type'))) {
      return errorResponse(
        415,
        'UNSUPPORTED_MEDIA_TYPE',
        'A JSON request body is required.',
        correlationId,
        origin,
      );
    }
    try {
      body = await prepareBody(request, route.kind, site.siteKey);
    } catch (error) {
      if (error instanceof RequestBodyError) {
        return errorResponse(error.status, error.code, error.message, correlationId, origin);
      }
      return errorResponse(
        400,
        'INVALID_JSON',
        'The JSON request is invalid.',
        correlationId,
        origin,
      );
    }
  }

  const headers = forwardedRequestHeaders(
    request.headers,
    route.kind,
    origin,
    env.CHAT_CORE_SERVICE_TOKEN,
  );
  const upstreamUrl = new URL(
    `${requestUrl.pathname}${requestUrl.search}`,
    configuration.coreBaseUrl,
  );
  let upstream: Response;
  try {
    upstream = await dependencies.fetch(
      new Request(upstreamUrl, {
        method: request.method,
        headers,
        ...(body === undefined ? {} : { body }),
        redirect: 'manual',
      }),
    );
  } catch {
    console.error(
      JSON.stringify({
        message: 'chat core request failed',
        correlationId,
        path: requestUrl.pathname,
      }),
    );
    return errorResponse(
      502,
      'CORE_UNAVAILABLE',
      'The chat service is unavailable.',
      correlationId,
      origin,
    );
  }

  return streamedResponse(upstream, origin);
}

export default {
  fetch(request, env) {
    return handleGatewayRequest(request, env);
  },
} satisfies ExportedHandler<Env>;

interface GatewayConfiguration {
  coreBaseUrl: URL;
  sites: Record<string, SiteConfig>;
}

function parseConfiguration(env: GatewayEnv): GatewayConfiguration {
  const coreBaseUrl = new URL(env.CHAT_CORE_BASE_URL);
  if (coreBaseUrl.protocol !== 'https:' || coreBaseUrl.username || coreBaseUrl.password) {
    throw new Error('Invalid core URL.');
  }
  if (coreBaseUrl.pathname !== '/' || coreBaseUrl.search || coreBaseUrl.hash) {
    throw new Error('Core URL must not contain a path, query, or fragment.');
  }
  if (!env.CHAT_CORE_SERVICE_TOKEN) throw new Error('Missing service token.');

  const value: unknown = JSON.parse(env.CHAT_SITES);
  if (!isRecord(value) || Object.keys(value).length === 0) throw new Error('Invalid site map.');
  const sites: Record<string, SiteConfig> = {};
  for (const [hostname, candidate] of Object.entries(value)) {
    const normalizedHostname = hostname.toLowerCase();
    if (!isHostname(normalizedHostname) || !isSiteConfig(candidate)) {
      throw new Error('Invalid site configuration.');
    }
    sites[normalizedHostname] = {
      siteKey: candidate.siteKey,
      allowedOrigins: candidate.allowedOrigins.map(normalizeConfiguredOrigin),
    };
  }
  return { coreBaseUrl, sites };
}

function isSiteConfig(value: unknown): value is SiteConfig {
  return (
    isRecord(value) &&
    typeof value.siteKey === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(value.siteKey) &&
    Array.isArray(value.allowedOrigins) &&
    value.allowedOrigins.length > 0 &&
    value.allowedOrigins.length <= 20 &&
    value.allowedOrigins.every((origin) => typeof origin === 'string')
  );
}

function normalizeConfiguredOrigin(value: string): string {
  const url = new URL(value);
  if (url.origin !== value || url.protocol !== 'https:') throw new Error('Invalid allowed origin.');
  return url.origin;
}

function validatedOrigin(
  value: string | null,
  allowedOrigins: readonly string[],
  requestOrigin: string,
  fetchSite: string | null,
): string | undefined {
  if (!value) {
    return fetchSite === 'same-origin' && allowedOrigins.includes(requestOrigin)
      ? requestOrigin
      : undefined;
  }
  try {
    const origin = new URL(value).origin;
    if (origin !== value || !allowedOrigins.includes(origin)) return undefined;
    return origin;
  } catch {
    return undefined;
  }
}

function isHostname(value: string): boolean {
  return (
    value.length <= 253 &&
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(
      value,
    )
  );
}

async function prepareBody(
  request: Request,
  kind: Route['kind'],
  siteKey: string,
): Promise<string> {
  const raw = await readBoundedBody(request, MAX_REQUEST_BYTES);
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new RequestBodyError(400, 'INVALID_JSON', 'The JSON request is invalid.');
  }
  if (kind !== 'bootstrap') return JSON.stringify(value);
  if (!isRecord(value)) {
    throw new RequestBodyError(400, 'INVALID_REQUEST', 'The session request is invalid.');
  }
  const browserIdentity = value.browserIdentity;
  if (browserIdentity !== undefined && typeof browserIdentity !== 'string') {
    throw new RequestBodyError(400, 'INVALID_REQUEST', 'The session request is invalid.');
  }
  return JSON.stringify({ ...(browserIdentity ? { browserIdentity } : {}), siteKey });
}

async function readBoundedBody(request: Request, maximumBytes: number): Promise<string> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength && Number(declaredLength) > maximumBytes) {
    throw new RequestBodyError(413, 'REQUEST_TOO_LARGE', 'The request body is too large.');
  }
  if (!request.body) throw new RequestBodyError(400, 'INVALID_JSON', 'A JSON body is required.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) {
        throw new RequestBodyError(413, 'REQUEST_TOO_LARGE', 'The request body is too large.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function forwardedRequestHeaders(
  incoming: Headers,
  kind: Route['kind'],
  origin: string,
  serviceToken: string,
): Headers {
  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    if (kind === 'bootstrap' && name === 'authorization') continue;
    const value = incoming.get(name);
    if (value) headers.set(name, value);
  }
  headers.set('Origin', origin);
  headers.set(SERVICE_TOKEN_HEADER, serviceToken);
  return headers;
}

function streamedResponse(upstream: Response, origin: string): Response {
  const headers = new Headers();
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  addCorsHeaders(headers, origin);
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

function preflightResponse(
  request: Request,
  route: Route,
  origin: string,
  correlationId: string,
): Response {
  const requestedMethod = request.headers.get('access-control-request-method');
  if (!requestedMethod || !route.methods.includes(requestedMethod.toUpperCase())) {
    return errorResponse(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.', correlationId, origin);
  }
  const requestedHeaders = (request.headers.get('access-control-request-headers') ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (requestedHeaders.some((name) => !ALLOWED_PREFLIGHT_HEADERS.has(name))) {
    return errorResponse(
      403,
      'HEADER_NOT_ALLOWED',
      'Request header not allowed.',
      correlationId,
      origin,
    );
  }
  const headers = new Headers({
    'Access-Control-Allow-Methods': route.methods.join(', '),
    'Access-Control-Allow-Headers': FORWARDED_REQUEST_HEADERS.join(', '),
    'Access-Control-Max-Age': '600',
  });
  addCorsHeaders(headers, origin);
  return new Response(null, { status: 204, headers });
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  correlationId: string,
  origin?: string,
): Response {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  });
  if (origin) addCorsHeaders(headers, origin);
  return Response.json({ error: { code, message, correlationId } }, { status, headers });
}

function addCorsHeaders(headers: Headers, origin: string): void {
  headers.set('Access-Control-Allow-Origin', origin);
  headers.append('Vary', 'Origin');
}

function isJsonContentType(value: string | null): boolean {
  return value?.split(';', 1)[0]?.trim().toLowerCase() === 'application/json';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

class RequestBodyError extends Error {
  constructor(
    readonly status: 400 | 413,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
