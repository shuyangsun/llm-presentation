/* ============================================================================
   audio.ts — a single live tap on the talking-head video's audio.

   The 3D "audio → transcript" scene (asr3d.ts) shows a waveform of what's being
   said. To guarantee it dances to *exactly* the audio you hear — never a
   precomputed envelope that can drift out of phase with the encoded video — we
   route the <video> element through a Web Audio AnalyserNode and read the live
   signal each frame.

   A MediaElementAudioSourceNode can be created only once per element, and once
   created the element's sound flows ONLY through the graph — so the source must
   reach `ctx.destination` or the video goes silent. We connect
   source → analyser → destination, and fall back to source → destination if the
   analyser can't be built, so audio is never lost.

   The AudioContext needs a user gesture to start, so main.ts calls
   `attachAudioAnalyser` + `resumeAudio` from the play gesture. If anything here
   fails (unsupported browser, autoplay policy), the scene degrades to the
   precomputed envelope (src/data/intro.peaks.json) indexed by the playhead.
   ============================================================================ */

type AC = AudioContext;

let ctx: AC | null = null;
let analyser: AnalyserNode | null = null;
let srcNode: MediaElementAudioSourceNode | null = null;
let timeBuf: Uint8Array<ArrayBuffer> | null = null;
let attachedEl: HTMLMediaElement | null = null;

/** Wire the element's audio through an analyser. Idempotent per element (a
 *  MediaElementSource can only be made once), best-effort, never throws. */
export function attachAudioAnalyser(video: HTMLMediaElement): void {
  if (srcNode) return; // already tapped (one source per element, ever)
  const Ctor: typeof AudioContext | undefined =
    window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  try {
    ctx = new Ctor();
    srcNode = ctx.createMediaElementSource(video);
    // make sound the moment the graph exists, even if the analyser build fails
    srcNode.connect(ctx.destination);
    try {
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.6;
      timeBuf = new Uint8Array(analyser.fftSize);
      srcNode.disconnect(ctx.destination);
      srcNode.connect(analyser);
      analyser.connect(ctx.destination);
    } catch {
      analyser = null;
      timeBuf = null;
      // srcNode → destination stays connected, so audio still plays
    }
    attachedEl = video;
  } catch {
    // creating the context or source failed — leave native playback intact
    ctx = null;
    srcNode = null;
    analyser = null;
  }
}

/** Resume a context the browser left suspended (call from a user gesture). */
export function resumeAudio(): void {
  ctx?.resume?.().catch(() => {});
}

/** Is the live analyser available? */
export function audioReady(): boolean {
  return !!analyser && !!timeBuf;
}

/** Broadband RMS level (≈0..1) of what's playing *right now*, or null if the
 *  live tap isn't available (scene then falls back to the precomputed envelope). */
export function audioLevel(): number | null {
  if (!analyser || !timeBuf) return null;
  analyser.getByteTimeDomainData(timeBuf);
  let sum = 0;
  for (let i = 0; i < timeBuf.length; i++) {
    const v = (timeBuf[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / timeBuf.length);
}

/** Which element (if any) the tap is bound to — lets callers avoid re-attaching. */
export function audioAttachedTo(): HTMLMediaElement | null {
  return attachedEl;
}
