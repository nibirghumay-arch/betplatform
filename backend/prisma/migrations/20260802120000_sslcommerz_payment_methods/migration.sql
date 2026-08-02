-- CreateEnum
CREATE TYPE "PaymentMethodType" AS ENUM ('BKASH', 'NAGAD', 'ROCKET', 'UPAY', 'MCASH', 'TAP', 'BANK', 'CARD');

-- AlterTable: SSLCommerz-specific deposit tracking fields
ALTER TABLE "deposits" ADD COLUMN "ssl_val_id" TEXT;
ALTER TABLE "deposits" ADD COLUMN "payment_channel" TEXT;

-- AlterTable: link a withdrawal to a saved payment method
ALTER TABLE "withdrawals" ADD COLUMN "payment_method_id" TEXT;

-- CreateTable
CREATE TABLE "payment_methods" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "PaymentMethodType" NOT NULL,
    "account_number" TEXT NOT NULL,
    "account_holder" TEXT,
    "bank_name" TEXT,
    "branch_name" TEXT,
    "routing_number" TEXT,
    "label" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_methods_user_id_is_default_idx" ON "payment_methods"("user_id", "is_default");

-- CreateIndex
CREATE INDEX "payment_methods_user_id_type_idx" ON "payment_methods"("user_id", "type");

-- AddForeignKey
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;
