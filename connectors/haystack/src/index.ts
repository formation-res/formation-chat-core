import {
  ConnectorEventSchema,
  type ConnectorEvent,
  type ConnectorExecutionRequest,
} from '@formation-chat-core/protocol';
import type { ChatConnector, ConnectorExecution } from '@formation-chat-core/server-sdk';
import { Value } from '@sinclair/typebox/value';

import {
  type HaystackAgentRequest,
  type HaystackAgentResponse,
  type HaystackConnectorConfig,
  type HaystackConnectorMap,
  HaystackAgentRequestSchema,
  HaystackAgentResponseSchema,
  HaystackConnectorConfigSchema,
  HaystackConnectorMapSchema,
  isHaystackAgentRequest,
  isHaystackAgentResponse,
  parseHaystackConfig,
  parseHaystackConnectorMap,
} from './contracts.js';
import { completedEvents } from './translate.js';

export {
  type HaystackAgentRequest,
  type HaystackAgentResponse,
  type HaystackConnectorConfig,
  type HaystackConnectorMap,
  HaystackAgentRequestSchema,
  HaystackAgentResponseSchema,
  HaystackConnectorConfigSchema,
  HaystackConnectorMapSchema,
  parseHaystackConnectorMap,
};

const RESPONSE_LIMIT_BYTES = 1_048_576;

export interface HaystackConnectorDependencies {
  fetch(request: Request): Promise<Response>;
}

export class HaystackConnector implements ChatConnector {
  readonly historyMode = 'duplicate' as const;
  private readonly config: HaystackConnectorConfig;
  private readonly dependencies: HaystackConnectorDependencies;

  constructor(
    config: HaystackConnectorConfig,
    dependencies: HaystackConnectorDependencies = { fetch: globalThis.fetch },
  ) {
    this.config = parseHaystackConfig(config);
    this.dependencies = dependencies;
  }

  async *run(execution: ConnectorExecution): AsyncIterable<ConnectorEvent> {
    if (execution.signal.aborted) return;
    if (this.config.connectorToken) {
      yield* this.runNative(execution);
      return;
    }
    yield* this.runCompatibility(execution);
  }

  private async *runNative(execution: ConnectorExecution): AsyncIterable<ConnectorEvent> {
    const payload = nativePayload(execution, this.config);
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), this.config.timeoutMs ?? 120_000);
    const signal = AbortSignal.any([execution.signal, timeout.signal]);
    try {
      let response: Response;
      try {
        response = await this.dependencies.fetch(
          new Request(`${this.config.baseUrl}/api/connectors/v1/runs`, {
            method: 'POST',
            headers: {
              Accept: 'text/event-stream',
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.config.connectorToken}`,
            },
            body: JSON.stringify(payload),
            redirect: 'error',
            signal,
          }),
        );
      } catch {
        if (execution.signal.aborted) return;
        yield failedEvent(
          execution,
          timeout.signal.aborted ? 'HAYSTACK_TIMEOUT' : 'HAYSTACK_UNAVAILABLE',
        );
        return;
      }
      if (execution.signal.aborted) return;
      if (!response.ok) {
        yield failedEvent(
          execution,
          response.status === 401 ? 'HAYSTACK_UNAUTHORIZED' : 'HAYSTACK_HTTP_ERROR',
        );
        return;
      }
      if (!response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream')) {
        yield failedEvent(execution, 'HAYSTACK_INVALID_RESPONSE');
        return;
      }
      if (!response.body) {
        yield failedEvent(execution, 'HAYSTACK_INVALID_RESPONSE');
        return;
      }
      try {
        for await (const event of parseConnectorEventStream(response.body, signal)) yield event;
      } catch {
        if (!execution.signal.aborted) yield failedEvent(execution, 'HAYSTACK_INVALID_RESPONSE');
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private async *runCompatibility(execution: ConnectorExecution): AsyncIterable<ConnectorEvent> {
    const base = {
      visibility: 'public' as const,
      conversationId: execution.request.conversationId,
      runId: execution.request.runId,
    };
    yield {
      ...base,
      type: 'run.started',
      data: { agentRef: execution.request.agentRef },
    };

    const payload = requestPayload(execution, this.config);
    if (!payload) {
      yield failedEvent(execution, 'HAYSTACK_INVALID_REQUEST');
      return;
    }

    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), this.config.timeoutMs ?? 30_000);
    const signal = AbortSignal.any([execution.signal, timeout.signal]);
    let body: unknown;
    try {
      let response: Response;
      try {
        response = await this.dependencies.fetch(
          new Request(`${this.config.baseUrl}/api/agents/knowledge/chat`, {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            redirect: 'error',
            signal,
          }),
        );
      } catch {
        if (execution.signal.aborted) return;
        yield failedEvent(
          execution,
          timeout.signal.aborted ? 'HAYSTACK_TIMEOUT' : 'HAYSTACK_UNAVAILABLE',
        );
        return;
      }
      if (execution.signal.aborted) return;
      if (!response.ok) {
        yield failedEvent(execution, 'HAYSTACK_HTTP_ERROR');
        return;
      }
      if (!isJson(response.headers.get('content-type'))) {
        yield failedEvent(execution, 'HAYSTACK_INVALID_RESPONSE');
        return;
      }
      try {
        body = JSON.parse(await readBoundedText(response, signal));
      } catch {
        if (execution.signal.aborted) return;
        yield failedEvent(
          execution,
          timeout.signal.aborted ? 'HAYSTACK_TIMEOUT' : 'HAYSTACK_INVALID_RESPONSE',
        );
        return;
      }
    } finally {
      clearTimeout(timer);
    }

    if (!isValidResponse(body, payload)) {
      yield failedEvent(execution, 'HAYSTACK_INVALID_RESPONSE');
      return;
    }
    const status = body.status ?? 'completed';
    if (status !== 'completed') {
      yield failedEvent(execution, `HAYSTACK_${status.toUpperCase()}`);
      return;
    }
    for (const event of completedEvents(execution, body)) yield event;
  }
}

function nativePayload(
  execution: ConnectorExecution,
  config: HaystackConnectorConfig,
): ConnectorExecutionRequest {
  return {
    assistantMessageId: execution.assistantMessageId,
    request: {
      ...execution.request,
      trustedMetadata: {
        ...execution.request.trustedMetadata,
        'haystack.tenant_key': config.tenantKey,
        'haystack.agent_slug': config.agentSlug,
        ...(config.responseMode ? { 'haystack.response_mode': config.responseMode } : {}),
      },
    },
  };
}

function requestPayload(
  execution: ConnectorExecution,
  config: HaystackConnectorConfig,
): HaystackAgentRequest | undefined {
  const text = execution.request.currentMessage.parts
    .filter((part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text')
    .map(({ text: value }) => value)
    .join('\n')
    .trim();
  if (!text) return undefined;
  const origin = execution.request.trustedMetadata.origin;
  const payload = {
    channel: 'web',
    tenant_key: config.tenantKey,
    agent_slug: config.agentSlug,
    user_id: execution.request.principalContext.principalId,
    thread_id: execution.request.conversationId,
    text,
    ...(config.responseMode ? { response_mode: config.responseMode } : {}),
    metadata: {
      chat_core: {
        compatibility_mode: 'duplicate_history',
        run_id: execution.request.runId,
        message_id: execution.request.currentMessage.messageId,
        assistant_message_id: execution.assistantMessageId,
        conversation_id: execution.request.conversationId,
        agent_ref: execution.request.agentRef,
        ...(origin ? { origin } : {}),
      },
    },
  };
  return isHaystackAgentRequest(payload) ? payload : undefined;
}

function isValidResponse(
  value: unknown,
  request: HaystackAgentRequest,
): value is HaystackAgentResponse {
  return (
    isHaystackAgentResponse(value) &&
    value.tenant_key === request.tenant_key &&
    value.agent_slug === request.agent_slug &&
    value.channel === request.channel &&
    value.thread_id === request.thread_id
  );
}

function failedEvent(execution: ConnectorExecution, code: string): ConnectorEvent {
  return {
    type: 'run.failed',
    visibility: 'public',
    conversationId: execution.request.conversationId,
    runId: execution.request.runId,
    data: { code },
  };
}

function isJson(value: string | null): boolean {
  const mediaType = value?.split(';', 1)[0]?.trim().toLowerCase();
  return mediaType === 'application/json' || mediaType?.endsWith('+json') === true;
}

async function readBoundedText(response: Response, signal: AbortSignal): Promise<string> {
  const declared = response.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > RESPONSE_LIMIT_BYTES)) {
    throw new Error('Invalid response length.');
  }
  if (!response.body) throw new Error('Missing response body.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const result = await abortableRead(reader, signal);
      if (result.done) break;
      length += result.value.byteLength;
      if (length > RESPONSE_LIMIT_BYTES) throw new Error('Response too large.');
      chunks.push(result.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
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

async function* parseConnectorEventStream(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncIterable<ConnectorEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let frameBytes = 0;
  let dataLines: string[] = [];
  const dispatch = function* (): Iterable<ConnectorEvent> {
    if (dataLines.length === 0) return;
    const raw = dataLines.join('\n');
    dataLines = [];
    frameBytes = 0;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error('Invalid connector event JSON.');
    }
    if (!Value.Check(ConnectorEventSchema, value)) throw new Error('Invalid connector event.');
    yield value as ConnectorEvent;
  };
  const consumeLine = function* (line: string): Iterable<ConnectorEvent> {
    if (line === '') {
      yield* dispatch();
      return;
    }
    if (line.startsWith(':')) return;
    const separator = line.indexOf(':');
    const field = separator < 0 ? line : line.slice(0, separator);
    let value = separator < 0 ? '' : line.slice(separator + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') dataLines.push(value);
  };

  try {
    for (;;) {
      const { done, value } = await abortableRead(reader, signal);
      if (done) break;
      frameBytes += value.byteLength;
      if (frameBytes > RESPONSE_LIMIT_BYTES) throw new Error('Connector event frame is too large.');
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        let line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        yield* consumeLine(line);
        newline = buffer.indexOf('\n');
      }
    }
    buffer += decoder.decode();
    if (buffer) {
      const line = buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer;
      yield* consumeLine(line);
    }
    yield* dispatch();
  } finally {
    reader.releaseLock();
  }
}

async function abortableRead(reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal) {
  if (signal.aborted) throw signal.reason;
  let rejectAbort: ((reason?: unknown) => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => rejectAbort?.(signal.reason);
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    return await Promise.race([reader.read(), aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}
