import { gatewayManifest, gatewayOpenApi, operationIds } from '../src/entry.ts';

type JsonObject = Record<string, unknown>;

const ORIGIN = process.env.KANAREK_LIVE_ORIGIN ?? 'https://kanarek-companion.travny.workers.dev';
const ATTEMPTS = Number(process.env.KANAREK_SMOKE_ATTEMPTS ?? '36');
const INTERVAL_MS = Number(process.env.KANAREK_SMOKE_INTERVAL_MS ?? '15000');
const REQUIRED_OPERATIONS = [
  'getOperatorBootstrap',
  'getOperatorCapabilities',
  'runOperatorAutopilot',
  'runOperatorSmokeTest',
  'orchestrateRelease',
] as const;

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
  return isObject(value[key]) ? value[key] as JsonObject : null;
}

function stringValue(value: JsonObject | null, key: string): string | null {
  return value && typeof value[key] === 'string' ? value[key] as string : null;
}

const expectedDocument = gatewayOpenApi(ORIGIN);
const expectedManifest = await gatewayManifest(expectedDocument, undefined);
const expectedOpenApi = nestedObject(expectedManifest, 'openApi');
const expectedDigest = stringValue(expectedOpenApi, 'capabilityDigest');
if (!expectedDigest) throw new Error('could not derive expected capability digest');

const maxAttempts = positiveInteger(ATTEMPTS, 36);
const intervalMs = positiveInteger(INTERVAL_MS, 15_000);
let lastSeen = 'unreachable';

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  try {
    const health = await getJson('/health');
    if (health.ok !== true) throw new Error('/health reports not ready');

    const gateway = nestedObject(health, 'gateway');
    const liveOpenApi = gateway ? nestedObject(gateway, 'openApi') : null;
    const workerVersion = gateway ? nestedObject(gateway, 'workerVersion') : null;
    const liveDigest = stringValue(liveOpenApi, 'capabilityDigest');
    const versionId = stringValue(workerVersion, 'id');
    const versionTimestamp = stringValue(workerVersion, 'timestamp');
    lastSeen = liveDigest ?? 'missing-live-manifest';

    if (liveDigest !== expectedDigest || !versionId || !versionTimestamp) {
      console.log(
        `smoke ${attempt}/${maxAttempts}: waiting for live deployment ` +
          `(expected ${expectedDigest}, got ${lastSeen}, version ${versionId ?? 'none'})`,
      );
    } else {
      const liveDocument = await getJson('/gpt-actions/openapi.json');
      const liveManifest = await gatewayManifest(liveDocument, undefined);
      const liveDocumentOpenApi = nestedObject(liveManifest, 'openApi');
      const documentDigest = stringValue(liveDocumentOpenApi, 'capabilityDigest');
      if (documentDigest !== liveDigest) {
        throw new Error(`health/OpenAPI digest mismatch: ${liveDigest} != ${documentDigest}`);
      }

      const ids = operationIds(liveDocument);
      const missing = REQUIRED_OPERATIONS.filter((operation) => !ids.includes(operation));
      if (missing.length) throw new Error(`live OpenAPI missing operations: ${missing.join(', ')}`);

      console.log(
        `live smoke passed: version=${versionId} timestamp=${versionTimestamp} ` +
          `operations=${ids.length} digest=${liveDigest}`,
      );
      process.exit(0);
    }
  } catch (error) {
    lastSeen = error instanceof Error ? error.message : 'unknown smoke error';
    console.log(`smoke ${attempt}/${maxAttempts}: ${lastSeen}`);
  }

  if (attempt < maxAttempts) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

throw new Error(
  `live gateway did not converge after ${maxAttempts} attempts; expected ${expectedDigest}; last seen ${lastSeen}`,
);
