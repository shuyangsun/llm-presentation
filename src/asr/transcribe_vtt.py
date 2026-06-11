"""Transcribe video or audio into WebVTT subtitles with faster-whisper on CUDA."""

from __future__ import annotations

import argparse
import shutil
import textwrap
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from asr.cuda_env import configure_cuda_shared_libraries
from asr.media import extract_mono_16khz_wav
from asr.model_cache import (
    DEFAULT_DOWNLOAD_DIR,
    DEFAULT_MODEL_DIR,
    ensure_model_cached,
    find_nemo_checkpoint,
)
from asr.runtime_env import restart_with_system_media_libraries

Backend = Literal["faster-whisper", "whisperx", "parakeet"]

DEFAULT_BACKEND: Backend = "whisperx"
DEFAULT_MODELS: dict[Backend, str] = {
    "faster-whisper": "large-v3",
    "whisperx": "large-v3",
    "parakeet": "parakeet",
}


@dataclass(frozen=True)
class Word:
    start: float
    end: float
    text: str


@dataclass(frozen=True)
class Cue:
    start: float
    end: float
    text: str


def transcribe_to_vtt(
    input_path: Path,
    output_path: Path,
    *,
    model_name: str | None,
    model_dir: Path,
    download_dir: Path,
    device: str,
    device_index: int,
    compute_type: str,
    language: str | None,
    task: str,
    beam_size: int,
    vad_filter: bool,
    condition_on_previous_text: bool,
    max_line_width: int,
    max_cue_chars: int,
    max_cue_duration: float,
    max_gap: float,
    backend: Backend = DEFAULT_BACKEND,
    batch_size: int = 32,
    vad_method: str = "silero",
    align_model: str | None = None,
) -> list[Cue]:
    model_name = model_name or DEFAULT_MODELS[backend]
    prepared_input = input_path
    if backend in {"whisperx", "parakeet"}:
        prepared_input = extract_mono_16khz_wav(
            input_path,
            output_dir=download_dir / "audio",
        )

    if backend == "faster-whisper":
        cues, note = transcribe_with_faster_whisper(
            prepared_input,
            model_name=model_name,
            model_dir=model_dir,
            download_dir=download_dir,
            device=device,
            device_index=device_index,
            compute_type=compute_type,
            language=language,
            task=task,
            beam_size=beam_size,
            vad_filter=vad_filter,
            condition_on_previous_text=condition_on_previous_text,
            max_cue_chars=max_cue_chars,
            max_cue_duration=max_cue_duration,
            max_gap=max_gap,
        )
    elif backend == "whisperx":
        cues, note = transcribe_with_whisperx(
            prepared_input,
            model_name=model_name,
            model_dir=model_dir,
            download_dir=download_dir,
            device=device,
            device_index=device_index,
            compute_type=compute_type,
            language=language,
            task=task,
            batch_size=batch_size,
            vad_method=vad_method,
            align_model=align_model,
            max_cue_chars=max_cue_chars,
            max_cue_duration=max_cue_duration,
            max_gap=max_gap,
        )
    elif backend == "parakeet":
        cues, note = transcribe_with_parakeet(
            prepared_input,
            model_name=model_name,
            model_dir=model_dir,
            download_dir=download_dir,
            device=device,
            device_index=device_index,
            max_cue_chars=max_cue_chars,
            max_cue_duration=max_cue_duration,
            max_gap=max_gap,
        )
    else:
        assert_never(backend)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        render_vtt(cues, max_line_width=max_line_width, note=note),
        encoding="utf-8",
    )
    return cues


def transcribe_with_faster_whisper(
    input_path: Path,
    *,
    model_name: str,
    model_dir: Path,
    download_dir: Path,
    device: str,
    device_index: int,
    compute_type: str,
    language: str | None,
    task: str,
    beam_size: int,
    vad_filter: bool,
    condition_on_previous_text: bool,
    max_cue_chars: int,
    max_cue_duration: float,
    max_gap: float,
) -> tuple[list[Cue], str]:
    model_path = ensure_model_cached(
        model_name,
        model_dir=model_dir,
        download_dir=download_dir,
    )

    if device in {"cuda", "auto"}:
        configure_cuda_shared_libraries()

    from faster_whisper import WhisperModel

    model = WhisperModel(
        str(model_path),
        device=device,
        device_index=device_index,
        compute_type=compute_type,
        local_files_only=True,
    )
    segments, info = model.transcribe(
        str(input_path),
        beam_size=beam_size,
        word_timestamps=True,
        vad_filter=vad_filter,
        language=language,
        task=task,
        condition_on_previous_text=condition_on_previous_text,
    )
    segment_list = list(segments)
    cues = cues_from_segments(
        segment_list,
        max_cue_chars=max_cue_chars,
        max_cue_duration=max_cue_duration,
        max_gap=max_gap,
    )

    note = format_note(
        backend="faster-whisper",
        model=str(model_path),
        language=info.language,
        probability=info.language_probability,
    )
    return cues, note


def transcribe_with_whisperx(
    input_path: Path,
    *,
    model_name: str,
    model_dir: Path,
    download_dir: Path,
    device: str,
    device_index: int,
    compute_type: str,
    language: str | None,
    task: str,
    batch_size: int,
    vad_method: str,
    align_model: str | None,
    max_cue_chars: int,
    max_cue_duration: float,
    max_gap: float,
) -> tuple[list[Cue], str]:
    model_path = ensure_model_cached(
        model_name,
        model_dir=model_dir,
        download_dir=download_dir,
    )
    whisper_device, torch_device = resolve_devices(device, device_index)
    if whisper_device == "cuda":
        configure_cuda_shared_libraries()

    import torch
    import whisperx

    hub_cache_dir, use_final_hub_cache = select_cache_dir(
        model_dir / "torch" / "hub",
        download_dir / "torch-hub",
    )
    torch.hub.set_dir(str(hub_cache_dir))

    audio = whisperx.load_audio(str(input_path))
    model = whisperx.load_model(
        str(model_path),
        whisper_device,
        device_index=device_index,
        compute_type=compute_type,
        language=language,
        task=task,
        download_root=str(download_dir / "whisperx"),
        local_files_only=True,
        vad_method=vad_method,
    )
    result = model.transcribe(audio, batch_size=batch_size)
    detected_language = str(result.get("language") or language or "en")

    align_dir, use_final_align_cache = select_cache_dir(
        model_dir / "torch" / "whisperx-align",
        download_dir / "whisperx-align",
    )

    aligner, metadata = whisperx.load_align_model(
        language_code=detected_language,
        device=torch_device,
        model_name=align_model,
        model_dir=str(align_dir),
        model_cache_only=use_final_align_cache,
    )
    aligned = whisperx.align(
        result["segments"],
        aligner,
        metadata,
        audio,
        torch_device,
        return_char_alignments=False,
    )

    if not use_final_align_cache:
        move_directory_contents(align_dir, model_dir / "torch" / "whisperx-align")
    if not use_final_hub_cache:
        move_directory_contents(hub_cache_dir, model_dir / "torch" / "hub")

    words = words_from_whisperx(aligned.get("word_segments", []))
    if words:
        cues = cues_from_words(
            words,
            max_cue_chars=max_cue_chars,
            max_cue_duration=max_cue_duration,
            max_gap=max_gap,
        )
    else:
        cues = cues_from_whisperx_segments(aligned.get("segments", []))

    note = format_note(
        backend="whisperx",
        model=str(model_path),
        language=detected_language,
        probability=None,
    )
    return cues, note


def transcribe_with_parakeet(
    input_path: Path,
    *,
    model_name: str,
    model_dir: Path,
    download_dir: Path,
    device: str,
    device_index: int,
    max_cue_chars: int,
    max_cue_duration: float,
    max_gap: float,
) -> tuple[list[Cue], str]:
    model_path = ensure_model_cached(
        model_name,
        model_dir=model_dir,
        download_dir=download_dir,
    )
    nemo_path = find_nemo_checkpoint(model_path)
    _, torch_device = resolve_devices(device, device_index)

    import torch
    from nemo.collections.asr.models import ASRModel

    asr_model = ASRModel.restore_from(
        str(nemo_path),
        map_location=torch.device(torch_device),
    )
    asr_model.to(torch_device)
    asr_model.eval()

    with torch.inference_mode():
        output = asr_model.transcribe([str(input_path)], timestamps=True)

    transcript = output[0]
    words = words_from_parakeet(transcript)
    if words:
        cues = cues_from_words(
            words,
            max_cue_chars=max_cue_chars,
            max_cue_duration=max_cue_duration,
            max_gap=max_gap,
        )
    else:
        cues = cues_from_parakeet_segments(transcript)

    note = format_note(
        backend="parakeet",
        model=str(nemo_path),
        language=None,
        probability=None,
    )
    return cues, note


def cues_from_segments(
    segments: object,
    *,
    max_cue_chars: int,
    max_cue_duration: float,
    max_gap: float,
) -> list[Cue]:
    words = words_from_segments(segments)
    if words:
        return cues_from_words(
            words,
            max_cue_chars=max_cue_chars,
            max_cue_duration=max_cue_duration,
            max_gap=max_gap,
        )

    cues: list[Cue] = []
    for segment in segments:
        text = clean_text(str(getattr(segment, "text", "")))
        if text:
            cues.append(Cue(float(segment.start), float(segment.end), text))
    return cues


def words_from_segments(segments: object) -> list[Word]:
    words: list[Word] = []
    for segment in segments:
        for raw_word in getattr(segment, "words", None) or []:
            text = clean_text(str(getattr(raw_word, "word", "")))
            if not text:
                continue

            start = float(raw_word.start)
            end = float(raw_word.end)
            if end <= start:
                continue

            words.append(Word(start=start, end=end, text=text))

    return words


def words_from_whisperx(word_segments: object) -> list[Word]:
    words: list[Word] = []
    for raw_word in word_segments:
        text = clean_text(str(raw_word.get("word", "")))
        start = raw_word.get("start")
        end = raw_word.get("end")
        if not text or start is None or end is None:
            continue

        start_float = float(start)
        end_float = float(end)
        if end_float <= start_float:
            continue

        words.append(Word(start=start_float, end=end_float, text=text))
    return words


def words_from_parakeet(transcript: object) -> list[Word]:
    timestamp = getattr(transcript, "timestamp", None) or {}
    raw_words = timestamp.get("word") or []
    words: list[Word] = []
    for raw_word in raw_words:
        text = clean_text(str(raw_word.get("word") or raw_word.get("text") or ""))
        start = raw_word.get("start")
        end = raw_word.get("end")
        if not text or start is None or end is None:
            continue

        start_float = float(start)
        end_float = float(end)
        if end_float <= start_float:
            continue

        words.append(Word(start=start_float, end=end_float, text=text))
    return words


def cues_from_whisperx_segments(segments: object) -> list[Cue]:
    cues: list[Cue] = []
    for segment in segments:
        text = clean_text(str(segment.get("text", "")))
        start = segment.get("start")
        end = segment.get("end")
        if text and start is not None and end is not None:
            cues.append(Cue(start=float(start), end=float(end), text=text))
    return cues


def cues_from_parakeet_segments(transcript: object) -> list[Cue]:
    timestamp = getattr(transcript, "timestamp", None) or {}
    raw_segments = timestamp.get("segment") or []
    cues: list[Cue] = []
    for segment in raw_segments:
        text = clean_text(str(segment.get("segment") or segment.get("text") or ""))
        start = segment.get("start")
        end = segment.get("end")
        if text and start is not None and end is not None:
            cues.append(Cue(start=float(start), end=float(end), text=text))

    if cues:
        return cues

    text = clean_text(str(getattr(transcript, "text", "")))
    if text:
        return [Cue(start=0.0, end=0.5, text=text)]
    return []


def cues_from_words(
    words: list[Word],
    *,
    max_cue_chars: int,
    max_cue_duration: float,
    max_gap: float,
) -> list[Cue]:
    cues: list[Cue] = []
    current: list[Word] = []

    for word in words:
        if _should_flush_before_word(current, word, max_cue_chars, max_cue_duration, max_gap):
            cues.append(_cue_from_words(current))
            current = []

        current.append(word)

        if _should_flush_after_word(current):
            cues.append(_cue_from_words(current))
            current = []

    if current:
        cues.append(_cue_from_words(current))

    return cues


def render_vtt(cues: list[Cue], *, max_line_width: int, note: str | None = None) -> str:
    lines = ["WEBVTT", ""]
    if note:
        lines.extend([f"NOTE {note}", ""])

    for cue in cues:
        start = format_vtt_timestamp(cue.start)
        end = format_vtt_timestamp(max(cue.end, cue.start + 0.5))
        lines.append(f"{start} --> {end}")
        lines.extend(wrap_subtitle_text(cue.text, max_line_width=max_line_width))
        lines.append("")

    return "\n".join(lines)


def format_vtt_timestamp(seconds: float) -> str:
    milliseconds = max(0, int(round(seconds * 1000)))
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{millis:03d}"


def wrap_subtitle_text(text: str, *, max_line_width: int) -> list[str]:
    return textwrap.wrap(
        text,
        width=max_line_width,
        break_long_words=False,
        break_on_hyphens=False,
    ) or [text]


def clean_text(text: str) -> str:
    return " ".join(text.replace("-->", "->").split())


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="Input video or audio file.")
    parser.add_argument("-o", "--output", type=Path, required=True, help="Output .vtt path.")
    parser.add_argument(
        "--backend",
        choices=["faster-whisper", "whisperx", "parakeet"],
        default=DEFAULT_BACKEND,
        help=f"ASR backend. Default: {DEFAULT_BACKEND}",
    )
    parser.add_argument(
        "--model",
        help="Model alias, Hugging Face repo id, or local model path. Defaults by backend.",
    )
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
    parser.add_argument(
        "--condition-on-previous-text",
        action="store_true",
        help="Enable Whisper's previous-text conditioning. Disabled by default for subtitles.",
    )
    parser.add_argument("--max-line-width", type=int, default=42)
    parser.add_argument("--max-cue-chars", type=int, default=84)
    parser.add_argument("--max-cue-duration", type=float, default=6.0)
    parser.add_argument("--max-gap", type=float, default=0.7)
    return parser


def main() -> None:
    restart_with_system_media_libraries()
    args = build_parser().parse_args()
    cues = transcribe_to_vtt(
        args.input,
        args.output,
        model_name=args.model,
        model_dir=args.model_dir,
        download_dir=args.download_dir,
        device=args.device,
        device_index=args.device_index,
        compute_type=args.compute_type,
        language=args.language,
        task=args.task,
        beam_size=args.beam_size,
        vad_filter=args.vad_filter,
        condition_on_previous_text=args.condition_on_previous_text,
        max_line_width=args.max_line_width,
        max_cue_chars=args.max_cue_chars,
        max_cue_duration=args.max_cue_duration,
        max_gap=args.max_gap,
        backend=args.backend,
        batch_size=args.batch_size,
        vad_method=args.vad_method,
        align_model=args.align_model,
    )
    print(f"Wrote {len(cues)} cues to {args.output}")


def _should_flush_before_word(
    current: list[Word],
    word: Word,
    max_cue_chars: int,
    max_cue_duration: float,
    max_gap: float,
) -> bool:
    if not current:
        return False

    current_text = _words_text(current)
    projected_text = f"{current_text} {word.text}".strip()
    gap = word.start - current[-1].end
    duration = word.end - current[0].start

    return gap > max_gap or duration > max_cue_duration or len(projected_text) > max_cue_chars


def _should_flush_after_word(current: list[Word]) -> bool:
    if not current:
        return False

    text = _words_text(current)
    duration = current[-1].end - current[0].start
    return len(text) >= 28 and duration >= 1.0 and text.endswith((".", "?", "!"))


def _cue_from_words(words: list[Word]) -> Cue:
    return Cue(start=words[0].start, end=words[-1].end, text=_words_text(words))


def _words_text(words: list[Word]) -> str:
    return clean_text(" ".join(word.text for word in words))


def resolve_devices(device: str, device_index: int) -> tuple[str, str]:
    if device == "auto":
        try:
            import torch

            device = "cuda" if torch.cuda.is_available() else "cpu"
        except ImportError:
            device = "cpu"

    if device == "cuda":
        return "cuda", f"cuda:{device_index}"
    return "cpu", "cpu"


def move_directory_contents(source: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    for child in source.iterdir():
        target = destination / child.name
        if target.exists():
            continue
        shutil.move(str(child), str(target))


def select_cache_dir(final_dir: Path, download_dir: Path) -> tuple[Path, bool]:
    final_dir.mkdir(parents=True, exist_ok=True)
    download_dir.mkdir(parents=True, exist_ok=True)
    if any(final_dir.iterdir()):
        return final_dir, True
    return download_dir, False


def format_note(
    *,
    backend: str,
    model: str,
    language: str | None,
    probability: float | None,
) -> str:
    details = [f"Generated with backend={backend}", f"model={model}"]
    if language:
        details.append(f"language={language}")
    if probability is not None:
        details.append(f"probability={probability:.3f}")
    return " ".join(details)


def assert_never(value: object) -> None:
    raise AssertionError(f"Unhandled backend: {value}")


if __name__ == "__main__":
    main()
