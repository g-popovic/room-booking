# Roomwell

Roomwell is a local meeting-room booking app for a fictional coworking venue in Podgorica. Anyone can browse availability. Members create an account with their email and a password, then reserve one or more consecutive half-hour slots and cancel future bookings. They can form teams, invite teammates to a booking, and see who's coming. The seeded venue admin creates and edits rooms.

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

Open **http://127.0.0.1:3000** and choose **Create account**, or **Sign in** with one of the demo accounts. The setup command adds fictional rooms, the demo accounts, and a few reservations the first time it runs.

| Account     | Email                 | Password        |
| ----------- | --------------------- | --------------- |
| Alex Morgan | `alex@roomwell.test`  | `roomwell-demo` |
| Sam Rivera  | `sam@roomwell.test`   | `roomwell-demo` |
| Jamie Lee   | `jamie@roomwell.test` | `roomwell-demo` |

Alex and Sam are members. Jamie is the venue admin and can open **Manage rooms**. All three are in a team called **The Commons**, which Jamie owns, so they can invite each other to bookings straight away. Setup adds the team to existing databases too, and puts back any demo account that left it. If your database was set up before sign-in, teams, and booking participants existed, run `pnpm db:setup` again. It applies the new migrations, gives the demo accounts their email and password, and adds the team.

## How sign-in works

- **Accounts.** `POST /api/auth/register` creates a member from a name, email, and password of 8–128 characters, then signs them in. Emails are trimmed and lowercased, so each address can have only one account, whatever its case. New accounts are never admins. The only admin is the seeded one, and the `is_admin` flag can only be changed in the database.
- **Passwords.** Passwords are hashed with scrypt from Node's `crypto` module, with a random salt for each password. `members.password_hash` stores the parameters alongside the hash, so they can be raised later. The demo seed uses the same code (`packages/db/src/password.ts`).
- **Sessions.** Signing in creates a random 256-bit token. The browser keeps it in an HTTP-only, `SameSite=Strict` cookie that lasts 14 days. Postgres stores only the token's SHA-256 hash in `sessions`, the same way calendar links work. Express looks up the session on every request. Sessions therefore survive API restarts, signing out deletes the session so a copied cookie stops working, and a change to the admin flag applies immediately. Signing in or registering replaces the browser's previous session.
- **Failed sign-ins.** A wrong email and a wrong password give the same error and take about as long, so signing in doesn't reveal which emails have accounts. Registering does: it says when an email is already taken.
- **Rate limits.** [`express-rate-limit`](https://github.com/express-rate-limit/express-rate-limit) middleware on the two routes counts only the responses that help an attacker. Refused requests get a 429 with a `Retry-After` header. The counts are kept in memory, so they reset when the API restarts.
  - Sign-in: after 10 wrong passwords for one email from one address within 15 minutes, that email is refused from that address until the window ends.
  - Registration: after 10 "already exists" answers to one address within an hour, that address can't register until the window ends. Successful sign-ups don't count, so many people on one network can still register.

- **Not built yet:** changing a password, signing out other devices, email verification, and password reset. The last two need email sending, which the app doesn't have.

Both development servers bind to loopback for local use. The API sees every browser as `127.0.0.1`, the address of Next's dev server, so locally the rate limits apply to all browsers together. Before serving Roomwell anywhere else:

- Add `secure: true` to the session cookie (`apps/api/src/modules/auth/session.ts`).
- Put the API behind a proxy that overwrites `X-Forwarded-For`, and set Express's `trust proxy` to exactly that proxy. Don't trust Next's rewrite for this: it passes a client's `X-Forwarded-For` through unchanged, so anyone could claim a new address on each attempt.
- If the API runs as more than one process, give both rate limiters a shared store, such as Redis.

## Teams

Signed-in members can create teams under **Teams** and invite people to them by email. Whoever creates a team is its first owner.

- **Roles.** Owners can rename the team, invite people, cancel invitations, make members owners or owners members, remove members, and delete the team. Members can see the team and its members' names and emails, and leave. A team always has at least one owner: the last owner can't step down or leave, only delete the team. The venue admin has no special powers over teams.
- **Privacy.** To anyone outside a team, the team doesn't exist. Every route for a particular team answers 404 to non-members, and team names don't have to be unique, so trying a name reveals nothing.
- **Invitations.** An invitation is stored against the email address, not an account, and the invited person sees it under **Teams** when they sign in with that address. Inviting never looks the address up among accounts, so owners get the same answer whether or not it has one ("If … has a Roomwell account, or creates one by …, they'll see your invitation"). Someone who registers with the address later still sees the invitation. Owners do see when an invitation is declined.
- **Limits.** Invitations last 14 days. While an invitation is pending or declined, the same address can't be invited to that team again until it expires. Cancelled invitations don't block a new one, and nor does having been a member. A team can have at most 50 pending invitations.
- **Email isn't verified.** Whoever registers an address sees the invitations sent to it. Owners can see who joined and remove them.

The rules live in the database as well as the API (`packages/db/migrations/005_teams.sql`). A constraint trigger keeps every team with an owner. It locks the team's row before checking, so two owners stepping down at the same moment can't both succeed. An exclusion constraint enforces the 14-day re-invite rule. The API locks a team's row at the start of every change to it, so changes to one team happen one at a time.

## People on a booking

When booking, the organizer can invite people under **Who's coming?**: anyone who shares a team with them, one at a time or a whole team at once.

- **Answers.** Invited people see the booking in **My bookings** and answer **Going? Yes / No**. They can change their answer until the booking starts. Everyone on the booking sees the organizer and each person's answer: a green check for going, a red cross for not going, and grey for no reply yet. People see each other's names but not their emails, because they may not share a team.
- **Organizer.** The organizer is always going and isn't asked. Only the organizer can cancel the booking or change who's invited, until it starts. People who stay invited keep their answers. Someone who has since left the team stays on bookings they were already invited to, but only current teammates can be added.
- **Seats.** The organizer and everyone invited must fit the room's capacity, whatever they answered, because answers can change.
- **Calendar feed.** A member's calendar feed includes bookings they're invited to, unless they said no.

`packages/db/migrations/006_booking_participants.sql` stores invitations and answers. A trigger keeps a booking's organizer out of its participant list.

## Calendar sync

On **My bookings**, a signed-in member can choose **Connect Google Calendar**. Express creates a private iCalendar feed link and the page opens Google Calendar's "Add calendar" prompt in a new tab with the link filled in. The page also shows the link to copy into other calendar apps, and an **Other calendar app** link using `webcal://`.

- The link contains a random 256-bit token and nothing else. Postgres stores only its SHA-256 hash in `calendar_feeds`, next to the member ID. The API hashes the token from each request and looks up that hash to find the member. The link can't be shown again later; **Add to a calendar again** replaces it, and the previous link stops working.
- `GET /api/calendar/<token>.ics` needs no cookie, because calendar servers fetch it on their own schedule. It lists the member's active bookings from the last 12 months onward, including ones they're invited to and haven't declined. Cancelled bookings drop out, and calendar apps remove them on their next refresh.
- Google fetches the feed from its own servers, so a subscription only fills in once Roomwell is reachable from the internet. Locally, you can import a saved copy of the feed in Google Calendar (**Settings → Import**) to check parsing, or subscribe from Apple Calendar or Thunderbird, which can read `http://127.0.0.1:3000/...` and refresh on demand. Google refreshes subscriptions on its own schedule, which can take several hours.

## Verify

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm format:check
```

`pnpm test` runs the API and web tests. The API tests run migrations against `TEST_DATABASE_URL` and exercise real Postgres. They cover registration, sign-in, sessions (hashing, restarts, sign-out, and expiry), the sign-in and registration rate limits, teams (who can see and change what, the owner rule, invitations whether or not the address has an account, expiry, re-inviting, the invitation limit, and simultaneous changes), people on bookings (who can be invited, seats, answers, who can cancel or change the list, and the calendar feed), member and admin permissions, concurrent reservation conflicts, cancellation, adjacent reservations, the venue's booking hours, and the calendar feed: its file format, which bookings it lists, keeping each member's link separate, and replacing or turning off links. Unit tests cover password hashing. The web tests cover the calendar subscription links and how the Google Calendar tab is opened, including when the browser blocks it.

## Workspace

- `apps/web/app/components` — The booking desk and its room, booking, teams, and admin views, and the sign-in and registration screen used by `app/sign-in` and `app/register`. Shared requests and formatting live in `app/lib`.
- `apps/api/src/app.ts` — Composes Express and mounts the routers. `middleware/auth.ts` has `requireMember` and `requireAdmin`, which load the signed-in member from the session. The `modules/auth`, `modules/rooms`, `modules/bookings`, `modules/calendar`, and `modules/teams` folders contain the routes for each feature.
- `packages/db` — Kysely client and types in `src`, SQL schema in `migrations`, and demo records in `src/seed.ts`.

Bookings are free and run from 08:00 to 20:00 in the venue's time zone. PostgreSQL keeps active bookings from overlapping. The API saves bookings for a room one at a time, so when several members request the same time at once, one gets it and the others get a clear conflict instead of an error. Cancelled bookings remain visible to their owner.
