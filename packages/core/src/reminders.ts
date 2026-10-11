import { radarConfig } from "@radar/config";
import { decideByDeadline } from "./deadline";
import type { SnapshotEvent } from "./state";
import type { ReminderKind } from "./telegram";

export interface DueReminder {
  kind: ReminderKind;
  eventId: number;
  /** Includes the target time, so a rescheduled sale gets a fresh reminder. */
  dedupKey: string;
  at: Date;
}

const toDate = (s: string | null) => (s ? new Date(s) : null);

/**
 * Reminders whose window is open right now (spec 4.7). A reminder is due from `window` before its
 * target time until the target itself, so the first run inside the window sends it, and a late
 * cron run still does as long as the moment hasn't passed. `sent` holds keys already delivered;
 * the alerts table's unique key is the final guard against duplicates.
 */
export function dueReminders(
  events: SnapshotEvent[],
  now: Date,
  sent: Set<string>,
  opts = { saleWindowMin: radarConfig.reminders.saleStartWindowMinutes, decideWindowHours: radarConfig.reminders.decideByWindowHours },
): DueReminder[] {
  const out: DueReminder[] = [];
  const inWindow = (at: Date | null, windowMs: number): at is Date => !!at && at.getTime() > now.getTime() && at.getTime() - now.getTime() <= windowMs;
  for (const e of events) {
    if (e.decision === "pass" || e.decision === "not_interested") continue;
    if (e.urgency === "possible") continue;
    const sale = toDate(e.saleStartsAt);
    if (inWindow(sale, opts.saleWindowMin * 60_000)) out.push({ kind: "sale_reminder", eventId: e.id, dedupKey: `sale:${e.id}:${sale.toISOString()}`, at: sale });
    const ebOpens = toDate(e.earlyBirdOpensAt);
    if (e.earlyBirdStatus !== "sold_out" && inWindow(ebOpens, opts.saleWindowMin * 60_000)) {
      out.push({ kind: "early_bird_reminder", eventId: e.id, dedupKey: `ebopen:${e.id}:${ebOpens.toISOString()}`, at: ebOpens });
    }
    if (e.decision === "maybe") {
      const d = decideByDeadline(
        { date: e.date, earlyBirdStatus: e.earlyBirdStatus, earlyBirdOpensAt: ebOpens, earlyBirdClosesAt: toDate(e.earlyBirdClosesAt), saleStartsAt: sale, tiers: e.tiers },
        now,
      );
      if (d && inWindow(d.at, opts.decideWindowHours * 3_600_000)) out.push({ kind: "decide_reminder", eventId: e.id, dedupKey: `decide:${e.id}:${d.at.toISOString()}`, at: d.at });
    }
  }
  return out.filter((r) => !sent.has(r.dedupKey));
}
