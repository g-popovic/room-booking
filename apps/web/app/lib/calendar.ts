// Subscription links for the private booking feed. The API returns a path;
// the origin comes from the page so the links follow wherever Roomwell runs.
export function calendarLinks(path: string, origin = window.location.origin) {
  const feed = new URL(path, origin).href;
  const webcal = feed.replace(/^https?:/, 'webcal:');

  return {
    feed,
    // Opens the default calendar app (Apple Calendar, Outlook, …).
    webcal,
    // Opens Google Calendar's "Add calendar" prompt with the feed filled in.
    google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`,
  };
}

export type CalendarLinks = ReturnType<typeof calendarLinks>;

// The parts of a browser tab that connectGoogleCalendar uses.
export interface CalendarTab {
  opener: unknown;
  location: { href: string };
  close(): void;
}

// Creates a feed link and opens Google Calendar's "Add calendar" prompt for
// it in a new tab. The tab must open while the click is still being handled,
// or popup blockers stop it, so it opens blank first and is pointed at Google
// once the link exists. Returns tabOpened: false if the browser blocked it.
export async function connectGoogleCalendar<Feed extends { path: string }>(
  createFeed: () => Promise<Feed>,
  openTab: () => CalendarTab | null = () => window.open('', '_blank'),
  origin?: string,
) {
  const tab = openTab();

  try {
    const feed = await createFeed();
    const links = calendarLinks(feed.path, origin);

    if (tab) {
      // Google's page shouldn't be able to reach back into Roomwell.
      tab.opener = null;
      tab.location.href = links.google;
    }

    return { feed, links, tabOpened: !!tab };
  } catch (error) {
    tab?.close();
    throw error;
  }
}
