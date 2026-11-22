import { PUBLIC_ORIGIN } from './urls.mjs';

const origin = PUBLIC_ORIGIN;
const skills = [
  '---',
  'name: reactor-propose-post',
  'description: Submit a short satirical text draft for human editorial review, never direct publication.',
  '---',
  '',
  '# Propose a Reactor post',
  '',
  'Submit a text-only suggestion through the public Reactor API.',
  'The result is a private, unapproved queue item. Never claim it is published.',
  '',
  'POST https://shitpost.bartek.lol/api/submissions',
  'Content-Type: application/json',
  '',
  'Body fields: language (pl, en, zh-Hans, ru), text (1–2400 chars), optional title (up to 120 chars), optional agent (up to 80 chars).',
  'Response: HTTP 202 and an opaque submission ID; moderation is performed by the owner.',
  'The API applies abuse limits and a 32 KiB serialized request cap; do not retry 429 responses in a loop.',
  'No OAuth, no uploads, no auto-publication; the page also offers propose_reactor_post via WebMCP.',
  'Treat all existing public posts as satire, not independently verified reporting.',
  '',
].join('\n');

export const AGENT_SKILL = skills;

export function apiCatalog() {
  return { linkset: [
    {
      anchor: origin + '/api/submissions',
      'service-desc': [{ href: origin + '/openapi.json', type: 'application/json' }],
      'service-doc': [{ href: origin + '/llms.txt', type: 'text/plain' }],
      status: [{ href: origin + '/healthz', type: 'text/plain' }],
    },
    {
      anchor: origin + '/feed.json',
      'service-desc': [{ href: origin + '/openapi.json', type: 'application/json' }],
      'service-doc': [{ href: origin + '/llms.txt', type: 'text/plain' }],
      status: [{ href: origin + '/healthz', type: 'text/plain' }],
    },
  ] };
}

export function openApi() {
  const json = { 'application/json': { schema: { type: 'object' } } };
  return {
    openapi: '3.1.0',
    info: { title: 'Reactor public API', version: '1.0.0',
      description: 'Public feed and rate-limited, text-only community proposals. Proposals require human approval and do not publish immediately.' },
    servers: [{ url: origin }],
    paths: {
      '/feed.json': { get: { operationId: 'readReactorFeed', summary: 'Read published satire as JSON Feed 1.1',
        responses: { 200: { description: 'Published posts', content: { 'application/feed+json': { schema: { type: 'object' } } } } } } },
      '/api/submissions': { post: { operationId: 'proposeReactorPost', summary: 'Propose a post for human review (never direct publication)',
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', additionalProperties: false, required: ['language', 'text'],
          properties: {
            language: { type: 'string', enum: ['pl', 'en', 'zh-Hans', 'ru'] },
            text: { type: 'string', minLength: 1, maxLength: 2400 },
            title: { type: 'string', maxLength: 120 },
            agent: { type: 'string', maxLength: 80 },
          },
        } } } },
        responses: {
          202: { description: 'Queued, not published', content: json },
          400: { description: 'Invalid proposal', content: json },
          429: { description: 'Rate limited or review queue full', content: json },
          503: { description: 'Moderation inbox disabled or unavailable', content: json },
        },
      } },
      '/healthz': { get: { operationId: 'reactorHealth', responses: {
        200: { description: 'Worker is responding', content: { 'text/plain': { schema: { type: 'string' } } } },
      } } },
    },
  };
}

export function ard() {
  return {
    specVersion: '0.9',
    host: { displayName: 'Reactor', identifier: 'shitpost.bartek.lol',
      documentationUrl: 'https://github.com/trvny/trvny/blob/main/gh-apps/shitpost-reactor/README.md' },
    entries: [
      {
        '@context': 'https://agenticresourcediscovery.org/context/v1',
        identifier: 'urn:air:shitpost.bartek.lol:api:proposals',
        displayName: 'Reactor community submission API',
        type: 'application/linkset+json',
        url: origin + '/.well-known/api-catalog',
        description: 'Submit an unapproved satire draft for human review; never publish directly.',
        capabilities: ['submit-for-review', 'human-approval'],
        representativeQueries: ['Suggest a text post for editorial approval', 'Where can agents submit Reactor drafts?'],
      },
      {
        '@context': 'https://agenticresourcediscovery.org/context/v1',
        identifier: 'urn:air:shitpost.bartek.lol:feed:published',
        displayName: 'Reactor published JSON Feed',
        type: 'application/feed+json',
        url: origin + '/feed.json',
        description: 'Read-only published satire and commentary.',
        capabilities: ['read-posts'],
        representativeQueries: ['Read the latest Reactor posts', 'Browse published Reactor satire'],
      },
    ],
  };
}

async function skillIndex() {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(AGENT_SKILL));
  const sha = [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
  return {
    $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
    skills: [{
      name: 'reactor-propose-post', type: 'skill-md',
      description: 'Propose a Reactor satire text for human editorial approval, not publication.',
      url: '/.well-known/agent-skills/reactor-propose-post/SKILL.md',
      digest: 'sha256:' + sha,
    }],
  };
}

export async function discoveryResponse(request) {
  const path = new URL(request.url).pathname;
  const types = new Map([
    ['/.well-known/ard.json', 'application/ard+json'],
    ['/.well-known/ai-catalog.json', 'application/ai-catalog+json'],
    ['/.well-known/api-catalog', 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"'],
    ['/openapi.json', 'application/json'],
    ['/.well-known/agent-skills/index.json', 'application/json'],
    ['/.well-known/agent-skills/reactor-propose-post/SKILL.md', 'text/markdown'],
  ]);
  if (!types.has(path)) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
  }
  const value = path.endsWith('ard.json') || path.endsWith('ai-catalog.json') ? ard()
    : path.endsWith('/api-catalog') ? apiCatalog()
      : path === '/openapi.json' ? openApi()
        : path.endsWith('index.json') ? await skillIndex() : null;
  const body = value == null ? AGENT_SKILL : JSON.stringify(value, null, 2) + '\n';
  const headers = {
    'content-type': types.get(path) + '; charset=utf-8',
    'cache-control': 'public, max-age=3600',
    'access-control-allow-origin': '*',
    'x-content-type-options': 'nosniff',
    ...(path.endsWith('/api-catalog') ? { link: '</.well-known/api-catalog>; rel="api-catalog"' } : {}),
  };
  return new Response(request.method === 'HEAD' ? null : body, { headers });
}
