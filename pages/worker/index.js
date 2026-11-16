import { onRequestGet as radioNow } from '../functions/_shared/radio-now.js';
import { onRequestGet as radioStation } from '../functions/_shared/radio-station.js';

export default {
  async fetch(request) {
    const { pathname } = new URL(request.url);
    const handler = pathname === '/api/radio-now' ? radioNow :
      pathname === '/api/radio-station' ? radioStation : null;
    if (!handler) return new Response('Not found', { status: 404 });
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405, headers: { allow: 'GET' } });
    }
    const response = await handler({ request });
    response.headers.set('x-travny-backend', 'worker');
    return response;
  },
};
