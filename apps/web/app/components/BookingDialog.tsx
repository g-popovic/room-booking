'use client';

import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Account, Room } from '../lib/api';
import { displayTime } from '../lib/format';
import styles from './BookingDialog.module.css';

export function BookingDialog({
  room,
  date,
  timeZone,
  account,
  accounts,
  onAccount,
  onClose,
  onBook,
  busy,
  error,
}: {
  room: Room;
  date: string;
  timeZone: string;
  account: Account | null;
  accounts: Account[];
  onAccount: (id: string) => Promise<void>;
  onClose: () => void;
  onBook: (roomId: number, start: string, end: string) => Promise<void>;
  busy: boolean;
  error: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [duration, setDuration] = useState(1);
  const [start, setStart] = useState('');

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const options = room.slots.map((slot, index) => {
    const span = room.slots.slice(index, index + duration);

    return {
      ...slot,
      end: span.at(-1)!.end,
      available:
        span.length === duration && span.every((part) => part.available),
    };
  });

  const selected = options.find(
    (slot) => slot.start === start && slot.available,
  );

  const formattedDate = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(date + 'T12:00:00Z'));

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      onCancel={onClose}
      aria-labelledby="booking-title"
    >
      <div className={styles.header}>
        <div>
          <p className={styles.date}>{formattedDate}</p>
          <h2 id="booking-title">Book {room.name}</h2>
        </div>
        <button
          type="button"
          className="secondary"
          aria-label="Close booking dialog"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>

      <label className={styles.duration}>
        Meeting length
        <select
          value={duration}
          onChange={(event) => setDuration(Number(event.target.value))}
          disabled={busy}
        >
          {Array.from({ length: 24 }, (_, index) => {
            const minutes = (index + 1) * 30;
            return (
              <option key={minutes} value={index + 1}>
                {minutes < 60
                  ? '30 minutes'
                  : `${Math.floor(minutes / 60)}h${minutes % 60 ? ' 30m' : ''}`}
              </option>
            );
          })}
        </select>
      </label>

      <div className={styles.slots} aria-label="Start times">
        {options.map((slot) => (
          <button
            key={slot.start}
            type="button"
            disabled={!slot.available || busy}
            aria-pressed={selected?.start === slot.start}
            onClick={() => setStart(slot.start)}
          >
            {displayTime(slot.start, timeZone)}
          </button>
        ))}
      </div>

      {!options.some((slot) => slot.available) && (
        <p className={styles.date}>No slots fit this meeting length.</p>
      )}

      {!account && (
        <label className={styles.duration}>
          Demo account
          <select
            defaultValue=""
            disabled={busy}
            onChange={(event) => void onAccount(event.target.value)}
          >
            <option value="" disabled>
              Choose a demo account
            </option>
            {accounts.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
                {person.isAdmin ? ' (admin)' : ''}
              </option>
            ))}
          </select>
        </label>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className={styles.footer}>
        <span>
          {selected
            ? `${displayTime(selected.start, timeZone)}–${displayTime(selected.end, timeZone)} · Free`
            : 'Choose a start time'}
        </span>
        <button
          type="button"
          className="primary"
          disabled={!selected || !account || busy}
          onClick={() => {
            if (selected) void onBook(room.id, selected.start, selected.end);
          }}
        >
          {busy ? 'Working…' : 'Confirm booking'}
        </button>
      </div>
    </dialog>
  );
}
