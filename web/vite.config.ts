import { defineConfig } from "vite";

// Plain Vite + TypeScript. The presentation is a single bespoke animation
// engine, so no framework — GSAP drives the choreography, the video drives time.
export default defineConfig({
  server: { host: true, port: 5173 },
  assetsInclude: ["**/*.vtt"],
  build: { target: "es2022" },
});
