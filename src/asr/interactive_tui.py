"""Interactive terminal subtitle tuning for audio or video inputs."""

from __future__ import annotations

import argparse
import array
import curses
import math
import subprocess
import sys
import threading
import time
import traceback
import wave
from collections.abc import Callable
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path
from typing import TypeVar

from asr.media import extract_mono_16khz_wav
from asr.model_cache import (
    DEFAULT_DOWNLOAD_DIR,
    DEFAULT_MODEL_DIR,
    DEFAULT_RUNTIME_MODEL_DIR,
    ensure_model_cached,
    runtime_model_destination,
    stage_model_for_runtime,
)
from asr.runtime_env import restart_with_system_media_libraries
from asr.transcribe_vtt import (
    DEFAULT_MODELS,
    Cue,
    TranscriptionResult,
    TranscriptionSession,
    cues_from_words,
    load_transcription_session,
    render_txt,
    render_vtt,
    transcript_output_path,
    wrap_subtitle_text,
)

T = TypeVar("T")
DEFAULT_TUI_BACKEND = "whisperx"


@dataclass(frozen=True)
class Waveform:
    peaks: list[float]
    duration: float


@dataclass(frozen=True)
class SubtitleSettings:
    max_line_width: int
    max_cue_chars: int
    max_cue_duration: float
    max_gap: float


@dataclass(frozen=True)
class TranscriptState:
    result: TranscriptionResult
    settings: SubtitleSettings


@dataclass(frozen=True)
class WriteResult:
    output_path: Path
    txt_path: Path
    cue_count: int


@dataclass(frozen=True)
class SliderGeometry:
    y: int
    start_x: int
    end_x: int


@dataclass(frozen=True)
class ModelLoadPlan:
    model_name: str
    model_path: Path
    cache_label: str

    @property
    def progress_detail(self) -> str:
        return f"{self.model_name} from {self.cache_label}: {self.model_path}"


class AudioPlayer:
    def __init__(self, audio_path: Path, *, duration: float, ffplay: str) -> None:
        self.audio_path = audio_path
        self.duration = max(0.0, duration)
        self.ffplay = ffplay
        self._position = 0.0
        self._started_at: float | None = None
        self._proc: subprocess.Popen[bytes] | None = None
        self._error: str | None = None

    @property
    def error(self) -> str | None:
        return self._error

    @property
    def paused(self) -> bool:
        return self._started_at is None

    def position(self) -> float:
        if self._started_at is None:
            return self._position

        position = self._position + (time.monotonic() - self._started_at)
        if position >= self.duration:
            self.stop()
            self._position = self.duration
            return self._position

        if self._proc is not None and self._proc.poll() is not None:
            self._started_at = None
            self._position = min(self.duration, position)
            return self._position

        return min(self.duration, position)

    def play(self) -> None:
        if self.duration <= 0.0:
            return
        if not self.paused:
            return
        if self._position >= self.duration:
            self._position = 0.0

        command = [
            self.ffplay,
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostats",
            "-nodisp",
            "-autoexit",
            "-ss",
            f"{self._position:.3f}",
            str(self.audio_path),
        ]
        try:
            self._proc = subprocess.Popen(
                command,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except OSError as exc:
            self._error = f"Could not start {self.ffplay}: {exc}"
            return

        self._error = None
        self._started_at = time.monotonic()

    def pause(self) -> None:
        if self.paused:
            return

        self._position = self.position()
        self._started_at = None
        self._terminate_proc()

    def stop(self) -> None:
        self._started_at = None
        self._terminate_proc()

    def toggle(self) -> None:
        if self.paused:
            self.play()
        else:
            self.pause()

    def seek(self, position: float) -> None:
        was_playing = not self.paused
        self.stop()
        self._position = clamp(position, 0.0, self.duration)
        if was_playing:
            self.play()

    def skip(self, seconds: float) -> None:
        self.seek(self.position() + seconds)

    def _terminate_proc(self) -> None:
        if self._proc is None or self._proc.poll() is not None:
            self._proc = None
            return

        self._proc.terminate()
        try:
            self._proc.wait(timeout=0.25)
        except subprocess.TimeoutExpired:
            self._proc.kill()
            self._proc.wait(timeout=0.25)
        finally:
            self._proc = None


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="Input video or audio file.")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        help="Output .vtt path. Default: input filename with a .vtt suffix.",
    )
    parser.add_argument(
        "--backend",
        choices=["faster-whisper", "whisperx", "parakeet"],
        default=DEFAULT_TUI_BACKEND,
        help=f"ASR backend. Default: {DEFAULT_TUI_BACKEND}.",
    )
    parser.add_argument("--model", help="Model alias, Hugging Face repo id, or local path.")
    parser.add_argument(
        "--model-dir",
        type=Path,
        default=DEFAULT_MODEL_DIR,
        help=f"NAS model directory. Default: {DEFAULT_MODEL_DIR}",
    )
    parser.add_argument(
        "--download-dir",
        type=Path,
        default=DEFAULT_DOWNLOAD_DIR,
        help=f"Temporary download root. Default: {DEFAULT_DOWNLOAD_DIR}",
    )
    parser.add_argument(
        "--runtime-model-dir",
        type=Path,
        default=DEFAULT_RUNTIME_MODEL_DIR,
        help=f"Local runtime model mirror directory. Default: {DEFAULT_RUNTIME_MODEL_DIR}",
    )
    parser.add_argument(
        "--no-stage-model",
        dest="stage_model",
        action="store_false",
        help="Load NAS-backed models directly instead of first mirroring them locally.",
    )
    parser.add_argument("--device", default="cuda", choices=["cuda", "cpu", "auto"])
    parser.add_argument("--device-index", type=int, default=0)
    parser.add_argument("--compute-type", default="float16")
    parser.add_argument("--language", help="Optional language code, such as en.")
    parser.add_argument("--task", default="transcribe", choices=["transcribe", "translate"])
    parser.add_argument("--beam-size", type=int, default=5)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--vad-filter", dest="vad_filter", action="store_true", default=True)
    parser.add_argument("--no-vad-filter", dest="vad_filter", action="store_false")
    parser.add_argument(
        "--vad-method",
        default="silero",
        choices=["silero", "pyannote"],
        help="WhisperX VAD method. Silero avoids gated pyannote model requirements.",
    )
    parser.add_argument("--align-model", help="Optional WhisperX alignment model override.")
    parser.add_argument("--max-line-width", type=int, default=42)
    parser.add_argument("--max-cue-chars", type=int, default=84)
    parser.add_argument("--max-cue-duration", type=float, default=6.0)
    parser.add_argument("--max-gap", type=float, default=0.7)
    parser.add_argument("--ffplay", default="ffplay", help="Audio playback command.")
    return parser


def main() -> None:
    restart_with_system_media_libraries()
    args = build_parser().parse_args()
    input_path = args.input.expanduser()
    args.model_dir = args.model_dir.expanduser()
    args.download_dir = args.download_dir.expanduser()
    args.runtime_model_dir = args.runtime_model_dir.expanduser()
    output_path = args.output.expanduser() if args.output else input_path.with_suffix(".vtt")
    write_result = curses.wrapper(run_tui, args, input_path, output_path)
    if write_result is not None:
        print(
            f"Wrote {write_result.cue_count} cues to "
            f"{write_result.output_path} and {write_result.txt_path}"
        )
    else:
        print("No transcript written.")


def run_tui(
    stdscr: curses.window,
    args: argparse.Namespace,
    input_path: Path,
    output_path: Path,
) -> WriteResult | None:
    configure_curses(stdscr)
    backend = args.backend
    model_plan = run_with_progress(
        stdscr,
        "Resolving ASR model cache",
        model_cache_detail(args),
        lambda: resolve_model_load_plan(args),
    )
    if should_stage_model_for_runtime(model_plan.model_path, args):
        model_plan = run_with_progress(
            stdscr,
            "Staging ASR model locally",
            runtime_stage_detail(model_plan, args),
            lambda: stage_model_load_plan(model_plan, args),
        )
    session = run_with_progress(
        stdscr,
        "Loading ASR model",
        model_plan.progress_detail,
        lambda: load_transcription_session(
            backend=backend,
            model_name=str(model_plan.model_path),
            model_dir=args.model_dir,
            download_dir=args.download_dir,
            device=args.device,
            device_index=args.device_index,
            compute_type=args.compute_type,
            language=args.language,
            task=args.task,
            vad_method=args.vad_method,
        ),
    )
    prepared_audio = run_with_progress(
        stdscr,
        "Preparing audio waveform",
        str(input_path),
        lambda: extract_mono_16khz_wav(input_path, output_dir=args.download_dir / "audio"),
    )
    waveform = run_with_progress(
        stdscr,
        "Reading waveform peaks",
        str(prepared_audio),
        lambda: read_waveform(prepared_audio),
    )
    settings = SubtitleSettings(
        max_line_width=args.max_line_width,
        max_cue_chars=args.max_cue_chars,
        max_cue_duration=args.max_cue_duration,
        max_gap=args.max_gap,
    )
    result = run_transcription(stdscr, session, prepared_audio, args, settings)
    state = TranscriptState(result=result, settings=settings)
    player = AudioPlayer(prepared_audio, duration=waveform.duration, ffplay=args.ffplay)
    player.play()

    status = "Playing. Press Enter to write VTT/TXT, g to tune max_gap, q to quit."
    try:
        while True:
            position = player.position()
            slider = draw_main_screen(
                stdscr,
                input_path=input_path,
                output_path=output_path,
                session=session,
                waveform=waveform,
                state=state,
                player=player,
                position=position,
                status=status,
            )
            key = stdscr.getch()
            if key == -1:
                continue
            if key in {ord("q"), ord("Q")}:
                return None
            if key in {ord(" "), ord("k"), ord("K")}:
                player.toggle()
                status = "Paused." if player.paused else "Playing."
                continue
            if key in {curses.KEY_LEFT, ord("h"), ord("H")}:
                player.skip(-5.0)
                status = "Skipped back 5 seconds."
                continue
            if key in {curses.KEY_RIGHT, ord("l"), ord("L")}:
                player.skip(5.0)
                status = "Skipped forward 5 seconds."
                continue
            if key == curses.KEY_HOME:
                player.seek(0.0)
                status = "Seeked to start."
                continue
            if key == curses.KEY_END:
                player.seek(waveform.duration)
                status = "Seeked to end."
                continue
            if key in {ord("g"), ord("G")}:
                state, status = prompt_and_regenerate(
                    stdscr,
                    session=session,
                    audio_path=prepared_audio,
                    args=args,
                    state=state,
                )
                continue
            if key in {curses.KEY_ENTER, ord("\n"), ord("\r")}:
                if confirm_write(stdscr, output_path):
                    return write_transcripts(state, output_path)
                status = "Write canceled."
                continue
            if key == curses.KEY_MOUSE:
                clicked = handle_mouse(stdscr, slider, player, waveform.duration)
                if clicked:
                    status = "Seeked from slider click."
    finally:
        player.stop()


def configure_curses(stdscr: curses.window) -> None:
    curses.cbreak()
    curses.noecho()
    stdscr.keypad(True)
    stdscr.nodelay(True)
    curses.mousemask(curses.ALL_MOUSE_EVENTS)
    with suppress(curses.error):
        curses.curs_set(0)


def run_transcription(
    stdscr: curses.window,
    session: TranscriptionSession,
    prepared_audio: Path,
    args: argparse.Namespace,
    settings: SubtitleSettings,
) -> TranscriptionResult:
    return run_with_progress(
        stdscr,
        "Generating transcript",
        f"max_gap={settings.max_gap:.2f}s",
        lambda: session.transcribe(
            prepared_audio,
            language=args.language,
            task=args.task,
            beam_size=args.beam_size,
            vad_filter=args.vad_filter,
            condition_on_previous_text=False,
            batch_size=args.batch_size,
            align_model=args.align_model,
            max_cue_chars=settings.max_cue_chars,
            max_cue_duration=settings.max_cue_duration,
            max_gap=settings.max_gap,
        ),
    )


def run_with_progress(
    stdscr: curses.window,
    title: str,
    detail: str,
    func: Callable[[], T],
) -> T:
    result: dict[str, T | BaseException | str] = {}
    started_at = time.monotonic()

    def worker() -> None:
        try:
            result["value"] = func()
        except BaseException as exc:  # noqa: BLE001 - re-raised after curses cleanup.
            result["error"] = exc
            result["traceback"] = traceback.format_exc()

    thread = threading.Thread(target=worker, daemon=True)
    thread.start()
    frame = 0
    while thread.is_alive():
        draw_progress(stdscr, title, detail, frame, elapsed=time.monotonic() - started_at)
        frame += 1
        # Use time.sleep, not curses.napms: napms holds the GIL while it sleeps,
        # starving the worker thread doing GIL-bound work (heavy imports and model
        # loading) so the progress screen would otherwise hang indefinitely.
        time.sleep(0.09)

    thread.join()
    error = result.get("error")
    if error is not None:
        trace = result.get("traceback")
        raise RuntimeError(f"{title} failed:\n{trace}") from error

    return result["value"]  # type: ignore[return-value]


def draw_progress(
    stdscr: curses.window,
    title: str,
    detail: str,
    frame: int,
    *,
    elapsed: float,
) -> None:
    stdscr.erase()
    height, width = stdscr.getmaxyx()
    center_y = max(0, height // 2 - 2)
    add_centered(stdscr, center_y, title)
    add_centered(stdscr, center_y + 1, detail)
    add_centered(stdscr, center_y + 2, f"elapsed {elapsed:.1f}s")

    bar_width = max(10, min(48, width - 8))
    offset = frame % bar_width
    segment_width = max(3, bar_width // 4)
    chars = ["-"] * bar_width
    for index in range(segment_width):
        chars[(offset + index) % bar_width] = "#"

    bar = "[" + "".join(chars) + "]"
    add_centered(stdscr, center_y + 4, bar)
    stdscr.refresh()


def draw_main_screen(
    stdscr: curses.window,
    *,
    input_path: Path,
    output_path: Path,
    session: TranscriptionSession,
    waveform: Waveform,
    state: TranscriptState,
    player: AudioPlayer,
    position: float,
    status: str,
) -> SliderGeometry:
    stdscr.erase()
    height, width = stdscr.getmaxyx()
    if height < 12 or width < 48:
        addstr(stdscr, 0, 0, "Terminal too small; use at least 48x12.")
        stdscr.refresh()
        return SliderGeometry(y=max(0, height - 2), start_x=0, end_x=max(0, width - 1))

    addstr(stdscr, 0, 0, f"Input: {input_path}")
    addstr(
        stdscr,
        1,
        0,
        (
            f"Model: {session.model_label} | max_gap={state.settings.max_gap:.2f}s | "
            f"cues={len(state.result.cues)}"
        ),
    )
    addstr(stdscr, 2, 0, f"Output: {output_path} | TXT: {transcript_output_path(output_path)}")
    player_status = "paused" if player.paused else "playing"
    if player.error is not None:
        player_status = player.error
    addstr(stdscr, 3, 0, f"Status: {status} ({player_status})")

    slider_y = height - 3
    help_y = height - 1
    subtitle_top = max(6, slider_y - 4)
    wave_top = 5
    wave_bottom = max(wave_top, subtitle_top - 1)
    draw_waveform(
        stdscr,
        waveform,
        top=wave_top,
        bottom=wave_bottom,
        width=width,
        position=position,
    )
    draw_subtitle(stdscr, state.result.cues, position, top=subtitle_top, width=width)
    slider = draw_slider(stdscr, slider_y, width, position, waveform.duration)
    addstr(
        stdscr,
        help_y,
        0,
        "Space play/pause | Left/Right seek | g max_gap | Enter write | q quit | click slider",
    )
    stdscr.refresh()
    return slider


def draw_waveform(
    stdscr: curses.window,
    waveform: Waveform,
    *,
    top: int,
    bottom: int,
    width: int,
    position: float,
) -> None:
    height = max(1, bottom - top + 1)
    columns = max(1, width - 2)
    peaks = resample_peaks(waveform.peaks, columns)
    playhead = int(clamp(position / max(waveform.duration, 0.001), 0.0, 1.0) * (columns - 1))

    for row in range(height):
        threshold = 1.0 - (row + 1) / height
        y = top + row
        for col, peak in enumerate(peaks):
            char = "#" if peak >= threshold else " "
            attr = curses.A_REVERSE if col == playhead else curses.A_NORMAL
            addstr(stdscr, y, col + 1, char, attr)


def draw_subtitle(
    stdscr: curses.window,
    cues: list[Cue],
    position: float,
    *,
    top: int,
    width: int,
) -> None:
    cue = active_cue(cues, position)
    text = cue.text if cue is not None else ""
    lines = wrap_subtitle_text(text, max_line_width=max(20, width - 4))[:3]
    for offset, line in enumerate(lines):
        add_centered(stdscr, top + offset, line, curses.A_BOLD)


def draw_slider(
    stdscr: curses.window,
    y: int,
    width: int,
    position: float,
    duration: float,
) -> SliderGeometry:
    left_label = format_clock(position)
    right_label = format_clock(duration)
    start_x = len(left_label) + 2
    end_x = max(start_x, width - len(right_label) - 3)
    track_width = max(1, end_x - start_x + 1)
    ratio = clamp(position / max(duration, 0.001), 0.0, 1.0)
    knob = start_x + int(round(ratio * (track_width - 1)))

    addstr(stdscr, y, 0, left_label)
    for x in range(start_x, end_x + 1):
        char = "=" if x < knob else "-"
        addstr(stdscr, y, x, char)
    addstr(stdscr, y, knob, "o", curses.A_REVERSE)
    addstr(stdscr, y, end_x + 2, right_label)
    return SliderGeometry(y=y, start_x=start_x, end_x=end_x)


def prompt_and_regenerate(
    stdscr: curses.window,
    *,
    session: TranscriptionSession,
    audio_path: Path,
    args: argparse.Namespace,
    state: TranscriptState,
) -> tuple[TranscriptState, str]:
    value = prompt(stdscr, f"New max_gap in seconds [{state.settings.max_gap:.2f}]: ")
    if not value:
        return state, "Max gap unchanged."

    try:
        max_gap = float(value)
    except ValueError:
        return state, f"Invalid max_gap: {value!r}"

    if max_gap < 0.0:
        return state, "max_gap must be zero or greater."

    settings = SubtitleSettings(
        max_line_width=state.settings.max_line_width,
        max_cue_chars=state.settings.max_cue_chars,
        max_cue_duration=state.settings.max_cue_duration,
        max_gap=max_gap,
    )
    if state.result.words:
        cues = cues_from_words(
            state.result.words,
            max_cue_chars=settings.max_cue_chars,
            max_cue_duration=settings.max_cue_duration,
            max_gap=settings.max_gap,
        )
        result = TranscriptionResult(cues=cues, note=state.result.note, words=state.result.words)
    else:
        result = run_transcription(stdscr, session, audio_path, args, settings)

    status = f"Regenerated with max_gap={max_gap:.2f}s."
    return TranscriptState(result=result, settings=settings), status


def confirm_write(stdscr: curses.window, output_path: Path) -> bool:
    txt_path = transcript_output_path(output_path)
    value = prompt(stdscr, f"Write {output_path} and {txt_path}? [y/N] ")
    return value.lower() in {"y", "yes"}


def write_transcripts(state: TranscriptState, output_path: Path) -> WriteResult:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        render_vtt(
            state.result.cues,
            max_line_width=state.settings.max_line_width,
            note=state.result.note,
        ),
        encoding="utf-8",
    )
    txt_path = transcript_output_path(output_path)
    txt_path.write_text(render_txt(state.result.cues), encoding="utf-8")
    return WriteResult(output_path=output_path, txt_path=txt_path, cue_count=len(state.result.cues))


def handle_mouse(
    stdscr: curses.window,
    slider: SliderGeometry,
    player: AudioPlayer,
    duration: float,
) -> bool:
    try:
        _, x, y, _, button_state = curses.getmouse()
    except curses.error:
        return False

    clicked = bool(button_state & (curses.BUTTON1_CLICKED | curses.BUTTON1_PRESSED))
    if not clicked or y != slider.y or not (slider.start_x <= x <= slider.end_x):
        return False

    ratio = (x - slider.start_x) / max(1, slider.end_x - slider.start_x)
    player.seek(ratio * duration)
    return True


def prompt(stdscr: curses.window, message: str) -> str:
    height, width = stdscr.getmaxyx()
    y = max(0, height - 2)
    stdscr.nodelay(False)
    curses.echo()
    with suppress(curses.error):
        curses.curs_set(1)

    addstr(stdscr, y, 0, " " * max(0, width - 1))
    addstr(stdscr, y, 0, message)
    stdscr.refresh()
    raw = stdscr.getstr(y, min(len(message), max(0, width - 2)), 32)

    curses.noecho()
    with suppress(curses.error):
        curses.curs_set(0)
    stdscr.nodelay(True)
    return raw.decode("utf-8", errors="replace").strip()


def read_waveform(path: Path, *, buckets: int = 4096) -> Waveform:
    with wave.open(str(path), "rb") as wav_file:
        channels = wav_file.getnchannels()
        sample_width = wav_file.getsampwidth()
        frame_rate = wav_file.getframerate()
        frame_count = wav_file.getnframes()
        if channels != 1 or sample_width != 2:
            raise ValueError(f"Expected mono 16-bit PCM WAV, got {channels}ch/{sample_width} bytes")

        frames_per_bucket = max(1, math.ceil(frame_count / max(1, buckets)))
        peaks: list[float] = []
        while True:
            raw = wav_file.readframes(frames_per_bucket)
            if not raw:
                break
            samples = array.array("h")
            samples.frombytes(raw)
            if sys.byteorder != "little":
                samples.byteswap()
            peak = max((abs(sample) for sample in samples), default=0) / 32768.0
            peaks.append(peak)

    max_peak = max(peaks, default=0.0)
    if max_peak > 0.0:
        peaks = [min(1.0, peak / max_peak) for peak in peaks]
    return Waveform(peaks=peaks, duration=frame_count / frame_rate if frame_rate else 0.0)


def resample_peaks(peaks: list[float], columns: int) -> list[float]:
    if not peaks:
        return [0.0] * columns
    if columns <= 1:
        return [max(peaks)]

    scale = len(peaks) / columns
    sampled: list[float] = []
    for column in range(columns):
        start = int(column * scale)
        end = max(start + 1, int((column + 1) * scale))
        sampled.append(max(peaks[start : min(end, len(peaks))], default=0.0))
    return sampled


def active_cue(cues: list[Cue], position: float) -> Cue | None:
    for cue in cues:
        if cue.start <= position <= max(cue.end, cue.start + 0.5):
            return cue
        if cue.start > position:
            return None
    return None


def resolve_model_load_plan(args: argparse.Namespace) -> ModelLoadPlan:
    model_name = args.model or DEFAULT_MODELS[args.backend]
    model_path = ensure_model_cached(
        model_name,
        model_dir=args.model_dir,
        download_dir=args.download_dir,
    )
    return ModelLoadPlan(
        model_name=model_name,
        model_path=model_path,
        cache_label=model_cache_label(model_path, args.model_dir),
    )


def should_stage_model_for_runtime(model_path: Path, args: argparse.Namespace) -> bool:
    if not args.stage_model or not model_path.is_dir():
        return False

    resolved_model_path = model_path.resolve()
    runtime_dir = args.runtime_model_dir.resolve()
    if resolved_model_path == runtime_dir or resolved_model_path.is_relative_to(runtime_dir):
        return False

    return resolved_model_path.is_relative_to(args.model_dir.resolve())


def runtime_stage_detail(model_plan: ModelLoadPlan, args: argparse.Namespace) -> str:
    destination = runtime_model_destination(model_plan.model_path, args.runtime_model_dir)
    return f"{model_plan.model_path} -> {destination}"


def stage_model_load_plan(model_plan: ModelLoadPlan, args: argparse.Namespace) -> ModelLoadPlan:
    staged_path = stage_model_for_runtime(
        model_plan.model_path,
        runtime_dir=args.runtime_model_dir,
    )
    return ModelLoadPlan(
        model_name=model_plan.model_name,
        model_path=staged_path,
        cache_label=f"runtime stage of {model_plan.cache_label}",
    )


def model_cache_detail(args: argparse.Namespace) -> str:
    model_name = args.model or DEFAULT_MODELS[args.backend]
    return f"backend={args.backend} model={model_name} model-dir={args.model_dir}"


def model_cache_label(model_path: Path, model_dir: Path) -> str:
    try:
        model_path.resolve().relative_to(model_dir.resolve())
    except ValueError:
        return "local path"
    return "model-dir"


def format_clock(seconds: float) -> str:
    total = max(0, int(seconds))
    minutes, secs = divmod(total, 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f"{hours:d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"


def add_centered(
    stdscr: curses.window,
    y: int,
    text: str,
    attr: int = curses.A_NORMAL,
) -> None:
    _, width = stdscr.getmaxyx()
    x = max(0, (width - len(text)) // 2)
    addstr(stdscr, y, x, text, attr)


def addstr(
    stdscr: curses.window,
    y: int,
    x: int,
    text: str,
    attr: int = curses.A_NORMAL,
) -> None:
    height, width = stdscr.getmaxyx()
    if y < 0 or y >= height or x >= width:
        return
    x = max(0, x)
    available = max(0, width - x - 1)
    if available <= 0:
        return
    with suppress(curses.error):
        stdscr.addstr(y, x, text[:available], attr)


def clamp(value: float, minimum: float, maximum: float) -> float:
    return min(max(value, minimum), maximum)


if __name__ == "__main__":
    main()
