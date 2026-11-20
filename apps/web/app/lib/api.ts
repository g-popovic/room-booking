export type Account = {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
};

export type Session = { account: Account | null };

export type Slot = { start: string; end: string; available: boolean };

export type RoomDetails = {
  name: string;
  description: string;
  capacity: number;
  amenities: string[];
};

export type Room = RoomDetails & { id: number; slots: Slot[] };

export type Schedule = { date: string; timeZone: string; rooms: Room[] };

// A participant's answer. The organizer is always attending and isn't asked.
export type Attendance = 'pending' | 'attending' | 'not_attending';

export type Person = { id: string; name: string };

export type Participant = Person & { response: Attendance };

// A booking the member organizes or is invited to.
export type Booking = {
  id: string;
  room: string;
  capacity: number;
  start: string;
  end: string;
  cancelled: string | null;
  organizer: Person;
  // The signed-in member's own answer.
  response: Attendance | 'organizer';
  participants: Participant[];
};

// People who share a team with the signed-in member.
export type Teammates = {
  people: (Person & { email: string })[];
  teams: { id: string; name: string; memberIds: string[] }[];
};

export type TeamRole = 'owner' | 'member';

export type TeamSummary = {
  id: string;
  name: string;
  role: TeamRole;
  memberCount: number;
};

export type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: TeamRole;
  joinedAt: string;
};

// An invitation as the team's owners see it.
export type TeamInvite = {
  id: string;
  email: string;
  status: 'pending' | 'declined';
  invitedBy: string | null;
  createdAt: string;
  expiresAt: string;
};

// Only owners get `invites`.
export type Team = {
  id: string;
  name: string;
  role: TeamRole;
  members: TeamMember[];
  invites?: TeamInvite[];
};

// An invitation as the invited member sees it.
export type Invitation = {
  id: string;
  team: string;
  invitedBy: string | null;
  createdAt: string;
  expiresAt: string;
};

export type CalendarFeed = { createdAt: string };

export type CreatedCalendarFeed = CalendarFeed & { path: string };

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

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
    throw new ApiError(
      body?.error ?? 'The server couldn’t complete that request.',
      response.status,
    );
  }

  return response.status === 204 ? (undefined as T) : response.json();
}

// True when the request failed because the member isn't signed in, for
// example because their session expired or they signed out in another tab.
export function isSignedOut(error: unknown) {
  return error instanceof ApiError && error.status === 401;
}

export function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'Something went wrong. Try again.';
}
