import { radarConfig, optionalEnv } from "@radar/config";
import { BookMyShowSource, DistrictSource, InstagramSource, NewsSource, SkillboxSource, type Source } from "@radar/sources";
import { currentInstagramToken } from "./instagram-auth";
import { log, type Runtime } from "./runtime";

/** Sources enabled by feature flags. A flag that is off means the source is never constructed. */
export async function buildSources(rt: Runtime): Promise<{ sources: Source[]; instagram: InstagramSource | null }> {
  const f = radarConfig.features;
  const sources: Source[] = [];
  let instagram: InstagramSource | null = null;

  if (f.instagram) {
    const userId = optionalEnv("INSTAGRAM_USER_ID");
    const token = userId && optionalEnv("FACEBOOK_APP_SECRET") ? await currentInstagramToken(rt.state, rt.getDb).catch(() => null) : null;
    if (userId && token) {
      instagram = new InstagramSource({
        userId,
        accessToken: token,
        version: optionalEnv("GRAPH_API_VERSION") ?? "v25.0",
        callsPerHour: radarConfig.instagram.callsPerHour,
        postsPerCall: radarConfig.instagram.postsPerCall,
        pollMinutes: radarConfig.intervals.pollMinutes,
        intervals: radarConfig.intervals.instagramMinutesByTier,
      });
      sources.push(instagram);
    } else {
      log("instagram: not configured (INSTAGRAM_USER_ID / token / FACEBOOK_APP_SECRET), skipping");
    }
  }
  if (f.ticketing.district) sources.push(new DistrictSource());
  if (f.ticketing.bookmyshow) sources.push(new BookMyShowSource());
  if (f.ticketing.skillbox) sources.push(new SkillboxSource());
  if (f.news) sources.push(new NewsSource());
  return { sources, instagram };
}
