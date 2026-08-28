import { gatewayManifest, operationIds } from '../src/entry.ts';
import { runtimeOpenApi } from '../src/runtime-openapi.ts';

type JsonObject = Record<string, unknown>;

const ORIGIN =
  process.env.KANAREK_LIVE_ORIGIN ??
  'https://kanarek-companion.travny.workers.dev';
const ATTEMPTS = Number(process.env.KANAREK_SMOKE_ATTEMPTS ?? '36');
const INTERVAL_MS = Number(process.env.KANAREK_SMOKE_INTERVAL_MS ?? '15000');
const EXPECTED_COMMIT_SHA = (
  process.env.KANAREK_EXPECTED_COMMIT_SHA ??
  process.env.GITHUB_SHA ??
  ''
)
  .trim()
  .toLowerCase();
const REQUIRED_OPERATIONS = [
  'getOperatorBootstrap',
  'getOperatorCapabilities',
  'runOperatorAutopilot',
  'runOperatorSmokeTest',
  'orchestrateRelease',
] as const;

if (EXPECTED_COMMIT_SHA && !/^[0-9a-f]{40}$/.test(EXPECTED_COMMIT_SHA)) {
  throw new Error('expected commit SHA must be a 40-character Git SHA');
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function positiveInteger(value: number, fallback: number): number {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

async function getJson(path: string): Promise<JsonObject> {
  const response = await fetch(`${ORIGIN}${path}`, {
    headers: {
      Accept: 'application/json',
      'Cache-Control': 'no-cache',
    },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  const value: unknown = await response.json();
  if (!isObject(value)) throw new Error(`${path} returned non-object JSON`);
  return value;
}

function nestedObject(value: JsonObject, key: string): JsonObject | null {
  return isObject(value[key]) ? (value[key] as JsonObject) : null;
}

function stringValue(value: JsonObject | null, key: string): string | null {
  return value && typeof value[key] === 'string'
    ? (value[key] as string)
    : null;
}


const expectedDocument = runtimeOpenApi(ORIGIN);
const expectedManifest = await gatewayManifest(expectedDocument, undefined);
const expectedOpenApi = nestedObject(expectedManifest, 'openApi');
const expectedDigest = stringValue(expectedOpenApi, 'capabilityDigest');
if (!expectedDigest) {
  throw new Error('could not derive expected capability digest');
}

const maxAttempts = positiveInteger(ATTEMPTS, 36);
const intervalMs = positiveInteger(INTERVAL_MS, 15_000);
let lastSeen = 'unreachable';

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  try {
    const health = await getJson('/health');
    if (health.ok !== true) throw new Error('/health reports not ready');
    const gateway = nestedObject(health, 'gateway');
    const liveOpenApi = gateway ? nestedObject(gateway, 'openApi') : null;
    const workerVersion = gateway
      ? nestedObject(gateway, 'workerVersion')
      : null;
    const liveDigest = stringValue(liveOpenApi, 'capabilityDigest');
    const versionId = stringValue(workerVersion, 'id');
    const versionTag = stringValue(workerVersion, 'tag');
    const versionTimestamp = stringValue(workerVersion, 'timestamp');
    const versionMatchesCommit = EXPECTED_COMMIT_SHA
      ? versionTag?.toLowerCase() === EXPECTED_COMMIT_SHA
      : Boolean(versionId && versionTimestamp);
    lastSeen = `digest=${liveDigest ?? 'missing'} tag=${versionTag ?? 'none'}`;

    if (
      liveDigest !== expectedDigest ||
      !versionId ||
      !versionTimestamp ||
      !versionMatchesCommit
    ) {
      console.log(
        `smoke ${attempt}/${maxAttempts}: waiting for live deployment ` +
          `(expected digest ${expectedDigest}, expected tag ${
            EXPECTED_COMMIT_SHA || 'any'
          }, got ${lastSeen})`,
      );
    } else {
      const liveDocument = await getJson('/gpt-actions/openapi.json');
      const liveManifest = await gatewayManifest(liveDocument, undefined);
      const liveDocumentOpenApi = nestedObject(liveManifest, 'openApi');
      const documentDigest = stringValue(
        liveDocumentOpenApi,
        'capabilityDigest',
      );
      if (documentDigest !== liveDigest) {
        throw new Error(
          `health/OpenAPI digest mismatch: ${liveDigest} != ${documentDigest}`,
        );
      }

      const ids = operationIds(liveDocument);
      const missing = REQUIRED_OPERATIONS.filter(
        (operation) => !ids.includes(operation),
      );
      if (missing.length) {
        throw new Error(
          `live OpenAPI missing operations: ${missing.join(', ')}`,
        );
      }

      console.log(
        `live smoke passed: version=${versionId} tag=${versionTag ?? 'none'} ` +
          `timestamp=${versionTimestamp} operations=${ids.length} ` +
          `digest=${liveDigest}`,
      );
      process.exit(0);
    }
  } catch (error) {
    lastSeen =
      error instanceof Error ? error.message : 'unknown smoke error';
    console.log(`smoke ${attempt}/${maxAttempts}: ${lastSeen}`);
  }

  if (attempt < maxAttempts) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

throw new Error(
  `live gateway did not converge after ${maxAttempts} attempts; ` +
    `expected ${expectedDigest}; last seen ${lastSeen}`,
);
