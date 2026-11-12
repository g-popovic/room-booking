// Minimal iCalendar (RFC 5545) writer for the read-only booking feed.

export interface CalendarEvent {
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  location: string;
  description: string;
}

const MAX_LINE_OCTETS = 75;

// TEXT values escape backslashes, semicolons, commas and line breaks.
export function escapeText(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

// UTC date-time form, e.g. 20320610T080000Z.
export function formatUtc(date: Date) {
  return date.toISOString().replace(/[-:]|\.\d{3}/g, '');
}

// Lines longer than 75 octets continue on the next line after a single space.
// Splits happen between characters so multi-byte UTF-8 sequences stay intact.
export function foldLine(line: string) {
  const parts: string[] = [];
  let current = '';
  let octets = 0;

  for (const char of line) {
    const size = Buffer.byteLength(char);
    const limit = parts.length === 0 ? MAX_LINE_OCTETS : MAX_LINE_OCTETS - 1;

    if (octets + size > limit) {
      parts.push(current);
      current = '';
      octets = 0;
    }

    current += char;
    octets += size;
  }

  parts.push(current);
  return parts.join('\r\n ');
}

export function buildCalendar(
  calendar: { name: string; productId: string },
  events: CalendarEvent[],
  now: Date,
) {
  const stamp = formatUtc(now);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${calendar.productId}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `NAME:${escapeText(calendar.name)}`,
    `X-WR-CALNAME:${escapeText(calendar.name)}`,
    // Refresh hints. Apple Calendar and Outlook respect them; Google ignores
    // them and refreshes subscriptions on its own schedule.
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];

  for (const event of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${formatUtc(event.start)}`,
      `DTEND:${formatUtc(event.end)}`,
      `SUMMARY:${escapeText(event.summary)}`,
      `LOCATION:${escapeText(event.location)}`,
      `DESCRIPTION:${escapeText(event.description)}`,
      'STATUS:CONFIRMED',
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');

  return lines.map(foldLine).join('\r\n') + '\r\n';
}
