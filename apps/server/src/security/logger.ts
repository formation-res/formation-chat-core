export interface LoggedRequest {
  id?: string;
  method?: string;
  url?: string;
}

export function sanitizeRequestLog(request: LoggedRequest): Record<string, unknown> {
  return {
    ...(request.id ? { id: request.id } : {}),
    ...(request.method ? { method: request.method } : {}),
    ...(request.url ? { url: request.url.split('?', 1)[0] } : {}),
  };
}
