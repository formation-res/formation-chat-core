import type { ChatClient, ChatState } from '@formation-chat-core/browser-client';
import { useEffect, useSyncExternalStore } from 'react';

export function useChatClient(client: ChatClient): ChatState {
  const state = useSyncExternalStore(client.subscribe, client.getState, client.getState);
  useEffect(() => {
    void client.start().catch(() => undefined);
  }, [client]);
  return state;
}
