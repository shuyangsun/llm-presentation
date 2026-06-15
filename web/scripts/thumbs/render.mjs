// render.mjs — rasterize a self-contained square HTML/SVG thumbnail to WebP.
//
//   node scripts/thumbs/render.mjs <input.html> <output.webp> [size]
//
// Renders the document in a headless Chrome at <size>×<size> CSS px (default 360,
// 3× the 118px display box so it stays crisp on retina) and screenshots it to
// WebP. These are the progress-bar hover thumbnails — one per chapter, each a
// pure visual illustration matched to its 3D scene's art style. See README.md.
//
// Requires `puppeteer-core` and a Chrome/Chromium. The browser is found via, in
// order: $CHROME_BIN, `google-chrome`/`chromium` on PATH, the puppeteer cache.
import puppeteer from "puppeteer-core";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";

function findChrome() {
  if (process.env.CHROME_BIN && existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    try {
      const p = execSync(`command -v ${name}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
      if (p) return p;
    } catch {
      /* not on PATH — keep looking */
    }
  }
  try {
    const cache = `${process.env.HOME}/.cache/puppeteer/chrome`;
    const hit = execSync(`ls ${cache}/*/chrome-linux64/chrome 2>/dev/null | head -1`).toString().trim();
    if (hit && existsSync(hit)) return hit;
  } catch {
    /* no cached download */
  }
  throw new Error("No Chrome found — set CHROME_BIN to a Chrome/Chromium binary.");
}

const [, , inPath, outPath, sizeArg] = process.argv;
if (!inPath || !outPath) {
  console.error("usage: node scripts/thumbs/render.mjs <input.html> <output.webp> [size]");
  process.exit(1);
}
const SIZE = Number(sizeArg) || 360;

const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: "shell",
  args: ["--no-sandbox", "--force-color-profile=srgb", "--hide-scrollbars"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: SIZE, height: SIZE, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(resolve(inPath)).href, { waitUntil: "networkidle0" });
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
  });
  await new Promise((r) => setTimeout(r, 350)); // let webfonts + entrances settle on a frame
  await page.screenshot({ path: resolve(outPath), type: "webp", quality: 92, clip: { x: 0, y: 0, width: SIZE, height: SIZE } });
  console.log("wrote", outPath);
} finally {
  await browser.close();
}
