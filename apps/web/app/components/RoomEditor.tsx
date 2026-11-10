'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Room, RoomDetails } from '../lib/api';
import { errorMessage } from '../lib/api';
import styles from './RoomEditor.module.css';

export function RoomEditor({
  room,
  onSave,
  onClose,
}: {
  room: Room | null;
  onSave: (room: RoomDetails, id?: number) => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    setBusy(true);
    setError('');

    try {
      await onSave(
        {
          name: String(form.get('name')).trim(),
          description: String(form.get('description')).trim(),
          capacity: Number(form.get('capacity')),
          amenities: String(form.get('amenities'))
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean),
        },
        room?.id,
      );
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={save}>
      <h3>{room ? `Edit ${room.name}` : 'Add a room'}</h3>

      <div className={styles.fields}>
        <label>
          Room name
          <input
            name="name"
            defaultValue={room?.name}
            maxLength={80}
            required
          />
        </label>

        <label>
          Capacity
          <input
            name="capacity"
            type="number"
            min={1}
            max={100}
            defaultValue={room?.capacity ?? 4}
            required
          />
        </label>
      </div>

      <label>
        Description
        <textarea
          name="description"
          defaultValue={room?.description}
          maxLength={300}
          rows={3}
          required
        />
      </label>

      <label>
        Amenities <span>Separate items with commas</span>
        <input name="amenities" defaultValue={room?.amenities.join(', ')} />
      </label>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className={styles.actions}>
        <button
          type="button"
          className="secondary"
          onClick={onClose}
          disabled={busy}
        >
          Cancel
        </button>
        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save room'}
        </button>
      </div>
    </form>
  );
}
