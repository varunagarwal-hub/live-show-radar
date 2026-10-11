/**
 * Live Show Radar: Gmail forwarder for fan-app emails (Bandsintown, Songkick).
 *
 * Runs inside your own Gmail as a Google Apps Script on a time trigger. Every few minutes it reads
 * new messages in the `radar-feeds` label and POSTs subject, sender, date and body text to
 * <PUBLIC_BASE_URL>/api/ingest/email, authenticated with a shared secret. It then labels them
 * `radar-feeds/sent` so they're only sent once. No OAuth app and no refresh tokens, so nothing
 * expires.
 *
 * Setup (README → "Fan-app emails"):
 *   1. script.google.com → New project → paste this file.
 *   2. Project Settings → Script properties: add
 *        RADAR_INGEST_URL     https://<your-app>.vercel.app/api/ingest/email
 *        RADAR_INGEST_SECRET  <same value as INGEST_EMAIL_SECRET>
 *   3. Run `forwardRadarFeeds` once and approve the Gmail permission prompt.
 *   4. Triggers → Add trigger → forwardRadarFeeds, time-driven, every 5 or 10 minutes.
 */

var LABEL = "radar-feeds";
var SENT_LABEL = "radar-feeds/sent";
var BATCH = 20;

function forwardRadarFeeds() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty("RADAR_INGEST_URL");
  var secret = props.getProperty("RADAR_INGEST_SECRET");
  if (!url || !secret) throw new Error("Set RADAR_INGEST_URL and RADAR_INGEST_SECRET in Script properties.");

  var sent = GmailApp.getUserLabelByName(SENT_LABEL) || GmailApp.createLabel(SENT_LABEL);
  var threads = GmailApp.search("label:" + LABEL + " -label:" + SENT_LABEL.replace("/", "-") + " newer_than:14d", 0, BATCH);
  if (!threads.length) return;

  var messages = [];
  threads.forEach(function (t) {
    t.getMessages().forEach(function (m) {
      messages.push({
        messageId: m.getId(),
        subject: m.getSubject() || "",
        from: m.getFrom() || "",
        date: m.getDate().toISOString(),
        // Plain text only, capped. Links inside the text are kept.
        body: (m.getPlainBody() || "").slice(0, 100000),
      });
    });
  });

  for (var i = 0; i < messages.length; i += 20) {
    var res = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + secret },
      payload: JSON.stringify({ messages: messages.slice(i, i + 20) }),
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) {
      // Leave the threads unlabelled so the next run retries; don't log message contents.
      console.error("Radar ingest failed with HTTP " + res.getResponseCode());
      return;
    }
  }
  threads.forEach(function (t) {
    t.addLabel(sent);
  });
  console.log("Forwarded " + messages.length + " message(s).");
}
