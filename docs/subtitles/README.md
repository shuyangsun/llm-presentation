# Subtitle Assets

Date: 2026-06-13
Status: Current
Area: presentation subtitles, WebVTT transcripts, plain text transcripts
Sources: `docs/subtitles/0001_intro.vtt`, `docs/subtitles/0001_intro.txt`, `docs/subtitles/brain_dump_20260611.vtt`, `docs/subtitles/presentation_test.vtt`

## Summary

`docs/subtitles/` is the canonical home for presentation subtitle assets. It
contains current WebVTT subtitles and timestamp-free text transcripts used by
the LLMOS presentation workflow, including the `0001_intro` intro pair and
older WebVTT subtitle files moved out of `docs/archive/`.

## Files

- [`0001_intro.vtt`](0001_intro.vtt) - WebVTT subtitles for the current intro
  recording.
- [`0001_intro.txt`](0001_intro.txt) - timestamp-free transcript text for the
  current intro recording.
- [`brain_dump_20260611.vtt`](brain_dump_20260611.vtt) - raw June 11, 2026
  brain-dump WebVTT subtitle transcript used as source context for the
  presentation.
- [`presentation_test.vtt`](presentation_test.vtt) - WebVTT transcript for the
  June 13, 2026 presentation prototype talking-head test video.

## Related Docs

- [`docs/archive/20260611/brain_dump_20260611_distilled.txt`](../archive/20260611/brain_dump_20260611_distilled.txt)
  is the distilled prose context derived from
  `docs/subtitles/brain_dump_20260611.vtt`.
- [`docs/archive/20260611/llmos_5_minute_outline.md`](../archive/20260611/llmos_5_minute_outline.md)
  uses `docs/subtitles/brain_dump_20260611.vtt` for speech-speed measurements
  and five-minute delivery planning.
- [`prototypes/20260613/web/`](../../prototypes/20260613/web/README.md) uses
  `docs/subtitles/presentation_test.vtt` as the transcript source for its
  synchronized timeline beats.
