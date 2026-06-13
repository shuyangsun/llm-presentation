import { defineConfig } from "vite";

// The presentation is a single self-contained page. The talking-head video is
// served from public/ via a (git-ignored) symlink to the transcoded asset, so
// the large media never enters version control.
export default defineConfig({
  base: "./",
  server: { host: true, fs: { allow: [".."] } },
  build: { target: "es2022", assetsInlineLimit: 0 },
});
