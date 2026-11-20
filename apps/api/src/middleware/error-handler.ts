import type { ErrorRequestHandler } from 'express';
import { z } from 'zod';

import { HttpError } from '../http-error.js';

// Database rules that a request can break, by constraint name. Matching the
// name rather than the error code keeps one rule's message from showing up
// for another, since several rules share a code.
const constraintErrors: Record<string, string> = {
  bookings_no_overlap: 'That time is no longer available. Choose another slot.',
  rooms_name_key: 'A room with that name already exists.',
  team_has_owner:
    'A team needs at least one owner. Make someone else an owner first, or delete the team.',
  team_invites_one_at_a_time:
    'That address already has an invitation from this team. You can invite it again once that invitation expires.',
};

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
  } else if (error instanceof z.ZodError || error.status === 400) {
    res.status(400).json({ error: 'Check the fields and try again.' });
  } else if (constraintErrors[error.constraint]) {
    res.status(409).json({ error: constraintErrors[error.constraint] });
  } else {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Try again.' });
  }
};
