import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { URL } from 'node:url';

import { context } from 'esbuild';

const directory = new URL('..', import.meta.url).pathname;
const output = join(directory, 'dist');
const build = await context({
  entryPoints: { app: join(directory, 'src/main.tsx') },
  bundle: true,
  format: 'esm',
  outdir: output,
  sourcemap: true,
  target: ['es2022'],
});
await build.watch();
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  const file = pathname === '/' ? join(directory, 'index.html') : join(output, pathname.slice(1));
  try {
    response.setHeader('content-type', contentType(file));
    response.end(await readFile(file));
  } catch {
    response.statusCode = 404;
    response.end('Not found');
  }
});
server.listen(4174, '127.0.0.1', () => process.stdout.write('Dashboard: http://127.0.0.1:4174\n'));
process.on('SIGINT', async () => {
  await build.dispose();
  server.close();
});

function contentType(path) {
  return extname(path) === '.css'
    ? 'text/css'
    : extname(path) === '.html'
      ? 'text/html; charset=utf-8'
      : 'text/javascript; charset=utf-8';
}
