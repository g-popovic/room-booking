import { Clock3 } from 'lucide-react';
import type { Booking } from '../lib/api';
import { displayDate, displayTime } from '../lib/format';
import styles from './BookingList.module.css';

export function MyBookings({
  signedIn,
  bookings,
  timeZone,
  busy,
  onCancel,
}: {
  signedIn: boolean;
  bookings: Booking[];
  timeZone: string;
  busy: boolean;
  onCancel: (id: string) => Promise<void>;
}) {
  return (
    <>
      {!signedIn && (
        <p className={styles.message}>
          Choose a demo account to see your bookings.
        </p>
      )}
      {signedIn && bookings.length === 0 && (
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
                  <Clock3 size={15} /> {displayDate(booking.start, timeZone)} ·{' '}
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
                  onClick={() => void onCancel(booking.id)}
                >
                  Cancel booking
                </button>
              )}
            </article>
          );
        })}
      </div>
    </>
  );
}
