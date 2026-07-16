import type { ConnectorEvent, ContentPart } from '@formation-chat-core/protocol';
import type { ConnectorExecution } from '@formation-chat-core/server-sdk';

import type { HaystackAgentResponse } from './contracts.js';

interface CitationData {
  citationId: string;
  sourceId: string;
  title?: string;
  url?: string;
  excerpt?: string;
}

export function completedEvents(
  execution: ConnectorExecution,
  response: HaystackAgentResponse,
): ConnectorEvent[] {
  const base = {
    visibility: 'public' as const,
    conversationId: execution.request.conversationId,
    runId: execution.request.runId,
  };
  const message = { ...base, messageId: execution.assistantMessageId };
  const tools = [...new Set(response.metadata?.used_tools ?? [])];
  const citations = normalizedCitations(response);
  const events: ConnectorEvent[] = [
    { ...message, type: 'message.started', data: { role: 'assistant' } },
  ];
  tools.forEach((tool, index) => {
    const toolCallId = `haystack-tool-${index + 1}`;
    events.push({
      ...message,
      type: 'tool.started',
      data: { toolCallId, label: publicToolLabel(tool) },
    });
    events.push({ ...message, type: 'tool.completed', data: { toolCallId } });
  });
  citations.forEach((data) => events.push({ ...message, type: 'citation.added', data }));
  for (const delta of textChunks(response.text)) {
    events.push({ ...message, type: 'message.delta', data: { delta } });
  }
  const parts: ContentPart[] = [
    { type: 'text', text: response.text },
    ...citations.map((citation) => ({ type: 'citation' as const, ...citation })),
  ];
  events.push({ ...message, type: 'message.completed', data: { parts } });
  if (response.metadata?.handoff?.requested) {
    events.push({
      ...base,
      type: 'handoff.requested',
      data: { handoffId: execution.request.runId },
    });
  }
  events.push({ ...base, type: 'run.completed', data: {} });
  return events;
}

function normalizedCitations(response: HaystackAgentResponse): CitationData[] {
  return (response.metadata?.rag_sources ?? []).map((source, index) => {
    const title = source.title?.trim();
    const excerpt = source.content?.trim().slice(0, 2_000);
    const url = safeHttpsUrl(source.source_path);
    return {
      citationId: `haystack-citation-${index + 1}`,
      sourceId: opaqueSourceId(source.id, index),
      ...(title ? { title } : {}),
      ...(url ? { url } : {}),
      ...(excerpt ? { excerpt } : {}),
    };
  });
}

function opaqueSourceId(value: string | undefined, index: number): string {
  const normalized = value?.trim();
  return normalized && /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(normalized)
    ? normalized
    : `haystack-source-${index + 1}`;
}

function safeHttpsUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.toString().length <= 2_048 ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function publicToolLabel(value: string): string {
  const label = value.replaceAll(/[_-]+/g, ' ').trim();
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`.slice(0, 200);
}

function textChunks(value: string): string[] {
  const chunks: string[] = [];
  for (let offset = 0; offset < value.length; offset += 20_000) {
    chunks.push(value.slice(offset, offset + 20_000));
  }
  return chunks;
}
