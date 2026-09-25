import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Raycast provides its API at runtime; the npm package has no Node entry point.
export default defineConfig({
  resolve: {
    alias: {
      "@raycast/api": fileURLToPath(new URL("./tests/raycast-api.mock.ts", import.meta.url)),
    },
  },
});
