'use client';

import { ArrowLeft, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError, api, errorMessage, isSignedOut } from '../lib/api';
import type { Account, Team, TeamInvite, TeamMember } from '../lib/api';
import { displayDate } from '../lib/format';
import styles from './Teams.module.css';

type Confirming =
  | { action: 'remove'; member: TeamMember }
  | { action: 'leave' }
  | { action: 'delete' };

export function TeamDetail({
  teamId,
  account,
  timeZone,
  onClose,
  onSignedOut,
}: {
  teamId: string;
  account: Account;
  timeZone: string;
  // Back to the list, with a message to show there if something happened.
  onClose: (message?: string) => void;
  onSignedOut: () => void;
}) {
  const [team, setTeam] = useState<Team>();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);

  function fail(error: unknown) {
    if (isSignedOut(error)) onSignedOut();
    // Removed from the team, or it was deleted, since the page loaded.
    else if (error instanceof ApiError && error.status === 404)
      onClose('That team is no longer available to you.');
    else setError(errorMessage(error));
  }

  useEffect(() => {
    const request = new AbortController();

    api<Team>(`/teams/${teamId}`, { signal: request.signal })
      .then(setTeam)
      .catch((error) => {
        if (!request.signal.aborted) fail(error);
      });

    return () => request.abort();
  }, [teamId, refresh]);

  // Runs a change, then reloads the team. Returns whether it worked.
  async function change(run: () => Promise<unknown>, success = '') {
    setBusy(true);
    setError('');
    setNotice('');

    try {
      await run();
      setNotice(success);
      setConfirming(null);
      setRefresh((count) => count + 1);
      return true;
    } catch (error) {
      fail(error);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const send = (path: string, method: string, body?: unknown) => () =>
    api(`/teams/${teamId}${path}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  async function rename(event: FormEvent) {
    event.preventDefault();
    if (await change(send('', 'PATCH', { name }), 'Team renamed.'))
      setRenaming(false);
  }

  async function invite(event: FormEvent) {
    event.preventDefault();
    let sent: TeamInvite | undefined;

    const ok = await change(async () => {
      sent = await api<TeamInvite>(`/teams/${teamId}/invites`, {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
    });

    // Deliberately doesn't say whether the address has an account.
    if (ok && sent) {
      setEmail('');
      setNotice(
        `If ${sent.email} has a Roomwell account, or creates one by ${displayDate(sent.expiresAt, timeZone)}, they’ll see your invitation under Teams.`,
      );
    }
  }

  async function leaveOrDelete(action: 'leave' | 'delete') {
    setBusy(true);
    setError('');

    try {
      await (action === 'leave'
        ? send(`/members/${account.id}`, 'DELETE')()
        : send('', 'DELETE')());
      onClose(
        action === 'leave'
          ? `You left ${team?.name}.`
          : `${team?.name} was deleted.`,
      );
    } catch (error) {
      fail(error);
      setConfirming(null);
      setBusy(false);
    }
  }

  const back = (
    <button type="button" className={styles.back} onClick={() => onClose()}>
      <ArrowLeft size={16} /> All teams
    </button>
  );

  if (!team)
    return (
      <div className={styles.stack}>
        {back}
        {error && (
          <p className={styles.message + ' error'} role="alert">
            {error}
          </p>
        )}
      </div>
    );

  const owner = team.role === 'owner';

  // Shown next to the button that asked for it.
  const confirmPanel = confirming && (
    <div className={styles.confirm} role="group" aria-label="Confirm">
      <p>
        {confirming.action === 'remove'
          ? `Remove ${confirming.member.name} from ${team.name}?`
          : confirming.action === 'leave'
            ? `Leave ${team.name}? You’ll need a new invitation to join again.`
            : `Delete ${team.name} for everyone? This can’t be undone.`}
      </p>
      <div className={styles.actions}>
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() =>
            void (confirming.action === 'remove'
              ? change(
                  send(`/members/${confirming.member.id}`, 'DELETE'),
                  `${confirming.member.name} was removed from the team.`,
                )
              : leaveOrDelete(confirming.action))
          }
        >
          {confirming.action === 'remove'
            ? 'Remove'
            : confirming.action === 'leave'
              ? 'Leave team'
              : 'Delete team'}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => setConfirming(null)}
        >
          Cancel
        </button>
      </div>
    </div>
  );

  return (
    <div className={styles.stack}>
      {back}

      <header className={styles.teamHeader}>
        {renaming ? (
          <form className={styles.inline} onSubmit={rename}>
            <input
              aria-label="Team name"
              required
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <button type="submit" className="primary" disabled={busy}>
              Save
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => setRenaming(false)}
            >
              Cancel
            </button>
          </form>
        ) : (
          <>
            <h2>{team.name}</h2>
            {owner && (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setName(team.name);
                  setRenaming(true);
                }}
              >
                Rename
              </button>
            )}
          </>
        )}
      </header>

      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className={styles.message + ' error'} role="alert">
          {error}
        </p>
      )}

      <section className={styles.panel} aria-labelledby="members-title">
        <h3 id="members-title">Members</h3>
        {team.members.map((member) => {
          const you = member.id === account.id;

          return (
            <div key={member.id} className={styles.row}>
              <div>
                <strong>
                  {member.name}
                  {you && ' (you)'}
                </strong>
                <p className={styles.meta}>
                  {member.email}
                  <span className={styles.tag}>
                    {member.role === 'owner' ? 'Owner' : 'Member'}
                  </span>
                </p>
              </div>
              <div className={styles.actions}>
                {owner && (
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void change(
                        send(`/members/${member.id}`, 'PATCH', {
                          role: member.role === 'owner' ? 'member' : 'owner',
                        }),
                        member.role === 'owner'
                          ? `${you ? 'You are' : `${member.name} is`} no longer an owner.`
                          : `${member.name} is now an owner.`,
                      )
                    }
                  >
                    {member.role === 'owner' ? 'Make member' : 'Make owner'}
                  </button>
                )}
                {you ? (
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => setConfirming({ action: 'leave' })}
                  >
                    Leave team
                  </button>
                ) : (
                  owner && (
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        setConfirming({ action: 'remove', member })
                      }
                    >
                      Remove
                    </button>
                  )
                )}
              </div>
            </div>
          );
        })}
      </section>

      {confirming && confirming.action !== 'delete' && confirmPanel}

      {owner && team.invites && (
        <section className={styles.panel} aria-labelledby="invites-title">
          <h3 id="invites-title">Invite people</h3>
          <form className={styles.inline} onSubmit={invite}>
            <input
              type="email"
              aria-label="Email address to invite"
              placeholder="name@example.com"
              required
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <button type="submit" className="primary" disabled={busy}>
              <Send size={16} /> Send invitation
            </button>
          </form>
          <p className={styles.meta}>
            They’ll see the invitation under Teams when they sign in with that
            address. Invitations last 14 days.
          </p>

          {team.invites.map((invite) => (
            <div key={invite.id} className={styles.row}>
              <div>
                <strong>{invite.email}</strong>
                <p className={styles.meta}>
                  {invite.status === 'declined'
                    ? `Declined · Can be invited again after ${displayDate(invite.expiresAt, timeZone)}`
                    : `Invited${invite.invitedBy ? ` by ${invite.invitedBy}` : ''} · Expires ${displayDate(invite.expiresAt, timeZone)}`}
                </p>
              </div>
              {invite.status === 'pending' && (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  aria-label={`Cancel invitation for ${invite.email}`}
                  onClick={() =>
                    void change(
                      send(`/invites/${invite.id}`, 'DELETE'),
                      `The invitation for ${invite.email} was cancelled.`,
                    )
                  }
                >
                  Cancel
                </button>
              )}
            </div>
          ))}
        </section>
      )}

      {owner &&
        (confirming?.action === 'delete' ? (
          confirmPanel
        ) : (
          <div>
            <button
              type="button"
              className={styles.danger}
              disabled={busy}
              onClick={() => setConfirming({ action: 'delete' })}
            >
              Delete team
            </button>
          </div>
        ))}
    </div>
  );
}
