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

On Debian or Ubuntu, including the dev sandbox, `pnpm db:start` replaces the two `createdb` commands. Run it after creating `.env` and before `pnpm db:setup`. It creates or starts the local PostgreSQL cluster, sets the password of the user in `.env`, and creates both databases as UTF-8. Run it as root or as the cluster's owner. It's safe to repeat, so run it again whenever the machine restarts if nothing starts PostgreSQL automatically. If the cluster is gone, for example after the sandbox is reset, it creates a new one; run `pnpm db:setup` again afterwards to restore the tables and demo data. `pg_ctlcluster <version> main stop` stops the server.

Open **http://127.0.0.1:3000**. Choose Alex Morgan or Sam Rivera to try member bookings. Choose Jamie Lee to open **Manage rooms**. The setup command adds fictional rooms, demo accounts, and a few reservations the first time it runs.

## How demo sign-in works

The account picker lists fictional accounts from the Postgres `members` table. Selecting one asks Express to issue a signed, HTTP-only cookie containing the member ID and expiry. The browser sends that cookie on later requests, and Express verifies it before reading the ID. Postgres stores the demo accounts, rooms, and bookings. The cookie carries the session, so there is no sessions table.

The cookie lasts up to 12 hours and stops working after an API restart because the signing key lives in memory. The picker is passwordless and includes Jamie, the seeded admin. Express checks the member’s `is_admin` flag in Postgres when handling room changes. Both development servers bind to loopback for local use.

## Calendar sync

On **My bookings**, a signed-in member can choose **Connect Google Calendar**. Express creates a private iCalendar feed link and the page opens Google Calendar's "Add calendar" prompt in a new tab with the link filled in. The page also shows the link to copy into other calendar apps, and an **Other calendar app** link using `webcal://`.

- The link contains a random 256-bit token and nothing else. Postgres stores only its SHA-256 hash in `calendar_feeds`, next to the member ID. The API hashes the token from each request and looks up that hash to find the member. The link can't be shown again later; **Add to a calendar again** replaces it, and the previous link stops working.
- `GET /api/calendar/<token>.ics` needs no cookie, because calendar servers fetch it on their own schedule. It lists the member's active bookings from the last 12 months onward. Cancelled bookings drop out, and calendar apps remove them on their next refresh.
- Google fetches the feed from its own servers, so a subscription only fills in once Roomwell is reachable from the internet. Locally, you can import a saved copy of the feed in Google Calendar (**Settings → Import**) to check parsing, or subscribe from Apple Calendar or Thunderbird, which can read `http://127.0.0.1:3000/...` and refresh on demand. Google refreshes subscriptions on its own schedule, which can take several hours.

## Verify

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm format:check
```

`pnpm test` runs the API and web tests. The API tests run migrations against `TEST_DATABASE_URL` and exercise real Postgres. They cover member and admin permissions, concurrent reservation conflicts, cancellation, adjacent reservations, the venue's booking hours, and the calendar feed: its file format, which bookings it lists, keeping each member's link separate, and replacing or turning off links. The web tests cover the calendar subscription links and how the Google Calendar tab is opened, including when the browser blocks it.

## Workspace

- `apps/web/app/components` — The booking desk and its room, booking, and admin views. Shared requests and formatting live in `app/lib`.
- `apps/api/src/app.ts` — Composes Express and mounts the routers. The `modules/auth`, `modules/rooms`, `modules/bookings`, and `modules/calendar` folders contain the routes for each feature.
- `packages/db` — Kysely client and types in `src`, SQL schema in `migrations`, and demo records in `src/seed.ts`.

Bookings are free and run from 08:00 to 20:00 in the venue's time zone. PostgreSQL keeps active bookings from overlapping. Cancelled bookings remain visible to their owner.
