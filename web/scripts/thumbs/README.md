# Progress-bar section thumbnails

The hover thumbnails on the progress bar (`tipThumb` in `src/main.ts`, one per
`CHAPTERS` entry in `src/data/timeline.ts`) are **generated art**, not video
freeze frames — each is a square illustration drawn in the art style of that
section's 3D scene (`src/engine/*`), so once you've seen a scene you recognise
its thumbnail at a glance. Like the intro video and poster, the rendered images
are **CDN-hosted** at `https://cdn.shuyangsun.com/images/thumbs/thumb_<n>.webp`
(the `THUMB_BASE` constant in `src/main.ts`) — they are not committed; this
folder holds the *sources* so they can be regenerated and re-uploaded.

| thumb | section          | source                                              |
| ----- | ---------------- | --------------------------------------------------- |
| 0     | Cold open        | first freeze frame of the intro video (see below)   |
| 1     | Library, or OS?  | `thumb_1.html` — Paper-style `{ }` → OS window       |
| 2     | A demo — this    | `thumb_2.html` — browser frame + play (this page)    |
| 3     | The reveal       | `thumb_3.html` — asr3d waveform → transcript         |
| 4     | Two languages    | `thumb_4.html` — translate3d EN scatter → glass → 文 |
| 5     | Interactive      | `thumb_5.html` — sync3d two lanes, one playhead      |
| 6     | Be a director    | `thumb_6.html` — director3d pixel-art clapperboard   |
| 7     | Which model?     | `thumb_7.html` — rag3d query probe + k-NN beams      |
| 8     | Open the loop    | `thumb_8.html` — loop3d green→red torus with a gap   |

Each `thumb_<n>.html` is a self-contained 360×360 document (inline CSS/SVG, site
fonts only) — pure visuals, no text labels (the tooltip prints the section name).

## Regenerate

Render into a scratch dir, then upload the `*.webp` to the CDN bucket behind
`https://cdn.shuyangsun.com/images/thumbs/`.

`render.mjs` needs `puppeteer-core` and a Chrome/Chromium (auto-detected; or set
`CHROME_BIN`). From `web/`:

```sh
out=/tmp/thumbs; mkdir -p "$out"
for n in 1 2 3 4 5 6 7 8; do
  node scripts/thumbs/render.mjs scripts/thumbs/thumb_$n.html "$out/thumb_$n.webp" 360
done
```

`thumb_0` is the intro video's first frame, centre-cropped to a square:

```sh
ffmpeg -i <intro.mp4> -frames:v 1 \
  -vf "crop=720:720:280:0,scale=360:360:flags=lanczos" \
  -c:v libwebp -quality 90 /tmp/thumbs/thumb_0.webp
```
