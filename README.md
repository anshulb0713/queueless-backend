# QueueLess backend

REST and Socket.IO backend for the QueueLess MVP. It implements the TRD's queue lifecycle, including sequential token generation, queue-position and wait-time recalculation, staff actions, dashboard data, and public-display data.

## Confirmed technology

- Node.js 22+ and TypeScript
- Express 5 REST API
- Supabase PostgreSQL, accessed through a server-only `DATABASE_URL` using `pg`
- Socket.IO for live queue events
- JWT for staff/admin access, bcrypt password verification, Zod validation

Supabase is the database and migration host, not the public API surface: the browser and Android app call this backend. This preserves the transactional locking needed to prevent duplicate token numbers or two staff members calling the same token. The migration enables RLS and does not grant `anon` or `authenticated` roles table access.

## Setup

1. Create a Supabase project and copy its direct Postgres connection string into `.env` as `DATABASE_URL`.
2. Copy `.env.example` to `.env`, set a long `JWT_SECRET`, then install dependencies: `npm install`.
3. Install the Supabase CLI, authenticate, link the project, then apply the schema with `supabase db push`.
4. Seed the required demo data with `npm run db:seed`.
5. Run `npm run dev`.

The demo users are `admin@queueless.com` / `admin123` and `staff@queueless.com` / `staff123`.

## Real-time client contract

On Socket.IO connection, send `branch:join` with the branch UUID. Subscribe to `token-created`, `token-called`, `token-started`, `token-completed`, `token-skipped`, `token-waiting` (restore), `token-cancelled`, and `queue-updated`.

## Main API routes

- `POST /api/auth/login`; `GET /api/health`
- `GET /api/branches`, `GET /api/branches/:branchId/services`
- `POST /api/tokens`, `GET /api/tokens/:tokenId`, `GET /api/tokens/:tokenId/status`, `PATCH /api/tokens/:tokenId/cancel`
- `GET /api/queues/:branchId`, `POST /api/queues/:branchId/call-next`
- `PATCH /api/tokens/:tokenId/{call,start,complete,skip,restore}`
- `GET /api/dashboard/{summary,analytics,current-serving}`, `GET /api/counters`, `GET /api/public-display/:branchId`

All staff actions require `Authorization: Bearer <token>`. Cancelling a token intentionally remains available to the customer app in the MVP; production should bind that endpoint to a signed customer-token claim.
