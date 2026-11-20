import type { DatabaseClient } from '@room-booking/db';
import { Router } from 'express';
import { z } from 'zod';

import type { MemberResponse } from '../../app-locals.js';
import { HttpError } from '../../http-error.js';
import { requireMember } from '../../middleware/auth.js';
import { emailAddress } from '../auth/email.js';

const INVITE_DAYS = 14;
const MAX_OPEN_INVITES = 50;

type Role = 'owner' | 'member';

const teamInput = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: 'Enter a team name.' })
    .max(80, { error: 'Use a team name of 80 characters or fewer.' }),
});
const roleInput = z.object({ role: z.enum(['owner', 'member']) });
const inviteInput = z.object({ email: emailAddress });

function parse<T>(schema: z.ZodType<T>, body: unknown) {
  const input = schema.safeParse(body);
  if (!input.success) throw new HttpError(400, input.error.issues[0].message);
  return input.data;
}

// IDs that aren't UUIDs can't match anything, so they're simply not found.
function uuidParam(value: string, notFound: string) {
  if (!z.uuid().safeParse(value).success) throw new HttpError(404, notFound);
  return value;
}

const teamNotFound = 'Team not found.';
const invitationNotFound = 'Invitation not found.';

// Runs a change to a team in a transaction that first locks the team's row,
// so changes to one team happen one at a time. The database's owner rule
// relies on that lock (see 005_teams.sql), and taking it first keeps
// concurrent changes from deadlocking. People outside the team get a 404, as
// if it didn't exist; members without the role they need get a 403.
function changeTeam<T>(
  db: DatabaseClient,
  teamId: string,
  memberId: string,
  needs: Role,
  change: (trx: DatabaseClient) => Promise<T>,
) {
  uuidParam(teamId, teamNotFound);

  return db.transaction().execute(async (trx) => {
    const team = await trx
      .selectFrom('teams')
      .select('id')
      .where('id', '=', teamId)
      .forNoKeyUpdate()
      .executeTakeFirst();

    const mine =
      team &&
      (await trx
        .selectFrom('team_members')
        .select('role')
        .where('team_id', '=', teamId)
        .where('member_id', '=', memberId)
        .executeTakeFirst());

    if (!mine) throw new HttpError(404, teamNotFound);
    if (needs === 'owner' && mine.role !== 'owner')
      throw new HttpError(403, 'Only team owners can do that.');

    return change(trx);
  });
}

// Invitations whose time is still running. A pending invitation past its
// expiry is treated as gone.
const isOpen = (now: Date) => (invite: { expires_at: Date }) =>
  invite.expires_at > now;

export const teamRoutes = Router();

teamRoutes.use(requireMember);

teamRoutes.get('/', async (_req, res: MemberResponse) => {
  const { db, member } = res.locals;

  const teams = await db
    .selectFrom('team_members as mine')
    .innerJoin('teams', 'teams.id', 'mine.team_id')
    .select((eb) => [
      'teams.id',
      'teams.name',
      'mine.role',
      eb
        .selectFrom('team_members as everyone')
        .whereRef('everyone.team_id', '=', 'teams.id')
        .select(eb.fn.countAll<string>().as('count'))
        .as('memberCount'),
    ])
    .where('mine.member_id', '=', member.id)
    .orderBy('teams.name')
    .orderBy('teams.created_at')
    .execute();

  res.json(
    teams.map((team) => ({ ...team, memberCount: Number(team.memberCount) })),
  );
});

teamRoutes.post('/', async (req, res: MemberResponse) => {
  const { db, clock, member } = res.locals;
  const { name } = parse(teamInput, req.body);
  const now = clock();

  const team = await db.transaction().execute(async (trx) => {
    const team = await trx
      .insertInto('teams')
      .values({ name, created_at: now })
      .returning(['id', 'name'])
      .executeTakeFirstOrThrow();

    await trx
      .insertInto('team_members')
      .values({
        team_id: team.id,
        member_id: member.id,
        role: 'owner',
        joined_at: now,
      })
      .execute();

    return team;
  });

  res.status(201).json({ ...team, role: 'owner', memberCount: 1 });
});

teamRoutes.get('/:id', async (req, res: MemberResponse) => {
  const { db, clock, member } = res.locals;
  const teamId = uuidParam(req.params.id, teamNotFound);

  const team = await db
    .selectFrom('team_members')
    .innerJoin('teams', 'teams.id', 'team_members.team_id')
    .select(['teams.id', 'teams.name', 'team_members.role'])
    .where('team_members.team_id', '=', teamId)
    .where('team_members.member_id', '=', member.id)
    .executeTakeFirst();

  if (!team) throw new HttpError(404, teamNotFound);

  const members = await db
    .selectFrom('team_members')
    .innerJoin('members', 'members.id', 'team_members.member_id')
    .select([
      'members.id',
      'members.name',
      'members.email',
      'team_members.role',
      'team_members.joined_at as joinedAt',
    ])
    .where('team_members.team_id', '=', teamId)
    .orderBy('team_members.role', 'desc')
    .orderBy('members.name')
    .execute();

  // Only owners manage invitations, so only they see them. Declined ones stay
  // listed until they expire, because until then the address can't be
  // invited again.
  const invites =
    team.role === 'owner'
      ? (
          await db
            .selectFrom('team_invites')
            .leftJoin('members', 'members.id', 'team_invites.invited_by')
            .select([
              'team_invites.id',
              'team_invites.email',
              'team_invites.status',
              'members.name as invitedBy',
              'team_invites.created_at as createdAt',
              'team_invites.expires_at',
            ])
            .where('team_invites.team_id', '=', teamId)
            .where('team_invites.status', 'in', ['pending', 'declined'])
            .orderBy('team_invites.created_at', 'desc')
            .execute()
        )
          .filter(isOpen(clock()))
          .map(({ expires_at, ...invite }) => ({
            ...invite,
            expiresAt: expires_at,
          }))
      : undefined;

  res.json({ ...team, members, invites });
});

teamRoutes.patch('/:id', async (req, res: MemberResponse) => {
  const { db, member } = res.locals;
  const { name } = parse(teamInput, req.body);

  await changeTeam(db, req.params.id, member.id, 'owner', (trx) =>
    trx
      .updateTable('teams')
      .set({ name })
      .where('id', '=', req.params.id)
      .execute(),
  );

  res.json({ id: req.params.id, name });
});

teamRoutes.delete('/:id', async (req, res: MemberResponse) => {
  const { db, member } = res.locals;

  await changeTeam(db, req.params.id, member.id, 'owner', (trx) =>
    trx.deleteFrom('teams').where('id', '=', req.params.id).execute(),
  );

  res.sendStatus(204);
});

teamRoutes.patch('/:id/members/:memberId', async (req, res: MemberResponse) => {
  const { db, member } = res.locals;
  const { role } = parse(roleInput, req.body);

  // The database refuses to leave the team without an owner.
  await changeTeam(db, req.params.id, member.id, 'owner', async (trx) => {
    const updated = await trx
      .updateTable('team_members')
      .set({ role })
      .where('team_id', '=', req.params.id)
      .where('member_id', '=', req.params.memberId)
      .executeTakeFirst();

    if (!updated.numUpdatedRows)
      throw new HttpError(404, 'That person isn’t in this team.');
  });

  res.json({ id: req.params.memberId, role });
});

// Owners can remove anyone. Anyone can remove themselves, which is leaving.
teamRoutes.delete(
  '/:id/members/:memberId',
  async (req, res: MemberResponse) => {
    const { db, member } = res.locals;
    const leaving = req.params.memberId === member.id;

    await changeTeam(
      db,
      req.params.id,
      member.id,
      leaving ? 'member' : 'owner',
      async (trx) => {
        const removed = await trx
          .deleteFrom('team_members')
          .where('team_id', '=', req.params.id)
          .where('member_id', '=', req.params.memberId)
          .executeTakeFirst();

        if (!removed.numDeletedRows)
          throw new HttpError(404, 'That person isn’t in this team.');
      },
    );

    res.sendStatus(204);
  },
);

// Inviting works the same whether or not anyone has the address: it never
// looks the address up among accounts, only among this team's members, whom
// owners can already see. The invitation is stored against the address and
// shown to whoever signs in with it.
teamRoutes.post('/:id/invites', async (req, res: MemberResponse) => {
  const { db, clock, member } = res.locals;
  const { email } = parse(inviteInput, req.body);
  const now = clock();

  const invite = await changeTeam(
    db,
    req.params.id,
    member.id,
    'owner',
    async (trx) => {
      const alreadyMember = await trx
        .selectFrom('team_members')
        .innerJoin('members', 'members.id', 'team_members.member_id')
        .select('members.id')
        .where('team_members.team_id', '=', req.params.id)
        .where('members.email', '=', email)
        .executeTakeFirst();

      if (alreadyMember)
        throw new HttpError(409, 'That person is already in this team.');

      const open = (
        await trx
          .selectFrom('team_invites')
          .select(['email', 'status', 'expires_at'])
          .where('team_id', '=', req.params.id)
          .where('status', 'in', ['pending', 'declined'])
          .execute()
      ).filter(isOpen(now));

      // The database refuses this too (team_invites_one_at_a_time), but
      // checking first keeps the message next to the rule.
      if (open.some((invite) => invite.email === email))
        throw new HttpError(
          409,
          'That address already has an invitation from this team. You can invite it again once that invitation expires.',
        );

      if (
        open.filter((invite) => invite.status === 'pending').length >=
        MAX_OPEN_INVITES
      )
        throw new HttpError(
          409,
          `This team has ${MAX_OPEN_INVITES} open invitations. Cancel some before inviting more people.`,
        );

      return trx
        .insertInto('team_invites')
        .values({
          team_id: req.params.id,
          email,
          invited_by: member.id,
          created_at: now,
          expires_at: new Date(now.getTime() + INVITE_DAYS * 24 * 60 * 60_000),
        })
        .returning([
          'id',
          'email',
          'status',
          'created_at as createdAt',
          'expires_at as expiresAt',
        ])
        .executeTakeFirstOrThrow();
    },
  );

  res.status(201).json({ ...invite, invitedBy: member.name });
});

teamRoutes.delete(
  '/:id/invites/:inviteId',
  async (req, res: MemberResponse) => {
    const { db, clock, member } = res.locals;
    const inviteId = uuidParam(req.params.inviteId, invitationNotFound);

    await changeTeam(db, req.params.id, member.id, 'owner', async (trx) => {
      const cancelled = await trx
        .updateTable('team_invites')
        .set({ status: 'cancelled', responded_at: clock() })
        .where('id', '=', inviteId)
        .where('team_id', '=', req.params.id)
        .where('status', '=', 'pending')
        .executeTakeFirst();

      if (!cancelled.numUpdatedRows)
        throw new HttpError(404, invitationNotFound);
    });

    res.sendStatus(204);
  },
);

// The signed-in member's invitations, matched by their account's email.
export const inviteRoutes = Router();

inviteRoutes.use(requireMember);

inviteRoutes.get('/', async (_req, res: MemberResponse) => {
  const { db, clock, member } = res.locals;

  const invites = await db
    .selectFrom('team_invites')
    .innerJoin('teams', 'teams.id', 'team_invites.team_id')
    .leftJoin('members', 'members.id', 'team_invites.invited_by')
    .select([
      'team_invites.id',
      'teams.name as team',
      'members.name as invitedBy',
      'team_invites.created_at as createdAt',
      'team_invites.expires_at as expiresAt',
    ])
    .where('team_invites.email', '=', member.email)
    .where('team_invites.status', '=', 'pending')
    .where('team_invites.expires_at', '>', clock())
    .orderBy('team_invites.created_at', 'desc')
    .execute();

  res.json(invites);
});

// Answers one of the member's own open invitations. Locks the team first,
// like every other change to a team.
async function respond(
  res: MemberResponse,
  inviteId: string,
  status: 'accepted' | 'declined',
) {
  const { db, clock, member } = res.locals;
  const now = clock();
  uuidParam(inviteId, invitationNotFound);

  const invite = await db
    .selectFrom('team_invites')
    .select('team_id')
    .where('id', '=', inviteId)
    .where('email', '=', member.email)
    .executeTakeFirst();

  if (!invite) throw new HttpError(404, invitationNotFound);

  await db.transaction().execute(async (trx) => {
    await trx
      .selectFrom('teams')
      .select('id')
      .where('id', '=', invite.team_id)
      .forNoKeyUpdate()
      .execute();

    const answered = await trx
      .updateTable('team_invites')
      .set({ status, responded_at: now })
      .where('id', '=', inviteId)
      .where('email', '=', member.email)
      .where('status', '=', 'pending')
      .where('expires_at', '>', now)
      .executeTakeFirst();

    if (!answered.numUpdatedRows) throw new HttpError(404, invitationNotFound);

    if (status === 'accepted')
      await trx
        .insertInto('team_members')
        .values({
          team_id: invite.team_id,
          member_id: member.id,
          role: 'member',
          joined_at: now,
        })
        .onConflict((oc) => oc.columns(['team_id', 'member_id']).doNothing())
        .execute();
  });

  return invite.team_id;
}

inviteRoutes.post('/:id/accept', async (req, res: MemberResponse) => {
  const teamId = await respond(res, req.params.id, 'accepted');
  res.json({ teamId });
});

inviteRoutes.post('/:id/decline', async (req, res: MemberResponse) => {
  await respond(res, req.params.id, 'declined');
  res.sendStatus(204);
});

// People the signed-in member can add to a booking: everyone who shares a team
// with them, and their teams, so a whole team can be added at once.
export const teammateRoutes = Router();

teammateRoutes.use(requireMember);

teammateRoutes.get('/', async (_req, res: MemberResponse) => {
  const { db, member } = res.locals;

  const rows = await db
    .selectFrom('team_members as mine')
    .innerJoin('teams', 'teams.id', 'mine.team_id')
    .innerJoin('team_members as theirs', 'theirs.team_id', 'mine.team_id')
    .innerJoin('members', 'members.id', 'theirs.member_id')
    .select([
      'teams.id as teamId',
      'teams.name as teamName',
      'members.id',
      'members.name',
      'members.email',
    ])
    .where('mine.member_id', '=', member.id)
    .where('theirs.member_id', '!=', member.id)
    .orderBy('teams.name')
    .orderBy('members.name')
    .execute();

  const people = new Map<string, { id: string; name: string; email: string }>();
  const teams = new Map<
    string,
    { id: string; name: string; memberIds: string[] }
  >();

  for (const { teamId, teamName, ...person } of rows) {
    people.set(person.id, person);
    const team = teams.get(teamId) ?? {
      id: teamId,
      name: teamName,
      memberIds: [],
    };
    team.memberIds.push(person.id);
    teams.set(teamId, team);
  }

  res.json({
    people: [...people.values()].sort((a, b) => a.name.localeCompare(b.name)),
    teams: [...teams.values()],
  });
});
