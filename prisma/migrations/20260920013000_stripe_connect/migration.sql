CREATE TYPE "payment_status" AS ENUM (
  'pending',
  'requires_action',
  'requires_capture',
  'processing',
  'succeeded',
  'canceled',
  'failed',
  'disputed'
);

CREATE TYPE "webhook_processing_status" AS ENUM (
  'processing',
  'processed',
  'failed'
);

CREATE TABLE "contractors" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "stripe_account_id" TEXT NOT NULL,
  "charges_enabled" BOOLEAN NOT NULL DEFAULT false,
  "payouts_enabled" BOOLEAN NOT NULL DEFAULT false,
  "details_submitted" BOOLEAN NOT NULL DEFAULT false,
  "requirements_due" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "contractors_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "order_id" UUID NOT NULL,
  "contractor_id" UUID NOT NULL,
  "stripe_payment_intent_id" TEXT NOT NULL,
  "stripe_charge_id" TEXT,
  "idempotency_key" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "application_fee_amount" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "status" "payment_status" NOT NULL DEFAULT 'pending',
  "authorized_at" TIMESTAMP(3),
  "captured_at" TIMESTAMP(3),
  "canceled_at" TIMESTAMP(3),
  "dispute_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payments_positive_amount" CHECK ("amount" > 0),
  CONSTRAINT "payments_valid_fee" CHECK (
    "application_fee_amount" >= 0
    AND "application_fee_amount" < "amount"
  )
);

CREATE TABLE "webhook_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "stripe_event_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "status" "webhook_processing_status" NOT NULL DEFAULT 'processing',
  "attempts" INTEGER NOT NULL DEFAULT 1,
  "processed_at" TIMESTAMP(3),
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "contractors_user_id_key" ON "contractors"("user_id");
CREATE UNIQUE INDEX "contractors_stripe_account_id_key" ON "contractors"("stripe_account_id");
CREATE UNIQUE INDEX "payments_order_id_key" ON "payments"("order_id");
CREATE UNIQUE INDEX "payments_stripe_payment_intent_id_key" ON "payments"("stripe_payment_intent_id");
CREATE UNIQUE INDEX "payments_stripe_charge_id_key" ON "payments"("stripe_charge_id");
CREATE UNIQUE INDEX "payments_idempotency_key_key" ON "payments"("idempotency_key");
CREATE UNIQUE INDEX "payments_dispute_id_key" ON "payments"("dispute_id");
CREATE INDEX "payments_status_idx" ON "payments"("status");
CREATE INDEX "payments_contractor_id_idx" ON "payments"("contractor_id");
CREATE UNIQUE INDEX "webhook_events_stripe_event_id_key" ON "webhook_events"("stripe_event_id");
CREATE INDEX "webhook_events_status_idx" ON "webhook_events"("status");

ALTER TABLE "contractors"
  ADD CONSTRAINT "contractors_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_contractor_id_fkey"
  FOREIGN KEY ("contractor_id") REFERENCES "contractors"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
