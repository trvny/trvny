import type { CompanionEnv } from '../companion/companion-types.ts';
import { botAuthorized } from '../gptomek/github-gateway.ts';

// Shitpost Reactor start. GitHub schedule lagged 2-6 h and dropped whole days;
// Cloudflare cron is punctual. Fires 02:20 and 03:20 UTC; only the run that
// lands on 04:20 Warsaw dispatches, so DST needs no config change.
export const SHITPOST_DISPATCH_CRON = '20 2,3 * * *';
const SHITPOST_WARSAW_HOUR = 4;
const SHITPOST_DISPATCH_PATH =
  '/repos/trvny/trvny/actions/workflows/shitpost-reactor.yml/dispatches';

export function warsawHour(epochMs: number): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Warsaw',
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(epochMs),
  );
}

export async function runScheduledDispatch(
  cron: string,
  scheduledTime: number,
  env: CompanionEnv,
  fetcher: typeof fetch,
): Promise<'dispatched' | 'skipped'> {
  if (cron !== SHITPOST_DISPATCH_CRON) return 'skipped';
  if (warsawHour(scheduledTime) !== SHITPOST_WARSAW_HOUR) return 'skipped';
  await botAuthorized(
    { method: 'POST', path: SHITPOST_DISPATCH_PATH, body: { ref: 'main' }, expect: 'empty' },
    env,
    fetcher,
  );
  console.info(JSON.stringify({ scheduledDispatch: 'shitpost-reactor', scheduledTime }));
  return 'dispatched';
}
