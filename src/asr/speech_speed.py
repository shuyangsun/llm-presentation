"""Estimate speech speed from WebVTT transcripts."""

from __future__ import annotations

import argparse
import html
import json
import re
import statistics
import sys
from collections.abc import Sequence
from dataclasses import dataclass, replace
from pathlib import Path

TIMING_RE = re.compile(
    r"^\s*(?P<start>(?:\d{2}:)?\d{2}:\d{2}[\.,]\d{3})\s+-->\s+"
    r"(?P<end>(?:\d{2}:)?\d{2}:\d{2}[\.,]\d{3})(?:\s+.*)?$"
)
TAG_RE = re.compile(r"<[^>]+>")
WORD_RE = re.compile(r"[A-Za-z0-9]+(?:[''][A-Za-z0-9]+)?")
BLOCK_HEADERS = ("NOTE", "STYLE", "REGION")

AUTO_DEFAULT_PROFILE = "balanced"
TUNING_FLAGS = (
    "--profile",
    "--max-gap",
    "--long-break-gap",
    "--min-run-words",
    "--min-run-seconds",
)


@dataclass(frozen=True)
class VttCue:
    start: float
    end: float
    text: str
    words: int


@dataclass(frozen=True)
class GapProfile:
    name: str
    max_gap: float
    long_break_gap: float
    min_run_words: int = 1
    min_run_seconds: float = 0.0
    description: str = ""


@dataclass(frozen=True)
class SpeechRun:
    start: float
    end: float
    words: int
    cues: int

    @property
    def duration(self) -> float:
        return max(0.0, self.end - self.start)


@dataclass(frozen=True)
class CueGap:
    start: float
    end: float

    @property
    def duration(self) -> float:
        return max(0.0, self.end - self.start)


@dataclass(frozen=True)
class SpeedReport:
    input_path: Path
    profile: GapProfile
    cue_count: int
    total_words: int
    included_words: int
    total_span_seconds: float
    cue_seconds: float
    active_seconds: float
    excluded_seconds: float
    speech_rate_wpm: float
    articulation_rate_wpm: float
    session_rate_wpm: float
    speech_runs: list[SpeechRun]
    ignored_runs: list[SpeechRun]
    long_breaks: list[CueGap]


DEFAULT_PROFILES = (
    GapProfile(
        name="strict-pauses",
        max_gap=0.75,
        long_break_gap=4.0,
        description="Excludes most pauses between subtitle cues.",
    ),
    GapProfile(
        name=AUTO_DEFAULT_PROFILE,
        max_gap=1.5,
        long_break_gap=8.0,
        description="Counts short thinking pauses but excludes clear interruptions.",
    ),
    GapProfile(
        name="lenient-pauses",
        max_gap=3.0,
        long_break_gap=12.0,
        description="Counts longer pauses as part of the delivered speech.",
    ),
)
DEFAULT_PROFILES_BY_NAME = {profile.name: profile for profile in DEFAULT_PROFILES}


def parse_vtt(path: Path) -> list[VttCue]:
    """Parse cue timings and text from a WebVTT file."""

    lines = path.read_text(encoding="utf-8-sig").splitlines()
    cues: list[VttCue] = []
    index = 0

    while index < len(lines):
        line = lines[index].strip()
        if not line or line.startswith("WEBVTT"):
            index += 1
            continue

        if line.startswith(BLOCK_HEADERS):
            index = skip_block(lines, index + 1)
            continue

        timing = TIMING_RE.match(line)
        if timing is None and index + 1 < len(lines):
            next_timing = TIMING_RE.match(lines[index + 1].strip())
            if next_timing is not None:
                index += 1
                timing = next_timing

        if timing is None:
            index += 1
            continue

        start = parse_timestamp(timing.group("start"))
        end = parse_timestamp(timing.group("end"))
        index += 1

        text_lines: list[str] = []
        while index < len(lines) and lines[index].strip():
            text_lines.append(lines[index].strip())
            index += 1

        text = clean_cue_text(" ".join(text_lines))
        words = count_words(text)
        if text and words and end > start:
            cues.append(VttCue(start=start, end=end, text=text, words=words))

    return cues


def analyze_cues(cues: list[VttCue], profile: GapProfile, input_path: Path) -> SpeedReport:
    if not cues:
        raise ValueError(f"No timed text cues found in {input_path}")

    sorted_cues = sorted(cues, key=lambda cue: (cue.start, cue.end))
    total_words = sum(cue.words for cue in sorted_cues)
    first_start = sorted_cues[0].start
    last_end = max(cue.end for cue in sorted_cues)
    total_span_seconds = max(0.0, last_end - first_start)
    cue_seconds = sum(max(0.0, cue.end - cue.start) for cue in sorted_cues)
    runs = group_speech_runs(sorted_cues, profile.max_gap)
    speech_runs = [run for run in runs if keep_run(run, profile)]
    ignored_runs = [run for run in runs if not keep_run(run, profile)]

    if not speech_runs:
        raise ValueError(
            "No speech runs matched the current thresholds. "
            "Lower --min-run-words or --min-run-seconds."
        )

    active_seconds = sum(run.duration for run in speech_runs)
    included_words = sum(run.words for run in speech_runs)
    gaps = cue_gaps(sorted_cues)
    long_breaks = [gap for gap in gaps if gap.duration >= profile.long_break_gap]

    return SpeedReport(
        input_path=input_path,
        profile=profile,
        cue_count=len(sorted_cues),
        total_words=total_words,
        included_words=included_words,
        total_span_seconds=total_span_seconds,
        cue_seconds=cue_seconds,
        active_seconds=active_seconds,
        excluded_seconds=max(0.0, total_span_seconds - active_seconds),
        speech_rate_wpm=words_per_minute(included_words, active_seconds),
        articulation_rate_wpm=words_per_minute(total_words, cue_seconds),
        session_rate_wpm=words_per_minute(total_words, total_span_seconds),
        speech_runs=speech_runs,
        ignored_runs=ignored_runs,
        long_breaks=long_breaks,
    )


def group_speech_runs(cues: list[VttCue], max_gap: float) -> list[SpeechRun]:
    runs: list[SpeechRun] = []
    current = SpeechRun(start=cues[0].start, end=cues[0].end, words=cues[0].words, cues=1)

    for cue in cues[1:]:
        gap = cue.start - current.end
        if gap <= max_gap:
            current = SpeechRun(
                start=current.start,
                end=max(current.end, cue.end),
                words=current.words + cue.words,
                cues=current.cues + 1,
            )
            continue

        runs.append(current)
        current = SpeechRun(start=cue.start, end=cue.end, words=cue.words, cues=1)

    runs.append(current)
    return runs


def cue_gaps(cues: list[VttCue]) -> list[CueGap]:
    gaps: list[CueGap] = []
    for previous, current in zip(cues, cues[1:], strict=False):
        if current.start > previous.end:
            gaps.append(CueGap(start=previous.end, end=current.start))
    return gaps


def keep_run(run: SpeechRun, profile: GapProfile) -> bool:
    return run.words >= profile.min_run_words and run.duration >= profile.min_run_seconds


def words_per_minute(words: int, seconds: float) -> float:
    if seconds <= 0.0:
        return 0.0
    return words / (seconds / 60.0)


def parse_timestamp(value: str) -> float:
    normalized = value.replace(",", ".")
    parts = normalized.split(":")
    if len(parts) == 2:
        minutes, seconds = parts
        return int(minutes) * 60 + float(seconds)
    if len(parts) == 3:
        hours, minutes, seconds = parts
        return int(hours) * 3600 + int(minutes) * 60 + float(seconds)
    raise ValueError(f"Invalid WebVTT timestamp: {value}")


def clean_cue_text(text: str) -> str:
    without_tags = TAG_RE.sub(" ", html.unescape(text.replace("-->", " ")))
    return " ".join(without_tags.split())


def count_words(text: str) -> int:
    return len(WORD_RE.findall(text))


def skip_block(lines: list[str], index: int) -> int:
    while index < len(lines) and lines[index].strip():
        index += 1
    return index


def render_single_report(report: SpeedReport, *, show_breaks: int) -> str:
    lines = [
        f"Input: {report.input_path}",
        (
            f"Parsed {report.cue_count} cues and {report.total_words} words "
            f"across {format_duration(report.total_span_seconds)}."
        ),
        "",
        render_selected_report(report),
        "",
        "Parameters:",
        f"  {format_profile_params(report.profile)}",
    ]
    lines.extend(render_break_lines(report, show_breaks=show_breaks))
    return "\n".join(lines)


def render_auto_report(
    reports: list[SpeedReport],
    selected: SpeedReport,
    *,
    ambiguous: bool,
    prompted: bool,
    show_breaks: int,
) -> str:
    first = reports[0]
    lines = [
        f"Input: {first.input_path}",
        (
            f"Parsed {first.cue_count} cues and {first.total_words} words "
            f"across {format_duration(first.total_span_seconds)}."
        ),
        "",
        "Auto candidate profiles:",
    ]

    for index, report in enumerate(reports, start=1):
        lines.append(f"  {index}. {format_candidate_line(report)}")

    lines.append("")
    if ambiguous:
        rates = [report.speech_rate_wpm for report in reports]
        spread = max(rates) - min(rates)
        lines.append(
            "Auto verdict: ambiguous. The candidate profiles differ by "
            f"{spread:.1f} wpm, so the answer depends on how pauses should count."
        )
        if prompted:
            lines.append(f"Selected from prompt: {selected.profile.name}.")
        else:
            lines.append(
                f"Defaulting to {selected.profile.name}. Rerun with --profile or "
                "--max-gap to make the pause rule explicit."
            )
    else:
        lines.append(f"Auto verdict: candidates agree; using {selected.profile.name}.")

    lines.extend(["", render_selected_report(selected)])
    lines.extend(render_break_lines(selected, show_breaks=show_breaks))
    return "\n".join(lines)


def render_selected_report(report: SpeedReport) -> str:
    return "\n".join(
        [
            (
                f"Speech speed: {report.speech_rate_wpm:.1f} wpm "
                f"({pace_label(report.speech_rate_wpm)})"
            ),
            (
                f"Measured over {format_duration(report.active_seconds)} of speech in "
                f"{len(report.speech_runs)} runs; excluded "
                f"{format_duration(report.excluded_seconds)} of gaps or ignored runs."
            ),
            (
                f"Articulation-only rate: {report.articulation_rate_wpm:.1f} wpm; "
                f"full-session rate: {report.session_rate_wpm:.1f} wpm."
            ),
        ]
    )


def render_break_lines(report: SpeedReport, *, show_breaks: int) -> list[str]:
    if show_breaks <= 0:
        return []

    lines = [
        "",
        (f"Long breaks >= {report.profile.long_break_gap:.2f}s: {len(report.long_breaks)}"),
    ]
    for gap in sorted(report.long_breaks, key=lambda item: item.duration, reverse=True)[
        :show_breaks
    ]:
        lines.append(
            f"  {format_timestamp(gap.start)} -> {format_timestamp(gap.end)} ({gap.duration:.1f}s)"
        )
    return lines


def format_candidate_line(report: SpeedReport) -> str:
    return (
        f"{report.profile.name}: {report.speech_rate_wpm:.1f} wpm "
        f"({pace_label(report.speech_rate_wpm)}), "
        f"runs={len(report.speech_runs)}, excluded={format_duration(report.excluded_seconds)}, "
        f"{format_profile_params(report.profile)}"
    )


def format_profile_params(profile: GapProfile) -> str:
    return (
        f"max-gap={profile.max_gap:.2f}s, "
        f"long-break-gap={profile.long_break_gap:.2f}s, "
        f"min-run-words={profile.min_run_words}, "
        f"min-run-seconds={profile.min_run_seconds:.2f}s"
    )


def pace_label(wpm: float) -> str:
    if wpm < 100:
        return "very slow"
    if wpm < 120:
        return "slow"
    if wpm < 145:
        return "conversational"
    if wpm < 165:
        return "brisk"
    if wpm < 190:
        return "fast"
    return "very fast"


def format_duration(seconds: float) -> str:
    rounded = int(round(seconds))
    hours, remainder = divmod(rounded, 3600)
    minutes, secs = divmod(remainder, 60)
    if hours:
        return f"{hours}h {minutes}m {secs}s"
    if minutes:
        return f"{minutes}m {secs}s"
    return f"{secs}s"


def format_timestamp(seconds: float) -> str:
    milliseconds = max(0, int(round(seconds * 1000)))
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{millis:03d}"


def is_polarized(reports: list[SpeedReport]) -> bool:
    rates = [report.speech_rate_wpm for report in reports]
    if len(rates) < 2:
        return False

    spread = max(rates) - min(rates)
    median_rate = statistics.median(rates)
    labels = {pace_label(rate) for rate in rates}
    return spread >= max(18.0, median_rate * 0.12) or len(labels) > 1


def select_default_report(reports: list[SpeedReport]) -> SpeedReport:
    for report in reports:
        if report.profile.name == AUTO_DEFAULT_PROFILE:
            return report
    return reports[len(reports) // 2]


def choose_report_interactively(reports: list[SpeedReport]) -> SpeedReport:
    default = select_default_report(reports)
    default_index = reports.index(default) + 1
    while True:
        choice = input(f"Choose profile [1-{len(reports)}] (Enter for {default_index}): ").strip()
        if not choice:
            return default
        if choice.isdigit():
            index = int(choice)
            if 1 <= index <= len(reports):
                return reports[index - 1]
        print("Please enter one of the listed profile numbers.")


def render_interactive_choices(reports: list[SpeedReport]) -> str:
    lines = [
        "Auto mode found materially different speech-speed interpretations.",
        "Choose the pause profile that matches how you want gaps counted:",
    ]
    for index, report in enumerate(reports, start=1):
        lines.append(f"  {index}. {format_candidate_line(report)}")
    return "\n".join(lines)


def profile_from_args(args: argparse.Namespace) -> GapProfile:
    base = DEFAULT_PROFILES_BY_NAME[args.profile or AUTO_DEFAULT_PROFILE]
    profile = replace(base)
    overridden = False

    if args.max_gap is not None:
        profile = replace(profile, max_gap=args.max_gap)
        overridden = True
    if args.long_break_gap is not None:
        profile = replace(profile, long_break_gap=args.long_break_gap)
        overridden = True
    if args.min_run_words is not None:
        profile = replace(profile, min_run_words=args.min_run_words)
        overridden = True
    if args.min_run_seconds is not None:
        profile = replace(profile, min_run_seconds=args.min_run_seconds)
        overridden = True

    if overridden and args.profile is None:
        return replace(profile, name="custom")
    if overridden:
        return replace(profile, name=f"{profile.name}-custom")
    return profile


def has_explicit_tuning(argv: Sequence[str]) -> bool:
    for argument in argv:
        for flag in TUNING_FLAGS:
            if argument == flag or argument.startswith(f"{flag}="):
                return True
    return False


def should_prompt(args: argparse.Namespace) -> bool:
    return not args.no_prompt and not args.json and sys.stdin.isatty() and sys.stdout.isatty()


def report_to_dict(report: SpeedReport) -> dict[str, object]:
    return {
        "profile": report.profile.name,
        "parameters": {
            "max_gap": report.profile.max_gap,
            "long_break_gap": report.profile.long_break_gap,
            "min_run_words": report.profile.min_run_words,
            "min_run_seconds": report.profile.min_run_seconds,
        },
        "cue_count": report.cue_count,
        "total_words": report.total_words,
        "included_words": report.included_words,
        "total_span_seconds": round(report.total_span_seconds, 3),
        "active_seconds": round(report.active_seconds, 3),
        "excluded_seconds": round(report.excluded_seconds, 3),
        "speech_rate_wpm": round(report.speech_rate_wpm, 3),
        "pace": pace_label(report.speech_rate_wpm),
        "articulation_rate_wpm": round(report.articulation_rate_wpm, 3),
        "session_rate_wpm": round(report.session_rate_wpm, 3),
        "speech_run_count": len(report.speech_runs),
        "ignored_run_count": len(report.ignored_runs),
        "long_breaks": [
            {
                "start": format_timestamp(gap.start),
                "end": format_timestamp(gap.end),
                "seconds": round(gap.duration, 3),
            }
            for gap in report.long_breaks
        ],
    }


def render_json(
    *,
    mode: str,
    reports: list[SpeedReport],
    selected: SpeedReport,
    ambiguous: bool = False,
) -> str:
    payload = {
        "input": str(selected.input_path),
        "mode": mode,
        "ambiguous": ambiguous,
        "selected_profile": selected.profile.name,
        "selected": report_to_dict(selected),
        "candidates": [report_to_dict(report) for report in reports],
    }
    return json.dumps(payload, indent=2)


def non_negative_float(value: str) -> float:
    parsed = float(value)
    if parsed < 0.0:
        raise argparse.ArgumentTypeError("must be >= 0")
    return parsed


def positive_int(value: str) -> int:
    parsed = int(value)
    if parsed < 1:
        raise argparse.ArgumentTypeError("must be >= 1")
    return parsed


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="Input .vtt transcript.")
    parser.add_argument(
        "--profile",
        choices=sorted(DEFAULT_PROFILES_BY_NAME),
        help="Use a named candidate profile as the base for a single report.",
    )
    parser.add_argument(
        "--auto",
        action="store_true",
        help="Run all default candidate profiles. This is the default with no tuning flags.",
    )
    parser.add_argument(
        "--max-gap",
        type=non_negative_float,
        help="Maximum cue-to-cue pause, in seconds, to count inside a speech run.",
    )
    parser.add_argument(
        "--long-break-gap",
        type=non_negative_float,
        help="Report cue-to-cue pauses at or above this many seconds as long breaks.",
    )
    parser.add_argument(
        "--min-run-words",
        type=positive_int,
        help="Ignore speech runs with fewer than this many words.",
    )
    parser.add_argument(
        "--min-run-seconds",
        type=non_negative_float,
        help="Ignore speech runs shorter than this many seconds.",
    )
    parser.add_argument(
        "--show-breaks",
        type=int,
        default=5,
        help="Number of longest long breaks to print. Use 0 to hide them. Default: 5.",
    )
    parser.add_argument("--json", action="store_true", help="Emit JSON instead of text.")
    parser.add_argument(
        "--no-prompt",
        action="store_true",
        help="Do not ask for a profile in ambiguous auto mode; use the balanced profile.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    if argv is None:
        argv = sys.argv[1:]

    args = build_parser().parse_args(argv)

    try:
        cues = parse_vtt(args.input)
        explicit_tuning = has_explicit_tuning(argv)
        if args.auto or not explicit_tuning:
            reports = [analyze_cues(cues, profile, args.input) for profile in DEFAULT_PROFILES]
            ambiguous = is_polarized(reports)
            selected = select_default_report(reports)
            prompted = False
            if ambiguous and should_prompt(args):
                print(render_interactive_choices(reports))
                selected = choose_report_interactively(reports)
                prompted = True

            if args.json:
                print(
                    render_json(
                        mode="auto",
                        reports=reports,
                        selected=selected,
                        ambiguous=ambiguous,
                    )
                )
            else:
                print(
                    render_auto_report(
                        reports,
                        selected,
                        ambiguous=ambiguous,
                        prompted=prompted,
                        show_breaks=args.show_breaks,
                    )
                )
            return

        profile = profile_from_args(args)
        report = analyze_cues(cues, profile, args.input)
        if args.json:
            print(render_json(mode="single", reports=[report], selected=report))
        else:
            print(render_single_report(report, show_breaks=args.show_breaks))
    except (OSError, ValueError) as exc:
        raise SystemExit(f"error: {exc}") from exc


if __name__ == "__main__":
    main()
