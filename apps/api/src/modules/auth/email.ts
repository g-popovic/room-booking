import { z } from 'zod';

// Emails are trimmed and lowercased before they're stored or compared, so
// Alex@Example.com and alex@example.com are the same address everywhere.
export const emailAddress = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Enter a valid email address.' }).max(254));
