-- CreateEnum
CREATE TYPE "ReferralRewardStatus" AS ENUM ('PENDING', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BonusType" AS ENUM ('WELCOME', 'DEPOSIT', 'REFERRAL', 'PROMOTION', 'VIP_TIER', 'CASHBACK');

-- CreateEnum
CREATE TYPE "BonusStatus" AS ENUM ('PENDING_CLAIM', 'ACTIVE', 'WAGERING', 'COMPLETED', 'FORFEITED', 'EXPIRED', 'CANCELLED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "referral_code" TEXT;

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "referrals" (
    "id" TEXT NOT NULL,
    "referrer_id" TEXT NOT NULL,
    "referred_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_rewards" (
    "id" TEXT NOT NULL,
    "referral_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "amount" DECIMAL(18,8) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "ReferralRewardStatus" NOT NULL DEFAULT 'PENDING',
    "reward_type" TEXT NOT NULL,
    "transaction_id" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMP(3),

    CONSTRAINT "referral_rewards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vip_levels" (
    "id" TEXT NOT NULL,
    "tier" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "min_wager_usd" DECIMAL(18,2) NOT NULL,
    "bonus_amount" DECIMAL(18,2) NOT NULL,
    "cashback_rate" DECIMAL(5,4) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vip_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vip_progress" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "current_tier" INTEGER NOT NULL DEFAULT 0,
    "total_wager_usd" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "period_wager_usd" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "last_promoted_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vip_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bonus_rules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bonus_type" "BonusType" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "trigger_event" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "max_claims_per_user" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bonus_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bonuses" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "bonus_rule_id" TEXT,
    "bonus_type" "BonusType" NOT NULL,
    "status" "BonusStatus" NOT NULL DEFAULT 'PENDING_CLAIM',
    "amount" DECIMAL(18,8) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "wagering_requirement" DECIMAL(18,8) NOT NULL,
    "wagered_amount" DECIMAL(18,8) NOT NULL DEFAULT 0,
    "transaction_id" TEXT,
    "expires_at" TIMESTAMP(3),
    "activated_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bonuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bonus_claims" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "bonus_rule_id" TEXT NOT NULL,
    "bonus_id" TEXT,
    "claimed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bonus_claims_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "referrals_referred_id_key" ON "referrals"("referred_id");

-- CreateIndex
CREATE INDEX "referrals_referrer_id_idx" ON "referrals"("referrer_id");

-- CreateIndex
CREATE UNIQUE INDEX "referral_rewards_transaction_id_key" ON "referral_rewards"("transaction_id");

-- CreateIndex
CREATE INDEX "referral_rewards_referral_id_idx" ON "referral_rewards"("referral_id");

-- CreateIndex
CREATE INDEX "referral_rewards_user_id_status_idx" ON "referral_rewards"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "vip_levels_tier_key" ON "vip_levels"("tier");

-- CreateIndex
CREATE UNIQUE INDEX "vip_progress_user_id_key" ON "vip_progress"("user_id");

-- CreateIndex
CREATE INDEX "bonus_rules_trigger_event_is_active_idx" ON "bonus_rules"("trigger_event", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "bonuses_transaction_id_key" ON "bonuses"("transaction_id");

-- CreateIndex
CREATE INDEX "bonuses_user_id_status_idx" ON "bonuses"("user_id", "status");

-- CreateIndex
CREATE INDEX "bonuses_expires_at_idx" ON "bonuses"("expires_at");

-- CreateIndex
CREATE INDEX "bonus_claims_user_id_bonus_rule_id_idx" ON "bonus_claims"("user_id", "bonus_rule_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_referral_code_key" ON "users"("referral_code");

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_id_fkey" FOREIGN KEY ("referrer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referred_id_fkey" FOREIGN KEY ("referred_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_referral_id_fkey" FOREIGN KEY ("referral_id") REFERENCES "referrals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vip_progress" ADD CONSTRAINT "vip_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vip_progress" ADD CONSTRAINT "vip_progress_current_tier_fkey" FOREIGN KEY ("current_tier") REFERENCES "vip_levels"("tier") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bonuses" ADD CONSTRAINT "bonuses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bonuses" ADD CONSTRAINT "bonuses_bonus_rule_id_fkey" FOREIGN KEY ("bonus_rule_id") REFERENCES "bonus_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bonuses" ADD CONSTRAINT "bonuses_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bonus_claims" ADD CONSTRAINT "bonus_claims_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bonus_claims" ADD CONSTRAINT "bonus_claims_bonus_rule_id_fkey" FOREIGN KEY ("bonus_rule_id") REFERENCES "bonus_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

