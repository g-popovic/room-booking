import type { ErrorRequestHandler } from 'express';
import { z } from 'zod';

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof z.ZodError || error.status === 400) {
    res.status(400).json({ error: 'Check the fields and try again.' });
  } else if (error.code === '23P01') {
    res.status(409).json({
      error: 'That time is no longer available. Choose another slot.',
    });
  } else if (error.code === '23505') {
    res.status(409).json({ error: 'A room with that name already exists.' });
  } else {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Try again.' });
  }
};
