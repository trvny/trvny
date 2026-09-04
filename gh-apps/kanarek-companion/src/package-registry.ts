export type PackageEcosystem = 'npm' | 'pypi' | 'crates' | 'maven' | 'nuget';

export type PackageAlternative = {
  name: string;
  version: string | null;
  description: string | null;
  url: string | null;
};

export type PackageRegistryResult = {
  ecosystem: PackageEcosystem;
  name: string;
  selectedVersion: string;
  latestVersion: string;
  latestPublishedAt: string | null;
  description: string | null;
  license: string | null;
  deprecated: string | null;
  yanked: boolean | null;
  repositoryUrl: string | null;
  homepageUrl: string | null;
  registryUrl: string;
  packageUrl: string | null;
  checksum: string | null;
  requiresRuntime: string | null;
  registryVulnerabilities: Array<{ url: string | null; severity: string | null }>;
};

type JsonObject = Record<string, unknown>;
type JsonFetcher = (url: string, init?: RequestInit) => Promise<unknown>;
type TextFetcher = (url: string, init?: RequestInit) => Promise<string>;

export class PackageRegistryError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 400) {
    super(code);
    this.name = 'PackageRegistryError';
    this.code = code;
    this.status = status;
  }
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function arrayObjects(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

function objectValue(value: unknown): JsonObject | null {
  return isObject(value) ? value : null;
}

export function packageEcosystem(value: unknown): PackageEcosystem {
  if (value === 'npm' || value === 'pypi' || value === 'crates' || value === 'maven' || value === 'nuget') {
    return value;
  }
  throw new PackageRegistryError('invalid_ecosystem');
}

export function packageName(ecosystem: PackageEcosystem, value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 240) {
    throw new PackageRegistryError('invalid_package');
  }
  const name = value.trim();
  if (ecosystem === 'npm') {
    if (!/^(?:@[A-Za-z0-9][A-Za-z0-9._~-]*\/)?[A-Za-z0-9][A-Za-z0-9._~-]*$/.test(name)) {
      throw new PackageRegistryError('invalid_package');
    }
    return name;
  }
  if (ecosystem === 'maven') {
    const [group, artifact, extra] = name.split(':');
    if (extra || !group || !artifact || !/^[A-Za-z0-9_.-]+$/.test(group) || !/^[A-Za-z0-9_.-]+$/.test(artifact)) {
      throw new PackageRegistryError('invalid_package');
    }
    return `${group}:${artifact}`;
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    throw new PackageRegistryError('invalid_package');
  }
  return name;
}

export function packageVersion(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !value.trim() || value.length > 160 || /[\r\n\0]/.test(value)) {
    throw new PackageRegistryError('invalid_version');
  }
  return value.trim();
}

function repositoryUrl(value: unknown): string | null {
  if (typeof value === 'string') return text(value);
  if (!isObject(value)) return null;
  return text(value.url);
}

function firstProjectUrl(info: JsonObject, names: string[]): string | null {
  const projectUrls = objectValue(info.project_urls);
  if (!projectUrls) return null;
  for (const wanted of names) {
    for (const [key, value] of Object.entries(projectUrls)) {
      if (key.toLowerCase() === wanted.toLowerCase()) {
        const url = text(value);
        if (url) return url;
      }
    }
  }
  return null;
}

function npmPackagePath(name: string): string {
  return encodeURIComponent(name);
}

async function npmRegistry(
  name: string,
  version: string | null,
  fetchJson: JsonFetcher,
): Promise<PackageRegistryResult> {
  const packagePath = npmPackagePath(name);
  const searchUrl = new URL('https://registry.npmjs.org/-/v1/search');
  searchUrl.searchParams.set('text', `package:${name}`);
  searchUrl.searchParams.set('size', '5');
  const [selectedRaw, searchRaw] = await Promise.all([
    fetchJson(`https://registry.npmjs.org/${packagePath}/${encodeURIComponent(version ?? 'latest')}`),
    fetchJson(searchUrl.toString()),
  ]);
  if (!isObject(selectedRaw)) throw new PackageRegistryError('invalid_registry_response', 502);
  const selectedVersion = text(selectedRaw.version);
  if (!selectedVersion) throw new PackageRegistryError('package_not_found', 404);
  const search = isObject(searchRaw) ? searchRaw : {};
  const exact = arrayObjects(search.objects)
    .map((entry) => objectValue(entry.package))
    .find((entry) => entry?.name === name) ?? null;
  const latestVersion = text(exact?.version) ?? selectedVersion;
  const selectedRepository = repositoryUrl(selectedRaw.repository);
  const links = objectValue(exact?.links);
  const dist = objectValue(selectedRaw.dist);
  return {
    ecosystem: 'npm',
    name,
    selectedVersion,
    latestVersion,
    latestPublishedAt: text(exact?.date),
    description: text(selectedRaw.description) ?? text(exact?.description),
    license: text(selectedRaw.license),
    deprecated: text(selectedRaw.deprecated),
    yanked: null,
    repositoryUrl: selectedRepository ?? text(links?.repository),
    homepageUrl: text(selectedRaw.homepage) ?? text(links?.homepage),
    registryUrl: `https://www.npmjs.com/package/${encodeURIComponent(name)}`,
    packageUrl: text(dist?.tarball),
    checksum: text(dist?.integrity) ?? text(dist?.shasum),
    requiresRuntime: objectValue(selectedRaw.engines) ? text(objectValue(selectedRaw.engines)?.node) : null,
    registryVulnerabilities: [],
  };
}

function pypiReleaseDate(releases: JsonObject, version: string): string | null {
  const files = Array.isArray(releases[version]) ? releases[version] : [];
  const dates = files.flatMap((item): string[] => {
    if (!isObject(item)) return [];
    const date = text(item.upload_time_iso_8601) ?? text(item.upload_time);
    return date ? [date] : [];
  }).sort();
  return dates.at(-1) ?? null;
}

async function pypiRegistry(
  name: string,
  version: string | null,
  fetchJson: JsonFetcher,
): Promise<PackageRegistryResult> {
  const base = `https://pypi.org/pypi/${encodeURIComponent(name)}`;
  const latestRaw = await fetchJson(`${base}/json`);
  if (!isObject(latestRaw) || !isObject(latestRaw.info)) {
    throw new PackageRegistryError('package_not_found', 404);
  }
  const latestInfo = latestRaw.info;
  const latestVersion = text(latestInfo.version);
  if (!latestVersion) throw new PackageRegistryError('invalid_registry_response', 502);
  const selectedRaw = version && version !== latestVersion
    ? await fetchJson(`${base}/${encodeURIComponent(version)}/json`)
    : latestRaw;
  if (!isObject(selectedRaw) || !isObject(selectedRaw.info)) {
    throw new PackageRegistryError('package_version_not_found', 404);
  }
  const info = selectedRaw.info;
  const selectedVersion = text(info.version);
  if (!selectedVersion) throw new PackageRegistryError('invalid_registry_response', 502);
  const releases = objectValue(latestRaw.releases) ?? {};
  const urls = Array.isArray(selectedRaw.urls) ? selectedRaw.urls.filter(isObject) : [];
  const checksum = urls.map((item) => objectValue(item.digests)).map((item) => text(item?.sha256)).find(Boolean) ?? null;
  return {
    ecosystem: 'pypi',
    name: text(info.name) ?? name,
    selectedVersion,
    latestVersion,
    latestPublishedAt: pypiReleaseDate(releases, latestVersion),
    description: text(info.summary),
    license: text(info.license_expression) ?? text(info.license),
    deprecated: null,
    yanked: bool(info.yanked),
    repositoryUrl: firstProjectUrl(info, ['Source', 'Source Code', 'Repository', 'Code']),
    homepageUrl: text(info.home_page) ?? firstProjectUrl(info, ['Homepage', 'Documentation']),
    registryUrl: text(info.package_url) ?? `https://pypi.org/project/${encodeURIComponent(name)}/`,
    packageUrl: urls.map((item) => text(item.url)).find(Boolean) ?? null,
    checksum,
    requiresRuntime: text(info.requires_python),
    registryVulnerabilities: [],
  };
}

async function cratesRegistry(
  name: string,
  version: string | null,
  fetchJson: JsonFetcher,
): Promise<PackageRegistryResult> {
  const raw = await fetchJson(`https://crates.io/api/v1/crates/${encodeURIComponent(name)}`);
  if (!isObject(raw) || !isObject(raw.crate)) throw new PackageRegistryError('package_not_found', 404);
  const crate = raw.crate;
  const latestVersion = text(crate.max_stable_version) ?? text(crate.max_version);
  if (!latestVersion) throw new PackageRegistryError('invalid_registry_response', 502);
  const versions = arrayObjects(raw.versions);
  const selectedVersion = version ?? latestVersion;
  const selected = versions.find((entry) => entry.num === selectedVersion) ?? null;
  if (!selected) throw new PackageRegistryError('package_version_not_found', 404);
  return {
    ecosystem: 'crates',
    name: text(crate.name) ?? name,
    selectedVersion,
    latestVersion,
    latestPublishedAt: text(versions.find((entry) => entry.num === latestVersion)?.created_at) ?? text(crate.updated_at),
    description: text(crate.description),
    license: text(selected.license),
    deprecated: null,
    yanked: bool(selected.yanked),
    repositoryUrl: text(crate.repository),
    homepageUrl: text(crate.homepage) ?? text(crate.documentation),
    registryUrl: `https://crates.io/crates/${encodeURIComponent(name)}`,
    packageUrl: `https://crates.io/api/v1/crates/${encodeURIComponent(name)}/${encodeURIComponent(selectedVersion)}/download`,
    checksum: text(selected.checksum),
    requiresRuntime: text(selected.rust_version),
    registryVulnerabilities: [],
  };
}

function xmlScalar(value: string): string | null {
  const trimmed = value.trim();
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(trimmed);
  const scalar = (cdata ? cdata[1] : trimmed).trim();
  if (!scalar || /[<>]/.test(scalar)) return null;
  const decoded = scalar
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
  return decoded || null;
}

function xmlSection(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(xml);
  return match ? match[1] : null;
}

function xmlText(xml: string | null, tag: string): string | null {
  if (!xml) return null;
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(xml);
  return match ? xmlScalar(match[1]) : null;
}

function xmlAttribute(xml: string, tag: string, attribute: string): string | null {
  const match = new RegExp(`<${tag}\\b[^>]*\\b${attribute}=["']([^"']+)["'][^>]*>`, 'i').exec(xml);
  return match ? xmlScalar(match[1]) : null;
}

type MavenPomMetadata = {
  description: string | null;
  license: string | null;
  repositoryUrl: string | null;
  homepageUrl: string | null;
  parent: { group: string; artifact: string; version: string } | null;
};

function mavenPomUrl(group: string, artifact: string, version: string): string {
  const groupPath = group.split('.').map(encodeURIComponent).join('/');
  return `https://repo1.maven.org/maven2/${groupPath}/${encodeURIComponent(artifact)}/${encodeURIComponent(version)}/${encodeURIComponent(artifact)}-${encodeURIComponent(version)}.pom`;
}

function mavenPomMetadata(pom: string): MavenPomMetadata {
  const project = xmlSection(pom, 'project') ?? pom;
  const licenses = xmlSection(project, 'licenses');
  const firstLicense = licenses ? xmlSection(licenses, 'license') : null;
  const scm = xmlSection(project, 'scm');
  const parent = xmlSection(project, 'parent');
  const parentGroup = xmlText(parent, 'groupId');
  const parentArtifact = xmlText(parent, 'artifactId');
  const parentVersion = xmlText(parent, 'version');
  const parentCoordinates =
    parentGroup &&
    parentArtifact &&
    parentVersion &&
    /^[A-Za-z0-9_.-]+$/.test(parentGroup) &&
    /^[A-Za-z0-9_.-]+$/.test(parentArtifact) &&
    /^[A-Za-z0-9_.+-]+$/.test(parentVersion)
      ? { group: parentGroup, artifact: parentArtifact, version: parentVersion }
      : null;
  let topLevel = project;
  for (const tag of [
    'parent',
    'licenses',
    'scm',
    'developers',
    'dependencies',
    'dependencyManagement',
    'distributionManagement',
    'profiles',
    'build',
    'properties',
  ]) {
    topLevel = topLevel.replace(new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tag}>`, 'gi'), '');
  }
  return {
    description: xmlText(topLevel, 'description'),
    license: xmlText(firstLicense, 'name'),
    repositoryUrl: xmlText(scm, 'url') ?? xmlText(scm, 'connection'),
    homepageUrl: xmlText(topLevel, 'url'),
    parent: parentCoordinates,
  };
}

async function mavenPomWithParent(
  group: string,
  artifact: string,
  version: string,
  fetchText: TextFetcher,
): Promise<{ url: string; selected: MavenPomMetadata; parent: MavenPomMetadata | null }> {
  const url = mavenPomUrl(group, artifact, version);
  let pom = '';
  try {
    pom = await fetchText(url);
  } catch {
    return { url, selected: mavenPomMetadata(''), parent: null };
  }
  const selected = mavenPomMetadata(pom);
  if (!selected.parent || (selected.license && selected.repositoryUrl && selected.homepageUrl)) {
    return { url, selected, parent: null };
  }
  try {
    const parentPom = await fetchText(
      mavenPomUrl(selected.parent.group, selected.parent.artifact, selected.parent.version),
    );
    return { url, selected, parent: mavenPomMetadata(parentPom) };
  } catch {
    return { url, selected, parent: null };
  }
}

async function mavenRegistry(
  name: string,
  version: string | null,
  fetchJson: JsonFetcher,
  fetchText: TextFetcher,
): Promise<PackageRegistryResult> {
  const [group, artifact] = name.split(':');
  const latestUrl = new URL('https://search.maven.org/solrsearch/select');
  latestUrl.searchParams.set('q', `g:"${group}" AND a:"${artifact}"`);
  latestUrl.searchParams.set('rows', '1');
  latestUrl.searchParams.set('wt', 'json');
  const latestRaw = await fetchJson(latestUrl.toString());
  const latestDocs = isObject(latestRaw) && isObject(latestRaw.response)
    ? arrayObjects(latestRaw.response.docs)
    : [];
  const latest = latestDocs[0] ?? null;
  const latestVersion = text(latest?.latestVersion);
  if (!latestVersion) throw new PackageRegistryError('package_not_found', 404);
  const selectedVersion = version ?? latestVersion;
  if (version) {
    const exactUrl = new URL('https://search.maven.org/solrsearch/select');
    exactUrl.searchParams.set('q', `g:"${group}" AND a:"${artifact}" AND v:"${version}"`);
    exactUrl.searchParams.set('core', 'gav');
    exactUrl.searchParams.set('rows', '1');
    exactUrl.searchParams.set('wt', 'json');
    const exactRaw = await fetchJson(exactUrl.toString());
    const exactDocs = isObject(exactRaw) && isObject(exactRaw.response)
      ? arrayObjects(exactRaw.response.docs)
      : [];
    if (!exactDocs.length) throw new PackageRegistryError('package_version_not_found', 404);
  }
  const pom = await mavenPomWithParent(group, artifact, selectedVersion, fetchText);
  const timestamp = integer(latest?.timestamp);
  return {
    ecosystem: 'maven',
    name,
    selectedVersion,
    latestVersion,
    latestPublishedAt: timestamp === null ? null : new Date(timestamp).toISOString(),
    description: pom.selected.description ?? pom.parent?.description ?? null,
    license: pom.selected.license ?? pom.parent?.license ?? null,
    deprecated: null,
    yanked: null,
    repositoryUrl: pom.selected.repositoryUrl ?? pom.parent?.repositoryUrl ?? null,
    homepageUrl: pom.selected.homepageUrl ?? pom.parent?.homepageUrl ?? null,
    registryUrl: `https://central.sonatype.com/artifact/${encodeURIComponent(group)}/${encodeURIComponent(artifact)}/${encodeURIComponent(selectedVersion)}`,
    packageUrl: pom.url,
    checksum: null,
    requiresRuntime: null,
    registryVulnerabilities: [],
  };
}

function nugetResource(resources: JsonObject[], typePrefix: string): string | null {
  for (const resource of resources) {
    const type = text(resource['@type']);
    const id = text(resource['@id']);
    if (type?.startsWith(typePrefix) && id) return id;
  }
  return null;
}

type NugetVersion = { core: number[]; prerelease: Array<number | string> | null };

function parsedNugetVersion(value: string): NugetVersion | null {
  const withoutBuild = value.split('+', 1)[0];
  const separator = withoutBuild.indexOf('-');
  const main = separator === -1 ? withoutBuild : withoutBuild.slice(0, separator);
  const prereleaseRaw = separator === -1 ? null : withoutBuild.slice(separator + 1);
  const coreText = main.split('.');
  if (!coreText.length || coreText.some((part) => !/^\d+$/.test(part))) return null;
  const core = coreText.map(Number);
  while (core.length < 4) core.push(0);
  if (core.length > 4) return null;
  const prerelease = prereleaseRaw
    ? prereleaseRaw.split('.').map((part) => /^\d+$/.test(part) ? Number(part) : part.toLowerCase())
    : null;
  return { core, prerelease };
}

function compareNugetVersions(left: string, right: string): number | null {
  const leftVersion = parsedNugetVersion(left);
  const rightVersion = parsedNugetVersion(right);
  if (!leftVersion || !rightVersion) return null;
  for (let index = 0; index < leftVersion.core.length; index += 1) {
    if (leftVersion.core[index] !== rightVersion.core[index]) {
      return leftVersion.core[index] - rightVersion.core[index];
    }
  }
  if (leftVersion.prerelease === null && rightVersion.prerelease === null) return 0;
  if (leftVersion.prerelease === null) return 1;
  if (rightVersion.prerelease === null) return -1;
  const length = Math.max(leftVersion.prerelease.length, rightVersion.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftVersion.prerelease[index];
    const rightPart = rightVersion.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    if (typeof leftPart === 'number' && typeof rightPart === 'number') return leftPart - rightPart;
    if (typeof leftPart === 'number') return -1;
    if (typeof rightPart === 'number') return 1;
    return leftPart.localeCompare(rightPart);
  }
  return 0;
}

function nugetPageContains(page: JsonObject, version: string): boolean {
  const lower = text(page.lower);
  const upper = text(page.upper);
  if (!lower || !upper) return false;
  const afterLower = compareNugetVersions(version, lower);
  const beforeUpper = compareNugetVersions(version, upper);
  return afterLower !== null && beforeUpper !== null && afterLower >= 0 && beforeUpper <= 0;
}

async function nugetLeaves(
  index: JsonObject,
  fetchJson: JsonFetcher,
  requestedVersion: string | null,
): Promise<JsonObject[]> {
  const pages = arrayObjects(index.items);
  const leaves: JsonObject[] = [];
  const remotePages: JsonObject[] = [];
  for (const page of pages) {
    if (Array.isArray(page.items)) leaves.push(...arrayObjects(page.items));
    else remotePages.push(page);
  }
  const requestedPages = requestedVersion
    ? remotePages.filter((page) => nugetPageContains(page, requestedVersion))
    : [];
  const recentPages = remotePages.slice(-2);
  const candidates = [...requestedPages, ...recentPages].filter(
    (page, index, items) => items.findIndex((candidate) => candidate['@id'] === page['@id']) === index,
  );
  for (const page of candidates.slice(0, 12)) {
    const pageUrl = text(page['@id']);
    if (!pageUrl) continue;
    const parsed = new URL(pageUrl);
    if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.nuget.org')) continue;
    const raw = await fetchJson(pageUrl);
    if (isObject(raw)) leaves.push(...arrayObjects(raw.items));
  }
  return leaves;
}

type NugetCatalogSelection = {
  selected: JsonObject;
  latest: JsonObject;
  selectedVersion: string;
  latestVersion: string;
};

function safeNugetBase(value: string | null): URL | null {
  if (!value) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  return parsed.protocol === 'https:' && parsed.hostname.endsWith('.nuget.org') ? parsed : null;
}

function nugetServiceBases(service: unknown): {
  registrationBase: URL;
  packageBase: URL | null;
} {
  if (!isObject(service)) throw new PackageRegistryError('invalid_registry_response', 502);
  const resources = arrayObjects(service.resources);
  const registrationBase = safeNugetBase(nugetResource(resources, 'RegistrationsBaseUrl'));
  if (!registrationBase) throw new PackageRegistryError('registry_capability_unavailable', 502);
  return {
    registrationBase,
    packageBase: safeNugetBase(nugetResource(resources, 'PackageBaseAddress')),
  };
}

function nugetCatalogSelection(
  entries: JsonObject[],
  requestedVersion: string | null,
): NugetCatalogSelection {
  if (!entries.length) throw new PackageRegistryError('package_not_found', 404);
  const listed = entries.filter((entry) => entry.listed !== false);
  const stable = listed.filter((entry) => !text(entry.version)?.includes('-'));
  const latest = stable.at(-1) ?? listed.at(-1) ?? entries.at(-1);
  if (!latest) throw new PackageRegistryError('package_not_found', 404);
  const latestVersion = text(latest.version);
  if (!latestVersion) throw new PackageRegistryError('invalid_registry_response', 502);
  const selectedVersion = requestedVersion ?? latestVersion;
  const selected = entries.find(
    (entry) => text(entry.version)?.toLowerCase() === selectedVersion.toLowerCase(),
  );
  if (!selected) throw new PackageRegistryError('package_version_not_found', 404);
  return { selected, latest, selectedVersion, latestVersion };
}

async function nugetNuspec(
  name: string,
  selectedVersion: string,
  packageBase: URL | null,
  fetchText: TextFetcher,
): Promise<{ content: string; url: string | null }> {
  if (!packageBase) return { content: '', url: null };
  const id = name.toLowerCase();
  const version = selectedVersion.toLowerCase();
  const url = new URL(
    `${encodeURIComponent(id)}/${encodeURIComponent(version)}/${encodeURIComponent(id)}.nuspec`,
    packageBase,
  ).toString();
  try {
    return { content: await fetchText(url), url };
  } catch {
    return { content: '', url };
  }
}

function nugetVulnerabilities(selected: JsonObject): Array<{ url: string | null; severity: string | null }> {
  return arrayObjects(selected.vulnerabilities).slice(0, 16).map((entry) => ({
    url: text(entry.advisoryUrl),
    severity: entry.severity === undefined ? null : String(entry.severity),
  }));
}

function nugetDeprecation(selected: JsonObject): string | null {
  const deprecation = objectValue(selected.deprecation);
  if (!Array.isArray(deprecation?.reasons)) return null;
  const reasons = deprecation.reasons.filter((item): item is string => typeof item === 'string');
  return reasons.length ? reasons.join(', ') : null;
}

async function nugetRegistry(
  name: string,
  version: string | null,
  fetchJson: JsonFetcher,
  fetchText: TextFetcher,
): Promise<PackageRegistryResult> {
  const bases = nugetServiceBases(await fetchJson('https://api.nuget.org/v3/index.json'));
  const indexUrl = new URL(
    `${encodeURIComponent(name.toLowerCase())}/index.json`,
    bases.registrationBase,
  ).toString();
  const indexRaw = await fetchJson(indexUrl);
  if (!isObject(indexRaw)) throw new PackageRegistryError('package_not_found', 404);
  const leaves = await nugetLeaves(indexRaw, fetchJson, version);
  const entries = leaves
    .map((leaf) => objectValue(leaf.catalogEntry))
    .filter((entry): entry is JsonObject => Boolean(entry));
  const selection = nugetCatalogSelection(entries, version);
  const selectedVersion = text(selection.selected.version) ?? selection.selectedVersion;
  const nuspec = await nugetNuspec(name, selectedVersion, bases.packageBase, fetchText);
  const nuspecMetadata = xmlSection(nuspec.content, 'metadata') ?? nuspec.content;
  const repository = objectValue(selection.selected.repository);
  return {
    ecosystem: 'nuget',
    name: text(selection.selected.id) ?? name,
    selectedVersion,
    latestVersion: selection.latestVersion,
    latestPublishedAt: text(selection.latest.published),
    description:
      text(selection.selected.description) ??
      text(selection.selected.summary) ??
      xmlText(nuspecMetadata, 'description'),
    license:
      text(selection.selected.licenseExpression) ??
      xmlText(nuspecMetadata, 'license') ??
      text(selection.selected.licenseUrl),
    deprecated: nugetDeprecation(selection.selected),
    yanked: selection.selected.listed === false,
    repositoryUrl:
      text(repository?.url) ??
      xmlAttribute(nuspec.content, 'repository', 'url') ??
      text(selection.selected.projectUrl),
    homepageUrl: text(selection.selected.projectUrl) ?? xmlText(nuspecMetadata, 'projectUrl'),
    registryUrl: `https://www.nuget.org/packages/${encodeURIComponent(name)}/${encodeURIComponent(selectedVersion)}`,
    packageUrl: text(selection.selected.packageContent) ?? nuspec.url,
    checksum: null,
    requiresRuntime: null,
    registryVulnerabilities: nugetVulnerabilities(selection.selected),
  };
}

export function inspectRegistryPackage(
  ecosystem: PackageEcosystem,
  name: string,
  version: string | null,
  fetchJson: JsonFetcher,
  fetchText: TextFetcher,
): Promise<PackageRegistryResult> {
  if (ecosystem === 'npm') return npmRegistry(name, version, fetchJson);
  if (ecosystem === 'pypi') return pypiRegistry(name, version, fetchJson);
  if (ecosystem === 'crates') return cratesRegistry(name, version, fetchJson);
  if (ecosystem === 'maven') return mavenRegistry(name, version, fetchJson, fetchText);
  return nugetRegistry(name, version, fetchJson, fetchText);
}

function alternative(value: JsonObject, name: string, versionKey: string, url: string | null): PackageAlternative {
  return {
    name,
    version: text(value[versionKey]),
    description: text(value.description),
    url,
  };
}

export async function registryAlternatives(
  ecosystem: PackageEcosystem,
  name: string,
  fetchJson: JsonFetcher,
): Promise<{ supported: boolean; items: PackageAlternative[] }> {
  if (ecosystem === 'pypi') return { supported: false, items: [] };
  if (ecosystem === 'npm') {
    const url = new URL('https://registry.npmjs.org/-/v1/search');
    url.searchParams.set('text', name);
    url.searchParams.set('size', '8');
    const raw = await fetchJson(url.toString());
    const objects = isObject(raw) ? arrayObjects(raw.objects) : [];
    const items = objects.flatMap((entry): PackageAlternative[] => {
      const pkg = objectValue(entry.package);
      const candidate = text(pkg?.name);
      if (!pkg || !candidate || candidate === name) return [];
      const links = objectValue(pkg.links);
      return [alternative(pkg, candidate, 'version', text(links?.npm))];
    }).slice(0, 5);
    return { supported: true, items };
  }
  if (ecosystem === 'crates') {
    const url = new URL('https://crates.io/api/v1/crates');
    url.searchParams.set('q', name);
    url.searchParams.set('per_page', '8');
    const raw = await fetchJson(url.toString());
    const items = (isObject(raw) ? arrayObjects(raw.crates) : []).flatMap((crate): PackageAlternative[] => {
      const candidate = text(crate.name);
      if (!candidate || candidate === name) return [];
      return [alternative(crate, candidate, 'max_stable_version', `https://crates.io/crates/${encodeURIComponent(candidate)}`)];
    }).slice(0, 5);
    return { supported: true, items };
  }
  if (ecosystem === 'maven') {
    const [, artifact] = name.split(':');
    const url = new URL('https://search.maven.org/solrsearch/select');
    url.searchParams.set('q', artifact);
    url.searchParams.set('rows', '8');
    url.searchParams.set('wt', 'json');
    const raw = await fetchJson(url.toString());
    const docs = isObject(raw) && isObject(raw.response) ? arrayObjects(raw.response.docs) : [];
    const items = docs.flatMap((doc): PackageAlternative[] => {
      const group = text(doc.g);
      const candidateArtifact = text(doc.a);
      if (!group || !candidateArtifact) return [];
      const candidate = `${group}:${candidateArtifact}`;
      if (candidate === name) return [];
      return [alternative(doc, candidate, 'latestVersion', `https://central.sonatype.com/artifact/${encodeURIComponent(group)}/${encodeURIComponent(candidateArtifact)}`)];
    }).slice(0, 5);
    return { supported: true, items };
  }

  const service = await fetchJson('https://api.nuget.org/v3/index.json');
  if (!isObject(service)) return { supported: false, items: [] };
  const searchBase = nugetResource(arrayObjects(service.resources), 'SearchQueryService');
  if (!searchBase) return { supported: false, items: [] };
  const base = new URL(searchBase);
  if (base.protocol !== 'https:' || !base.hostname.endsWith('.nuget.org')) return { supported: false, items: [] };
  base.searchParams.set('q', name);
  base.searchParams.set('take', '8');
  base.searchParams.set('prerelease', 'true');
  base.searchParams.set('semVerLevel', '2.0.0');
  const raw = await fetchJson(base.toString());
  const items = (isObject(raw) ? arrayObjects(raw.data) : []).flatMap((entry): PackageAlternative[] => {
    const candidate = text(entry.id);
    if (!candidate || candidate.toLowerCase() === name.toLowerCase()) return [];
    return [alternative(entry, candidate, 'version', `https://www.nuget.org/packages/${encodeURIComponent(candidate)}`)];
  }).slice(0, 5);
  return { supported: true, items };
}
