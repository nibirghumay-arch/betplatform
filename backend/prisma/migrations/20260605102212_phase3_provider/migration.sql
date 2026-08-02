-- CreateEnum
CREATE TYPE "GameSessionStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'EXPIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "game_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "game_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_definitions" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "description" TEXT,
    "thumbnail_url" TEXT,
    "game_url" TEXT NOT NULL,
    "rtp" DECIMAL(5,2),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "game_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "game_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" "GameSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "launch_url" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "game_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "game_categories_name_key" ON "game_categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "game_categories_slug_key" ON "game_categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "game_definitions_external_id_key" ON "game_definitions"("external_id");

-- CreateIndex
CREATE UNIQUE INDEX "game_definitions_slug_key" ON "game_definitions"("slug");

-- CreateIndex
CREATE INDEX "game_definitions_provider_id_is_active_idx" ON "game_definitions"("provider_id", "is_active");

-- CreateIndex
CREATE INDEX "game_definitions_category_id_idx" ON "game_definitions"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "game_sessions_token_key" ON "game_sessions"("token");

-- CreateIndex
CREATE INDEX "game_sessions_user_id_status_idx" ON "game_sessions"("user_id", "status");

-- CreateIndex
CREATE INDEX "game_sessions_token_idx" ON "game_sessions"("token");

-- CreateIndex
CREATE INDEX "game_sessions_game_id_idx" ON "game_sessions"("game_id");

-- AddForeignKey
ALTER TABLE "game_definitions" ADD CONSTRAINT "game_definitions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "game_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "game_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
