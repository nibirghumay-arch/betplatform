# SSLCommerz Integration — What Changed

This document explains how SSLCommerz was wired into the betting platform's
existing payment system, and what to check before you submit/demo it.

## What SSLCommerz gives you

SSLCommerz is a single Bangladeshi payment gateway that internally routes to:
**bKash, Nagad, Rocket, Upay, mCash, Tap**, plus cards and internet banking.
You integrate once against SSLCommerz's API; it presents all of those methods
on its own hosted checkout page. This integration lets a user pick a specific
mobile wallet up front (so SSLCommerz shows only that one), or leave it open
and let SSLCommerz show every method it supports.

## New concept: saved Payment Methods

The original codebase had no way to save a payout destination — withdrawals
just sent an empty `payoutDetails: {}` object. This integration adds a
`PaymentMethod` model: a user can save several bKash/Nagad/Rocket/Upay/mCash/
Tap (or bank/card) accounts. **Exactly one is "active" (`isDefault`) at a
time**, but the user can switch which one is active whenever they want —
nothing is deleted when you switch, so you can switch back later.

- Adding your *first* method always makes it active automatically.
- Adding a second+ method does *not* change the active one unless you tick
  "make this my active payment method".
- Deleting the active method promotes the next most-recently-added one, so
  there's never a gap if you still have methods on file.

This is enforced transactionally in `PaymentMethodService` (see
`backend/src/payment/payment-method.service.ts`) — every write that sets
`isDefault: true` first clears it on all the user's other methods in the same
DB transaction.

## Backend changes

| File | What changed |
|---|---|
| `prisma/schema.prisma` | Added `PaymentMethodType` enum and `PaymentMethod` model. Added `sslValId`/`paymentChannel` to `Deposit`, `paymentMethodId` to `Withdrawal`. |
| `prisma/migrations/20260802120000_sslcommerz_payment_methods/` | Hand-written migration SQL (see note below). |
| `src/payment/sslcommerz/` | New folder: a TypeScript port of the uploaded SSLCommerz Node SDK (`sslcommerz-client.service.ts`), a higher-level service mapping our concepts onto it (`sslcommerz.service.ts`), shared types, and a module. |
| `src/payment/payment-method.service.ts` + `.controller.ts` | New: CRUD + "set active" for saved payment methods. |
| `src/payment/deposit.service.ts` / `.controller.ts` | `initiate()` now creates a real SSLCommerz checkout session when `pspProvider: 'sslcommerz'`. Added `@Public()` success/fail/cancel/IPN endpoints that **always re-validate with SSLCommerz's own Order Validation API** before crediting a wallet — the raw redirect/IPN payload is never trusted on its own. |
| `src/payment/withdrawal.service.ts` / `.controller.ts` | Withdrawals now resolve a saved `PaymentMethod` (a specific one, or the user's active one) instead of requiring raw `payoutDetails` from the frontend. |
| `src/payment/dto/sslcommerz-callback.dto.ts` | **Important fix**: SSLCommerz's callback body has to be a `class-validator`-decorated DTO, not a plain interface — `main.ts` has a global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })` that would otherwise reject every field SSLCommerz sends. |
| `.env.example` / root `.env` | Added `SSLCOMMERZ_STORE_ID`, `SSLCOMMERZ_STORE_PASSWORD`, `SSLCOMMERZ_LIVE`, `API_PUBLIC_URL`, `FRONTEND_URL`. Defaults are SSLCommerz's real public sandbox test credentials (`testbox` / `qwerty`), so it works out of the box against their sandbox. |

**Also fixed a pre-existing bug**: the original Stripe/PayPal webhook
endpoints weren't marked `@Public()`, but the app has a global JWT guard —
meaning a real PSP calling that webhook would have gotten a 401. Fixed for
both deposit and withdrawal webhooks.

## Frontend changes

| File | What changed |
|---|---|
| `hooks/usePaymentMethods.ts` | New: list/add/set-default/remove saved methods. |
| `components/payment/PaymentMethodManager.tsx` | New: UI to add bKash/Nagad/Rocket/Upay/mCash/Tap accounts, see which is active, switch, or delete. |
| `app/(app)/wallet/page.tsx` | Deposit form now lets you pick SSLCommerz + a mobile wallet + phone number, and redirects to SSLCommerz's hosted checkout. Withdrawal form now picks from your saved payment methods instead of a blank form. |
| `app/(app)/wallet/deposit/result/page.tsx` | New: the page SSLCommerz redirects back to after payment succeeds/fails/is cancelled. |
| `types/index.ts` | Added `PaymentMethod`/`PaymentMethodType` types. |

## Running it

```bash
cd backend
npm install
cp .env.example .env      # already has working SSLCommerz sandbox credentials
npx prisma migrate deploy
npx prisma generate
npm run start:dev
```

```bash
cd frontend
npm install
npm run dev
```

Then, on the Wallet page: add a bKash/Nagad/etc. account under **Payment
Methods**, then use the **Deposit** form (pick SSLCommerz + a wallet) or the
**Withdraw** form (pick a saved account).

## Important note on the migration file

I could not run `npx prisma migrate dev` or `npx prisma generate` myself in
my sandboxed environment — Prisma needs to download an engine binary from
`binaries.prisma.sh`, which my environment's network allowlist blocks. The
migration SQL in `prisma/migrations/20260802120000_sslcommerz_payment_methods/`
was written by hand, carefully matching the exact style/format of the other
migrations already in this project (and I cross-checked every field name
against the schema by hand). **Please run `npx prisma migrate deploy` (or
`migrate dev` if you're still iterating) yourself and confirm it applies
cleanly** — on your machine, with normal internet access, this should just
work, but it's the one part of this integration I couldn't execute and watch
run end-to-end myself.

## Testing

Unit tests were added/updated for every new/changed service:
`sslcommerz.service.spec.ts`, `payment-method.service.spec.ts`,
`deposit.service.spec.ts` (SSLCommerz cases added), `withdrawal.service.spec.ts`
(payment-method resolution cases added). Same limitation as above applies:
I verified these are correct TypeScript by hand and cross-referenced every
Prisma field/enum against the schema, but couldn't execute `npm test` myself
since that also requires a generated Prisma client. Run `npx prisma generate`
first, then `npm test` — they should pass.

## Verified against SSLCommerz's real API

I cross-checked the integration against SSLCommerz's official documentation
(`developer.sslcommerz.com/doc/v4`) via web search while building this:
endpoint paths (`gwprocess/v4/api.php`, `validator/api/validationserverAPI.php`,
`validator/api/merchantTransIDvalidationAPI.php`), field names (`cus_add1`,
`multi_card_name`, `value_a`–`value_d`, etc.), and the recommended flow
(always re-validate server-side via the Order Validation API rather than
trusting the raw redirect/IPN body) all match what's implemented here.
