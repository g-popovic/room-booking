import { ArrowRight, ChevronLeft, ChevronRight, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Room } from '../lib/api';
import { moveDay } from '../lib/format';
import { RoomIllustration } from './RoomIllustration';
import styles from './RoomCatalog.module.css';

export function RoomCatalog({
  date: day,
  rooms,
  status,
  error,
  onDateChange,
  onBook,
}: {
  date: string;
  rooms: Room[] | undefined;
  status: ReactNode;
  error: string;
  onDateChange: (date: string) => void;
  onBook: (roomId: number) => void;
}) {
  return (
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
            onClick={() => onDateChange(moveDay(day, -1))}
          >
            <ChevronLeft size={18} />
          </button>
          <input
            type="date"
            aria-label="Booking date"
            value={day}
            onChange={(event) => {
              if (event.target.value) onDateChange(event.target.value);
            }}
          />
          <button
            type="button"
            aria-label="Next day"
            disabled={!day}
            onClick={() => onDateChange(moveDay(day, 1))}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
      {status}
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
          const openSlots = room.slots.filter((slot) => slot.available).length;
          return (
            <article key={room.id} className={styles.card}>
              <div className={styles.illustration}>
                <RoomIllustration id={room.id} capacity={room.capacity} />
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
                  <span className={openSlots ? styles.dot : styles.closedDot} />
                  {openSlots
                    ? `${openSlots} open ${openSlots === 1 ? 'slot' : 'slots'}`
                    : 'Fully booked or closed'}
                </span>
                <button
                  type="button"
                  className="primary"
                  disabled={!openSlots}
                  aria-label={`Book ${room.name}`}
                  onClick={() => onBook(room.id)}
                >
                  Book <ArrowRight size={16} />
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
