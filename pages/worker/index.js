import { radioNow } from '../functions/api/radio-now.js';
import { radioStation } from '../functions/api/radio-station.js';
import { badgeResponse } from '../functions/badge/[[path]].js';

export default {
  async fetch(request) {
    const rawPath = new URL(request.url).pathname.replace(/\/$/, '');
    const pathname = rawPath.toLowerCase();
    const badgePath = pathname.startsWith('/badge/') ? rawPath.slice('/badge/'.length) : null;
    let params;
    if (badgePath !== null) {
      try {
        params = { path: badgePath.split('/').map(decodeURIComponent) };
      } catch {
        return new Response('Invalid path', { status: 400 });
      }
    }
    const handler = pathname === '/api/radio-now' ? radioNow :
      pathname === '/api/radio-station' ? radioStation :
      badgePath !== null ? badgeResponse : null;
    if (!handler) return new Response('Not found', { status: 404 });
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
    }
    const response = await handler({ request, params });
    response.headers.set('x-travny-backend', 'worker');
    return request.method === 'HEAD'
      ? new Response(null, { status: response.status, headers: response.headers })
      : response;
  },
};
