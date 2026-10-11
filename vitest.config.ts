import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: { TZ: "UTC", RADAR_DRY_RUN: "", RADAR_STATE_DIR: ".radar-state/test" },
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["packages/*/test/**/*.test.ts", "apps/web/test/**/*.test.ts", "jobs/test/**/*.test.ts"] },
      },
      {
        extends: true,
        test: { name: "e2e", include: ["tests/e2e/**/*.test.ts"], testTimeout: 60_000, hookTimeout: 60_000 },
      },
    ],
  },
});
