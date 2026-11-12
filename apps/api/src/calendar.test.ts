import assert from 'node:assert/strict';
import { test } from 'node:test';
import ICAL from 'ical.js';

import {
  buildCalendar,
  escapeText,
  foldLine,
  type CalendarEvent,
} from './modules/calendar/ics.js';
import {
  createFeedToken,
  hashFeedToken,
  isFeedToken,
} from './modules/calendar/token.js';

const now = new Date('2032-06-10T06:00:00Z');
const calendar = { name: 'Roomwell', productId: '-//Roomwell//Test//EN' };
const event: CalendarEvent = {
  uid: '7d3c2f0e-5b1a-4c8e-9f6d-2a4b6c8d0e1f@roomwell',
  start: new Date('2032-06-10T08:00:00Z'),
  end: new Date('2032-06-10T09:30:00Z'),
  summary: 'The Nook · Roomwell',
  location: 'The Commons, Podgorica',
  description: 'Booked through Roomwell.',
};

function parseEvents(ics: string) {
  const component = new ICAL.Component(ICAL.parse(ics));
  return component
    .getAllSubcomponents('vevent')
    .map((vevent) => new ICAL.Event(vevent));
}

test('the calendar follows RFC 5545 line rules', () => {
  const long = 'Ž'.repeat(60) + ' Studio, with; commas\\and\nnew lines';
  const ics = buildCalendar(
    calendar,
    [{ ...event, summary: long, description: long }],
    now,
  );

  assert.ok(ics.endsWith('\r\n'));
  assert.doesNotMatch(ics, /[^\r]\n/, 'every line break is CRLF');

  for (const line of ics.split('\r\n')) {
    assert.ok(Buffer.byteLength(line) <= 75, `line too long: ${line}`);
    assert.doesNotMatch(line, /\uFFFD/);
  }

  const [parsed] = parseEvents(ics);
  assert.equal(parsed.summary, long);
  assert.equal(parsed.description, long);
});

test('events round-trip through a standards-compliant parser', () => {
  const ics = buildCalendar(calendar, [event], now);
  const component = new ICAL.Component(ICAL.parse(ics));

  assert.equal(component.getFirstPropertyValue('version'), '2.0');
  assert.equal(component.getFirstPropertyValue('prodid'), calendar.productId);
  assert.equal(component.getFirstPropertyValue('x-wr-calname'), 'Roomwell');

  const [parsed] = parseEvents(ics);
  assert.equal(parsed.uid, event.uid);
  assert.equal(parsed.summary, event.summary);
  assert.equal(parsed.location, event.location);
  assert.equal(parsed.description, event.description);
  assert.equal(parsed.startDate.toJSDate().getTime(), event.start.getTime());
  assert.equal(parsed.endDate.toJSDate().getTime(), event.end.getTime());
  assert.equal(parsed.startDate.zone?.tzid, 'UTC');
  assert.equal(
    parsed.component.getFirstPropertyValue('dtstamp')?.toString(),
    '2032-06-10T06:00:00Z',
  );
});

test('text values are escaped as RFC 5545 requires', () => {
  assert.equal(escapeText('a\\b;c,d\ne\r\nf'), 'a\\\\b\\;c\\,d\\ne\\nf');

  const ics = buildCalendar(calendar, [event], now);
  assert.ok(ics.includes('\r\nLOCATION:The Commons\\, Podgorica\r\n'));
});

test('an empty feed is still a valid calendar', () => {
  const ics = buildCalendar(calendar, [], now);

  assert.deepEqual(parseEvents(ics), []);
});

test('folding never splits a multi-byte character', () => {
  const folded = foldLine('SUMMARY:' + '€'.repeat(40));

  for (const line of folded.split('\r\n')) {
    assert.ok(Buffer.byteLength(line) <= 75);
  }

  assert.equal(folded.replace(/\r\n /g, ''), 'SUMMARY:' + '€'.repeat(40));
});

test('feed tokens are random, URL-safe, and hashed deterministically', () => {
  const a = createFeedToken();
  const b = createFeedToken();

  assert.notEqual(a.token, b.token);
  assert.ok(isFeedToken(a.token));
  assert.deepEqual(hashFeedToken(a.token), a.hash);
  assert.equal(a.hash.length, 32);
  assert.equal(isFeedToken('too-short'), false);
  assert.equal(isFeedToken(a.token + '/'), false);
});
