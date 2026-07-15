import type { ChatConnector, ConnectorCancellationStatus } from '@formation-chat-core/server-sdk';

interface ActiveRun {
  controller: AbortController;
  connector: ChatConnector;
}

export class RunCancellationCoordinator {
  private readonly active = new Map<string, ActiveRun>();

  register(runId: string, activeRun: ActiveRun): () => void {
    this.active.set(runId, activeRun);
    return () => {
      if (this.active.get(runId) === activeRun) this.active.delete(runId);
    };
  }

  async request(runId: string): Promise<ConnectorCancellationStatus> {
    const activeRun = this.active.get(runId);
    if (!activeRun) return 'not_supported';
    activeRun.controller.abort();
    return (await activeRun.connector.cancel?.(runId)) ?? 'not_supported';
  }
}
