/* ============================================================================
   timeline.ts — the director's score.

   The talking-head video is the prompt. Every UI element is *generated from the
   transcript* and revealed at the timestamp where the presenter asks for it.

   Philosophy (from the recording): "When people read, they can't listen; when
   they listen, they can't read." The video carries the words; the deck shows a
   compact transcript beside a fun, illustrative visual for whatever is being
   said right now.
   ============================================================================ */

export type Lang = "en" | "zh";

/** Beat thresholds (seconds into the video) where the interface changes.
 *
 * Every threshold is pinned to the moment the presenter *says* the words in
 * `en.vtt`, so nothing animates ahead of the audio. (Cross-reference the cue
 * timings before nudging any of these.) */
export const BEATS = {
  // The reveal is TWO steps, each matched to the words:
  crop: 120.3, // 02:00.2 "you should start cropping the horizontal aspect ratio video"
  dock: 131.6, // 02:11.6 "then place the frame at the left side of the screen"
  deck: 137.05, // 02:17.04 "Now on the main screen, you should show this teleprompter"
  translate: 169.0, // 02:49.0 site flips EN→中文 as the 3D crossing settles into 文 (post-animation, on the spoken word)
  picker: 176, // 02:54.8 "and now show a language picker somewhere on the UI" (defaults to 中文)
  progress: 205.2, // 03:25.2 "So display that progress bar" — a one-time auto-reveal
} as const;

/** The crop is described as "a very smooth animation", so step 1 (full →
 *  centered portrait) eases over this long duration starting at BEATS.crop;
 *  every other stage move uses the snappier default in main.ts. */
export const CROP_DURATION = 3.0;

export interface Chapter {
  t: number;
  thumb: number; // index into /media/thumbs/thumb_<n>.jpg
  label: Record<Lang, string>;
}

/** Section markers — the dots on the progress bar, each with a frame thumbnail. */
export const CHAPTERS: Chapter[] = [
  { t: 0, thumb: 0, label: { en: "Cold open", zh: "开场" } },
  { t: 71.2, thumb: 1, label: { en: "Library, or OS?", zh: "是库，还是操作系统？" } },
  { t: 88, thumb: 2, label: { en: "A demo — this", zh: "演示——就是这个" } },
  { t: 120, thumb: 3, label: { en: "The reveal", zh: "揭幕" } },
  { t: 165, thumb: 4, label: { en: "Two languages", zh: "两种语言" } },
  { t: 205, thumb: 5, label: { en: "Interactive", zh: "可交互" } },
  { t: 263, thumb: 6, label: { en: "Be a director", zh: "像导演一样" } },
  { t: 298, thumb: 7, label: { en: "Which model?", zh: "哪个模型？" } },
  { t: 335, thumb: 8, label: { en: "Open the loop", zh: "打开这个环" } },
];

/** All translatable UI copy lives here so the language picker can swap it. */
export const STRINGS = {
  brand: { en: "Open & Closed Loops", zh: "开环与闭环" },
  brandSub: { en: "The economics of the LLM OS", zh: "LLM 操作系统的经济学" },
  playHint: { en: "play · sound on", zh: "播放 · 打开声音" },
  rec: { en: "REC", zh: "录制中" },
  transcriptLabel: { en: "live transcript", zh: "实时字幕" },
  contextKicker: { en: "retrieved via RAG", zh: "由 RAG 检索得到" },
  contextLead: { en: "Who transcribed this?", zh: "是谁转写了这段视频？" },
  modelName: { en: "WhisperX · large-v3", zh: "WhisperX · large-v3" },
  modelNote: { en: "run locally, on-device (CUDA)", zh: "在本地设备上运行（CUDA）" },
} as const;

/** Open-source artifacts the recording asks us to surface + link. */
export interface SkillRef {
  name: string;
  href: string | null;
  blurb: Record<Lang, string>;
}

export const SKILLS_REPO = "https://github.com/shuyangsun/coding-agent-skills";

export const SKILLS: SkillRef[] = [
  {
    name: "/retrieving-context",
    href: `${SKILLS_REPO}/tree/main/.agents/skills/retrieving-context`,
    blurb: {
      en: "Find prior context with RAG, not blind grep.",
      zh: "用 RAG 检索过往上下文，而不是盲目 grep。",
    },
  },
  {
    name: "/export-transcript",
    href: `${SKILLS_REPO}/tree/main/.agents/skills/export-transcript`,
    blurb: {
      en: "Save every agent conversation as durable context.",
      zh: "把每次与智能体的对话都存为可复用的上下文。",
    },
  },
];

/** When each skill is *named* in the recording. In the 3D RAG scene this is the
 *  moment that skill's edge stops scanning random corpus nodes, locks onto a node
 *  in the cloud, and its link becomes permanently visible — one at a time. Pinned
 *  to en.vtt ("retrieving context skill" · "and the export transcript skill"). */
export const SKILL_AT = [313.25, 316.0];

/** A labelled document node in the 3D RAG galaxy — a real file from one of
 *  Shuyang's **open-source** repos, linked to its source on GitHub. */
export interface CorpusFile {
  /** shown on the node (basename, or `repo/README.md` to disambiguate). */
  label: string;
  /** the actual open-source file URL on GitHub. */
  href: string;
  /** `rag3d.ts` — the source of *this very animation*; rendered prominently. */
  emphasis?: boolean;
}

const GH = "https://github.com/shuyangsun";

/** The corpus the two skills search, drawn as labelled nodes in the galaxy:
 *  complex agent session transcripts, one README, and `rag3d.ts` itself (the
 *  code drawing this scene). Curated via the /retrieving-context RAG (local
 *  Qdrant) and pinned to files that exist on each repo's `main`; every label is
 *  a real link to its open-source source. Only public repos appear here
 *  (llm-presentation, coding-agent-skills, alpha-zero-game/-api). */
export const CORPUS_FILES: CorpusFile[] = [
  // the source of this animation — emphasised so it's clear what you're watching.
  { label: "rag3d.ts", href: `${GH}/llm-presentation/blob/main/web/src/engine/rag3d.ts`, emphasis: true },
  // complex session transcripts (this presentation + the skills/RAG work)
  { label: "0013-claude-interactive-presentation-prototype.md", href: `${GH}/llm-presentation/blob/main/docs/transcripts/2026-06-13/0013-claude-interactive-presentation-prototype.md` },
  { label: "0018-claude-3d-asr-supporting-art.md", href: `${GH}/llm-presentation/blob/main/docs/transcripts/2026-06-14/0018-claude-3d-asr-supporting-art.md` },
  { label: "0017-codex-vcs-script-first-jj-workspaces.md", href: `${GH}/coding-agent-skills/blob/main/docs/transcripts/2026-06-07/0017-codex-vcs-script-first-jj-workspaces.md` },
  { label: "0055-claude-wave4-contextual-retrieval-generator-comparison.md", href: `${GH}/coding-agent-skills/blob/main/docs/transcripts/2026-06-10/0055-claude-wave4-contextual-retrieval-generator-comparison.md` },
  { label: "0060-codex-rag-wave7-answer-faithfulness.md", href: `${GH}/coding-agent-skills/blob/main/docs/transcripts/2026-06-12/0060-codex-rag-wave7-answer-faithfulness.md` },
  // one README, from another open-source project
  { label: "alpha-zero-game/README.md", href: `${GH}/alpha-zero-game/blob/main/README.md` },
];
