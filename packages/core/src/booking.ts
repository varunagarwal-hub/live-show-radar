import { radarConfig } from "@radar/config";
import { fetchText, BROWSER_UA } from "./http";

/**
 * Finding the booking page for a show when no source gave a ticket link. Two ways, cheapest first:
 *
 * 1. The artist's link-in-bio page (Linktree etc.). Artists list every date there with its exact
 *    booking link ("Oktoberfest | Goa - 1st November 2026" → district.in/events/…), so a link
 *    whose title or address names the show's city and date is a direct hit.
 * 2. A web search through Groq's browser_search tool, for shows the bio page doesn't cover
 *    (Diljit Dosanjh's tour, sold only on BookMyShow). Only event pages on ticketing sites that
 *    name the artist and the city are accepted; anything else is discarded rather than guessed.
 *
 * Neither path opens a ticketing site itself: those pages block servers, and we never try to
 * get past that. The links are for Karan to open in his own browser.
 */

export interface BookingShow {
  artistName: string;
  city: string;
  date: string | null;
}

export interface BookingLink {
  title: string;
  url: string;
}

const TICKETING_HOST = /(^|\.)(district\.in|bookmyshow\.com|skillboxes\.com|insider\.in|thumpn\.com|zomato\.com|paytm\.com|platinumlist\.net|ticketmaster\.co\.in|townscript\.com|highape\.com|sortmyscene\.com)$/i;
/** Landing, listing and search pages: never a booking page for one show. */
const NOT_EVENT_PATH = /^\/?$|\/(explore|search|discover|home|city|cities|venues?|artists?|movies|plays|sports|activities|campaigns?|offers?)(\/|$)|\/events\/?$/i;

/** An event page on an Indian ticketing site (not its home, city, search or artist page). */
export function isEventPageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    if (!TICKETING_HOST.test(u.hostname)) return false;
    if (/^(cdn|assets?|static|img|images|link)\./i.test(u.hostname)) return false;
    return !NOT_EVENT_PATH.test(u.pathname) && u.pathname.split("/").filter(Boolean).length >= 2;
  } catch {
    return false;
  }
}

const norm = (s: string) =>
  ` ${s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;

/** The show's city and its aliases ("Delhi NCR" also matches Noida, Gurugram…). */
function cityWords(city: string): string[] {
  const c = radarConfig.cities.find((x) => x.name.toLowerCase() === city.toLowerCase());
  return [city, ...(c?.aliases ?? [])].map((w) => norm(w).trim()).filter((w) => w.length >= 3 && w !== "ncr");
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** True when the text names this date ("1st November", "Nov 1", "01-11-2026", "oct30"…). */
function namesDate(text: string, date: string): boolean {
  const [, m, d] = date.split("-").map(Number) as [number, number, number];
  const month = MONTHS[m - 1]!;
  const t = norm(text);
  const day = `(0?${d})(st|nd|rd|th)?`;
  const mon = `(${month}|${month.slice(0, 3)})`;
  return (
    new RegExp(` ${day} ${mon} `).test(t) ||
    new RegExp(` ${mon} ${day} `).test(t) ||
    new RegExp(` ${mon}${d} `).test(t) ||
    new RegExp(` 0?${d} 0?${m} 20\\d\\d `).test(t)
  );
}

/** Any date written in the text at all (so a link for a different date can be ruled out). */
function namesSomeDate(text: string): boolean {
  const t = norm(text);
  return MONTHS.some((mo) => new RegExp(` (\\d{1,2}(st|nd|rd|th)? ${mo}|${mo} \\d{1,2}|${mo.slice(0, 3)}\\d{1,2}) `).test(t) || new RegExp(` \\d{1,2} ${mo.slice(0, 3)} `).test(t));
}

/**
 * The bio-page link that books this show: a ticketing event page whose title or address names
 * the city, and the date too whenever the link mentions any date. Null when nothing fits or
 * when two different links fit equally (better no link than the wrong one).
 */
export function matchBookingLink(show: BookingShow, links: BookingLink[]): string | null {
  if (show.city === "TBA") return null;
  const words = cityWords(show.city);
  const hits = links.filter((l) => {
    if (!isEventPageUrl(l.url)) return false;
    const text = `${l.title} ${l.url.replace(/[?#].*$/, "")}`;
    const t = norm(text);
    if (!words.some((w) => t.includes(` ${w} `))) return false;
    if (show.date && namesSomeDate(text)) return namesDate(text, show.date);
    return true;
  });
  const urls = [...new Set(hits.map((h) => h.url))];
  return urls.length === 1 ? urls[0]! : null;
}

const LINK_PAGE_HOST = /(^|\.)(linktr\.ee|bio\.link|beacons\.ai|hoo\.be|solo\.to|komi\.io|tap\.bio|campsite\.bio|bfan\.link|fanlink\.tv|ffm\.to|lnk\.to)$/i;

export function isLinkPage(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return LINK_PAGE_HOST.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

const decodeJsonString = (s: string) => {
  try {
    return JSON.parse(`"${s}"`) as string;
  } catch {
    return s;
  }
};

/** The titled links on a link-in-bio page (Linktree's embedded data, else plain anchors). */
export function parseLinkPage(html: string): BookingLink[] {
  const out: BookingLink[] = [];
  for (const m of html.matchAll(/"title":"((?:[^"\\]|\\.)*)"(?:,"[a-zA-Z]+":(?:"(?:[^"\\]|\\.)*"|[-\d.]+|true|false|null))*,"url":"((?:[^"\\]|\\.)*)"/g)) {
    out.push({ title: decodeJsonString(m[1]!), url: decodeJsonString(m[2]!) });
  }
  for (const m of html.matchAll(/<a\b[^>]*\bhref="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    out.push({ title: m[2]!.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim(), url: m[1]!.replace(/&amp;/g, "&") });
  }
  return out;
}

export async function fetchLinkPage(url: string, fetchPage: (u: string) => Promise<string> = (u) => fetchText(u, { headers: { "user-agent": BROWSER_UA }, attempts: 1, timeoutMs: 15_000 })): Promise<BookingLink[]> {
  return parseLinkPage(await fetchPage(url));
}

const SearchAnswer = (raw: string): { url: string | null; date: string | null } => {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return { url: null, date: null };
  try {
    const j = JSON.parse(m[0]) as { url?: unknown; event_date?: unknown };
    return { url: typeof j.url === "string" ? j.url : null, date: typeof j.event_date === "string" ? j.event_date : null };
  } catch {
    return { url: null, date: null };
  }
};

/** Artist-name words that must appear in a searched link (skips short words like "DJ", "A.R."). */
function artistWords(name: string): string[] {
  return norm(name)
    .trim()
    .split(" ")
    .filter((w) => w.length >= 4);
}

/**
 * Whether a searched link is believable for this show: an event page that names the artist
 * (or the city, for festival pages listing the artist) and the city.
 */
export function plausibleSearchedLink(show: BookingShow, url: string): boolean {
  if (!isEventPageUrl(url) || show.city === "TBA") return false;
  const t = norm(url.replace(/[?#].*$/, ""));
  const artist = artistWords(show.artistName);
  const cities = cityWords(show.city);
  return artist.some((w) => t.includes(` ${w} `)) && cities.some((w) => t.includes(` ${w} `));
}

/**
 * Web search for the booking page through Groq's browser_search tool. Returns null when nothing
 * believable comes back. One call costs ~15k tokens, so callers ration it.
 */
export async function searchBookingUrl(apiKey: string, show: BookingShow, model = "openai/gpt-oss-120b"): Promise<string | null> {
  const when = show.date ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${show.date}T00:00:00Z`)) : "upcoming";
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      model,
      temperature: 0,
      tool_choice: "auto",
      tools: [{ type: "browser_search" }],
      messages: [
        {
          role: "system",
          content:
            "You find the official ticket booking page for one concert in India. Always use the browser_search tool first, then answer in plain text with JSON only: " +
            '{"url": string|null, "event_date": "YYYY-MM-DD"|null}. url must be the event\'s own page on an Indian ticketing site ' +
            "(BookMyShow, District, Skillboxes, Thumpn, Zomato Live…), copied exactly from a search result, for this exact city and date. " +
            "Never a home, city, search or artist page, never a news article, never a past year's event, never a guess. If unsure, url is null.",
        },
        { role: "user", content: `${show.artistName}, ${show.city}, ${when}` },
      ],
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    choices?: { message?: { content?: string | null } }[];
    error?: { code?: string; message?: string; failed_generation?: string };
  };
  // The model sometimes wraps its final answer in a made-up tool call; Groq rejects that but
  // returns the attempt, which still holds the JSON answer.
  const text = res.ok ? (body.choices?.[0]?.message?.content ?? "") : body.error?.code === "tool_use_failed" ? (body.error.failed_generation ?? "").replace(/^[\s\S]*?"arguments":\s*/, "") : null;
  if (text === null) throw new Error(`groq ${res.status}: ${body.error?.message?.slice(0, 200) ?? "no answer"}`);
  const { url, date } = SearchAnswer(text);
  if (!url || !plausibleSearchedLink(show, url)) return null;
  // A different date means a different show, except a reschedule by a few days (same page).
  if (show.date && date && /^\d{4}-\d\d-\d\d$/.test(date) && Math.abs(Date.parse(date) - Date.parse(show.date)) > 3 * 86_400_000) return null;
  return url;
}
