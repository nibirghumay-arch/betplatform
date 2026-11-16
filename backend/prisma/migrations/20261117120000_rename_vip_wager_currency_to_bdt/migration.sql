-- BetPlatform uses BDT exclusively. Preserve numeric values while renaming
-- legacy USD-named VIP wager columns to their BDT equivalents.
BEGIN;

ALTER TABLE "vip_levels"
  RENAME COLUMN "min_wager_usd" TO "min_wager_bdt";

ALTER TABLE "vip_progress"
  RENAME COLUMN "total_wager_usd" TO "total_wager_bdt";

ALTER TABLE "vip_progress"
  RENAME COLUMN "period_wager_usd" TO "period_wager_bdt";

-- Existing bonus rules may contain a currency field in their JSON config.
UPDATE "bonus_rules"
SET "config" = jsonb_set("config", '{currency}', '"BDT"'::jsonb, true)
WHERE jsonb_typeof("config") = 'object'
  AND "config" ->> 'currency' = 'USD';

COMMIT;
