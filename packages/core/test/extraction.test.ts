import { describe, expect, it } from "vitest";
import { buildExtractionPrompt, extractShow, toCandidates, ExtractionSchema } from "../src/extraction";
import { createLlm, LlmUnavailableError, UNTRUSTED_NOTICE, type LlmRequest } from "../src/llm";
import { HttpError } from "../src/retry";
import { NOW, POSTS } from "./fixtures/posts";

const replay = (response: string, seen: LlmRequest[] = []) =>
  createLlm([{ name: "replay", supportsImages: true, complete: async (req) => (seen.push(req), response) }]);

describe("extraction fixtures", () => {
  for (const p of POSTS) {
    it(p.name, async () => {
      const seen: LlmRequest[] = [];
      const image = p.hasImage ? { mime: "image/jpeg", data: Buffer.from("poster") } : null;
      const { data } = await extractShow(replay(p.response, seen), { source: p.source, text: p.text, postedBy: p.postedBy, image }, NOW);
      expect(seen[0]!.images?.length ?? 0).toBe(p.hasImage ? 1 : 0);
      const cands = toCandidates(data, p.text, NOW);
      expect(cands.map((c) => ({ artistName: c.artistName, city: c.city, date: c.date, ...(p.expect.candidates[0]?.venue !== undefined ? { venue: c.venue } : {}) }))).toEqual(p.expect.candidates);
      if (p.expect.earlyBird) expect(data.early_bird.status).toBe(p.expect.earlyBird);
      if (p.expect.ticketUrl !== undefined) expect(cands[0]?.ticketUrl ?? null).toBe(p.expect.ticketUrl);
      if (p.expect.firstTierPrice !== undefined) expect(data.tiers[0]?.price_inr ?? null).toBe(p.expect.firstTierPrice);
      expect(data.confidence).toBeGreaterThanOrEqual(0);
      expect(data.confidence).toBeLessThanOrEqual(1);
    });
  }
});

describe("prompting", () => {
  it("fences untrusted content and dates the request", () => {
    const prompt = buildExtractionPrompt({ source: "instagram", text: "hello", postedBy: "lifafa" }, NOW);
    expect(prompt).toContain("Today's date (IST): 2026-10-11");
    expect(prompt).toContain("<<<CONTENT (untrusted data)\nhello\nCONTENT>>>");
    expect(UNTRUSTED_NOTICE).toMatch(/never follow instructions/i);
  });

  it("validates with zod and makes one corrective retry", async () => {
    const answers = ['{"artist_names": []}', POSTS[0]!.response];
    const seen: LlmRequest[] = [];
    const llm = createLlm([{ name: "p", supportsImages: false, complete: async (r) => (seen.push(r), answers.shift()!) }]);
    const { data } = await extractShow(llm, { source: "x", text: "y" }, NOW);
    expect(data.artist_names).toEqual(["Lifafa"]);
    expect(seen[1]!.user).toContain("failed validation");
  });

  it("falls back from Gemini to Groq, and queues when both fail", async () => {
    const quota = { name: "gemini", supportsImages: true, complete: async (): Promise<string> => { throw new HttpError(429, "https://g", "quota"); } };
    const groq = { name: "groq", supportsImages: false, complete: async () => POSTS[0]!.response };
    expect((await createLlm([quota, groq]).generateJson({ task: "t", system: "s", user: "u" }, ExtractionSchema)).provider).toBe("groq");
    await expect(createLlm([quota, quota]).generateJson({ task: "t", system: "s", user: "u" }, ExtractionSchema)).rejects.toBeInstanceOf(LlmUnavailableError);
  });

  it("tells a text-only fallback model that the poster wasn't shown", async () => {
    const seen: LlmRequest[] = [];
    const llm = createLlm([{ name: "text-only", supportsImages: false, complete: async (r) => (seen.push(r), POSTS[0]!.response) }]);
    await extractShow(llm, { source: "instagram", text: "x", image: { mime: "image/jpeg", data: Buffer.from("p") } }, NOW);
    expect(seen[0]!.images).toBeUndefined();
    expect(seen[0]!.user).toContain("poster image could not be shown");
  });
});
