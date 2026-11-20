'use client';

import {
  Check,
  CircleCheck,
  CircleHelp,
  CircleX,
  Clock3,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import type { Attendance, Booking, Person } from '../lib/api';
import { displayDate, displayTime } from '../lib/format';
import { PeoplePicker } from './PeoplePicker';
import styles from './BookingList.module.css';

const statusLabel: Record<Attendance, string> = {
  attending: 'Going',
  not_attending: 'Not going',
  pending: 'No reply yet',
};

function StatusIcon({ response }: { response: Attendance }) {
  return response === 'attending' ? (
    <CircleCheck size={16} className={styles.going} aria-hidden />
  ) : response === 'not_attending' ? (
    <CircleX size={16} className={styles.notGoing} aria-hidden />
  ) : (
    <CircleHelp size={16} className={styles.noReply} aria-hidden />
  );
}

// The organizer and everyone invited, each with their answer.
function Attendees({ booking, you }: { booking: Booking; you: string }) {
  const count = (response: Attendance) =>
    booking.participants.filter((person) => person.response === response)
      .length;
  const going = count('attending') + 1;
  const notGoing = count('not_attending');
  const noReply = count('pending');

  return (
    <div className={styles.attendees}>
      <ul aria-label="People">
        <li>
          <StatusIcon response="attending" />
          {booking.organizer.name}
          {booking.organizer.id === you && ' (you)'}
          <span className={styles.role}>organizer</span>
        </li>
        {booking.participants.map((person) => (
          <li
            key={person.id}
            aria-label={`${person.name}${person.id === you ? ' (you)' : ''}: ${statusLabel[person.response]}`}
          >
            <StatusIcon response={person.response} />
            {person.name}
            {person.id === you && ' (you)'}
          </li>
        ))}
      </ul>
      {booking.participants.length > 0 && (
        <p className={styles.summary}>
          {going} going
          {notGoing > 0 && ` · ${notGoing} not going`}
          {noReply > 0 && ` · ${noReply} no reply yet`}
        </p>
      )}
    </div>
  );
}

export function MyBookings({
  signedIn,
  you,
  bookings,
  timeZone,
  busy,
  onCancel,
  onRespond,
  onSavePeople,
}: {
  signedIn: boolean;
  you: string;
  bookings: Booking[];
  timeZone: string;
  busy: boolean;
  onCancel: (id: string) => Promise<void>;
  onRespond: (
    id: string,
    response: 'attending' | 'not_attending',
  ) => Promise<void>;
  // Resolves to whether the change was saved.
  onSavePeople: (id: string, people: Person[]) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState<string>();
  const [draft, setDraft] = useState<Person[]>([]);

  return (
    <>
      {!signedIn && (
        <p className={styles.message}>
          <Link href="/sign-in">Sign in</Link> to see your bookings.
        </p>
      )}

      {signedIn && bookings.length === 0 && (
        <p className={styles.message}>
          You haven’t booked a room or been invited to one yet.
        </p>
      )}

      <div className={styles.list}>
        {bookings.map((booking) => {
          const past = new Date(booking.start).getTime() <= Date.now();
          const upcoming = !booking.cancelled && !past;
          const organizer = booking.response === 'organizer';
          const declined = booking.response === 'not_attending';

          return (
            <article
              key={booking.id}
              className={styles.booking}
              data-muted={!upcoming || declined}
            >
              <div className={styles.bookingTop}>
                <div>
                  <h3>{booking.room}</h3>
                  <p>
                    <Clock3 size={15} /> {displayDate(booking.start, timeZone)}{' '}
                    · {displayTime(booking.start, timeZone)}–
                    {displayTime(booking.end, timeZone)}
                  </p>
                  <p>
                    {organizer
                      ? 'You’re organizing'
                      : `${booking.organizer.name} invited you`}
                  </p>
                </div>

                <div className={styles.bookingActions}>
                  {booking.cancelled ? (
                    <span className={styles.tag}>Cancelled</span>
                  ) : past ? (
                    <span className={styles.tag}>Past booking</span>
                  ) : organizer ? (
                    editing !== booking.id && (
                      <>
                        <button
                          type="button"
                          className="secondary"
                          disabled={busy}
                          onClick={() => {
                            setDraft(booking.participants);
                            setEditing(booking.id);
                          }}
                        >
                          {booking.participants.length
                            ? 'Edit people'
                            : 'Invite people'}
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          disabled={busy}
                          onClick={() => void onCancel(booking.id)}
                        >
                          Cancel booking
                        </button>
                      </>
                    )
                  ) : (
                    <div
                      className={styles.reply}
                      role="group"
                      aria-label="Going?"
                    >
                      <span>Going?</span>
                      <button
                        type="button"
                        className={styles.answer}
                        data-answer="yes"
                        aria-pressed={booking.response === 'attending'}
                        disabled={busy}
                        onClick={() => void onRespond(booking.id, 'attending')}
                      >
                        <Check size={15} /> Yes
                      </button>
                      <button
                        type="button"
                        className={styles.answer}
                        data-answer="no"
                        aria-pressed={declined}
                        disabled={busy}
                        onClick={() =>
                          void onRespond(booking.id, 'not_attending')
                        }
                      >
                        <X size={15} /> No
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {editing === booking.id ? (
                <div className={styles.editPeople}>
                  <PeoplePicker
                    selected={draft}
                    onChange={setDraft}
                    capacity={booking.capacity}
                    disabled={busy}
                  />
                  <div className={styles.editActions}>
                    <button
                      type="button"
                      className="primary"
                      disabled={busy || draft.length + 1 > booking.capacity}
                      onClick={async () => {
                        if (await onSavePeople(booking.id, draft))
                          setEditing(undefined);
                      }}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() => setEditing(undefined)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                booking.participants.length > 0 && (
                  <Attendees booking={booking} you={you} />
                )
              )}
            </article>
          );
        })}
      </div>
    </>
  );
}
