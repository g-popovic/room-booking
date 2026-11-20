'use client';

import { Mail, Plus, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api, errorMessage, isSignedOut } from '../lib/api';
import type { Account, Invitation, TeamSummary } from '../lib/api';
import { displayDate } from '../lib/format';
import { TeamDetail } from './TeamDetail';
import styles from './Teams.module.css';

export function Teams({
  account,
  timeZone,
  onInvitationsChange,
  onSignedOut,
}: {
  account: Account;
  timeZone: string;
  onInvitationsChange: (count: number) => void;
  onSignedOut: () => void;
}) {
  const [teams, setTeams] = useState<TeamSummary[]>();
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [openTeam, setOpenTeam] = useState<string>();
  const [name, setName] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);

  function fail(error: unknown) {
    if (isSignedOut(error)) onSignedOut();
    else setError(errorMessage(error));
  }

  useEffect(() => {
    const request = new AbortController();

    Promise.all([
      api<TeamSummary[]>('/teams', { signal: request.signal }),
      api<Invitation[]>('/invites', { signal: request.signal }),
    ])
      .then(([teams, invitations]) => {
        setTeams(teams);
        setInvitations(invitations);
        onInvitationsChange(invitations.length);
      })
      .catch((error) => {
        if (!request.signal.aborted) fail(error);
      });

    return () => request.abort();
  }, [refresh]);

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');

    try {
      const team = await api<TeamSummary>('/teams', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });

      setName('');
      setOpenTeam(team.id);
      setRefresh((count) => count + 1);
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  }

  async function respond(invitation: Invitation, answer: 'accept' | 'decline') {
    setBusy(true);
    setError('');
    setNotice('');

    try {
      if (answer === 'accept') {
        const { teamId } = await api<{ teamId: string }>(
          `/invites/${invitation.id}/accept`,
          { method: 'POST' },
        );
        setOpenTeam(teamId);
      } else {
        await api(`/invites/${invitation.id}/decline`, { method: 'POST' });
        setNotice(`You declined the invitation to ${invitation.team}.`);
      }
    } catch (error) {
      fail(error);
    } finally {
      setRefresh((count) => count + 1);
      setBusy(false);
    }
  }

  if (openTeam)
    return (
      <TeamDetail
        key={openTeam}
        teamId={openTeam}
        account={account}
        timeZone={timeZone}
        onSignedOut={onSignedOut}
        onClose={(message) => {
          setOpenTeam(undefined);
          setNotice(message ?? '');
          setError('');
          setRefresh((count) => count + 1);
        }}
      />
    );

  return (
    <div className={styles.stack}>
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

      {invitations.length > 0 && (
        <section className={styles.panel} aria-labelledby="invitations-title">
          <div className={styles.heading}>
            <Mail size={18} />
            <h2 id="invitations-title">Invitations</h2>
          </div>
          {invitations.map((invitation) => (
            <div key={invitation.id} className={styles.row}>
              <div>
                <strong>{invitation.team}</strong>
                <p className={styles.meta}>
                  {invitation.invitedBy
                    ? `${invitation.invitedBy} invited you`
                    : 'You’re invited'}{' '}
                  · Expires {displayDate(invitation.expiresAt, timeZone)}
                </p>
              </div>
              <div className={styles.actions}>
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() => void respond(invitation, 'accept')}
                >
                  Join team
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => void respond(invitation, 'decline')}
                >
                  Decline
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      <form className={styles.create} onSubmit={create}>
        <label htmlFor="new-team-name">Create a team</label>
        <div className={styles.inline}>
          <input
            id="new-team-name"
            placeholder="Team name"
            required
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <button type="submit" className="primary" disabled={busy}>
            <Plus size={18} /> Create team
          </button>
        </div>
      </form>

      {teams?.length === 0 && (
        <p className={styles.message}>
          You’re not in any teams yet. Create one, or ask a team owner to invite{' '}
          <strong>{account.email}</strong>.
        </p>
      )}

      {teams && teams.length > 0 && (
        <div className={styles.list}>
          {teams.map((team) => (
            <article key={team.id} className={styles.item}>
              <div>
                <h3>{team.name}</h3>
                <p className={styles.meta}>
                  <Users size={15} /> {team.memberCount}{' '}
                  {team.memberCount === 1 ? 'member' : 'members'}
                  {team.role === 'owner' && (
                    <span className={styles.tag}>Owner</span>
                  )}
                </p>
              </div>
              <button
                type="button"
                className="secondary"
                aria-label={`Open ${team.name}`}
                onClick={() => {
                  setNotice('');
                  setError('');
                  setOpenTeam(team.id);
                }}
              >
                Open
              </button>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
