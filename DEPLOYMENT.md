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
| `PAYMENT_CONFIG_ENCRYPTION_KEY` | `openssl rand -hex 32` (64 hex characters) | required to save gateway secrets from the site admin |
| `BD_GATEWAY_TIMEOUT_MS` | `10000` | optional |
| `BD_GATEWAY_URL` / `BD_GATEWAY_API_KEY` / `BD_GATEWAY_API_SECRET` / `BD_GATEWAY_WEBHOOK_SECRET` | optional legacy environment fallback; normally entered in BetPlatform Admin → Payments → Gateway Setup | optional |
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

## 4. Connect the private BD payment gateway

Deploy `paymentgw` first (see that repository's `DEPLOYMENT.md`). The gateway remains a
separate service; BetPlatform connects to it using one dedicated merchant identity.

1. In the gateway operator dashboard, create the receiving accounts you own and keep
   the SMS-forwarder phone/device keys private. The gateway still receives the SMS and
   performs its own TrxID/amount matching.
2. Create **one dedicated merchant for BetPlatform**. When creating it, set its webhook
   URL to:

   ```
   https://<backend-site>.netlify.app/api/v1/payment/deposit/bdgateway/webhook
   ```

   Copy the merchant API key, API secret and webhook secret. These credentials are
   shown by the gateway only once.
3. In the backend Netlify site's environment, add
   `PAYMENT_CONFIG_ENCRYPTION_KEY` using a fresh `openssl rand -hex 32` value. Keep
   that 64-character key only in backend hosting secrets — never in Git or a
   `NEXT_PUBLIC_*` variable.
4. Deploy the backend and frontend. Sign in to BetPlatform with an administrator
   account, open **Admin → Payments → Gateway Setup**, enter the gateway base URL and
   merchant credentials, choose enabled providers and BDT deposit limits, then save.
   BetPlatform encrypts the credentials with AES-256-GCM before storing them in its
   own `system_settings` table. The admin screen only displays a masked API-key hint
   and whether secrets are saved; it never returns the plaintext secrets.
5. Copy the webhook URL shown in BetPlatform into the dedicated merchant's webhook
   setting if it was not already entered when the merchant was created. Check that the
   gateway merchant's webhook is active.

**The customer experience is now hosted by BetPlatform.** The browser does not receive
the gateway checkout URL, merchant API credentials, webhook secret, gateway admin URL,
or gateway order reference. The backend talks to the gateway server-to-server.

### What a deposit looks like

1. The player chooses the BetPlatform BD gateway method on `/wallet`, enters a BDT
   amount and selects an enabled provider.
2. BetPlatform creates the deposit record and gateway order on the backend. It saves
   the public receiving number and payment instructions on that deposit, but does not
   return the gateway's hosted checkout URL to the browser.
3. The player is sent to BetPlatform's own `/wallet/deposit/pay/<depositId>` screen.
   That page displays the receiving number, exact amount, instructions and TrxID form.
4. The player sends the exact amount, then submits the TrxID inside BetPlatform. The
   betting backend proxies that TrxID to the gateway; the browser never calls the
   gateway API directly.
5. The gateway matches the TrxID against the SMS forwarded from the receiving phone.
   The gateway sends a signed webhook to BetPlatform when the order changes.
6. BetPlatform verifies `X-Gateway-Signature` (HMAC-SHA256 over
   `${t}.${rawBody}`, with a 5-minute replay window), then re-reads the order from the
   gateway API and checks the reference, BDT currency and exact amount before crediting
   the player's BDT wallet through the existing double-entry ledger. A replayed or
   duplicated webhook cannot double-credit.
7. The BetPlatform payment page polls its own backend reconciliation endpoint while the
   deposit is pending. The Admin → Payments → Deposit Requests tab shows the deposit
   status and lets an administrator request a fresh gateway status check.

### What remains in the gateway operator dashboard

The current gateway's merchant API supports creating orders, reading order status and
submitting customer TrxIDs. It does **not** expose merchant-scoped APIs for managing
receiving accounts, SMS-forwarder device keys, raw SMS logs or manual gateway-side
order approvals. Those operator-only tasks remain in the gateway's own admin dashboard.
BetPlatform customers are not given that dashboard URL or any gateway credentials.
This integration does not modify the `paymentgw` repository.

### Currency safety

New player wallets are created in BDT. An unused legacy USD wallet with no ledger entries
is converted to BDT when its first BDT deposit is initiated. Existing wallets with ledger
history are intentionally not relabelled, because doing so would change the meaning of
past balances and transactions; those accounts need an explicit accounting migration
before accepting BDT deposits.

A webhook signature is not treated as proof of payment. Only an approved order read
back from the gateway can result in a wallet credit.

The gateway project handles incoming Send Money deposits; it does not expose a merchant
payout API. Withdrawal requests and destinations are recorded in BetPlatform Admin →
Payments → Withdrawal Queue and in the customer's Wallet → Payment Requests.

When an administrator approves a withdrawal, BetPlatform reserves the funds by posting
the withdrawal ledger debit and moving the request to PROCESSING. The operator then
sends the payout using the listed bKash/Nagad/Rocket/Upay account and records the real
transfer TrxID using **Mark as paid**. The request then becomes COMPLETED without a
second debit. If the operator did not send the money, **Fail & refund** records the
failure and posts a reversal to release the reserved funds. The site tracks the
request and ledger entries, but the actual outbound transfer remains manual until the
gateway vendor provides a merchant-scoped payout API.

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




