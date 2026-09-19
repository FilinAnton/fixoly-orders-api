# Fixoly Orders API

A production-style REST API for window replacement orders and Stripe Connect payments. The project uses NestJS, PostgreSQL, Prisma, DTO validation, JWT authentication, idempotent payment operations, signed webhooks, and automated tests.

## What is implemented

- PostgreSQL schema and committed Prisma migration;
- `orders` table with UUID identifiers, timestamps, constrained window types, and statuses;
- registration and login with hashed passwords and signed JWT access tokens;
- JWT protection for all order endpoints;
- order creation with strict request validation;
- list endpoint with status filtering and pagination;
- order lookup by UUID;
- status updates;
- optional order deletion endpoint;
- consistent `400`, `401`, `404`, and `409` responses;
- database-level positive-dimension constraint in addition to DTO validation;
- Swagger/OpenAPI documentation;
- unit tests for creation, filtering/pagination, status changes, and missing orders;
- end-to-end coverage for registration, JWT access, and the order lifecycle;
- Docker Compose configuration for local PostgreSQL.
- Stripe Express connected-account onboarding and live status refresh;
- destination charges with manual capture, a 95% contractor transfer, and a 5% platform fee;
- explicit authorization cancellation before capture;
- signed raw-body Stripe webhooks with durable `event.id` deduplication;
- payment/dispute status persistence and idempotency keys for Stripe writes;
- focused tests for PaymentIntent creation, capture, and invalid capture state.

## Technology

- Node.js 20+
- NestJS 11
- TypeScript 5
- PostgreSQL 17
- Prisma 6
- Passport JWT
- class-validator
- Jest
- Stripe Node SDK

## Quick start with Docker PostgreSQL

### 1. Install dependencies

```bash
pnpm install
```

### 2. Create the environment file

```bash
cp .env.example .env
```

Change `JWT_SECRET` in `.env` to a random value with at least 32 characters. Add Stripe test-mode keys and the Connect return URLs described below. The default database URL already matches the Docker Compose service.

### 3. Start PostgreSQL

```bash
docker compose up -d postgres
```

### 4. Generate the Prisma client and apply migrations

```bash
pnpm prisma:generate
pnpm db:deploy
```

For local schema development, `pnpm db:migrate` can be used instead of `pnpm db:deploy`.

### 5. Start the API

```bash
pnpm start:dev
```

The API is available at `http://localhost:3000/api`.

Swagger UI is available at `http://localhost:3000/docs`.

## Environment variables

| Variable                     | Required | Description                                               |
| ---------------------------- | -------- | --------------------------------------------------------- |
| `DATABASE_URL`               | yes      | PostgreSQL connection string                              |
| `JWT_SECRET`                 | yes      | Secret used to sign access tokens; at least 32 characters |
| `JWT_EXPIRES_IN_SECONDS`     | no       | Access-token lifetime in seconds; defaults to `3600`      |
| `STRIPE_SECRET_KEY`          | yes      | Stripe test secret key (`sk_test_...`)                    |
| `STRIPE_WEBHOOK_SECRET`      | yes      | Signing secret printed by `stripe listen` (`whsec_...`)   |
| `STRIPE_CONNECT_REFRESH_URL` | yes      | Absolute URL used when Connect onboarding must restart    |
| `STRIPE_CONNECT_RETURN_URL`  | yes      | Absolute URL used after Connect onboarding                |
| `PORT`                       | no       | HTTP port; defaults to `3000`                             |

The application fails fast for an invalid PostgreSQL URL, a short JWT secret, non-test Stripe credentials, or invalid Connect URLs. No real Stripe key is committed.

## API

Public endpoints:

| Method | Endpoint               | Description                         |
| ------ | ---------------------- | ----------------------------------- |
| `GET`  | `/api/health`          | Process health check                |
| `POST` | `/api/auth/register`   | Create an account and receive a JWT |
| `POST` | `/api/auth/login`      | Log in and receive a JWT            |
| `POST` | `/api/webhooks/stripe` | Receive and verify Stripe events    |

Protected endpoints require `Authorization: Bearer <token>`:

| Method   | Endpoint                                   | Description                                            |
| -------- | ------------------------------------------ | ------------------------------------------------------ |
| `GET`    | `/api/orders`                              | List orders with optional status filter and pagination |
| `GET`    | `/api/orders/:id`                          | Get one order by UUID                                  |
| `POST`   | `/api/orders`                              | Create an order                                        |
| `PATCH`  | `/api/orders/:id/status`                   | Change order status                                    |
| `DELETE` | `/api/orders/:id`                          | Delete an order                                        |
| `POST`   | `/api/orders/:id/complete`                 | Capture authorization and complete the order           |
| `POST`   | `/api/contractors/connect`                 | Create or reuse the caller's Express account           |
| `GET`    | `/api/contractors/connect/status`          | Refresh the caller's Stripe onboarding state           |
| `GET`    | `/api/contractors/connect/onboarding-link` | Create a single-use onboarding URL                     |
| `POST`   | `/api/payments/create-intent`              | Create a manual-capture destination PaymentIntent      |
| `POST`   | `/api/payments/:id/cancel`                 | Cancel an authorization that has not been captured     |

Accepted window types:

- `casement`
- `awning`
- `tilt_turn`
- `sliding`

Accepted statuses:

- `new`
- `in_progress`
- `completed`

## Request examples

### Register

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "engineer@example.com",
    "password": "StrongPassword123!"
  }'
```

The response contains `accessToken`. Export it for the next requests:

```bash
export TOKEN='paste-the-access-token-here'
```

### Create an order

```bash
curl -X POST http://localhost:3000/api/orders \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "clientName": "Jane Smith",
    "address": "42 King Street, Toronto, ON",
    "windowType": "tilt_turn",
    "width": 120.5,
    "height": 140
  }'
```

New orders receive the `new` status from the database default.

### List and filter orders

```bash
curl 'http://localhost:3000/api/orders?status=in_progress&page=1&limit=20' \
  -H "Authorization: Bearer $TOKEN"
```

Response shape:

```json
{
  "data": [],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 0,
    "totalPages": 0
  }
}
```

### Get an order

```bash
curl http://localhost:3000/api/orders/ORDER_UUID \
  -H "Authorization: Bearer $TOKEN"
```

### Change status

```bash
curl -X PATCH http://localhost:3000/api/orders/ORDER_UUID/status \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"status":"in_progress"}'
```

### Delete an order

```bash
curl -i -X DELETE http://localhost:3000/api/orders/ORDER_UUID \
  -H "Authorization: Bearer $TOKEN"
```

Successful deletion returns `204 No Content`.

## Stripe Connect payment flow

This implementation intentionally uses a **destination charge with manual capture**. It does not use Separate Charges and Transfers.

1. An authenticated contractor creates an Express connected account.
2. The API creates a single-use onboarding link. Stripe hosts the KYC form.
3. `POST /api/payments/create-intent` creates a PaymentIntent with `capture_method=manual`, `transfer_data.destination`, and a 5% `application_fee_amount`.
4. The client confirms the card. The amount is authorized and the PaymentIntent becomes `requires_capture`; no funds are captured yet.
5. `POST /api/orders/:id/complete` captures the authorization. Stripe routes 95% to the connected account and keeps 5% as the platform application fee.
6. Signed webhooks reconcile local payment, account, and dispute state. Duplicate event IDs are acknowledged without applying the change again.

Manual capture is delayed card capture, not a legally regulated escrow account. Card authorizations expire; Stripe commonly provides a limited capture window that varies by payment method and network.

### Start the Stripe webhook listener

Install and authenticate the Stripe CLI, then forward test events to the raw-body endpoint:

```bash
stripe login
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

Copy the printed `whsec_...` value into `STRIPE_WEBHOOK_SECRET` and restart the API.

### Create and onboard a contractor

```bash
curl -X POST http://localhost:3000/api/contractors/connect \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"country":"CA"}'

curl http://localhost:3000/api/contractors/connect/onboarding-link \
  -H "Authorization: Bearer $TOKEN"

curl http://localhost:3000/api/contractors/connect/status \
  -H "Authorization: Bearer $TOKEN"
```

Open the returned onboarding URL once and complete Stripe's test onboarding. Use the `contractorId` from the status response in the next request.

### Authorize a card without capturing it

```bash
curl -X POST http://localhost:3000/api/payments/create-intent \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: order-payment-$ORDER_ID" \
  -d "{\"orderId\":\"$ORDER_ID\",\"contractorId\":\"$CONTRACTOR_ID\",\"amount\":25000,\"currency\":\"cad\"}"
```

The amount is expressed in the smallest currency unit, so `25000` CAD means CAD 250.00. Save the returned `stripePaymentIntentId` from the database or Stripe Dashboard and confirm it with Stripe's test payment method:

```bash
curl -X POST "https://api.stripe.com/v1/payment_intents/$PAYMENT_INTENT_ID/confirm" \
  -u "$STRIPE_SECRET_KEY:" \
  -d payment_method=pm_card_visa
```

The PaymentIntent should now be `requires_capture`; the webhook updates the local payment to the same state.

### Capture on order completion

```bash
curl -X POST "http://localhost:3000/api/orders/$ORDER_ID/complete" \
  -H "Authorization: Bearer $TOKEN"
```

The response includes the total amount, 5% platform fee, 95% contractor amount, Stripe PaymentIntent ID, and final status. Retrying the completion endpoint is safe: an already captured order returns `already_captured` rather than charging twice.

### Cancel before capture

```bash
curl -X POST "http://localhost:3000/api/payments/$PAYMENT_ID/cancel" \
  -H "Authorization: Bearer $TOKEN"
```

### Handled webhook events

- `payment_intent.amount_capturable_updated` records card authorization;
- `payment_intent.succeeded` records capture and the Stripe charge ID;
- `account.updated` refreshes onboarding and payout readiness;
- `charge.dispute.created` marks the payment as disputed.

The Stripe signature is verified with `constructEvent` against the untouched raw request body. Every event is claimed in `webhook_events` by its unique Stripe event ID. Processed/in-flight duplicates are acknowledged immediately; failed events can be retried safely and their last error is retained.

## Validation and errors

The global validation pipeline:

- removes no unknown fields and rejects them instead;
- converts explicit numeric query/body values where DTOs require numbers;
- validates enum values;
- requires positive width and height with at most two decimal places;
- validates UUID route parameters;
- rejects invalid credentials with `401`;
- returns `404` for missing orders;
- returns `409` for duplicate registration emails.

Example validation response:

```json
{
  "message": ["width must not be less than 0.01"],
  "error": "Bad Request",
  "statusCode": 400
}
```

## Quality checks

```bash
pnpm prisma:generate
pnpm lint
pnpm test
pnpm test:e2e
pnpm build
```

Coverage report:

```bash
pnpm test:cov
```

## Project structure

```text
prisma/
  migrations/          committed PostgreSQL migration
  schema.prisma        database model and enums
src/
  auth/                registration, login, JWT strategy and guard
  common/filters/      database error mapping
  orders/              DTOs, controller, service and unit tests
  prisma/              shared Prisma lifecycle service
  app.module.ts
  main.ts
```

## Design notes

- The API uses camelCase JSON and maps it to the required snake_case PostgreSQL columns.
- Status and window type are PostgreSQL enums, so invalid domain values cannot be stored even outside the API.
- Width and height are checked in both the API and the database migration.
- Passwords are hashed with bcrypt using 12 rounds and are never returned by the API.
- JWT authentication is intentionally self-contained for this assessment. A production deployment should add refresh-token rotation, rate limiting, secret management, audit logging, and HTTPS termination.
- Pagination is capped at 100 records per request to avoid unbounded reads.
