// ============================================================
// Netlify Function that serves the whole NestJS API.
//
// Deliberately plain CommonJS JavaScript that requires the *compiled*
// output in dist/: NestJS depends on `emitDecoratorMetadata`, which
// esbuild cannot produce. `nest build` (tsc) runs first, so by the time
// Netlify bundles this file dist/ already contains the Reflect.metadata
// calls the DI container needs.
//
// The bootstrapped app is cached on the module scope so warm containers
// reuse the existing Prisma connection pool instead of reconnecting.
// ============================================================

const serverless = require('serverless-http');

const FUNCTION_PREFIX = '/.netlify/functions/api';
const API_PREFIX = '/api/v1';

let handlerPromise;

async function bootstrap() {
  const { createNestApp } = require('../../dist/app.factory');

  const app = await createNestApp();
  // init() wires up the modules and Express routes without binding a port —
  // app.listen() would never return inside a Lambda invocation.
  await app.init();

  return serverless(app.getHttpAdapter().getInstance(), {
    request(request, event) {
      // Keep the caller's real protocol/host for anything that builds absolute
      // URLs (payment redirects, Location headers).
      const proto = event.headers['x-forwarded-proto'];
      if (proto) request.headers['x-forwarded-proto'] = proto;
    },
  });
}

/**
 * Netlify may hand us either the original request path (`/api/v1/...`) or the
 * rewritten function path (`/.netlify/functions/api/...`), depending on how the
 * request arrived. Express only knows about `/api/v1`, so normalise both forms.
 */
function normalizePath(raw) {
  let path = raw || '/';
  if (path.startsWith(FUNCTION_PREFIX)) {
    path = path.slice(FUNCTION_PREFIX.length) || '/';
  }
  if (!path.startsWith(API_PREFIX)) {
    path = path === '/' ? API_PREFIX : API_PREFIX + path;
  }
  return path;
}

// Exported so it can be unit-tested without booting Nest (or a database).
exports.normalizePath = normalizePath;

exports.handler = async (event, context) => {
  // Lambda keeps the event loop alive waiting for the Prisma pool otherwise.
  context.callbackWaitsForEmptyEventLoop = false;

  if (!handlerPromise) {
    handlerPromise = bootstrap().catch((err) => {
      // Do not cache a failed bootstrap — the next invocation should retry
      // (a cold start that raced a database restart, say).
      handlerPromise = undefined;
      throw err;
    });
  }

  try {
    const handler = await handlerPromise;
    return handler({ ...event, path: normalizePath(event.path) }, context);
  } catch (err) {
    console.error('[netlify/api] bootstrap failed:', err);
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ statusCode: 500, message: 'API failed to start' }),
    };
  }
};
