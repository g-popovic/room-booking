import { ArrowRight, Users } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { Room } from '../lib/api';
import { RoomIllustration } from './RoomIllustration';
import styles from './RoomCatalog.module.css';

export function RoomCatalog({
  rooms,
  status,
  error,
  onBook,
}: {
  rooms: Room[] | undefined;
  status: ReactNode;
  error: string;
  onBook: (roomId: number) => void;
}) {
  const [people, setPeople] = useState('');
  const groupSize = Number(people);
  const validGroupSize =
    people === '' || (Number.isSafeInteger(groupSize) && groupSize > 0);
  const matchingRooms = validGroupSize
    ? rooms?.filter((room) => room.capacity >= groupSize)
    : [];

  return (
    <section aria-labelledby="rooms-heading">
      <div className={styles.sectionHeader}>
        <div>
          <h2 id="rooms-heading">Meeting rooms</h2>
          <p>08:00–20:00 · Venue local time</p>
        </div>
        <label className={styles.peopleFilter}>
          Number of people
          <input
            type="number"
            min={1}
            step={1}
            placeholder="Any"
            value={people}
            onChange={(event) => setPeople(event.target.value)}
            aria-invalid={!validGroupSize}
          />
        </label>
      </div>

      {status}

      {!rooms && !error && (
        <p className={styles.message} role="status">
          Loading rooms…
        </p>
      )}

      {rooms?.length === 0 && (
        <p className={styles.message}>No rooms have been listed yet.</p>
      )}

      {!validGroupSize && (
        <p className={styles.message} role="status">
          Enter a whole number of people.
        </p>
      )}

      {validGroupSize &&
        rooms &&
        rooms.length > 0 &&
        matchingRooms?.length === 0 && (
          <p className={styles.message} role="status">
            No rooms fit a group of {people}.
          </p>
        )}

      <div className={styles.grid}>
        {matchingRooms?.map((room) => (
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
              <button
                type="button"
                className="primary"
                aria-label={`Book ${room.name}`}
                onClick={() => onBook(room.id)}
              >
                Book <ArrowRight size={16} />
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
