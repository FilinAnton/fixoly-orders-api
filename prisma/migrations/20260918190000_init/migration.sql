CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE "window_type" AS ENUM (
  'casement',
  'awning',
  'tilt_turn',
  'sliding'
);

CREATE TYPE "order_status" AS ENUM (
  'new',
  'in_progress',
  'completed'
);

CREATE TABLE "users" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "email" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "orders" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "client_name" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "window_type" "window_type" NOT NULL,
  "width" DOUBLE PRECISION NOT NULL,
  "height" DOUBLE PRECISION NOT NULL,
  "status" "order_status" NOT NULL DEFAULT 'new',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "orders_positive_dimensions" CHECK ("width" > 0 AND "height" > 0)
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE INDEX "orders_status_idx" ON "orders"("status");
CREATE INDEX "orders_created_at_idx" ON "orders"("created_at");
