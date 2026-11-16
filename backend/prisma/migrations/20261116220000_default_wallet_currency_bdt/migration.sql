-- New user wallets use BDT, matching the BD Payment Gateway.
-- Existing wallet balances are deliberately not converted by this migration.
ALTER TABLE "wallets" ALTER COLUMN "currency" SET DEFAULT 'BDT';
