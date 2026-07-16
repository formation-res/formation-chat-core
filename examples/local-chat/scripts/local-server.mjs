import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { extname, join } from 'node:path';
import { URL } from 'node:url';
import { createServer } from 'node:http';

const CONTENT_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
]);
const FORWARDED_REQUEST_HEADERS = [
  'accept',
  'authorization',
  'content-length',
  'content-type',
  'idempotency-key',
  'last-event-id',
  'origin',
];
const FORWARDED_RESPONSE_HEADERS = [
  'cache-control',
  'content-type',
  'etag',
  'ratelimit-limit',
  'ratelimit-remaining',
  'ratelimit-reset',
  'retry-after',
  'x-correlation-id',
];

/**
 * @param {{ coreBaseUrl: URL, rootDirectory: string, siteKey: string }} options
 */
export function createLocalChatServer(options) {
  return createServer((request, response) => {
    void handleRequest(request, response, options).catch(() => {
      if (response.headersSent) return response.destroy();
      response.writeHead(500, securityHeaders('text/plain; charset=utf-8'));
      response.end('Local chat server error.');
    });
  });
}

/**
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 * @param {{ coreBaseUrl: URL, rootDirectory: string, siteKey: string }} options
 */
async function handleRequest(request, response, options) {
  const url = new URL(request.url ?? '/', 'http://local-chat.invalid');
  if (url.pathname.startsWith('/v1/')) {
    proxyRequest(request, response, options.coreBaseUrl);
    return;
  }
  if (url.pathname === '/local-chat-config.js') {
    response.writeHead(200, securityHeaders('text/javascript; charset=utf-8'));
    response.end(
      `window.__FORMATION_CHAT_LOCAL_CONFIG__=${JSON.stringify({ siteKey: options.siteKey })};`,
    );
    return;
  }
  const asset = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  if (!/^(?:index\.html|app\.(?:css|js|js\.map))$/.test(asset)) {
    response.writeHead(404, securityHeaders('text/plain; charset=utf-8'));
    response.end('Not found.');
    return;
  }
  const path = join(options.rootDirectory, asset);
  const metadata = await stat(path).catch(() => undefined);
  if (!metadata?.isFile()) {
    response.writeHead(404, securityHeaders('text/plain; charset=utf-8'));
    response.end('Not found.');
    return;
  }
  response.writeHead(
    200,
    securityHeaders(CONTENT_TYPES.get(extname(path)) ?? 'application/octet-stream'),
  );
  createReadStream(path).pipe(response);
}

/**
 * @param {import('node:http').IncomingMessage} incoming
 * @param {import('node:http').ServerResponse} outgoing
 * @param {URL} coreBaseUrl
 */
function proxyRequest(incoming, outgoing, coreBaseUrl) {
  const target = new URL(incoming.url ?? '/', coreBaseUrl);
  const headers = forwardedHeaders(incoming.headers, FORWARDED_REQUEST_HEADERS);
  headers.host = target.host;
  const request = target.protocol === 'https:' ? httpsRequest : httpRequest;
  const upstream = request(target, { headers, method: incoming.method }, (response) => {
    const responseHeaders = forwardedHeaders(response.headers, FORWARDED_RESPONSE_HEADERS);
    outgoing.writeHead(response.statusCode ?? 502, responseHeaders);
    response.pipe(outgoing);
  });
  upstream.on('error', () => {
    if (outgoing.headersSent) return outgoing.destroy();
    outgoing.writeHead(502, securityHeaders('application/json; charset=utf-8'));
    outgoing.end(
      JSON.stringify({
        error: { code: 'CORE_UNAVAILABLE', message: 'Chat Core is unavailable.' },
      }),
    );
  });
  incoming.pipe(upstream);
}

/**
 * @param {import('node:http').IncomingHttpHeaders} source
 * @param {readonly string[]} allowlist
 * @returns {import('node:http').OutgoingHttpHeaders}
 */
function forwardedHeaders(source, allowlist) {
  /** @type {import('node:http').OutgoingHttpHeaders} */
  const headers = {};
  for (const name of allowlist) {
    const value = source[name];
    if (value !== undefined) headers[name] = value;
  }
  return headers;
}

/** @param {string} contentType */
function securityHeaders(contentType) {
  return {
    'content-security-policy':
      "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    'content-type': contentType,
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
  };
}
