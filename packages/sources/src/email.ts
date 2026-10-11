import { z } from "zod";
import { contentHash } from "@radar/core";
import type { RawItem } from "./types";

/**
 * Fan-app emails (Bandsintown, Songkick) arrive by push: the Apps Script in apps-script/
 * POSTs each new message in the `radar-feeds` Gmail label to /api/ingest/email, which stores it
 * as an unprocessed raw item. The poll job then extracts it like any other item.
 */
export const IngestEmailSchema = z.object({
  messageId: z.string().min(1).max(300),
  subject: z.string().max(1000),
  from: z.string().max(500),
  date: z.string().max(100),
  body: z.string().max(200_000),
});
export type IngestEmail = z.infer<typeof IngestEmailSchema>;

const KNOWN_SENDERS = /bandsintown|songkick/i;

/** Trims marketing boilerplate and keeps the part that describes shows. */
export function cleanEmailBody(body: string): string {
  return body
    .replace(/\r/g, "")
    .replace(/(unsubscribe|manage (your )?(email )?(preferences|notifications)|you('re| are) receiving this)[\s\S]*$/i, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
    .slice(0, 8000);
}

export function emailToRawItem(e: IngestEmail): RawItem {
  const body = cleanEmailBody(e.body);
  const links = [...body.matchAll(/https?:\/\/[^\s)>\]"']+/g)].map((m) => m[0]);
  const ticketish = links.find((l) => /bandsintown\.com\/(e|t)\/|songkick\.com\/concerts\/|district\.in|bookmyshow|skillboxes/i.test(l)) ?? null;
  return {
    source: "email",
    externalId: e.messageId,
    url: ticketish,
    text: `Fan-app email from ${e.from}\nSubject: ${e.subject}\nDate: ${e.date}\n\n${body}`,
    publishedAt: Number.isNaN(Date.parse(e.date)) ? null : new Date(e.date),
    meta: { sender: e.from.replace(/.*<|>.*/g, ""), knownSender: KNOWN_SENDERS.test(e.from), bodyHash: contentHash(body) },
  };
}
