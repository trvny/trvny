import { onRequestGet as local } from '../_shared/radio-now.js';
import { forwardHubRequest } from '../_shared/hub-backend.js';

export function onRequestGet(context = {}) {
  return forwardHubRequest(context, local);
}
