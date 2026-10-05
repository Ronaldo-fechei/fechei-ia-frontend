import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", worker: "src/worker.ts", migrate: "src/scripts/migrate.ts", "set-plan": "src/scripts/set-plan.ts" },
  format: ["esm"],
  platform: "node",
  target: "node20",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  splitting: true,
  // O pacote compartilhado é TypeScript puro: incluído no bundle.
  noExternal: ["@veloxia/shared"],
});
