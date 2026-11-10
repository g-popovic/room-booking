import { VENUE_TIME_ZONE } from '@room-booking/db';
import { DateTime } from 'luxon';

const SLOT_MINUTES = 30;
const OPEN_HOUR = 8;
const CLOSE_HOUR = 20;

export function venueDate(now: Date) {
  return DateTime.fromJSDate(now, { zone: VENUE_TIME_ZONE }).toISODate()!;
}

export function dayWindow(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const day = DateTime.fromISO(date, { zone: VENUE_TIME_ZONE });
  if (!day.isValid) return null;

  return {
    start: day.set({ hour: OPEN_HOUR }).toJSDate(),
    end: day.set({ hour: CLOSE_HOUR }).toJSDate(),
  };
}

export function validBookingWindow(start: Date, end: Date, now: Date) {
  const window = dayWindow(venueDate(start));
  if (
    !window ||
    start < now ||
    start < window.start ||
    end > window.end ||
    end <= start
  ) {
    return false;
  }
  const slotMs = SLOT_MINUTES * 60_000;
  return (
    (start.getTime() - window.start.getTime()) % slotMs === 0 &&
    (end.getTime() - start.getTime()) % slotMs === 0
  );
}

export function availableSlots(
  window: { start: Date; end: Date },
  bookings: { starts_at: Date; ends_at: Date }[],
  now: Date,
) {
  const slots = [];
  const slotMs = SLOT_MINUTES * 60_000;
  for (
    let time = window.start.getTime();
    time < window.end.getTime();
    time += slotMs
  ) {
    const start = new Date(time);
    const end = new Date(time + slotMs);
    slots.push({
      start,
      end,
      available:
        start >= now &&
        !bookings.some(
          (booking) => booking.starts_at < end && booking.ends_at > start,
        ),
    });
  }
  return slots;
}
