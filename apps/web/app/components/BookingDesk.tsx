'use client';

import { CalendarDays, DoorOpen, LogOut, MapPin, Users } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, errorMessage, isSignedOut } from '../lib/api';
import { displayDate, displayTime } from '../lib/format';
import type {
  Account,
  Booking,
  Invitation,
  Person,
  Room,
  RoomDetails,
  Schedule,
  Session,
} from '../lib/api';
import { BookingDialog } from './BookingDialog';
import { CalendarSync } from './CalendarSync';
import { ManageRooms } from './ManageRooms';
import { MyBookings } from './MyBookings';
import { RoomCatalog } from './RoomCatalog';
import { Teams } from './Teams';
import styles from './BookingDesk.module.css';

type View = 'rooms' | 'bookings' | 'teams' | 'admin';

export function BookingDesk() {
  const [view, setView] = useState<View>('rooms');

  // undefined until the session has been checked.
  const [account, setAccount] = useState<Account | null>();

  // Open team invitations, shown as a count next to Teams.
  const [invitations, setInvitations] = useState(0);

  const [schedule, setSchedule] = useState<Schedule>();
  const [bookings, setBookings] = useState<Booking[]>([]);

  const [roomId, setRoomId] = useState<number>();
  const [editing, setEditing] = useState<Room | null>();

  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [dialogError, setDialogError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const request = new AbortController();

    api<Session>('/auth/me', { signal: request.signal })
      .then((result) => setAccount(result.account))
      .catch((error) => {
        if (!request.signal.aborted) setError(errorMessage(error));
      });

    return () => request.abort();
  }, []);

  useEffect(() => {
    const request = new AbortController();

    api<Schedule>('/rooms', { signal: request.signal })
      .then(setSchedule)
      .catch((error) => {
        if (!request.signal.aborted) setError(errorMessage(error));
      });

    return () => request.abort();
  }, [refresh]);

  useEffect(() => {
    if (!account || view !== 'bookings') return;
    const request = new AbortController();

    api<Booking[]>('/bookings', { signal: request.signal })
      .then(setBookings)
      .catch((error) => {
        if (!request.signal.aborted) showError(error);
      });

    return () => request.abort();
  }, [account, view, refresh]);

  useEffect(() => {
    if (!account) {
      setInvitations(0);
      return;
    }

    const request = new AbortController();

    api<Invitation[]>('/invites', { signal: request.signal })
      .then((invites) => setInvitations(invites.length))
      .catch((error) => {
        if (!request.signal.aborted) showError(error);
      });

    return () => request.abort();
  }, [account]);

  const selectedRoom = schedule?.rooms.find((room) => room.id === roomId);
  const timeZone = schedule?.timeZone ?? 'Europe/Podgorica';

  function changeView(nextView: View) {
    setEditing(undefined);
    setNotice('');
    setError('');
    setView(nextView);
  }

  function signedOut() {
    setAccount(null);
    setBookings([]);
    if (view === 'admin') setView('rooms');
  }

  // A 401 means the session ended (it expired, or the member signed out in
  // another tab). Switching to the signed-out state explains that on its own:
  // each view then shows how to sign in.
  function showError(error: unknown) {
    if (isSignedOut(error)) signedOut();
    else setError(errorMessage(error));
  }

  async function signOut() {
    setBusy(true);
    setError('');
    setNotice('');

    try {
      await api('/auth/logout', { method: 'POST' });
      signedOut();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function book(
    id: number,
    start: string,
    end: string,
    participants: Person[],
  ) {
    setBusy(true);
    setDialogError('');

    try {
      await api('/bookings', {
        method: 'POST',
        body: JSON.stringify({
          roomId: id,
          start,
          end,
          participantIds: participants.map((person) => person.id),
        }),
      });

      setRoomId(undefined);
      const invited = participants.length
        ? ` ${participants.length === 1 ? `${participants[0].name} is` : `${participants.length} people are`} invited and can answer under My bookings.`
        : '';
      setNotice(
        `${selectedRoom?.name ?? 'Room'} is booked for ${displayDate(start, timeZone)} at ${displayTime(start, timeZone)}.${invited}`,
      );

      setRefresh((count) => count + 1);
    } catch (error) {
      if (isSignedOut(error)) return showError(error);
      setDialogError(errorMessage(error));

      setRefresh((count) => count + 1);
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    setBusy(true);
    setError('');
    setNotice('');

    try {
      await api('/bookings/' + id, { method: 'DELETE' });

      setRefresh((count) => count + 1);
      setNotice('Booking cancelled. The room is available again.');
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  async function respond(id: string, response: 'attending' | 'not_attending') {
    setBusy(true);
    setError('');
    setNotice('');

    try {
      await api(`/bookings/${id}/response`, {
        method: 'PUT',
        body: JSON.stringify({ response }),
      });
      setRefresh((count) => count + 1);
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  async function savePeople(id: string, people: Person[]) {
    setBusy(true);
    setError('');
    setNotice('');

    try {
      await api(`/bookings/${id}/participants`, {
        method: 'PUT',
        body: JSON.stringify({
          participantIds: people.map((person) => person.id),
        }),
      });
      setRefresh((count) => count + 1);
      setNotice('Invitations updated.');
      return true;
    } catch (error) {
      showError(error);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveRoom(room: RoomDetails, id?: number) {
    try {
      await api(id ? '/rooms/' + id : '/rooms', {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify(room),
      });
    } catch (error) {
      if (isSignedOut(error)) showError(error);
      throw error;
    }

    setEditing(undefined);
    setRefresh((count) => count + 1);
    setNotice(id ? 'Room updated.' : 'Room added.');
  }

  const status = (
    <>
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
    </>
  );

  return (
    <>
      <header className={styles.top}>
        <div className={styles.topInner}>
          <button
            type="button"
            className={styles.brand}
            onClick={() => changeView('rooms')}
          >
            <span className={styles.mark}>
              <DoorOpen size={22} />
            </span>
            Roomwell
          </button>
          <nav aria-label="Main navigation" className={styles.nav}>
            <button
              type="button"
              aria-current={view === 'rooms' ? 'page' : undefined}
              onClick={() => changeView('rooms')}
            >
              Rooms
            </button>
            <button
              type="button"
              aria-current={view === 'bookings' ? 'page' : undefined}
              onClick={() => changeView('bookings')}
            >
              My bookings
            </button>
            <button
              type="button"
              aria-current={view === 'teams' ? 'page' : undefined}
              onClick={() => changeView('teams')}
            >
              Teams
              {invitations > 0 && (
                <span
                  className={styles.badge}
                  aria-label={`${invitations} ${invitations === 1 ? 'invitation' : 'invitations'}`}
                >
                  {invitations}
                </span>
              )}
            </button>
            {account?.isAdmin && (
              <button
                type="button"
                aria-current={view === 'admin' ? 'page' : undefined}
                onClick={() => changeView('admin')}
              >
                Manage rooms
              </button>
            )}
          </nav>
          {account ? (
            <div className={styles.account}>
              <span className={styles.who}>
                <strong>{account.name}</strong>
                <span>{account.isAdmin ? 'Venue admin' : account.email}</span>
              </span>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => void signOut()}
              >
                <LogOut size={16} /> Sign out
              </button>
            </div>
          ) : (
            account === null && (
              <div className={styles.account}>
                <Link href="/sign-in" className="secondary">
                  Sign in
                </Link>
                <Link href="/register" className="primary">
                  Create account
                </Link>
              </div>
            )
          )}
        </div>
      </header>

      <main className={styles.main}>
        {view === 'rooms' && (
          <>
            <div className={styles.intro}>
              <div className={styles.venue}>
                <MapPin size={16} /> The Commons · Podgorica
              </div>
              <h1>Book a meeting room</h1>
              <p>
                Find a room that fits your group, then choose when to book it.
              </p>
            </div>
            <RoomCatalog
              rooms={schedule?.rooms}
              status={status}
              error={error}
              onBook={(id) => {
                setDialogError('');
                setRoomId(id);
              }}
            />
          </>
        )}

        {view === 'bookings' && (
          <section>
            <div className={styles.intro}>
              <div className={styles.venue}>
                <CalendarDays size={16} /> Your schedule
              </div>
              <h1>My bookings</h1>
              <p>
                See the rooms you’ve booked or been invited to, and let people
                know if you’re coming.
              </p>
            </div>

            {status}
            {account && <CalendarSync key={account.id} timeZone={timeZone} />}
            {account !== undefined && (
              <MyBookings
                signedIn={!!account}
                you={account?.id ?? ''}
                bookings={bookings}
                timeZone={timeZone}
                busy={busy}
                onCancel={cancel}
                onRespond={respond}
                onSavePeople={savePeople}
              />
            )}
          </section>
        )}

        {view === 'teams' && (
          <section>
            <div className={styles.intro}>
              <div className={styles.venue}>
                <Users size={16} /> Work together
              </div>
              <h1>Teams</h1>
              <p>
                Create a team for the people you meet with, and invite them by
                email.
              </p>
            </div>

            {status}
            {account ? (
              <Teams
                key={account.id}
                account={account}
                timeZone={timeZone}
                onInvitationsChange={setInvitations}
                onSignedOut={signedOut}
              />
            ) : (
              account === null && (
                <p className={styles.message}>
                  <Link href="/sign-in">Sign in</Link> to create and join teams.
                </p>
              )
            )}
          </section>
        )}

        {view === 'admin' && account?.isAdmin && (
          <section>
            <div className={styles.intro}>
              <div className={styles.venue}>
                <DoorOpen size={16} /> Venue administration
              </div>
              <h1>Manage rooms</h1>
              <p>Add or edit the meeting rooms members can reserve.</p>
            </div>

            {status}
            <ManageRooms
              rooms={schedule?.rooms}
              editing={editing}
              onEdit={setEditing}
              onSave={saveRoom}
            />
          </section>
        )}

        <footer className={styles.footer}>
          <DoorOpen size={16} /> Roomwell <span>Local booking demo</span>
        </footer>
      </main>

      {schedule && selectedRoom && (
        <BookingDialog
          key={selectedRoom.id}
          room={selectedRoom}
          initialDate={schedule.date}
          refresh={refresh}
          timeZone={timeZone}
          signedIn={!!account}
          onDateChange={() => setDialogError('')}
          onClose={() => setRoomId(undefined)}
          onBook={book}
          busy={busy}
          error={dialogError}
        />
      )}
    </>
  );
}
