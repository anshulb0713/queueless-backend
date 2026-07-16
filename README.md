# QueueLess backend

REST backend for the QueueLess MVP. It implements the TRD's queue lifecycle, including sequential token generation, queue-position and wait-time recalculation, staff actions, dashboard data, and public-display data.

## Confirmed technology

- Node.js 22+ and TypeScript
- Express 5 REST API
- Supabase PostgreSQL, accessed through a server-only `DATABASE_URL` using `pg`
- REST polling for live queue updates
- Supabase Google OAuth for customer sign-in/sign-up; JWT and password login for staff/admin
- bcrypt password verification and Zod validation

Supabase is the database and migration host, not the public API surface: the browser and Android app call this backend. This preserves the transactional locking needed to prevent duplicate token numbers or two staff members calling the same token. The migration enables RLS and does not grant `anon` or `authenticated` roles table access.

## Setup

1. Create a Supabase project and copy its direct Postgres connection string into `.env` as `DATABASE_URL`.
2. Copy `.env.example` to `.env`, set a long `JWT_SECRET`, then install dependencies: `npm install`.
3. Install the Supabase CLI, authenticate, link the project, then apply the schema with `supabase db push`.
4. Seed the required demo data with `npm run db:seed`.
5. Run `npm run dev`.

The demo users are `admin@queueless.com` / `admin123` and `staff@queueless.com` / `staff123`.

## Authentication model

- **Customers:** Google Sign-In only. The Android app authenticates with Supabase Auth using Google OAuth, then sends the Supabase access token and mobile number to `POST /api/auth/customer/session`. The API verifies it with Supabase Auth and upserts a `customer` profile. No customer password endpoint exists.
- **Staff and admins:** continue using `POST /api/auth/login` with the preconfigured dashboard email and password. The API issues its existing staff/admin JWT for protected management routes.

Do not use `user_metadata` to authorize roles. The customer session endpoint always writes the `customer` role itself; staff/admin roles remain server-managed.

## Project structure

```text
src/
├── config/          # environment parsing and application configuration
├── database/        # PostgreSQL pool and transaction helper
├── middlewares/     # authentication and central error/response helpers
├── routes/          # REST API route definitions
├── services/        # queue state machine and recalculation rules
├── types/           # shared TypeScript domain types
└── server.ts         # Express application bootstrap and graceful shutdown
supabase/
├── migrations/      # versioned database schema changes
└── seed.sql          # deterministic demo users, branch, services, counters
```

## Live-update polling contract

For hackathon reliability, clients poll instead of holding a Socket.IO connection:

- Customer tracking screen: `GET /api/tokens/:tokenId/status` every 3 seconds while the token is active.
- Staff queue dashboard: `GET /api/queues/:branchId` and `GET /api/dashboard/summary?branchId=:branchId` every 3–5 seconds.
- Public display: `GET /api/public-display/:branchId` every 3 seconds.

Stop polling once a token becomes `completed` or `cancelled`, and clear the interval when the screen is unmounted.

## Main API routes

- `POST /api/auth/login`; `GET /api/health`
- `POST /api/auth/customer/session` (Google-authenticated customer access token; body: `{ "mobile": "9876543210" }`)
- `GET /api/branches`, `GET /api/branches/:branchId/services`
- `POST /api/tokens`, `GET /api/tokens/:tokenId`, `GET /api/tokens/:tokenId/status`, `PATCH /api/tokens/:tokenId/cancel` (all require the owning customer’s Supabase Google token)
- `GET /api/queues/:branchId`, `POST /api/queues/:branchId/call-next`
- `PATCH /api/tokens/:tokenId/{call,start,complete,skip,restore}`, `PATCH /api/staff/tokens/:tokenId/cancel`
- `GET /api/dashboard/{summary,analytics,current-serving}`, `GET /api/counters`, `POST /api/counters`, `PUT /api/counters/:counterId`, `GET /api/public-display/:branchId`

All staff actions require `Authorization: Bearer <token>`. Cancelling a token intentionally remains available to the customer app in the MVP; production should bind that endpoint to a signed customer-token claim.
