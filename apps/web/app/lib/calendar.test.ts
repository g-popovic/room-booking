import assert from 'node:assert/strict';
import { test } from 'node:test';

import { calendarLinks, connectGoogleCalendar } from './calendar';
import type { CalendarTab } from './calendar';

const path = '/api/calendar/Ab3_-xYz0123456789abcdefghijklmnopqrstuvwxy.ics';

function fakeTab() {
  const tab: CalendarTab & { closed: boolean } = {
    opener: 'roomwell',
    location: { href: '' },
    closed: false,
    close() {
      tab.closed = true;
    },
  };
  return tab;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('links point at the feed on the current site', () => {
  const links = calendarLinks(path, 'https://roomwell.example');

  assert.equal(links.feed, `https://roomwell.example${path}`);
  assert.equal(links.webcal, `webcal://roomwell.example${path}`);
});

test('local http addresses become webcal links too', () => {
  const links = calendarLinks(path, 'http://127.0.0.1:3000');

  assert.equal(links.feed, `http://127.0.0.1:3000${path}`);
  assert.equal(links.webcal, `webcal://127.0.0.1:3000${path}`);
});

test('the Google link opens the Add calendar prompt for the feed', () => {
  const links = calendarLinks(path, 'https://roomwell.example');
  const google = new URL(links.google);

  assert.equal(google.origin, 'https://calendar.google.com');
  assert.equal(google.pathname, '/calendar/r');
  assert.deepEqual([...google.searchParams.keys()], ['cid']);
  assert.equal(google.searchParams.get('cid'), links.webcal);
  // The feed URL is encoded, so its own characters can't break Google's URL.
  assert.ok(links.google.includes('cid=webcal%3A%2F%2Froomwell.example%2F'));
});

test('the tab opens before the link is requested, while the click still counts', async () => {
  const steps: string[] = [];
  const request = deferred<{ path: string }>();

  const connecting = connectGoogleCalendar(
    () => {
      steps.push('request link');
      return request.promise;
    },
    () => {
      steps.push('open tab');
      return fakeTab();
    },
    'https://roomwell.example',
  );

  // Both happen synchronously, before anything is awaited.
  assert.deepEqual(steps, ['open tab', 'request link']);

  request.resolve({ path });
  await connecting;
});

test('the tab goes to Google only once the link exists', async () => {
  const tab = fakeTab();
  const request = deferred<{ path: string; createdAt: string }>();

  const connecting = connectGoogleCalendar(
    () => request.promise,
    () => tab,
    'https://roomwell.example',
  );
  await Promise.resolve();
  assert.equal(tab.location.href, '');

  const feed = { path, createdAt: '2032-06-10T06:00:00.000Z' };
  request.resolve(feed);
  const result = await connecting;

  assert.equal(result.tabOpened, true);
  assert.equal(result.feed, feed);
  assert.deepEqual(
    result.links,
    calendarLinks(path, 'https://roomwell.example'),
  );
  assert.equal(tab.location.href, result.links.google);
  assert.equal(tab.opener, null, 'Google must not reach back into Roomwell');
  assert.equal(tab.closed, false);
});

test('a blocked tab still returns the links so the page can offer a button', async () => {
  const result = await connectGoogleCalendar(
    async () => ({ path }),
    () => null,
    'https://roomwell.example',
  );

  assert.equal(result.tabOpened, false);
  assert.equal(result.links.feed, `https://roomwell.example${path}`);
});

test('if the link can’t be created, the blank tab is closed', async () => {
  const tab = fakeTab();
  const failure = new Error('Choose a demo account to set up calendar sync.');

  await assert.rejects(
    connectGoogleCalendar(
      async () => {
        throw failure;
      },
      () => tab,
      'https://roomwell.example',
    ),
    failure,
  );

  assert.equal(tab.closed, true);
  assert.equal(tab.location.href, '');
});
