import { radioNow } from '../functions/api/radio-now.js';
import { radioStation } from '../functions/api/radio-station.js';

export default {
  async fetch(request) {
    const pathname = new URL(request.url).pathname.replace(/\/$/, '').toLowerCase();
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
