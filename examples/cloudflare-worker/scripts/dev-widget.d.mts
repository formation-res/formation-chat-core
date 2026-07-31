import type { Server } from 'node:http';

export interface WidgetPreviewServer extends Server {
  closePreviewStreams(): void;
  notifyReload(): void;
}

export interface WidgetPreviewServerOptions {
  assetDirectory?: string;
}

export function createWidgetPreviewServer(
  options?: WidgetPreviewServerOptions,
): WidgetPreviewServer;
