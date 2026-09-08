// Qualification-only static proxy. No API or repository files are served.
import http from 'node:http';
import { writeFileSync } from 'node:fs';
const output = new URL('./production-cold-wire.json', import.meta.url);
const responses = [];
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1:5204');
  if (request.method !== 'GET' || !(url.pathname === '/' || url.pathname.startsWith('/assets/') || url.pathname === '/favicon.ico')) {
    response.writeHead(403).end();
    return;
  }
  const socket = response.socket;
  const started = performance.now();
  const upstream = http.request({ hostname: '127.0.0.1', port: 5201, path: request.url, headers: { ...request.headers, host: '127.0.0.1:5201', connection: 'close' } }, (result) => {
    response.writeHead(result.statusCode, { ...result.headers, connection: 'close', 'cache-control': 'no-store' });
    result.pipe(response);
    response.on('finish', () => {
      responses.push({ path: url.pathname, status: result.statusCode, wireBytes: socket.bytesWritten, durationMs: performance.now() - started });
      writeFileSync(output, JSON.stringify({ capturedAt: new Date().toISOString(), method: 'Fresh origin, connection-close per response; socket bytesWritten includes headers and worker-owned image requests.', requests: responses.length, wireBytes: responses.reduce((total, item) => total + item.wireBytes, 0), responses }, null, 2));
    });
  });
  upstream.on('error', () => response.writeHead(502).end());
  upstream.end();
});
server.listen(5204, '127.0.0.1', () => process.stdout.write('Cold-load measurement: http://127.0.0.1:5204/\n'));
