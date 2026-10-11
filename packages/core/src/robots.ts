/**
 * Minimal robots.txt support: groups, Allow/Disallow, `*` wildcards and `$` anchors,
 * longest-match wins (RFC 9309). Enough to honour the ticketing sites' rules.
 */
export interface RobotsRules {
  allow: string[];
  disallow: string[];
}

export function parseRobots(text: string, userAgent: string): RobotsRules {
  const ua = userAgent.toLowerCase();
  const groups: { agents: string[]; allow: string[]; disallow: string[] }[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], allow: [], disallow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === "allow" && value) current.allow.push(value);
    if (key === "disallow" && value) current.disallow.push(value);
  }
  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && ua.includes(a)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes("*"));
  return { allow: chosen.flatMap((g) => g.allow), disallow: chosen.flatMap((g) => g.disallow) };
}

function patternToRegex(p: string): RegExp {
  const anchored = p.endsWith("$");
  const body = (anchored ? p.slice(0, -1) : p).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

export function isAllowed(rules: RobotsRules, pathAndQuery: string): boolean {
  let best: { len: number; allow: boolean } = { len: -1, allow: true };
  for (const [list, allow] of [
    [rules.allow, true],
    [rules.disallow, false],
  ] as const) {
    for (const p of list) {
      if (patternToRegex(p).test(pathAndQuery) && (p.length > best.len || (p.length === best.len && allow))) {
        best = { len: p.length, allow };
      }
    }
  }
  return best.allow;
}

const cache = new Map<string, RobotsRules>();

/** Fetches and caches robots.txt per origin for the life of the run. Unreachable robots → allowed. */
export async function robotsAllows(url: string, userAgent: string, fetcher: (u: string) => Promise<string>): Promise<boolean> {
  const u = new URL(url);
  let rules = cache.get(u.origin);
  if (!rules) {
    try {
      rules = parseRobots(await fetcher(`${u.origin}/robots.txt`), userAgent);
    } catch {
      rules = { allow: [], disallow: [] };
    }
    cache.set(u.origin, rules);
  }
  return isAllowed(rules, u.pathname + u.search);
}
