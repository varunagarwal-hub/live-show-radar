import { radarConfig, type CityConfig } from "@radar/config";

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Maps "Bangalore", "BLR", "Gurugram" etc. to the configured city name. Unknown Indian cities
 * (Shillong, Kochi…) are kept, title-cased, because any Indian city is worth an alert.
 */
export function normalizeCity(raw: string | null | undefined, cities: CityConfig[] = radarConfig.cities): string | null {
  if (!raw) return null;
  const n = norm(raw);
  if (!n) return null;
  for (const c of cities) {
    if (norm(c.name) === n || c.aliases.some((a) => norm(a) === n)) return c.name;
  }
  // "Bengaluru, Karnataka" / "Gurugram (Delhi NCR)"
  for (const c of cities) {
    const words = new Set(n.split(" "));
    if ([c.name, ...c.aliases].some((a) => { const an = norm(a); return an.includes(" ") ? n.includes(an) : words.has(an); })) return c.name;
  }
  return raw.trim().replace(/\b\w/g, (ch) => ch.toUpperCase());
}

/** A configured city named as a whole word in free text ("… Live in Bangalore | 12 Dec"). */
export function cityInText(text: string, cities: CityConfig[] = radarConfig.cities): string | null {
  const t = ` ${norm(text)} `;
  for (const c of cities) {
    if ([c.name, ...c.aliases].some((a) => { const an = norm(a); return an.length >= 3 && t.includes(` ${an} `); })) return c.name;
  }
  return null;
}

/**
 * City from an Indian postal address: the part before "State 560038". "…, Visakhapatnam,
 * Andhra Pradesh 530001, India" → "Visakhapatnam". Falls back to configured-city detection.
 */
export function cityFromAddress(address: string): string | null {
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  const pinIdx = parts.findIndex((p) => /^[A-Za-z .&]+\s+\d{6}$/.test(p));
  if (pinIdx > 0) {
    const known = cityInText(parts.slice(Math.max(0, pinIdx - 2), pinIdx + 1).join(", "));
    return known ?? normalizeCity(parts[pinIdx - 1]!);
  }
  if (parts.length === 1) return normalizeCity(parts[0]!);
  return cityInText(address);
}

export function isHomeCity(city: string | null | undefined): boolean {
  return normalizeCity(city) === radarConfig.homeCity;
}

export function cityConfig(name: string | null | undefined): CityConfig | undefined {
  const n = normalizeCity(name);
  return radarConfig.cities.find((c) => c.name === n);
}
