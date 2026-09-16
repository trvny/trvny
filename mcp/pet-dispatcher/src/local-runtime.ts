import { join as platformJoin } from "node:path";

export interface LocalRuntimePaths {
  root: string;
  appRoot: string;
  releasesRoot: string;
  currentManifest: string;
  configRoot: string;
  configPath: string;
  environmentPolicyPath: string;
  stateRoot: string;
  journalPath: string;
  secretsRoot: string;
  reposRoot: string;
  repoMirror: string;
  binRoot: string;
  logsRoot: string;
}

export interface PathApi { join(...parts: string[]): string }

export function localRuntimePaths(root: string, pathApi: PathApi = { join: platformJoin }): LocalRuntimePaths {
  const appRoot = pathApi.join(root, "app");
  const configRoot = pathApi.join(root, "config");
  const stateRoot = pathApi.join(root, "state");
  const reposRoot = pathApi.join(root, "repos");
  return {
    root,
    appRoot,
    releasesRoot: pathApi.join(appRoot, "releases"),
    currentManifest: pathApi.join(appRoot, "current.json"),
    configRoot,
    configPath: pathApi.join(configRoot, "dispatcher.json"),
    environmentPolicyPath: pathApi.join(configRoot, "environment-policy.json"),
    stateRoot,
    journalPath: pathApi.join(stateRoot, "remote-journal.json"),
    secretsRoot: pathApi.join(root, "secrets"),
    reposRoot,
    repoMirror: pathApi.join(reposRoot, "trvny.git"),
    binRoot: pathApi.join(root, "bin"),
    logsRoot: pathApi.join(root, "logs"),
  };
}

export interface MigrateDispatcherOptions {
  paths: LocalRuntimePaths;
  dcRoot: string;
  workspaceRoot: string;
  pathApi?: PathApi;
}

export function objectRecord(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}

export function migrateDispatcherConfig(legacy: unknown, options: MigrateDispatcherOptions): Record<string, unknown> {
  const source = objectRecord(legacy, "legacy dispatcher config");
  const cloned = structuredClone(source);
  const repositories = objectRecord(cloned.repositories ?? {}, "repositories");
  const workspaces = objectRecord(cloned.workspaces ?? {}, "workspaces");
  const remote = cloned.remote === undefined ? undefined : objectRecord(cloned.remote, "remote");
  const migrated: Record<string, unknown> = {
    ...cloned,
    workspaceRoot: options.workspaceRoot,
    repositories: { ...repositories, trvny: options.paths.repoMirror },
    workspaces: { ...workspaces, dc: options.dcRoot },
    environmentPolicyPath: options.paths.environmentPolicyPath,
  };
  if (remote) migrated.remote = { ...remote, journalPath: options.paths.journalPath };
  return migrated;
}
