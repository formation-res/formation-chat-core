import type { ContentPart } from '@formation-chat-core/protocol';
import type { ChatClient, ChatState } from '@formation-chat-core/browser-client';
import type { ReactNode } from 'react';

export interface ChatDisplayMessage {
  messageId: string;
  role: 'user' | 'assistant' | 'system';
  status: 'pending' | 'streaming' | 'completed' | 'failed' | 'cancelled';
  parts: readonly ContentPart[];
  text: string;
  isTransient: boolean;
}

export interface ChatMessageRenderContext {
  message: ChatDisplayMessage;
  state: ChatState;
  renderDefault(): ReactNode;
}

export interface ChatPartRenderContext {
  part: ContentPart;
  message: ChatDisplayMessage;
  renderDefault(): ReactNode;
}

export type StructuredInputSubmission =
  | { requestId: string; inputKind: 'email'; value: string; consent: true }
  | { requestId: string; inputKind: 'email'; declined: true };

export interface ChatPanelLabels {
  title: string;
  emptyTitle: string;
  emptyDescription: string;
  composerLabel: string;
  composerPlaceholder: string;
  send: string;
  retry: string;
  cancel: string;
}

export interface ChatPanelProps {
  client: ChatClient;
  title?: string;
  className?: string;
  labels?: Partial<ChatPanelLabels>;
  renderMessage?(context: ChatMessageRenderContext): ReactNode;
  renderPart?(context: ChatPartRenderContext): ReactNode | undefined;
  onSubmitStructuredInput?(submission: StructuredInputSubmission): Promise<void>;
}
