'use client';

import {
  ArrowRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  DoorOpen,
  MapPin,
  Plus,
  Users,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, displayDate, displayTime, errorMessage, moveDay } from './api';
import type {
  Account,
  Booking,
  Room,
  RoomDetails,
  Schedule,
  Session,
} from './api';
import { BookingDialog } from './BookingDialog';
import { RoomEditor } from './RoomEditor';
import { RoomIllustration } from './RoomIllustration';
import styles from './BookingDesk.module.css';

type View = 'rooms' | 'bookings' | 'admin';

export function BookingDesk() {
  const [view, setView] = useState<View>('rooms');
  const [account, setAccount] = useState<Account | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [schedule, setSchedule] = useState<Schedule>();
  const [date, setDate] = useState('');
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
    api<Session>('/session', { signal: request.signal })
      .then((result) => {
        setAccount(result.account);
        setAccounts(result.accounts);
      })
      .catch((error) => {
        if (!request.signal.aborted) setError(errorMessage(error));
      });
    return () => request.abort();
  }, []);

  useEffect(() => {
    const request = new AbortController();
    api<Schedule>(date ? '/rooms?date=' + encodeURIComponent(date) : '/rooms', {
      signal: request.signal,
    })
      .then(setSchedule)
      .catch((error) => {
        if (!request.signal.aborted) setError(errorMessage(error));
      });
    return () => request.abort();
  }, [date, refresh]);

  useEffect(() => {
    if (!account || view !== 'bookings') return;
    const request = new AbortController();
    api<Booking[]>('/bookings', { signal: request.signal })
      .then(setBookings)
      .catch((error) => {
        if (!request.signal.aborted) setError(errorMessage(error));
      });
    return () => request.abort();
  }, [account, view, refresh]);

  const day = date || schedule?.date || '';
  const rooms = schedule?.date === day ? schedule.rooms : undefined;
  const selectedRoom = rooms?.find((room) => room.id === roomId);
  const timeZone = schedule?.timeZone ?? 'Europe/Podgorica';

  function changeView(nextView: View) {
    setEditing(undefined);
    setNotice('');
    setError('');
    setView(nextView);
  }

  async function selectAccount(id: string) {
    setBusy(true);
    setError('');
    setDialogError('');
    try {
      const next = id
        ? await api<Account>('/session', {
            method: 'POST',
            body: JSON.stringify({ id }),
          })
        : await api<null>('/session', { method: 'DELETE' });
      setBookings([]);
      setAccount(next ?? null);
      if (view === 'admin' && !next?.isAdmin) changeView('rooms');
    } catch (error) {
      const report = selectedRoom ? setDialogError : setError;
      report(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function book(id: number, start: string, end: string) {
    setBusy(true);
    setDialogError('');
    try {
      await api('/bookings', {
        method: 'POST',
        body: JSON.stringify({ roomId: id, start, end }),
      });
      setRoomId(undefined);
      setNotice(
        `${selectedRoom?.name ?? 'Room'} is booked for ${displayTime(start, timeZone)}.`,
      );
      setRefresh((count) => count + 1);
    } catch (error) {
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
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveRoom(room: RoomDetails, id?: number) {
    await api(id ? '/rooms/' + id : '/rooms', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(room),
    });
    setEditing(undefined);
    setRefresh((count) => count + 1);
    setNotice(id ? 'Room updated.' : 'Room added.');
  }

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
          <select
            aria-label="Demo account"
            value={account?.id ?? ''}
            onChange={(event) => void selectAccount(event.target.value)}
            disabled={busy || !accounts.length}
          >
            <option value="">
              {account ? 'Sign out' : 'Choose demo account'}
            </option>
            {accounts.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
                {person.isAdmin ? ' (admin)' : ''}
              </option>
            ))}
          </select>
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
              <p>Find an open slot and make the room yours.</p>
            </div>
            <section aria-labelledby="rooms-heading">
              <div className={styles.sectionHeader}>
                <div>
                  <h2 id="rooms-heading">Available rooms</h2>
                  <p>08:00–20:00 · Venue local time</p>
                </div>
                <div className={styles.dateControl}>
                  <button
                    type="button"
                    aria-label="Previous day"
                    disabled={!day}
                    onClick={() => setDate(moveDay(day, -1))}
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <input
                    type="date"
                    aria-label="Booking date"
                    value={day}
                    onChange={(event) => {
                      if (event.target.value) setDate(event.target.value);
                    }}
                  />
                  <button
                    type="button"
                    aria-label="Next day"
                    disabled={!day}
                    onClick={() => setDate(moveDay(day, 1))}
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              </div>
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
              {!rooms && !error && (
                <p className={styles.message} role="status">
                  Checking availability…
                </p>
              )}
              {rooms?.length === 0 && (
                <p className={styles.message}>No rooms have been listed yet.</p>
              )}
              <div className={styles.grid}>
                {rooms?.map((room) => {
                  const openSlots = room.slots.filter(
                    (slot) => slot.available,
                  ).length;
                  return (
                    <article key={room.id} className={styles.card}>
                      <div className={styles.illustration}>
                        <RoomIllustration
                          id={room.id}
                          capacity={room.capacity}
                        />
                      </div>
                      <div className={styles.cardBody}>
                        <div className={styles.roomMeta}>
                          <Users size={15} /> Up to {room.capacity}{' '}
                          {room.capacity === 1 ? 'person' : 'people'}
                        </div>
                        <h3>{room.name}</h3>
                        <p>{room.description}</p>
                        <div className={styles.tags}>
                          {room.amenities.map((item, index) => (
                            <span key={index}>{item}</span>
                          ))}
                        </div>
                      </div>
                      <div className={styles.cardFooter}>
                        <span>
                          <span
                            className={
                              openSlots ? styles.dot : styles.closedDot
                            }
                          />
                          {openSlots
                            ? `${openSlots} open ${openSlots === 1 ? 'slot' : 'slots'}`
                            : 'Fully booked or closed'}
                        </span>
                        <button
                          type="button"
                          className="primary"
                          disabled={!openSlots}
                          aria-label={`Book ${room.name}`}
                          onClick={() => {
                            setDialogError('');
                            setRoomId(room.id);
                          }}
                        >
                          Book <ArrowRight size={16} />
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
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
                See your reservations and free up a room if your plans change.
              </p>
            </div>
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
            {!account && (
              <p className={styles.message}>
                Choose a demo account to see your bookings.
              </p>
            )}
            {account && bookings.length === 0 && (
              <p className={styles.message}>You haven’t booked a room yet.</p>
            )}
            <div className={styles.list}>
              {bookings.map((booking) => {
                const past = new Date(booking.start).getTime() <= Date.now();
                return (
                  <article key={booking.id} className={styles.listItem}>
                    <div>
                      <h3>{booking.room}</h3>
                      <p>
                        <Clock3 size={15} />{' '}
                        {displayDate(booking.start, timeZone)} ·{' '}
                        {displayTime(booking.start, timeZone)}–
                        {displayTime(booking.end, timeZone)}
                      </p>
                    </div>
                    {booking.cancelled || past ? (
                      <span className={styles.tag}>
                        {booking.cancelled ? 'Cancelled' : 'Past booking'}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy}
                        onClick={() => void cancel(booking.id)}
                      >
                        Cancel booking
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
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
            {editing !== undefined ? (
              <RoomEditor
                key={editing?.id ?? 'new'}
                room={editing}
                onSave={saveRoom}
                onClose={() => setEditing(undefined)}
              />
            ) : (
              <div className={styles.list}>
                <div className={styles.adminActions}>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => setEditing(null)}
                  >
                    <Plus size={18} /> Add room
                  </button>
                </div>
                {schedule?.rooms.map((room) => (
                  <article key={room.id} className={styles.listItem}>
                    <div>
                      <h3>{room.name}</h3>
                      <p>
                        <Users size={15} /> Capacity {room.capacity}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="secondary"
                      aria-label={`Edit ${room.name}`}
                      onClick={() => setEditing(room)}
                    >
                      Edit room
                    </button>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        <footer className={styles.footer}>
          <DoorOpen size={16} /> Roomwell <span>Local booking demo</span>
        </footer>
      </main>
      {selectedRoom && (
        <BookingDialog
          key={selectedRoom.id}
          room={selectedRoom}
          date={day}
          timeZone={timeZone}
          account={account}
          accounts={accounts}
          onAccount={selectAccount}
          onClose={() => setRoomId(undefined)}
          onBook={book}
          busy={busy}
          error={dialogError}
        />
      )}
    </>
  );
}
