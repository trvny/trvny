import http from 'node:http';
import { readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const BUILD_DIR = path.resolve('.manufact');
const MAX_ADAPTER_BODY_BYTES = 128 * 1024;

async function findWorkerBundle(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && /\.(?:m?js)$/.test(entry.name))
    .map((entry) => path.join(dir, entry.name));

  const preferred = files.find((file) => path.basename(file) === 'index.js');
  if (preferred) return preferred;
  if (files.length === 1) return files[0];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const found = await findWorkerBundle(path.join(dir, entry.name)).catch(() => null);
    if (found) return found;
  }
  throw new Error(`Could not find Wrangler bundle under ${dir}`);
}

const bundlePath = await findWorkerBundle(BUILD_DIR);
const module = await import(pathToFileURL(bundlePath).href);
const worker = module.default;

if (!worker || typeof worker.fetch !== 'function') {
  throw new Error('Wrangler bundle does not export a Worker fetch handler');
}

const env = {
  CLAUDIUSZ_APP_ID: process.env.CLAUDIUSZ_APP_ID ?? '4454097',
  ALLOWED_OWNERS: process.env.ALLOWED_OWNERS ?? 'trvny,travnie',
  CLAUDIUSZ_MCP_TOKEN: process.env.CLAUDIUSZ_MCP_TOKEN,
  GH_APP_PRIVATE_KEY: process.env.GH_APP_PRIVATE_KEY,
};

function firstHeader(value) {
  return value?.split(',')[0]?.trim();
}

async function requestBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;

  const chunks = [];
  let size = 0;
  let tooLarge = false;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_ADAPTER_BODY_BYTES) {
      tooLarge = true;
      continue;
    }
    chunks.push(chunk);
  }

  if (tooLarge) throw new Error('request_too_large');
  return Buffer.concat(chunks);
}

const server = http.createServer(async (req, res) => {
  try {
    const proto = firstHeader(req.headers['x-forwarded-proto']) ?? 'http';
    const host = firstHeader(req.headers['x-forwarded-host']) ?? req.headers.host ?? 'localhost';
    const url = new URL(req.url ?? '/', `${proto}://${host}`);

    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) {
        for (const item of value) headers.append(name, item);
      } else if (value !== undefined) {
        headers.set(name, value);
      }
    }

    const body = await requestBody(req);
    const request = new Request(url, {
      method: req.method,
      headers,
      body,
    });

    const response = await worker.fetch(request, env);
    res.statusCode = response.status;
    for (const [name, value] of response.headers) res.setHeader(name, value);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    const status = error instanceof Error && error.message === 'request_too_large' ? 413 : 500;
    process.stderr.write(`${JSON.stringify({ manufactAdapterError: String(error) })}\n`);
    res.statusCode = status;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(status === 413 ? 'request too large\n' : 'internal server error\n');
  }
});

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
server.listen(port, '0.0.0.0', () => {
  process.stdout.write(`${JSON.stringify({ event: 'listening', port })}\n`);
});
