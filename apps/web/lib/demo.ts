/**
 * The walkthrough video on the sign-in page (files in apps/web/public/demo). Null hides the
 * button. Re-encoded from the 59 MB recording to 31 MB (H.264 High, CRF 22, same 1700×1080):
 * SSIM 0.986 against the original, and +faststart so it begins playing before it's downloaded.
 */
export const DEMO_VIDEO: { src: string; poster?: string } | null = {
  src: "/demo/early-access-demo.mp4",
  poster: "/demo/early-access-demo-poster.jpg",
};
