import { describe, expect, it } from "vitest";
import { newsLooksRelevant } from "../lib/poll-pipeline";

describe("news filter", () => {
  it("keeps articles about shows in India", () => {
    expect(newsLooksRelevant("News headline: Arijit Singh announces India tour, Bengaluru on March 13")).toBe(true);
    expect(newsLooksRelevant("News headline: Drake to perform in Mumbai next year")).toBe(true);
    expect(newsLooksRelevant("News headline: Anuv Jain live in Gurugram: tickets out now")).toBe(true);
    expect(newsLooksRelevant("News headline: Prateek Kuhad to play Hyderabad on December 18")).toBe(true);
  });

  it("drops coverage that isn't about an Indian show", () => {
    expect(newsLooksRelevant("News headline: Taylor Swift releases new album")).toBe(false);
    expect(newsLooksRelevant("News headline: Drake announces European tour dates")).toBe(false);
    expect(newsLooksRelevant("News headline: Arijit Singh wins award in Mumbai")).toBe(false);
  });
});
