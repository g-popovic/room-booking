export type Account = { id: string; name: string; isAdmin: boolean };
export type Session = { account: Account | null; accounts: Account[] };
export type Slot = { start: string; end: string; available: boolean };
export type RoomDetails = {
  name: string;
  description: string;
  capacity: number;
  amenities: string[];
};
export type Room = RoomDetails & { id: number; slots: Slot[] };
export type Schedule = { date: string; timeZone: string; rooms: Room[] };
export type Booking = {
  id: string;
  room: string;
  start: string;
  end: string;
  cancelled: string | null;
};

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch('/api' + path, {
    ...options,
    cache: 'no-store',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(
      body?.error ?? 'The server couldn’t complete that request.',
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

export function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'Something went wrong. Try again.';
}

export function displayTime(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

export function displayDate(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(iso));
}

export function moveDay(date: string, days: number) {
  const day = new Date(date + 'T12:00:00Z');
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}
