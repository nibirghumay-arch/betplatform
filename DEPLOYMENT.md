# Deployment — Netlify (backend + frontend)

The backend used to run as a long-lived NestJS process on Railway. It now runs as a
**single Netlify Function** so the whole platform fits on free tiers. Nothing about the
API surface changed: same routes, same `/api/v1` prefix, same auth.

Two Netlify sites are created from this one repo:

| Site | Base directory | Serves |
|---|---|---|
| backend | `backend` | `/api/v1/*` — the entire NestJS app |
| frontend | `frontend` | the Next.js player/admin UI |

Plus one external dependency: the **BD Payment Gateway**
([paymentgw](https://github.com/nibirghumay-arch/paymentgw)), deployed separately, which
handles bKash/Nagad/Rocket/Upay Send Money deposits.

## How the backend runs serverless

- `src/app.factory.ts` holds all app configuration (pipes, CORS, global prefix) and is
  shared by both entry points, so local and deployed behaviour cannot drift.
- `src/main.ts` is unchanged in spirit: `createNestApp()` then `listen()`.
- `netlify/functions/api.js` calls `createNestApp()` + `app.init()` (never `listen()`)
  and wraps the Express instance with `serverless-http`. The bootstrapped handler is
  cached at module scope, so a warm container reuses the existing Prisma pool.
- That file is deliberately plain CommonJS: NestJS needs `emitDecoratorMetadata`, which
  esbuild cannot emit, so `nest build` (tsc) compiles `src/` to `dist/` first and the
  function `require`s the compiled output. Every NestJS/Prisma/native package is listed
  in `netlify.toml` under `external_node_modules` to be copied rather than bundled.
- `netlify.toml` rewrites `/api/v1/*` to the function. The doubled `api` in the target
  is intentional — the function strips its own `/.netlify/functions/api` prefix and
  what remains is the `/api/v1/...` path Nest expects.
- `@Cron(EVERY_DAY_AT_MIDNIGHT)` cannot fire in a frozen container, so
  `AnalyticsService.scheduledSnapshot()` returns early when `NETLIFY=true` and
  `netlify/functions/daily-snapshot.mts` drives the snapshot instead, by POSTing to
  `/api/v1/internal/cron/analytics-snapshot` with `Authorization: Bearer $CRON_SECRET`.

Redis is **not** required — `REDIS_URL` appears in `docker-compose.yml` but no code path
connects to it.

---

## 1. Database

The backend was already on PostgreSQL, so there is no data model change — only a move
off Railway's managed instance. Create a Postgres database (Neon's free tier is enough)
and copy **both** URLs:

- **Pooled** (`-pooler` in the host) → `DATABASE_URL` on Netlify. Serverless means many
  short-lived clients; the pooler is what keeps you under the connection cap.
- **Direct** → used only from your machine, to run migrations. Prisma Migrate needs a
  session-mode connection and will fail against a transaction-mode pooler.

Apply the schema once, from your machine:

```bash
cd backend
DATABASE_URL="postgresql://...direct..." npx prisma migrate deploy
```

Repeat that after any future `schema.prisma` change. The Netlify build deliberately runs
only `prisma generate` — a deploy must never silently migrate a live database.

Migrating existing Railway data, if you have any worth keeping:

```bash
pg_dump "<railway-direct-url>" --no-owner --no-acl -Fc -f betting.dump
pg_restore --no-owner --no-acl -d "<neon-direct-url>" betting.dump
```

## 2. Backend site

**Add new site → Import an existing project →** `nibirghumay-arch/betplatform`.

| Setting | Value |
|---|---|
| Base directory | `backend` |
| Build command | `npm run build:netlify` |
| Publish directory | `public` |
| Functions directory | `netlify/functions` |

All of it is already in `backend/netlify.toml`. `publish = "public"` exists only because
Netlify insists on a publish directory; the site serves no static content.

### Backend environment variables

| Key | Value | Required |
|---|---|---|
| `DATABASE_URL` | pooled Postgres URL | yes |
| `JWT_SECRET` | `openssl rand -hex 32` | yes |
| `NODE_ENV` | `production` | yes |
| `API_PUBLIC_URL` | `https://<backend-site>.netlify.app/api/v1` | yes |
| `FRONTEND_URL` | `https://<frontend-site>.netlify.app` | yes |
| `ALLOWED_ORIGIN` | `https://<frontend-site>.netlify.app` | yes |
| `CRON_SECRET` | `openssl rand -hex 32` | yes |
| `JWT_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN` | `15m` / `7d` | defaults exist |
| `BD_GATEWAY_URL` | `https://<gateway-site>.netlify.app` | for bKash/Nagad deposits |
| `BD_GATEWAY_API_KEY` | merchant API key from the gateway admin | " |
| `BD_GATEWAY_API_SECRET` | merchant API secret | " |
| `BD_GATEWAY_WEBHOOK_SECRET` | merchant webhook secret | " |
| `BD_GATEWAY_TIMEOUT_MS` | `10000` | optional |
| `SSLCOMMERZ_STORE_ID` / `SSLCOMMERZ_STORE_PASSWORD` / `SSLCOMMERZ_LIVE` | SSLCommerz credentials | only for that provider |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | outbound email | optional |

`ALLOWED_ORIGIN` accepts one origin, a comma-separated list, or `*`. Auth is a Bearer
token rather than a cookie, so `*` is not dangerous here — but naming the frontend
origin is still better.

`API_PUBLIC_URL` and `FRONTEND_URL` are only knowable after the first deploy: deploy
once, copy the assigned URLs, set the variables, redeploy. Payment redirects and the
SSLCommerz/gateway callback URLs are all built from them.

## 3. Frontend site

**Add new site** from the same repo, with base directory `frontend`
(`frontend/netlify.toml` already declares the build and the Next.js plugin).

| Key | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://<backend-site>.netlify.app/api/v1` |

`NEXT_PUBLIC_*` values are inlined at build time, so changing this requires a redeploy
of the frontend site, not just a restart.

## 4. Wire up the BD payment gateway

Deploy the gateway first (see its own `DEPLOYMENT.md`), then in its admin UI:

1. **Receiving Accounts** — add the bKash/Nagad/Rocket/Upay numbers you own.
2. **Merchants** — create one for this platform. The API key, API secret and webhook
   secret are shown **once**; paste them into the backend site's environment as
   `BD_GATEWAY_API_KEY`, `BD_GATEWAY_API_SECRET`, `BD_GATEWAY_WEBHOOK_SECRET`.
3. Set that merchant's **webhook URL** to:

   ```
   https://<backend-site>.netlify.app/api/v1/payment/deposit/bdgateway/webhook
   ```

### What a deposit looks like

1. Player picks *bKash / Nagad / Rocket / Upay — Send Money* on `/wallet`, enters an
   amount, submits. `POST /payment/deposit` with `pspProvider: "bdgateway"`.
2. The backend creates a gateway order and returns its `checkoutUrl`; the browser goes
   there. The gateway order reference is stored on the deposit as `pspSessionId`.
3. The player sends the exact amount to the number shown, then pastes their TrxID.
4. The forwarded SMS reaches the gateway, which auto-approves the order only when the
   **TrxID and the exact amount** both match, and POSTs a signed `order.approved`
   webhook to the backend.
5. The backend verifies `X-Gateway-Signature` (HMAC-SHA256 over `${t}.${rawBody}`,
   5-minute replay window), then — treating the webhook as a notification only —
   **re-reads the order from the gateway API** before crediting, exactly as the
   SSLCommerz integration re-validates through the Order Validation API. Crediting goes
   through the same double-entry `settle()` path, keyed on `deposit:<id>`, so a replayed
   or duplicated webhook cannot double-credit.
6. Meanwhile the player is on `/wallet/deposit/result?status=pending&depositId=…`, which
   polls `POST /payment/deposit/bdgateway/:depositId/reconcile` every 5s for up to
   2.5 minutes. That endpoint re-reads the gateway order and applies it, so a late or
   lost webhook still resolves without an admin.

Because a signature alone is never treated as proof of payment, a leaked webhook secret
cannot mint balance — only a real approved order on the gateway can.

## 5. Verify

```bash
curl -s https://<backend-site>.netlify.app/api/v1/health
```

Expect `{"status":"ok","database":"up","runtime":"netlify",...}`. `"database":"down"`
means the function boots but cannot reach Postgres — check `DATABASE_URL` and that you
used the pooled URL.

Then, in order:

1. Register and log in on the frontend — proves CORS and `NEXT_PUBLIC_API_URL`.
2. Deposit ৳10 through the BD gateway and confirm the balance lands without touching the
   admin UI.
3. Request a withdrawal — proves the ledger writes.
4. Trigger the scheduled snapshot by hand:

   ```bash
   curl -X POST https://<backend-site>.netlify.app/api/v1/internal/cron/analytics-snapshot \
     -H "Authorization: Bearer $CRON_SECRET"
   ```

## 6. Decommission Railway

Only after the two checks above pass: remove the Railway service, then the Railway
Postgres add-on last, once you are satisfied nothing still points at it.

## Local development

Unchanged — the serverless wrapper is additive:

```bash
cd backend && npm run start:dev     # http://localhost:3000/api/v1, Swagger at /api/docs
cd frontend && npm run dev          # http://localhost:3001
```

`backend/tsconfig.json` deliberately leaves `incremental` off. `nest build` deletes
`dist/` on every run (`deleteOutDir`), but incremental tsc trusts
`tsconfig.tsbuildinfo` rather than checking whether the output files still exist — so
every second build emitted nothing and the function died with
`Cannot find module '../../dist/app.factory'`. If you re-enable incremental, also set
`deleteOutDir: false` in `nest-cli.json`.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `Cannot find module '../../dist/app.factory'` | `nest build` emitted nothing — incremental tsc plus `deleteOutDir` (see above); delete `backend/tsconfig.tsbuildinfo` and rebuild |
| 404 on every `/api/v1/*` route | the `[[redirects]]` block is missing, or Base directory is not `backend` |
| `PrismaClientInitializationError` about query engine | `PRISMA_CLI_BINARY_TARGETS` or the `rhel-openssl-3.0.x` entry in `schema.prisma` was removed |
| `too many connections` | direct URL used instead of the pooled one |
| CORS errors in the browser | `ALLOWED_ORIGIN` does not match the frontend origin exactly (scheme included) |
| Deposits stay pending forever | webhook URL not registered on the merchant, or `BD_GATEWAY_WEBHOOK_SECRET` mismatched — the reconcile poll is the safety net, check the function log for `Invalid webhook signature` |
| Function times out on cold start | 10s default; raise it or keep the pooled URL, which connects faster |
| Daily snapshot never runs | `CRON_SECRET` unset — `daily-snapshot.mts` refuses to call an unguarded route |




