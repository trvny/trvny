import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HEALTH_URL =
  process.env.HEALTH_URL ??
  'https://pet-dispatcher-control.travny.workers.dev/health';
const ATTEMPTS = 12;
const RETRY_MS = 5_000;
const REQUEST_TIMEOUT_MS = 10_000;

function runWrangler(outputFile) {
  const executable = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  return new Promise((resolve, reject) => {
    const child = spawn(
      executable,
      [
        '--no-install',
        'wrangler',
        'deploy',
        '--config',
        'control-plane/wrangler.jsonc',
      ],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          WRANGLER_OUTPUT_FILE_PATH: outputFile,
        },
      },
    );
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `wrangler deploy failed: ${signal ? `signal ${signal}` : `exit ${code}`}`,
        ),
      );
    });
  });
}

async function deployedVersionId(outputFile) {
  const rows = (await readFile(outputFile, 'utf8'))
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const deploy = rows.findLast((row) => row.type === 'deploy');
  if (!deploy?.version_id) {
    throw new Error('Wrangler output did not contain a deployed version ID.');
  }
  return deploy.version_id;
}

async function healthMatches(versionId) {
  try {
    const response = await fetch(HEALTH_URL, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return false;
    const body = await response.json();
    return (
      body?.ok === true &&
      body?.service === 'pet-dispatcher-control' &&
      body?.versionId === versionId
    );
  } catch {
    return false;
  }
}

async function verifyHealth(versionId) {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    if (await healthMatches(versionId)) {
      console.log(`Verified pet-dispatcher-control version ${versionId}.`);
      return;
    }
    if (attempt < ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    }
  }
  throw new Error(
    `Pet Dispatcher control plane did not expose deployed version ${versionId} at ${HEALTH_URL}.`,
  );
}

const workdir = await mkdtemp(join(tmpdir(), 'pet-dispatcher-deploy-'));
const outputFile = join(workdir, 'wrangler-output.jsonl');

try {
  await runWrangler(outputFile);
  const versionId = await deployedVersionId(outputFile);
  await verifyHealth(versionId);
} finally {
  await rm(workdir, { recursive: true, force: true });
}
