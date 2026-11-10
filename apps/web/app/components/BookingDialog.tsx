'use client';

import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import type { Room, Schedule, Slot } from '../lib/api';
import { displayTime, moveDay } from '../lib/format';
import styles from './BookingDialog.module.css';

const LAST_DATE = '9999-12-31';

export function BookingDialog({
  room,
  initialDate,
  refresh,
  timeZone,
  signedIn,
  onDateChange,
  onClose,
  onBook,
  busy,
  error,
}: {
  room: Room;
  initialDate: string;
  refresh: number;
  timeZone: string;
  signedIn: boolean;
  onDateChange: () => void;
  onClose: () => void;
  onBook: (roomId: number, start: string, end: string) => Promise<void>;
  busy: boolean;
  error: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [{ date, revision }, setDateSelection] = useState({
    date: initialDate,
    revision: 0,
  });
  const [duration, setDuration] = useState(1);
  const [start, setStart] = useState('');
  const [availability, setAvailability] = useState<{
    requestKey: string;
    slots: Slot[];
    error?: string;
  }>();

  const requestKey = `${revision}:${refresh}`;

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  useEffect(() => {
    const request = new AbortController();

    api<Schedule>('/rooms?date=' + encodeURIComponent(date), {
      signal: request.signal,
    })
      .then((schedule) => {
        const slots =
          schedule.rooms.find((entry) => entry.id === room.id)?.slots ?? [];

        if (!request.signal.aborted) setAvailability({ requestKey, slots });
      })
      .catch((error) => {
        if (!request.signal.aborted) {
          setAvailability({
            requestKey,
            slots: [],
            error: errorMessage(error),
          });
        }
      });

    return () => request.abort();
  }, [date, requestKey, room.id]);

  const current =
    availability?.requestKey === requestKey ? availability : undefined;
  const slots = availability?.slots.length ? availability.slots : room.slots;
  const canSelect = !!current?.slots.length && !current.error;

  function changeDate(nextDate: string) {
    if (nextDate === date || nextDate < initialDate) return;

    setStart('');
    setDateSelection((previous) => ({
      date: nextDate,
      revision: previous.revision + 1,
    }));
    onDateChange();
  }

  const options = slots.map((slot, index) => {
    const span = slots.slice(index, index + duration);

    return {
      ...slot,
      end: span.at(-1)!.end,
      available:
        span.length === duration && span.every((part) => part.available),
    };
  });

  const selected = canSelect
    ? options.find((slot) => slot.start === start && slot.available)
    : undefined;

  const availabilityError = current?.error || error;
  const hasOpenSlots = canSelect && options.some((slot) => slot.available);
  const availabilityStatus =
    availabilityError ||
    (!current
      ? 'Checking availability…'
      : hasOpenSlots
        ? 'Start time'
        : 'No times fit. Try another date or a shorter meeting.');

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      onCancel={onClose}
      aria-labelledby="booking-title"
    >
      <div className={styles.header}>
        <div>
          <p className={styles.hint}>Times shown in the venue’s time zone</p>
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

      <div className={styles.controls}>
        <div className={styles.field}>
          <label htmlFor="booking-date">Date</label>
          <div className={styles.dateControl}>
            <button
              type="button"
              aria-label="Previous day"
              disabled={busy || date <= initialDate}
              onClick={() => changeDate(moveDay(date, -1))}
            >
              <ChevronLeft size={18} />
            </button>
            <input
              id="booking-date"
              type="date"
              min={initialDate}
              max={LAST_DATE}
              value={date}
              disabled={busy}
              onChange={(event) => {
                if (event.target.value && event.target.validity.valid)
                  changeDate(event.target.value);
              }}
            />
            <button
              type="button"
              aria-label="Next day"
              disabled={busy || date === LAST_DATE}
              onClick={() => changeDate(moveDay(date, 1))}
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
        <label className={styles.field}>
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
      </div>

      <p
        className={styles.availabilityStatus}
        data-error={!!availabilityError}
        role="status"
      >
        {availabilityStatus}
      </p>

      <div
        className={styles.slots}
        role="group"
        aria-label="Start times"
        aria-busy={!current}
      >
        {options.map((slot) => {
          const label = displayTime(slot.start, timeZone);

          return (
            <button
              key={label}
              type="button"
              disabled={!canSelect || !slot.available || busy}
              data-unavailable={!slot.available}
              aria-pressed={selected?.start === slot.start}
              onClick={() => setStart(slot.start)}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className={styles.footer}>
        <span>
          {!signedIn
            ? 'Choose a demo account in the top bar to book.'
            : selected
              ? `${displayTime(selected.start, timeZone)}–${displayTime(selected.end, timeZone)} · Free`
              : 'Choose a start time'}
        </span>
        <button
          type="button"
          className="primary"
          disabled={!selected || !signedIn || busy}
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
