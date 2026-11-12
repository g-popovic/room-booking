'use client';

import { CalendarSync as CalendarSyncIcon, Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import type { CalendarFeed, CreatedCalendarFeed } from '../lib/api';
import { connectGoogleCalendar } from '../lib/calendar';
import type { CalendarLinks } from '../lib/calendar';
import { displayDate } from '../lib/format';
import styles from './CalendarSync.module.css';

type Confirming = 'replace' | 'off' | null;

export function CalendarSync({ timeZone }: { timeZone: string }) {
  // undefined while loading, null when the member has no link.
  const [feed, setFeed] = useState<CalendarFeed | null>();
  // Only set right after creating a link. The server keeps just a hash, so
  // this is the one time the link can be shown.
  const [links, setLinks] = useState<CalendarLinks | null>(null);
  const [tabOpened, setTabOpened] = useState(false);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const request = new AbortController();

    api<CalendarFeed | null>('/calendar-feed', { signal: request.signal })
      .then(setFeed)
      .catch((error) => {
        if (!request.signal.aborted) setError(errorMessage(error));
      });

    return () => request.abort();
  }, []);

  async function connect() {
    setBusy(true);
    setError('');
    setConfirming(null);

    try {
      const connected = await connectGoogleCalendar(() =>
        api<CreatedCalendarFeed>('/calendar-feed', { method: 'POST' }),
      );

      setFeed({ createdAt: connected.feed.createdAt });
      setLinks(connected.links);
      setCopied(false);
      setTabOpened(connected.tabOpened);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setError('');

    try {
      await api('/calendar-feed', { method: 'DELETE' });

      setFeed(null);
      setLinks(null);
      setConfirming(null);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!links) return;

    try {
      await navigator.clipboard.writeText(links.feed);
      setCopied(true);
    } catch {
      input.current?.select();
      setError('Couldn’t copy automatically. The link is selected instead.');
    }
  }

  if (feed === undefined && !error) return null;

  return (
    <section className={styles.panel} aria-labelledby="calendar-sync-title">
      {links ? (
        <>
          <div className={styles.heading}>
            <Check size={18} />
            <h2 id="calendar-sync-title">Your calendar link is ready</h2>
          </div>
          <p className={styles.text}>
            {tabOpened
              ? 'Google Calendar opened in a new tab. Choose Add there to finish.'
              : 'Your browser blocked the new tab. Open Google Calendar to finish.'}
          </p>
          <div className={styles.actions}>
            {!tabOpened && (
              <a
                className="primary"
                href={links.google}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open Google Calendar
              </a>
            )}
            <a className="secondary" href={links.webcal}>
              Other calendar app
            </a>
          </div>

          <label className={styles.label} htmlFor="calendar-feed-link">
            Or copy the link into any calendar that subscribes by URL
          </label>
          <div className={styles.copy}>
            <input
              ref={input}
              id="calendar-feed-link"
              readOnly
              value={links.feed}
              onFocus={(event) => event.currentTarget.select()}
            />
            <button type="button" className="secondary" onClick={copy}>
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className={styles.hint}>
            This link is only shown now. Anyone with it can see your bookings.
            Google Calendar can take a few hours to show changes.
          </p>
        </>
      ) : feed ? (
        <>
          <div className={styles.row}>
            <div>
              <div className={styles.heading}>
                <CalendarSyncIcon size={18} />
                <h2 id="calendar-sync-title">Calendar sync is on</h2>
              </div>
              <p className={styles.text}>
                Link created {displayDate(feed.createdAt, timeZone)}. Your
                bookings stay up to date in the calendars you added it to.
              </p>
            </div>
            {!confirming && (
              <div className={styles.actions}>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => setConfirming('replace')}
                >
                  Add to a calendar again
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => setConfirming('off')}
                >
                  Turn off
                </button>
              </div>
            )}
          </div>

          {confirming && (
            <div className={styles.confirm} role="group">
              <p className={styles.text}>
                {confirming === 'replace'
                  ? 'This creates a new link. Calendars using your current link will stop updating.'
                  : 'Calendars using your link will stop updating.'}
              </p>
              <div className={styles.actions}>
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    void (confirming === 'replace' ? connect() : turnOff())
                  }
                >
                  {confirming === 'replace'
                    ? 'Create new link'
                    : 'Turn off calendar sync'}
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => setConfirming(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className={styles.row}>
          <div>
            <div className={styles.heading}>
              <CalendarSyncIcon size={18} />
              <h2 id="calendar-sync-title">
                See your bookings in Google Calendar
              </h2>
            </div>
            <p className={styles.text}>
              Add a private calendar that updates when you book or cancel.
            </p>
          </div>
          <button
            type="button"
            className="primary"
            disabled={busy || feed === undefined}
            onClick={() => void connect()}
          >
            Connect Google Calendar
          </button>
        </div>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
