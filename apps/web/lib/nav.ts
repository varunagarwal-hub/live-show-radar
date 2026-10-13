/** The More menu: everyone's own pages, then the owner's tools. Shared by the nav and /more. */
export const MORE = [
  { href: "/artists", label: "Artists", note: "Your watchlist and tiers", ownerOnly: false },
  { href: "/you", label: "You", note: "Telegram, calendar, Spotify", ownerOnly: false },
  { href: "/health", label: "Health", note: "Sources and jobs", ownerOnly: true },
  { href: "/admin", label: "Door list", note: "Invites and people", ownerOnly: true },
];

export const moreFor = (isOwner: boolean) => MORE.filter((m) => isOwner || !m.ownerOnly);
