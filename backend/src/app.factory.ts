import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

// ============================================================
// Single place where the Nest application is configured.
//
// Two very different runtimes consume this:
//   • src/main.ts             — long-lived node process (local dev, VPS)
//   • netlify/functions/api   — one Netlify Function per request
//
// Anything that must be true in BOTH (global prefix, validation
// pipe, CORS) belongs here. Only `listen()` lives in main.ts —
// calling it inside a Lambda would hang the invocation.
// ============================================================

export const GLOBAL_PREFIX = 'api/v1';

/** `ALLOWED_ORIGIN` accepts a single origin, a comma-separated list, or `*`. */
function corsOptions(): { origin: string | string[]; credentials?: boolean } {
  const raw = (process.env.ALLOWED_ORIGIN ?? '').trim();
  if (!raw || raw === '*') {
    // Credentials cannot be combined with a wildcard origin, and the API is
    // Bearer-token authenticated rather than cookie based, so this is safe.
    return { origin: '*' };
  }
  const list = raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return { origin: list.length === 1 ? list[0] : list, credentials: true };
}

export async function createNestApp(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Preserves the raw Buffer on req.rawBody so webhook HMAC signatures can be
    // verified against the exact bytes the sender signed.
    rawBody: true,
    logger:
      process.env.NODE_ENV === 'production'
        ? ['error', 'warn', 'log']
        : ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.setGlobalPrefix(GLOBAL_PREFIX);
  app.enableCors(corsOptions());

  // Netlify terminates TLS in front of the function; without this Express
  // reports http:// and the client's proxy IP instead of its real one.
  app.set('trust proxy', 1);

  return app;
}

/** Swagger is dev-only: it pulls in the whole swagger-ui asset tree, which has
 *  no business inside a serverless bundle. */
export async function mountSwagger(app: NestExpressApplication): Promise<void> {
  if (process.env.NODE_ENV === 'production' || process.env.NETLIFY === 'true') return;

  const { SwaggerModule, DocumentBuilder } = await import('@nestjs/swagger');
  const config = new DocumentBuilder()
    .setTitle('Gaming Platform API')
    .setDescription('Production-grade online gaming platform')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  SwaggerModule.setup(`${GLOBAL_PREFIX}/docs`, app, SwaggerModule.createDocument(app, config));
  new Logger('Bootstrap').log(
    `Swagger docs at http://localhost:${process.env.PORT ?? 3000}/${GLOBAL_PREFIX}/docs`,
  );
}
