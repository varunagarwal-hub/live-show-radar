/**
 * Actions as gig objects instead of text links: a ticket, a cassette, a boarding pass and a
 * wristband. Plain anchors underneath, so they work without JavaScript and with a keyboard.
 */

const ext = { target: "_blank", rel: "noopener noreferrer" } as const;

/** A notched ticket: the main call to action. */
export function TicketButton({ href, label, sub }: { href: string; label: string; sub?: string }) {
  return (
    <a className="act ticket-btn" href={href} {...ext}>
      <span className="tb-main">{label}</span>
      {sub && <span className="tb-sub">{sub}</span>}
    </a>
  );
}

/** A cassette for the pre-show playlist; the reels turn on hover. */
export function CassetteButton({ href }: { href: string }) {
  return (
    <a className="act cassette-btn" href={href} {...ext}>
      <svg viewBox="0 0 64 40" aria-hidden="true" className="cassette">
        <rect x="1.5" y="1.5" width="61" height="37" rx="3" />
        <rect x="10" y="8" width="44" height="16" rx="8" className="window" />
        <g className="reel reel-l">
          <circle cx="20" cy="16" r="5" />
          <path d="M20 11v10M15 16h10" />
        </g>
        <g className="reel reel-r">
          <circle cx="44" cy="16" r="5" />
          <path d="M44 11v10M39 16h10" />
        </g>
        <path d="M14 38l4-8h28l4 8" />
      </svg>
      <span className="act-text">
        <span className="act-kicker">Side A</span>
        Pre-show playlist <span aria-hidden="true">▶</span>
      </span>
    </a>
  );
}

/** A boarding pass with the route, for out-of-city shows. */
export function BoardingPassButton({ href, from, to }: { href: string; from: string; to: string }) {
  return (
    <a className="act boarding-btn" href={href} {...ext} aria-label={`Search flights from ${from} to ${to}`}>
      <span className="bp-route">
        {from} <span className="bp-plane" aria-hidden="true">✈</span> {to}
      </span>
      <span className="bp-label">Search flights</span>
    </a>
  );
}

/** A festival wristband for the artist's own link page. */
export function WristbandButton({ href, label }: { href: string; label: string }) {
  return (
    <a className="act wristband-btn" href={href} {...ext}>
      <span className="wb-holes" aria-hidden="true" />
      {label}
    </a>
  );
}

/** A photo pass for the artist's Instagram: a small camera and their handle. */
export function InstagramButton({ href, handle }: { href: string; handle: string }) {
  return (
    <a className="act insta-btn" href={href} {...ext} aria-label={`${handle} on Instagram`}>
      <svg viewBox="0 0 24 24" aria-hidden="true" className="insta-cam">
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4.2" />
        <circle cx="17.2" cy="6.8" r="1" className="dot" />
      </svg>
      <span className="act-text">
        <span className="act-kicker">Photo pass</span>@{handle}
      </span>
    </a>
  );
}
