/* ============================================================================
   vtt.ts — a tiny WebVTT parser.

   The transcript is the script. We parse the .vtt into timestamped cues so the
   teleprompter can show exactly the line being spoken at the current playback
   position — "make sure the text matches my audio."
   ============================================================================ */

export interface Cue {
  start: number; // seconds
  end: number; // seconds
  text: string;
}

function toSeconds(stamp: string): number {
  // Accepts HH:MM:SS.mmm or MM:SS.mmm. Returns NaN for anything malformed so a
  // bad timestamp degrades gracefully instead of throwing.
  const parts = stamp.trim().split(":");
  if (parts.length < 2 || parts.length > 3) return NaN;
  const nums = parts.map((p) => Number(p.replace(",", ".")));
  if (nums.some((n) => !isFinite(n))) return NaN;
  let h = 0;
  let m = 0;
  let s = 0;
  if (nums.length === 3) {
    h = nums[0];
    m = nums[1];
    s = nums[2];
  } else {
    m = nums[0];
    s = nums[1];
  }
  return h * 3600 + m * 60 + s;
}

// Header / comment / style / region blocks. Their bodies may legally contain
// "-->", so they must be skipped wholesale, never scanned for a cue timing.
const NON_CUE = /^(WEBVTT|NOTE|STYLE|REGION)(\s|$)/;

export function parseVtt(raw: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = raw.replace(/\r\n/g, "\n").split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length === 0) continue;
    if (NON_CUE.test(lines[0].trim())) continue;
    const timeIdx = lines.findIndex((l) => l.includes("-->"));
    if (timeIdx === -1) continue;
    const [from, to] = lines[timeIdx].split("-->");
    const start = toSeconds(from);
    const end = toSeconds(to.trim().split(/\s+/)[0]);
    if (!isFinite(start) || !isFinite(end)) continue;
    const text = lines.slice(timeIdx + 1).join(" ").trim();
    if (!text) continue;
    cues.push({ start, end, text });
  }
  return cues.sort((a, b) => a.start - b.start);
}

/**
 * Index of the most recent cue whose start time has passed (-1 before the
 * first). We deliberately hold the last spoken line through inter-cue gaps so
 * the teleprompter never blanks mid-thought.
 */
export function activeCueIndex(cues: Cue[], t: number): number {
  let idx = -1;
  for (let i = 0; i < cues.length; i++) {
    if (t >= cues[i].start) idx = i;
    else break;
  }
  return idx;
}
