import type { ContentPart } from '@formation-chat-core/protocol';
import { Fragment } from 'react';

import type { ChatDisplayMessage, ChatPanelProps } from './types.js';

interface ContentPartsProps {
  message: ChatDisplayMessage;
  renderPart: ChatPanelProps['renderPart'];
}

export function ContentParts({ message, renderPart }: ContentPartsProps) {
  return message.parts.map((part, index) => {
    const renderDefault = () => <DefaultPart part={part} />;
    const replacement = renderPart?.({ part, message, renderDefault });
    return (
      <Fragment key={partKey(part, index)}>
        {replacement === undefined ? renderDefault() : replacement}
      </Fragment>
    );
  });
}

function DefaultPart({ part }: { part: ContentPart }) {
  switch (part.type) {
    case 'text':
      return <span className="fcc-text">{part.text}</span>;
    case 'citation': {
      const citationUrl = safeHttpsUrl(part.url);
      return (
        <span className="fcc-citation">
          {citationUrl ? (
            <a href={citationUrl} target="_blank" rel="noreferrer noopener">
              {part.title ?? 'Source'}
            </a>
          ) : (
            (part.title ?? 'Source')
          )}
          {part.excerpt ? <small>{part.excerpt}</small> : null}
        </span>
      );
    }
    case 'file_reference': {
      const fileUrl = safeHttpsUrl(part.url);
      return fileUrl ? (
        <a className="fcc-file" href={fileUrl} target="_blank" rel="noreferrer noopener">
          {part.name}
        </a>
      ) : (
        <span className="fcc-file">{part.name}</span>
      );
    }
    case 'tool_status':
      return (
        <span className="fcc-tool" role="status">
          {part.label}: {part.status}
        </span>
      );
    case 'structured_input':
      return (
        <span className="fcc-input-status">
          {part.label}: {part.status}
        </span>
      );
  }
}

function safeHttpsUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function partKey(part: ContentPart, index: number): string {
  switch (part.type) {
    case 'citation':
      return `citation-${part.citationId}`;
    case 'file_reference':
      return `file-${part.fileId}`;
    case 'tool_status':
      return `tool-${part.toolCallId}`;
    case 'structured_input':
      return `input-${part.requestId}`;
    case 'text':
      return `text-${index}`;
  }
}
