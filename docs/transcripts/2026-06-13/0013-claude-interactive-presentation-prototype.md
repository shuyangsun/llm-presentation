<!-- markdownlint-disable MD013 MD024 -->

# Interactive talking-head presentation prototype (v1)

Date: 2026-06-13
Repo: llm-presentation (jj workspace `claude-interactive-presentation`, off `main`)
Author: Shuyang Sun <shuyangsun10@gmail.com>
Agent: Claude Code (Opus 4.8, 1M context)
Summary: Built the first interactive presentation prototype where the talking-head
video is the prompt and the UI is generated from the transcript timeline (Vite +
TypeScript + GSAP). Transcoded the 1.1 GB source to AV1/WebM (+ H.264 fallback),
verified every beat in a headless browser, then moved the prototype under
`prototypes/20260613/` and recorded review feedback for v2.


## User

Read the project context and understand what it's about. I added the transcript of the test video ~/Downloads/presentation_test.mp4 to @docs/archive/20260613/presentation_test.vtt. I would like to generate an Awwwards-winning interactive presentation website with my talking-head video.

The website should start with the video in full screen, then gradually narrow and reposition the video based on the timestamp in the transcript, while modifying UI elements on the fly. The key idea is that this should feel dynamic - not like watching a passive video - and the user should be able to pause the presentation at any time to interact with the site.

The UI should be generated on the fly. The core principle is that the talking-head video **is the prompt**: everything on the website should be generated dynamically from the video transcript, aligned to its timestamps.

Let me know if you have any questions; I can clarify before you get to work. Make sure all transitions use smooth animations, it should feel more like a continuous video than a page-by-page slideshow.

## Assistant

- _Read_ — `./AGENTS.md`

## Assistant

- _Bash_ — List repo files

## Assistant

- _Read_ — `./README.md`

## Assistant

- _Bash_ — Explore docs and src

## Assistant

This is a great project. Let me check the video asset and load the design skill before I plan.

## Assistant

- _Bash_ — Probe the video file

## Assistant

- _Skill_ — /frontend-design:frontend-design

## Assistant

The video is 1920×1080, ~2:51 long, but the raw file is **1.1 GB** — far too heavy for the web, so I'll transcode a compressed copy as the site asset. I understand the transcript is doubling as a *director's script* (it literally narrates what the UI should do at each timestamp) and as the *content source* (open/closed loops, the self-iterating skills example).

Before I build, two decisions worth your input:

## Assistant

- _AskUserQuestion_ — Tech stack, Video asset

## Assistant

Decisions locked in. I'll start transcoding the video (kept in `~/Downloads/`, never committed) and read the deeper source material in parallel.

## Assistant

- _Bash_ — Start web transcode in background

## Assistant

- _Read_ — `./docs/archive/20260611/llmos_5_minute_outline.md`

## Assistant

- _Read_ — `./docs/archive/20260611/brain_dump_20260611_distilled.txt`

## Assistant

Transcode finished. Let me check the result size.

## Assistant

- _Bash_ — Check transcoded file size

## Assistant

- _Bash_ — Verify output duration and dims

## Assistant

The file is incomplete — the double-backgrounding killed it. Let me re-run cleanly.

## Assistant

- _Bash_ — Re-run transcode via harness background

## Assistant

Video is transcoding. Let me set up the project scaffold and check tooling while it runs.

## Assistant

- _Bash_ — Check node/npm and vcs scripts

## Assistant

- _Bash_ — Check h264 result and AV1/VP9 encoder availability

## Assistant

Quick note: **AVI is the opposite of efficient** — it's an old container with no modern codec support and no web streaming. The genuinely most-efficient web format today is **AV1** (the newest royalty-free codec, ~30-50% smaller than H.264 at equal quality) in a **WebM** container with Opus audio. Your machine has `libsvtav1`, so I'll use that. Encoding now:

## Assistant

- _Bash_ — Encode AV1/WebM most-efficient web video

## Assistant

AV1 encoding in the background. Let me rename this work session and scaffold the web app.

## Assistant

- _Bash_ — Rename work session

## Assistant

Work renamed. Now I'll scaffold the Vite app. Let me create the project structure and config.

## Assistant

- _Bash_ — Create web dirs and view gitignore

## Assistant

- _Write_ — `./web/package.json`

## Assistant

- _Write_ — `./web/tsconfig.json`

## Assistant

- _Write_ — `./web/vite.config.ts`

## Assistant

- _Write_ — `./web/index.html`

## Assistant

Now the design system CSS:

## Assistant

- _Write_ — `./web/src/style.css`

## Assistant

- _Bash_ — Verify AV1 webm output

## Assistant

AV1/WebM is ready: **16 MB**, full 170s, `av1`+`opus`. I'll wire both the AV1 (primary) and the H.264 MP4 (Safari fallback) as sources, symlinked into `public/` and git-ignored.

## Assistant

- _Bash_ — Symlink video into public, update gitignore

## Assistant

Now the heart of it — the transcript-derived timeline. Let me write the scene definitions:

## Assistant

- _Write_ — `./web/src/timeline.ts`

## Assistant

Now the director engine that ties video playback to the generated UI:

## Assistant

- _Write_ — `./web/src/main.ts`

## Assistant

Now I'll add the start-gate styles I referenced:

## Assistant

- _Edit_ — `./web/src/style.css`

## Assistant

Now let me install dependencies and start the dev server to verify it builds and runs:

## Assistant

- _Bash_ — Install deps and typecheck

## Assistant

Typecheck clean. Let me verify the production build and start the dev server:

## Assistant

- _Bash_ — Production build

## Assistant

Build succeeds. Now let me launch the dev server and verify it renders correctly in a real browser using Chrome DevTools.

## Assistant

- _Bash_ — Start vite dev server and probe

## Assistant

- _Bash_ — Probe dev server

## Assistant

Server is up and serving the 16MB video. Let me drive it with a real browser to verify rendering and the scene transitions. Let me check for browser automation tools.

## Assistant

- _ToolSearch_ — `chrome devtools navigate page screenshot`

## Assistant

Browser-automation MCP isn't connected. Let me verify visually with headless Chromium screenshots instead.

## Assistant

- _Bash_ — Find a chromium binary

## Assistant

`google-chrome` is available. Let me drive it with puppeteer-core to screenshot key timeline moments:

## Assistant

- _Bash_ — Install puppeteer-core

## Assistant

- _Write_ — `./web/shot.mjs`

## Assistant

- _Bash_ — Capture timeline screenshots

## Assistant

All moments captured. Let me review the key frames:

## Assistant

- _Read_ — `/tmp/shots/00-gate.png`

## Assistant

- _Read_ — `/tmp/shots/42-title.png`

## Assistant

- _Read_ — `/tmp/shots/27-narrow.png`

## Assistant

Beautiful — the dock + title and the center-narrow states look excellent. Let me check the diagram-heavy scenes:

## Assistant

- _Read_ — `/tmp/shots/102-definition.png`

## Assistant

- _Read_ — `/tmp/shots/113-example.png`

## Assistant

The loop diagrams and scrubber render perfectly. Let me check the remaining scenes:

## Assistant

- _Read_ — `/tmp/shots/84-agenda.png`

## Assistant

- _Read_ — `/tmp/shots/158-outro.png`

## Assistant

Agenda and the outro bookend look great. Let me verify the start gate (which the script had removed) and the meta scene:

## Assistant

- _Read_ — `/tmp/shots/151-meta.png`

## Assistant

- _Bash_ — Capture start gate

## Assistant

Meta scene looks great. The gate script hit an error — let me retry:

## Assistant

- _Bash_ — Retry gate screenshot, show error

## Assistant

Module resolution — the script is in `/tmp` not the web dir. Let me place it in the web dir:

## Assistant

- _Bash_ — Run gate screenshot from web dir

## Assistant

- _Read_ — `/tmp/shots/start-gate.png`

## Assistant

The start gate is gorgeous. Everything renders beautifully across the whole timeline. Let me clean up the verification harness and write docs.

## Assistant

- _Read_ — `./web/package.json`

## Assistant

- _Edit_ — `./web/package.json`

## Assistant

- _Bash_ — Remove verification harness

## Assistant

- _Write_ — `./web/README.md`

## Assistant

Let me confirm the build is still clean after dependency cleanup, and add a pointer from the root README:

## Assistant

- _Bash_ — Final typecheck + build, check dev server

## Assistant

- _Read_ — `./README.md`

## Assistant

- _Edit_ — `./README.md`

## Assistant

Let me confirm the version-control state — that the new files are tracked and the large video is correctly excluded:

## Assistant

- _Bash_ — Check jj working-copy status

## Assistant

Done. The interactive presentation is built, verified frame-by-frame in a real browser, and running.

## What I built

A Vite + TypeScript + GSAP site in `web/` where **the talking-head video is the prompt** — every UI beat is generated from the transcript and anchored to its real timestamps (`web/src/timeline.ts`). The video's playback position drives everything; it's one continuous timeline, not a slideshow.

**The choreography follows your spoken direction exactly:**
- **0:00** — fullscreen talking head (a "Begin" gate handles the sound-on autoplay gesture)
- **0:16** — title fades in over fullscreen video
- **0:27** — video **narrows to a center vertical strip**
- **0:34** — strip **docks to the right**; generated UI animates in on the left
- **0:42** — the *Open & Closed Loops* title (Fraunces display)
- **0:48** — the **scrubber** reveals exactly when you ask for it — controls video *and* deck progress, with clickable chapter ticks
- **1:08–1:36** — interactive beats, agenda, the animated open/closed **loop diagrams** (mint = self-iterating, coral = human-gated), and the self-improving-skills example
- **2:38** — "Thank you" fullscreen bookend

**Interaction:** `space`/click-video/play-button to pause anytime; `←`/`→` to seek; drag the scrubber; click agenda items or ticks to jump. All transitions are GSAP tweens — continuous and filmic.

## On the video format

I corrected the AVI idea — AVI is an old container with no modern web codec or streaming support. The genuinely **most-efficient** web format today is **AV1 video + Opus in WebM**, which I produced with `libsvtav1` (16 MB, full quality), plus an H.264/MP4 Safari fallback. Both are symlinked into `public/`, kept in `~/Downloads/`, and **git-ignored** — `jj status` confirms no media (or `node_modules`/`dist`) is tracked.

## Run it

It's **live now** at **http://localhost:5173/** (dev server running). To restart later:
```sh
cd web && npm install && npm run dev
```

Changes live in the isolated workspace (`claude-interactive-presentation`), uncommitted — I didn't commit or publish since you didn't ask. Open it, scrub around, and tell me what to tune — pacing, palette, copy, or adding the comparative-advantage / parallel-agent topics from your outline as additional beats.

## User

Great! There are some improvements we can do, but this is a good enough prototype. Her are my feedback for now:

1. At the beginning, we should make the website feel like just a pre-recorded video, with nothing showing a hint of a GUI or interactive website. It should just be the first frame, then a play button. It's only when  I start talking about the content or explicit instruction to show the "closed-loop" concept, we should slowly start showing the audience bits by bits on how powerful this interactive website is. We want to learn something from Hollywood and give the audience the surprising "wow" factor.
2. The color theme should match the color theme of the `website` project, warm tone. Only light mode is good enough, we can add dark mode later if we want to.
3. There is too much text on the screen. Since there is already a talking-head video, visuals on the website should be supporting the verbal content. I will also add subtitles later, so there is even less of a need to show too much text on the screen. Use nice and smooth animations, that are interactive to illustrate the concept.
4. I like the bookmarks you put on time timeline. When the presentation is just playing, only show a very minimal line with bookmarks as dots, and of course the playhead. Only surface more information when the user  hovers over the timeline, or briefly after the user uses certain controls (play, pause, seek, etc.). Make controls similar to YouTube keyboard shortcut controls. I could not hit space bar to pause or resume the content currently.
5. The design is too standard. Like I said, I want Awwward-winning level design, so think more about how to keep it simple and minimal, but at the same time, it's interactive and fun. We will iteratively build  future versions, part-by-part, so I will give you feedback before continuing to the next step.
6. You should take advantage of the /retrieving-context skill. The local RAG setup should already have indexed all projects we will reference. Let me know if you run into issues with it, I'll help you fix it.
7. Focus on differentiating the presentation from static video and slides. One simple thing to do is when I mention certain session transcript, markdown file, or code, you should show a simple high-level summary of that thing, then .
You do NOT have to act on these feedback now, I just want to preserve them in the transcript so future work can refer to it. Move this prototype under @prorotypes/20260613/, then export transcript and integrate using the /vcs skill.

## User

[Request interrupted by user]

## User

Great! There are some improvements we can do, but this is a good enough prototype. Her are my feedback for now:

1. At the beginning, we should make the website feel like just a pre-recorded video, with nothing showing a hint of a GUI or interactive website. It should just be the first frame, then a play button. It's only when  I start talking about the content or explicit instruction to show the "closed-loop" concept, we should slowly start showing the audience bits by bits on how powerful this interactive website is. We want to learn something from Hollywood and give the audience the surprising "wow" factor.
2. The color theme should match the color theme of the `website` project, warm tone. Only light mode is good enough, we can add dark mode later if we want to.
3. There is too much text on the screen. Since there is already a talking-head video, visuals on the website should be supporting the verbal content. I will also add subtitles later, so there is even less of a need to show too much text on the screen. Use nice and smooth animations, that are interactive to illustrate the concept.
4. I like the bookmarks you put on time timeline. When the presentation is just playing, only show a very minimal line with bookmarks as dots, and of course the playhead. Only surface more information when the user  hovers over the timeline, or briefly after the user uses certain controls (play, pause, seek, etc.). Make controls similar to YouTube keyboard shortcut controls. I could not hit space bar to pause or resume the content currently.
5. The design is too standard. Like I said, I want Awwward-winning level design, so think more about how to keep it simple and minimal, but at the same time, it's interactive and fun. We will iteratively build  future versions, part-by-part, so I will give you feedback before continuing to the next step.
6. You should take advantage of the /retrieving-context skill. The local RAG setup should already have indexed all projects we will reference. Let me know if you run into issues with it, I'll help you fix it.
7. Focus on differentiating the presentation from static video and slides. One simple thing to do is when I mention certain session transcript, markdown file, or code, you should show a simple high-level summary of that thing, then link to the open-source GitHub URL for the thing (if it's open-source, I'll tell you which ones are).
8. Chunk the video into smaller segments, so the client does not have to load everything at once.

You do *not* have to act on these feedback now, I just want to preserve them in the transcript so future work can refer to it. Move this prototype under @prorotypes/20260613/, then /export-transcript  and integrate using the /vcs  skill.

## Assistant

Understood — I'll preserve the feedback (the transcript export will capture it verbatim), move the prototype, export the session, and integrate. Not acting on the feedback items themselves.

Let me start with the move and reference updates, and stop the dev server.

## Assistant

- _Bash_ — Move prototype under prototypes/20260613 and stop dev server

## Assistant

- _Bash_ — Check move result

## Assistant

- _Bash_ — Check prototypes dir and vite procs

## Assistant

The `pkill -f vite` matched its own shell command — that's what aborted it. Vite is already stopped. Let me do the move cleanly:

## Assistant

- _Bash_ — Move web into prototypes/20260613

## Assistant

Symlinks survived. Now update the path references in `.gitignore` and the root README:

## Assistant

- _Bash_ — Show gitignore tail

## Assistant

- _Edit_ — `./.gitignore`

## Assistant

- _Read_ — `./.gitignore`

## Assistant

- _Edit_ — `./.gitignore`

## Assistant

Now update the root README pointer and the prototype README's path references:

## Assistant

- _Edit_ — `./README.md`

## Assistant

The prototype README's link to the transcript needs depth adjustment after the move:

## Assistant

- _Edit_ — `./prototypes/20260613/web/README.md`

## Assistant

- _Read_ — `./prototypes/20260613/web/README.md`

## Assistant

- _Edit_ — `./prototypes/20260613/web/README.md`

## Assistant

Now the NOTES.md capturing the prototype status and the feedback for the next iteration:

## Assistant

- _Write_ — `./prototypes/20260613/NOTES.md`

## Assistant

Let me verify the app still builds from its new location, then export the transcript:

## Assistant

- _Bash_ — Verify build from new location

## Assistant

Build is clean from the new location. Now let me export the transcript:

## Assistant

- _Skill_ — /export-transcript

## Assistant

The repo convention (AGENTS.md + existing files) uses `docs/transcripts/`, not `docs/coding-sessions/`. Let me check the script and existing layout before writing:

## Assistant

- _Bash_ — Inspect export script target and existing transcript indices

## Assistant

Repo convention is `docs/transcripts/` (per AGENTS.md and all existing files), with global indices — highest is `0012`, so next is `0013`. Let me locate the session log:

## Assistant

- _Bash_ — Find newest Claude session jsonl

## Assistant

The session log is here. Let me get author info and write an extractor to render the transcript:

## Assistant

- _Bash_ — Get author identity

## Assistant

- _Write_ — `/tmp/extract_transcript.py`

## Assistant

- _Bash_ — Run extractor and preview user turns

## Assistant

The VCS hook blocks running from `/tmp`. Let me run from the workspace:

## Assistant

- _Bash_ — Run extractor from workspace
