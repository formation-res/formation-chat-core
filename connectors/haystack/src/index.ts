import type { ConnectorEvent } from '@formation-chat-core/protocol';
import type { ChatConnector, ConnectorExecution } from '@formation-chat-core/server-sdk';

import {
  type HaystackAgentRequest,
  type HaystackAgentResponse,
  type HaystackConnectorConfig,
  HaystackAgentRequestSchema,
  HaystackAgentResponseSchema,
  HaystackConnectorConfigSchema,
  isHaystackAgentResponse,
  parseHaystackConfig,
} from './contracts.js';
import { completedEvents } from './translate.js';

export {
  type HaystackAgentRequest,
  type HaystackAgentResponse,
  type HaystackConnectorConfig,
  HaystackAgentRequestSchema,
  HaystackAgentResponseSchema,
  HaystackConnectorConfigSchema,
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
    let response: Response;
    let body: unknown;
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
      if (execution.signal.aborted) return;
      if (!response.ok) {
        yield failedEvent(execution, 'HAYSTACK_HTTP_ERROR');
        return;
      }
      if (!isJson(response.headers.get('content-type'))) {
        yield failedEvent(execution, 'HAYSTACK_INVALID_RESPONSE');
        return;
      }
      body = JSON.parse(await readBoundedText(response, signal));
    } catch {
      if (execution.signal.aborted) return;
      yield failedEvent(
        execution,
        timeout.signal.aborted ? 'HAYSTACK_TIMEOUT' : 'HAYSTACK_UNAVAILABLE',
      );
      return;
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
  return {
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
