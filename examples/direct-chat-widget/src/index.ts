const MAX_BODY_BYTES = 65_536;
const MAX_MESSAGES = 30;
const MAX_MESSAGE_CHARS = 4_000;
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;

export interface WidgetEnv {
  BACKEND_MODE: string;
  ALLOWED_ORIGINS: string;
  HAYSTACK_BASE_URL: string;
  HAYSTACK_AGENT_REF: string;
  HAYSTACK_TENANT_KEY: string;
  HAYSTACK_AGENT_SLUG: string;
  HAYSTACK_CONNECTOR_TOKEN?: string;
}

export interface WidgetDependencies {
  fetch(request: Request): Promise<Response>;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

interface ChatRequest {
  conversationId: string;
  visitorId: string;
  messages: ChatMessage[];
}

export async function handleWidgetRequest(
  request: Request,
  env: WidgetEnv,
  dependencies: WidgetDependencies = { fetch: (upstream) => globalThis.fetch(upstream) },
): Promise<Response> {
  const correlationId = crypto.randomUUID();
  const url = new URL(request.url);
  if (url.pathname !== '/api/chat') return errorResponse(404, 'NOT_FOUND', correlationId);

  let configuration: WidgetConfiguration;
  try {
    configuration = parseConfiguration(env);
  } catch {
    return errorResponse(500, 'WIDGET_MISCONFIGURED', correlationId);
  }

  const origin = validatedOrigin(request.headers.get('origin'), url.origin, configuration.origins);
  if (!origin) return errorResponse(403, 'ORIGIN_NOT_ALLOWED', correlationId);
  if (request.method === 'OPTIONS') return preflightResponse(request, origin, correlationId);
  if (request.method !== 'POST') {
    const response = errorResponse(405, 'METHOD_NOT_ALLOWED', correlationId, origin);
    response.headers.set('Allow', 'POST, OPTIONS');
    return response;
  }
  if (!isJson(request.headers.get('content-type'))) {
    return errorResponse(415, 'UNSUPPORTED_MEDIA_TYPE', correlationId, origin);
  }

  let input: ChatRequest;
  try {
    input = parseChatRequest(JSON.parse(await readBoundedBody(request)));
  } catch (error) {
    const code = error instanceof BodyTooLargeError ? 'REQUEST_TOO_LARGE' : 'INVALID_REQUEST';
    return errorResponse(
      error instanceof BodyTooLargeError ? 413 : 400,
      code,
      correlationId,
      origin,
    );
  }

  if (configuration.mode === 'mock') return mockResponse(input, origin);

  const upstreamRequest = new Request(`${configuration.haystackBaseUrl}/api/connectors/v1/runs`, {
    method: 'POST',
    headers: {
      Accept: 'text/event-stream',
      Authorization: `Bearer ${configuration.connectorToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(haystackExecution(input, configuration, origin)),
    redirect: 'manual',
  });

  let upstream: Response;
  try {
    upstream = await dependencies.fetch(upstreamRequest);
  } catch {
    console.error(JSON.stringify({ message: 'Haystack request failed', correlationId }));
    return errorResponse(502, 'AGENT_UNAVAILABLE', correlationId, origin);
  }
  if (!upstream.ok || !isEventStream(upstream.headers.get('content-type')) || !upstream.body) {
    console.error(
      JSON.stringify({
        message: 'Haystack returned an invalid response',
        correlationId,
        status: upstream.status,
      }),
    );
    return errorResponse(502, 'AGENT_UNAVAILABLE', correlationId, origin);
  }
  return streamResponse(upstream.body, origin, upstream.headers);
}

export default {
  fetch(request, env) {
    return handleWidgetRequest(request, env);
  },
} satisfies ExportedHandler<WidgetEnv>;

interface WidgetConfiguration {
  mode: 'mock' | 'haystack';
  origins: string[];
  haystackBaseUrl: string;
  agentRef: string;
  tenantKey: string;
  agentSlug: string;
  connectorToken: string;
}

function parseConfiguration(env: WidgetEnv): WidgetConfiguration {
  if (env.BACKEND_MODE !== 'mock' && env.BACKEND_MODE !== 'haystack') throw new Error();
  const origins: unknown = JSON.parse(env.ALLOWED_ORIGINS);
  if (
    !Array.isArray(origins) ||
    origins.length > 20 ||
    !origins.every((origin) => typeof origin === 'string' && isHttpsOrigin(origin))
  ) {
    throw new Error();
  }
  const baseUrl = new URL(env.HAYSTACK_BASE_URL);
  if (
    !['http:', 'https:'].includes(baseUrl.protocol) ||
    (env.BACKEND_MODE === 'haystack' && baseUrl.protocol !== 'https:') ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.pathname !== '/' ||
    baseUrl.search ||
    baseUrl.hash
  ) {
    throw new Error();
  }
  if (!OPAQUE_ID.test(env.HAYSTACK_AGENT_REF)) throw new Error();
  if (!isTrustedName(env.HAYSTACK_TENANT_KEY) || !isTrustedName(env.HAYSTACK_AGENT_SLUG)) {
    throw new Error();
  }
  if (env.BACKEND_MODE === 'haystack' && !env.HAYSTACK_CONNECTOR_TOKEN) throw new Error();
  return {
    mode: env.BACKEND_MODE,
    origins,
    haystackBaseUrl: baseUrl.origin,
    agentRef: env.HAYSTACK_AGENT_REF,
    tenantKey: env.HAYSTACK_TENANT_KEY,
    agentSlug: env.HAYSTACK_AGENT_SLUG,
    connectorToken: env.HAYSTACK_CONNECTOR_TOKEN ?? '',
  };
}

function parseChatRequest(value: unknown): ChatRequest {
  if (!isRecord(value) || !isOpaqueId(value.conversationId) || !isOpaqueId(value.visitorId)) {
    throw new Error();
  }
  if (
    !Array.isArray(value.messages) ||
    value.messages.length < 1 ||
    value.messages.length > MAX_MESSAGES
  ) {
    throw new Error();
  }
  const messages = value.messages.map((candidate): ChatMessage => {
    if (
      !isRecord(candidate) ||
      (candidate.role !== 'user' && candidate.role !== 'assistant') ||
      typeof candidate.text !== 'string'
    ) {
      throw new Error();
    }
    const text = candidate.text.trim();
    if (!text || text.length > MAX_MESSAGE_CHARS) throw new Error();
    return { role: candidate.role, text };
  });
  if (messages.at(-1)?.role !== 'user') throw new Error();
  return { conversationId: value.conversationId, visitorId: value.visitorId, messages };
}

function haystackExecution(input: ChatRequest, configuration: WidgetConfiguration, origin: string) {
  const now = new Date().toISOString();
  const currentMessageId = `message-${crypto.randomUUID()}`;
  const history = input.messages.map((message, index) => {
    const isCurrent = index === input.messages.length - 1;
    return {
      messageId: isCurrent ? currentMessageId : `history-${index + 1}`,
      conversationId: input.conversationId,
      sequence: index + 1,
      participantId: message.role === 'user' ? input.visitorId : 'widget-agent',
      role: message.role,
      status: 'completed',
      parts: [{ type: 'text', text: message.text }],
      createdAt: now,
      completedAt: now,
    };
  });
  return {
    assistantMessageId: `message-${crypto.randomUUID()}`,
    request: {
      runId: `run-${crypto.randomUUID()}`,
      conversationId: input.conversationId,
      agentRef: configuration.agentRef,
      currentMessage: history.at(-1),
      userParticipantId: input.visitorId,
      history,
      principalContext: { kind: 'anonymous', principalId: input.visitorId },
      resolvedInputs: [],
      trustedMetadata: {
        origin,
        'haystack.tenant_key': configuration.tenantKey,
        'haystack.agent_slug': configuration.agentSlug,
      },
    },
  };
}

function mockResponse(input: ChatRequest, origin: string): Response {
  const base = {
    visibility: 'public',
    conversationId: input.conversationId,
    runId: `run-${crypto.randomUUID()}`,
  };
  const frames = [
    { ...base, type: 'run.started', data: { agentRef: 'preview' } },
    {
      ...base,
      type: 'message.started',
      messageId: `message-${crypto.randomUUID()}`,
      data: { role: 'assistant' },
    },
    { ...base, type: 'message.delta', data: { delta: 'This preview is working. ' } },
    {
      ...base,
      type: 'message.delta',
      data: { delta: `You said: “${input.messages.at(-1)?.text}”` },
    },
    { ...base, type: 'run.completed', data: {} },
  ];
  const body = frames
    .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join('');
  return streamResponse(new Response(body).body as ReadableStream<Uint8Array>, origin);
}

async function readBoundedBody(request: Request): Promise<string> {
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) {
    throw new BodyTooLargeError();
  }
  if (!request.body) throw new Error();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      length += result.value.byteLength;
      if (length > MAX_BODY_BYTES) throw new BodyTooLargeError();
      chunks.push(result.value);
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

function validatedOrigin(
  value: string | null,
  requestOrigin: string,
  allowed: string[],
): string | undefined {
  if (!value) return undefined;
  try {
    const origin = new URL(value).origin;
    return origin === value && (origin === requestOrigin || allowed.includes(origin))
      ? origin
      : undefined;
  } catch {
    return undefined;
  }
}

function preflightResponse(request: Request, origin: string, correlationId: string): Response {
  if (request.headers.get('access-control-request-method')?.toUpperCase() !== 'POST') {
    return errorResponse(405, 'METHOD_NOT_ALLOWED', correlationId, origin);
  }
  const headers = (request.headers.get('access-control-request-headers') ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (headers.some((name) => name !== 'content-type')) {
    return errorResponse(403, 'HEADER_NOT_ALLOWED', correlationId, origin);
  }
  return new Response(null, {
    status: 204,
    headers: corsHeaders(origin, {
      'Access-Control-Allow-Headers': 'content-type',
      'Access-Control-Allow-Methods': 'POST',
      'Access-Control-Max-Age': '600',
    }),
  });
}

function streamResponse(
  body: ReadableStream<Uint8Array>,
  origin: string,
  upstream?: Headers,
): Response {
  return new Response(body, {
    headers: corsHeaders(origin, {
      'Cache-Control': upstream?.get('cache-control') ?? 'no-cache, no-transform',
      'Content-Type': 'text/event-stream; charset=utf-8',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    }),
  });
}

function errorResponse(
  status: number,
  code: string,
  correlationId: string,
  origin?: string,
): Response {
  const headers = origin
    ? corsHeaders(origin, {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8',
      })
    : new Headers({
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8',
      });
  return Response.json(
    { error: { code, message: 'The chat request could not be completed.', correlationId } },
    { status, headers },
  );
}

function corsHeaders(origin: string, values: HeadersInit): Headers {
  const headers = new Headers(values);
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Vary', 'Origin');
  return headers;
}

function isJson(value: string | null): boolean {
  return value?.split(';', 1)[0]?.trim().toLowerCase() === 'application/json';
}

function isEventStream(value: string | null): boolean {
  return value?.split(';', 1)[0]?.trim().toLowerCase() === 'text/event-stream';
}

function isHttpsOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === value;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

class BodyTooLargeError extends Error {}

function isOpaqueId(value: unknown): value is string {
  return typeof value === 'string' && OPAQUE_ID.test(value);
}

function isTrustedName(value: string): boolean {
  return value.length >= 1 && value.length <= 200;
}
