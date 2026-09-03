import { Logger } from '@nestjs/common';
import { createNestApp, mountSwagger, GLOBAL_PREFIX } from './app.factory';

// Local / VPS entrypoint. On Netlify the app is bootstrapped by
// netlify/functions/api.js instead — this file is never loaded there.
async function bootstrap(): Promise<void> {
  const app = await createNestApp();
  await mountSwagger(app);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  new Logger('Bootstrap').log(`Server running on http://localhost:${port}/${GLOBAL_PREFIX}`);
}

void bootstrap();
