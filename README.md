# Roomwell

Roomwell is a local meeting-room booking app for a fictional coworking venue in Podgorica. Members browse availability, reserve one or more consecutive half-hour slots, and cancel future bookings. The seeded venue admin creates and edits rooms.

## Run locally

Requires Node 22.13+, pnpm 10, and PostgreSQL 14+ with `btree_gist` available. Use a local database and a separate test database. The database user needs permission to run migrations and enable `btree_gist`.

```sh
createdb room_booking
createdb room_booking_test
cp .env.example .env
# Edit .env to match your local Postgres credentials.
pnpm install --frozen-lockfile
pnpm db:setup
pnpm dev
```

Open **http://127.0.0.1:3000**. Choose Alex Morgan or Sam Rivera to try member bookings. Choose Jamie Lee to open **Manage rooms**. The setup command adds fictional rooms, demo accounts, and a few reservations the first time it runs.

## How demo sign-in works

The account picker lists fictional accounts from the Postgres `members` table. Selecting one asks Express to issue a signed, HTTP-only cookie containing the member ID and expiry. The browser sends that cookie on later requests, and Express verifies it before reading the ID. Postgres stores the demo accounts, rooms, and bookings. The cookie carries the session, so there is no sessions table.

The cookie lasts up to 12 hours and stops working after an API restart because the signing key lives in memory. The picker is passwordless and includes the seeded admin. Both development servers bind to loopback for local use.

## Verify

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm format:check
```

The API tests run migrations against `TEST_DATABASE_URL` and exercise real Postgres. They cover member and admin permissions, concurrent reservation conflicts, cancellation, adjacent reservations, and the venue's booking hours.

## Workspace

- `apps/web/app/components` — The booking desk and its room, booking, and admin views. Shared requests and formatting live in `app/lib`.
- `apps/api/src/app.ts` — Composes Express and mounts the routers. The `modules/auth`, `modules/rooms`, and `modules/bookings` folders contain the routes for each feature.
- `packages/db` — Kysely client and types in `src`, SQL schema in `migrations`, and demo records in `src/seed.ts`.

Bookings are free and run from 08:00 to 20:00 in the venue's time zone. PostgreSQL keeps active bookings from overlapping. Cancelled bookings remain visible to their owner.
