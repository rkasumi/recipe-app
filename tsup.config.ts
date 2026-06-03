import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "server/index": "src/server/index.ts",
    "cli/index": "src/cli/index.ts",
  },
  outDir: "dist",
  clean: false,
  format: ["esm"],
  platform: "node",
  target: "node24",
  sourcemap: true,
  splitting: false,
  dts: false,
  external: ["ajv", "better-sqlite3", "express"],
});

