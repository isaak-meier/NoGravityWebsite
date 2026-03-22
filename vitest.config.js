import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Workaround: npm package points main/module at dist/*.js but files ship under dist/dist/. */
const realtimeBpmAnalyzer = path.resolve(
  __dirname,
  "node_modules/realtime-bpm-analyzer/dist/dist/index.esm.js"
);

export default defineConfig({
  resolve: {
    alias: {
      "realtime-bpm-analyzer": realtimeBpmAnalyzer,
    },
  },
});
