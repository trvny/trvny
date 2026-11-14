import type { ActionInvoke } from '../../src/action-auth.ts';
import type { GithubGateway } from '../../src/gptomek/github-gateway.ts';
import { operatorSurface } from '../../src/operator/mcp-surface.ts';
import { selectedSpecialistSurface } from '../../src/specialists/mcp-adapter.ts';
import { combineMcpSurfaces, handleMcp } from '../../src/specialists/mcp-protocol.ts';
import type { JsonObject } from '../../src/tools/common.ts';
import type { SpecialistToolEnv, SpecialistToolName } from '../../src/tools/registry.ts';

// Exercise shared primitives with arbitrary test scopes.
export function handleScopedMcp(
  request: Request,
  document: JsonObject,
  env: SpecialistToolEnv,
  invoke: ActionInvoke,
  github: GithubGateway,
  names: readonly SpecialistToolName[],
  fetcher: typeof fetch = fetch,
): Promise<Response | null> {
  return handleMcp(request, github, combineMcpSurfaces(
    operatorSurface(request, document, invoke),
    selectedSpecialistSurface(env, fetcher, names),
    'Fixture scoped MCP surface.',
  ));
}
