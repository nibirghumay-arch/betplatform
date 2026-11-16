-- This platform operates exclusively in BDT.
-- Existing numeric balances and transaction amounts are intentionally preserved;
-- all historical and active records are re-denominated as BDT as requested.
-- Run atomically as a Prisma migration; no amount multiplication/division occurs.
BEGIN;
UPDATE "wallets" SET "currency" = 'BDT' WHERE "currency" <> 'BDT';
UPDATE "ledger_entries" SET "currency" = 'BDT' WHERE "currency" <> 'BDT';
UPDATE "transactions" SET "currency" = 'BDT' WHERE "currency" <> 'BDT';
UPDATE "game_sessions" SET "currency" = 'BDT' WHERE "currency" <> 'BDT';
UPDATE "deposits" SET "currency" = 'BDT' WHERE "currency" <> 'BDT';
UPDATE "withdrawals" SET "currency" = 'BDT' WHERE "currency" <> 'BDT';
UPDATE "referral_rewards" SET "currency" = 'BDT' WHERE "currency" <> 'BDT';
UPDATE "bonuses" SET "currency" = 'BDT' WHERE "currency" <> 'BDT';
ALTER TABLE "wallets" ALTER COLUMN "currency" SET DEFAULT 'BDT';
ALTER TABLE "ledger_entries" ALTER COLUMN "currency" SET DEFAULT 'BDT';
ALTER TABLE "transactions" ALTER COLUMN "currency" SET DEFAULT 'BDT';
ALTER TABLE "game_sessions" ALTER COLUMN "currency" SET DEFAULT 'BDT';
ALTER TABLE "deposits" ALTER COLUMN "currency" SET DEFAULT 'BDT';
ALTER TABLE "withdrawals" ALTER COLUMN "currency" SET DEFAULT 'BDT';
ALTER TABLE "referral_rewards" ALTER COLUMN "currency" SET DEFAULT 'BDT';
ALTER TABLE "bonuses" ALTER COLUMN "currency" SET DEFAULT 'BDT';
COMMIT;
