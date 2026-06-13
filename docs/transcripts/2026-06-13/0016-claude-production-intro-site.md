<!-- markdownlint-disable MD013 MD024 -->

# Production intro site — video-driven interactive presentation

Date: 2026-06-13
Repo: llm-presentation (jj workspace `claude-0001-intro`, off `main`)
Author: Shuyang Sun <shuyangsun10@gmail.com>
Agent: Claude Code (Opus 4.8, 1M context, effort: ultracode — xhigh + workflow orchestration)
Summary: Built the first production version of the presentation website in `web/`
(Vite + TS + GSAP), where the talking-head video is the prompt and its playback
time drives the whole interface. Implemented the choreography from
`0001_intro.vtt`: a Hollywood cold open, a two-step crop→dock reveal, a compact
teleprompter beside fun illustrative scenes, auto-translation to 中文 with a
default-中文 picker, on-demand subtle controls with bookmark frame thumbnails,
and the WhisperX large-v3 RAG payoff. Ported the warm "Paper" palette from the
`website` project with a terracotta accent. Used local RAG (`/retrieving-context`)
to find the transcription model, ran a 35-agent adversarial review, and verified
every beat in a headless browser on desktop + mobile.

## User

Read the following files to understand context:

1. @docs/archive/20260611/brain_dump_20260611_distilled.txt.
2. @docs/transcripts/2026-06-13/0013-claude-interactive-presentation-prototype.md.
3. @prototypes/20260613/web/ (no need to read the whole prototype, just reference if and when you need it).

I now have the first video clip of my podcast / presentation at /mnt/nas/home/documents/presentations/20260611-open-close-loop-llm-os/0001_intro.webm, the subtitle is stored at @docs/subtitles/0001_intro.vtt.

Build the first version of the production website based on my feedback from the previous session transcript, match ~/developer/website/ color scheme, make it look like an Awwward winning designer website. Be creative but at the same time keep the design clean. Use the /retrieving-context skill to get information about other projects, including this `llm-presentation` repository.

Ask me if anything is unclear, don't be afraid of interrupting me and asking questions. Work on the website until the introduction part of this website is done according to the 0001_intro.vtt file. When you are done, keep the local server up so I can view it myself.

## Assistant

Gathered context before building.

- _Read_ — `docs/archive/20260611/brain_dump_20260611_distilled.txt` (core thesis, open/closed loops, comparative-advantage economics, example projects)
- _Read_ — `docs/transcripts/2026-06-13/0013-...md` (prior prototype + review feedback)
- _Bash_ — recon: `website` project root, prototype `src/` + `NOTES.md`, `ffprobe` the intro video (AV1/WebM, 1280×720, 24fps, ~372s, 36 MB), repo root + `jj st`

Key feedback from the prototype `NOTES.md`: Hollywood cold open, warm light theme matching `website`, less on-screen text, minimal YouTube-style timeline, Awwwards-level, use `/retrieving-context`, link OSS artifacts, chunk the video.

## Assistant

- _Bash_ — read `website/shuyang-website/src/styles.css` → the warm **Paper** design system: `--bg #f7f4ee`, surfaces, `--fg #1a1614`, mood accents, Instrument Serif / Geist / JetBrains Mono, grain, eases.
- _Bash_ — read `presentation_content.md` (NAS) — the polished director's script with the "Interactive Website Reveal" instructions — plus `0001_intro.txt`, repo `AGENTS.md`/`README.md`.
- _Read_ — prototype `main.ts` (architectural reference for the video-driven director loop)

## Assistant

The `0001_intro.vtt` is meta: the presenter directs the coding agent on what to build (desktop crop→dock, teleprompter, translate to 中文 + picker, minimal progress bar, mobile top-dock, show the transcription model found via RAG). Confirmed the skills setup and local RAG.

- _Bash_ — `.agents/skills` list, git remotes (`llm-presentation`, `website`, `coding-agent-skills`)
- _Bash_ — detected local RAG (Qdrant up), `setting-up-rag` in `coding-agent-skills`, `check-local-rag.sh` → READY
- _Bash_ — RAG `query.py --list-projects` (alpha-zero, power-monitor, website, llm-presentation, …) and a natural-language query for the ASR model → pointed at `src/asr/README.md`
- _Bash_ — read `src/asr/README.md` → backend **WhisperX**, model **`large-v3`** (`Systran/faster-whisper-large-v3`), local CUDA

## Assistant

- _Bash_ — extracted the first-frame poster (`ffmpeg`), started an H.264 mp4 Safari fallback (background)
- _Read_ — the poster image (presenter centered → a center-crop to 9:16 keeps the face framed)
- _Bash_ — `vcs` rename-work → `claude-0001-intro`

## Assistant

- _AskUserQuestion_ — (1) which repos are public to link on screen; (2) signature warm accent

## User

Forgot to mention, don't add too much text on the screen, less is more. When people read, they can't listen; when people listen, they can't read. Make the main content supporting material about the podcast-style presentation.

## Assistant

Acknowledged — kept on-screen text minimal and supporting. User's answers: link only **coding-agent-skills** (public); `llm-presentation` is private, so show the ASR model name without a repo link. Accent: **terracotta/clay** (#c25450).

## Assistant

Scaffolded the production app and wrote it.

- _Bash_ — `web/` dirs + git-ignored symlinks to the NAS-stored media derivatives; updated `.gitignore`
- _Write_ — `web/package.json`, `tsconfig.json`, `vite.config.ts`, `index.html` (same Google Fonts as the website)
- _Bash_/_Write_ — `web/src/data/en.vtt` (copied) + `zh.vtt` (Mandarin translation, same cue timings)
- _Write_ — `web/src/engine/vtt.ts` (tiny WebVTT parser), `web/src/data/timeline.ts` (beats, chapters, bilingual strings, linked skills), `web/src/style.css` (ported Paper palette + terracotta), `web/src/main.ts` (the director engine), `vite-env.d.ts`
- _Bash_ — `npm install`, `tsc --noEmit` (clean), `vite build` (clean), dev server up on :5173

## Assistant

Verified the choreography in headless Chrome (puppeteer-core + system `google-chrome`), driving the video timeline and screenshotting each beat on desktop + mobile.

- _Bash_/_Read_ — captured + reviewed: cold-open gate, the crop+dock reveal, teleprompter, language picker, progress bar, model/RAG card, outro, the 中文 toggle, and mobile layouts
- _Edit_ — small spacing fixes (deck bottom padding so the model card clears the bar; hide the shortcut hint on mobile)

## Assistant

- _Workflow_ — launched a multi-agent adversarial review (correctness/sync, director-fidelity, a11y/responsive, code quality) — 35 agents, 28 confirmed findings
- _Edit_ ×many — applied the real fixes: VTT parser hardening, gate-the-keyboard-during-cold-open, pointer-capture cleanup, resize-retarget, reduced-motion for the GSAP crop, `preload="metadata"`, slider ARIA, help-dialog focus handling, contrast bump, dead-flag/selector cleanup. Skipped intentional ones (native captions, picker→bar gap, font preload, mobile cover-crop).
- _Bash_ — re-verified screenshots; removed the verification harness; updated root `README.md`; `jj describe` (no commit/publish)

Reported back with the live URL and the verified beats.

## User

Great! Love it! Make these adjustments:

1. The cropping and the repositioning of the video should be animated in two separate steps, each matching the timing of my words.
2. When I mentioned translating to Mandarin Chinese for the first time, the VTT text on the screen should be changed to Chinese. When the language selector button is added, the default should also be Chinese.
3. During the second half of the video, I don't like that all that is displayed on the main page is the transcript. Create fun and interactive visusals to assist and illustrate the content I'm talking about next to the transcript.
4. Even at the very beginning of the video, although by default the progress bar is not shown, if the user hovers around the bottom area of the screen, or if the user taps on the screen on mobile, the progress bar should still show.
5. Although the control should look like YouTube, the color template should not look like YouTube. Use the website's cololr template and make the progress bar more subtle.
6. Oh progress bar hover, it should also show thumbnails of bookmarks. Just use square images from the video frame for now, we may change it to something later.

## Assistant

Started the round.

- _Bash_ — generated 9 square bookmark thumbnails (`ffmpeg`, center-crop) at the chapter times into `web/public/media/thumbs/` (git-ignored)
- _Write_ — rewrote `web/src/data/timeline.ts`: two-step reveal beats (`crop`/`dock`), `translate` beat, chapters with thumbnail indices, scene schedule
- _Write_ — `web/src/engine/scenes.ts`: seven illustrative scenes (ASR, translate, sync, responsive, director, RAG, loops)

## User

Continue from where you left off.

## Assistant

No response requested.

## User

You were interrupted, continue your work, and there were a few things I forgot to mention:

1. I misspoke at the end, when I said "open the loop by pausing the video", I actually meant pausing the recording. The video shouldn't be paused.
2. The "the loop is open" page at the end is covering the whole screen, it shouldn't do that, it should just be a nice illustration next to the transcript. Remember, an open loop is stuck, waiting for human to return, the animation should not rotate, which gives the viewer a sense progress. It should be glowing / breathing in a slow pace, indicating it's waiting. The closed loop can be closed, with a dot going around the ring, indicating it's an iterative self-improving process.
3. In the transcript, there was one sentence "from EMMA, Google, OpenAI...", it should be "from NVIDIA, Google, OpenAI...". Fix mistranscribed "NVIDIA".

After you fix all the previous list of improvements and these 3, use the visual skill to verify the fix on both deskop and mobile.

## Assistant

Applied the three follow-ups, then finished the six adjustments.

- _Edit_ — `en.vtt` "from EMEA" → "from NVIDIA"; `zh.vtt` "来自 Meta" → "来自 NVIDIA"
- _Edit_ — removed the full-screen outro (beat + strings) from `timeline.ts`
- _Edit_ — `scenes.ts` loop scene: **closed** = full ring with an orbiting dot (iterating); **open** = ring with a gap that breathes/glows, no rotation (waiting)
- _Write_ — full rewrite of `web/src/main.ts`: two-step `full → center → dock` geometry; auto-switch to 中文 at the translate beat with manual-override; scene swapping (rebuilt on language change); on-demand chrome (hidden by default, shown on bottom-hover / tap / pause, auto-hide while playing); thumbnail tooltip; preserved all earlier review fixes
- _Write_ — full rewrite of `web/src/style.css`: restructured deck (scene stage + compact transcript), all seven scene visuals, subtle warm-palette progress bar, tooltip + thumbnail, loop animations (orbit + breathe), removed the outro
- _Bash_ — `tsc --noEmit` + `vite build` clean

## Assistant

- _Skill_ — `/verify` (GUI surface → drive the running app and screenshot)
- _Write_/_Bash_ — drove the app with Chrome and captured every changed beat on desktop (1440×900) and mobile (390×844): cold open, the two-step reveal, all scenes, auto-中文, default-中文 picker, on-demand bar, and the loop scene
- Found a scene-swap bleed-through (the outgoing scene relied on a GSAP `onComplete` that could lag) → _Edit_ hardened `swapScene` to drop stale scenes immediately + remove the outgoing one on a wall-clock timer (also robust for fast scrubbing)
- Tooltip relied on CSS `:hover` (doesn't fire on touch / synthetic moves) → _Edit_ drove the thumbnail tooltip from the `pointermove` handler; confirmed via a debug screenshot (thumbnail + time + chapter label)
- Re-verified all beats clean on both viewports

## Assistant

- _Bash_ — removed the harness + uninstalled the browser driver; final `tsc` + `vite build` clean; dev server up
- _Bash_ — `jj describe` (updated message; **not committed or published**); confirmed only source/config/docs tracked — no media, thumbnails, `node_modules`, or harness
- _Edit_ — updated `web/README.md` to the new behavior
- _SendUserFile_ — sent the key verification frames

Reported a PASS verdict: two-step reveal, auto-中文 + default picker, the seven scenes, on-demand subtle controls, bookmark thumbnails, and the redesigned non-rotating/breathing open loop vs. orbiting closed loop — all verified on desktop and mobile.

## User

/export-transcript — then integrate with /vcs skill.

## Assistant

- _Bash_ — `export-transcript`: found the next global index under `docs/transcripts/` (0016) and the author identity
- _Write_ — this transcript
- _Skill_ — `/vcs` to integrate
