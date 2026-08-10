import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        // Don't load wrangler.toml: the [ai] binding maps to a wrapped
        // external worker that can't be resolved inside the test pool.
        // All tests inject their own mock env, so no real bindings needed.
        miniflare: {
          compatibilityDate: "2024-08-01",
          compatibilityFlags: ["nodejs_compat"],
          bindings: {
            ENVIRONMENT: "test",
          },
        },
      },
    },
  },
});