import type { Config } from '@netlify/functions';

// ============================================================
// Netlify Scheduled Function — replaces @Cron(EVERY_DAY_AT_MIDNIGHT)
// in AnalyticsService, which can never fire on Netlify: the function
// container is frozen between requests, so in-process timers die.
//
// Runs at 00:20 UTC and asks the API to snapshot the previous day.
// ============================================================

export const config: Config = {
  schedule: '20 0 * * *',
};

function apiBase(): string {
  const explicit = process.env.API_PUBLIC_URL?.replace(/\/+$/, '');
  if (explicit) return explicit;
  const site = (process.env.URL || process.env.DEPLOY_URL || 'http://localhost:3000').replace(/\/+$/, '');
  return `${site}/api/v1`;
}

export default async function handler(): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('CRON_SECRET is not set — refusing to call the snapshot endpoint');
    return new Response('CRON_SECRET missing', { status: 500 });
  }

  const url = `${apiBase()}/internal/cron/analytics-snapshot`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${secret}`,
        'content-type': 'application/json',
      },
      body: '{}',
    });

    const text = await res.text();
    if (!res.ok) {
      console.error(`Snapshot call failed: HTTP ${res.status} ${text.slice(0, 300)}`);
      return new Response(text, { status: 502 });
    }

    console.log(`Snapshot ok: ${text.slice(0, 300)}`);
    return new Response(text, { status: 200 });
  } catch (err) {
    console.error(`Snapshot call threw: ${(err as Error).message}`);
    return new Response((err as Error).message, { status: 502 });
  }
}
