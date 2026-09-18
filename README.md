# Fixoly Orders API

A production-style REST API for managing window replacement orders. The project is built with NestJS, PostgreSQL, Prisma, DTO validation, JWT authentication, pagination, and automated tests.

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
- Docker Compose configuration for local PostgreSQL.

## Technology

- Node.js 20+
- NestJS 11
- TypeScript 5
- PostgreSQL 17
- Prisma 6
- Passport JWT
- class-validator
- Jest

## Quick start with Docker PostgreSQL

### 1. Install dependencies

```bash
pnpm install
```

### 2. Create the environment file

```bash
cp .env.example .env
```

Change `JWT_SECRET` in `.env` to a random value with at least 32 characters. The default database URL already matches the Docker Compose service.

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

| Variable                 | Required | Description                                               |
| ------------------------ | -------- | --------------------------------------------------------- |
| `DATABASE_URL`           | yes      | PostgreSQL connection string                              |
| `JWT_SECRET`             | yes      | Secret used to sign access tokens; at least 32 characters |
| `JWT_EXPIRES_IN_SECONDS` | no       | Access-token lifetime in seconds; defaults to `3600`      |
| `PORT`                   | no       | HTTP port; defaults to `3000`                             |

The application fails fast when `DATABASE_URL` is not PostgreSQL or when `JWT_SECRET` is too short.

## API

Public endpoints:

| Method | Endpoint             | Description                         |
| ------ | -------------------- | ----------------------------------- |
| `GET`  | `/api/health`        | Process health check                |
| `POST` | `/api/auth/register` | Create an account and receive a JWT |
| `POST` | `/api/auth/login`    | Log in and receive a JWT            |

Protected endpoints require `Authorization: Bearer <token>`:

| Method   | Endpoint                 | Description                                            |
| -------- | ------------------------ | ------------------------------------------------------ |
| `GET`    | `/api/orders`            | List orders with optional status filter and pagination |
| `GET`    | `/api/orders/:id`        | Get one order by UUID                                  |
| `POST`   | `/api/orders`            | Create an order                                        |
| `PATCH`  | `/api/orders/:id/status` | Change order status                                    |
| `DELETE` | `/api/orders/:id`        | Delete an order                                        |

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
