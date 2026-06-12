# Open-source ASR Models for WebVTT Subtitles

Date: 2026-06-10
Status: Current research snapshot
Area: ASR, subtitles, WebVTT, local inference
Sources: OpenAI Whisper, faster-whisper, WhisperX, whisper.cpp, NVIDIA NeMo/Parakeet, IBM Granite Speech, Hugging Face Open ASR Leaderboard, local model-cache inspection, `src/asr`

## Summary

For converting a video or audio file into timestamped `.vtt` subtitles, the most practical free local path is still a Whisper-family pipeline: use `faster-whisper` or `whisper.cpp` for fast transcription, and use `WhisperX` when accurate word-level timestamps or speaker diarization matter. OpenAI Whisper itself can directly emit `.vtt` via `--output_format vtt`, but its native subtitle timing is segment-level unless word timestamp options are enabled, and WhisperX exists because raw Whisper timings can drift on long-form audio.

This repo now includes a CUDA implementation under `src/asr`: `uv run asr-vtt --backend whisperx` is the default high-quality subtitle path, while `--backend faster-whisper` and `--backend parakeet` select the direct CTranslate2 Whisper and NVIDIA Parakeet TDT 0.6B v3 paths. Model downloads stage under `/tmp/asr-model-downloads`, completed snapshots move under `/mnt/nas/home/ml/model/`, and every backend writes WebVTT subtitles plus a sibling timestamp-free `.txt` transcript.

For state-of-the-art open ASR accuracy, benchmark newer speech-specific models too: `ibm-granite/granite-speech-4.1-2b-plus` supports speaker-attributed ASR and word-level timestamps, and NVIDIA `parakeet-tdt-0.6b-v3` supports 25 European languages with accurate word-level and segment-level timestamps. These models are stronger ASR candidates than general LLMs/VLMs, but their WebVTT export path is less plug-and-play than Whisper tooling.

The existing downloaded local models visible in the user's NAS LLM cache are not ASR models. Their `model_type` values include `gemma4`, `nemotron_h`, `qwen3_5_moe`, `llava`, `vit`, and evaluation classifiers; none matched Whisper, Parakeet, Canary, Granite Speech, Vosk, wav2vec, HuBERT, NeMo ASR, Moonshine, SenseVoice, FunASR, or related ASR families. Those LLM/VLM models may help clean or summarize a finished transcript, but they should not be used to create reliable audio timestamps.

## Recommendation

Use this decision order:

1. Best practical subtitle pipeline today: `uv run asr-vtt --backend whisperx --model large-v3`, which runs WhisperX with the CTranslate2 `large-v3` Whisper model and wav2vec2 alignment.
2. Best lightweight direct `.vtt` CLI: `whisper.cpp` with `--output-vtt`, especially for CPU, Apple Silicon, or simple offline jobs.
3. Best Python library base: `faster-whisper` with `word_timestamps=True`, then write WebVTT cues from `segment.start`, `segment.end`, or `segment.words`.
4. Best accuracy experiments beyond Whisper: NVIDIA Parakeet TDT 0.6B v3 and IBM Granite Speech 4.1 2B Plus. Convert their word/segment timestamps to WebVTT in a small post-processing script.
5. Legacy/small-device fallback: Vosk, because it is offline, Apache-2.0, and subtitle-oriented, but it is not the SOTA choice for transcription quality.

## Candidate Models and Tooling

| Option | License | Timestamp support | VTT/subtitle path | Best use |
| --- | --- | --- | --- | --- |
| OpenAI Whisper (`openai/whisper`) | MIT for code and model weights | Segment timestamps; experimental word timestamps via `--word_timestamps` | Direct `--output_format vtt` CLI | Simple, robust multilingual baseline |
| `faster-whisper` | MIT | `word_timestamps=True`; Silero VAD filter | Emit VTT from returned Python segments/words | Fast Python batch transcription |
| WhisperX | BSD-2-Clause | Accurate word timestamps via wav2vec2 alignment; optional diarization | CLI/Python output with aligned segments; convert JSON/SRT to VTT as needed | Best practical alignment and speaker workflow |
| `whisper.cpp` | MIT | Segment timestamps; word/karaoke modes exist | Direct `--output-vtt` / `--output-srt` CLI | Local CPU, Apple Silicon, simple CLI usage |
| NVIDIA Parakeet TDT 0.6B v3 | CC-BY-4.0 weights, NeMo tooling | Word-level and segment-level timestamps | Use NeMo `timestamps=True`, then write VTT | Fast multilingual ASR for supported European languages |
| IBM Granite Speech 4.1 2B Plus | Apache-2.0 | Speaker-attributed ASR and word-level timestamps; evaluated for timestamps up to 5 minutes | Use Transformers/Granite output and write VTT | Accuracy-first evaluation with timestamps |
| Vosk | Apache-2.0 | Word timings in JSON results | Existing subtitle-oriented ecosystem | Offline small-device fallback |
| `whisper-timestamped` | AGPL-3.0 | Word timestamps and confidence | CLI can produce SRT/VTT/TSV plus word-timestamp files | Useful if AGPL is acceptable |

## Source Notes

The Hugging Face Open ASR Leaderboard paper frames the current SOTA landscape: it compares open-source and proprietary systems across English, multilingual, and long-form tasks, reporting both WER and RTFx. The paper observes that Conformer-style encoders with transformer decoders often win on WER, while CTC and TDT decoders tend to win throughput, which matters for long-form video transcription. Source: <https://arxiv.org/html/2510.06961v4>

OpenAI Whisper remains the easiest baseline. The upstream CLI accepts `--output_format` values including `vtt`, and `transcribe.py` documents `word_timestamps` as an option that extracts word-level timestamps using cross-attention and dynamic time warping. The README states Whisper code and model weights are MIT licensed. Sources: <https://github.com/openai/whisper/blob/main/whisper/transcribe.py>, <https://github.com/openai/whisper/blob/main/README.md>

`faster-whisper` is a CTranslate2 reimplementation of Whisper. Its README reports up to 4x faster inference than OpenAI Whisper with lower memory use, shows `word_timestamps=True`, and includes a Silero VAD option. Source: <https://github.com/SYSTRAN/faster-whisper>

WhisperX is the strongest practical subtitle-alignment tool in the Whisper ecosystem. Its README describes fast ASR, accurate word-level timestamps using wav2vec2 alignment, optional pyannote diarization, VAD preprocessing, and v3 sentence-style transcript segmentation intended to improve subtitling. Source: <https://github.com/m-bain/whisperX>

`whisper.cpp` is the strongest simple local CLI choice when direct WebVTT output matters. The CLI includes `--output-vtt`, `--output-srt`, JSON, CSV, and word/karaoke output flags. Source: <https://github.com/ggml-org/whisper.cpp/blob/master/examples/cli/cli.cpp>

NVIDIA Parakeet TDT 0.6B v3 is an important open-weight timestamp model. The model card lists 25 supported European languages and calls out accurate word-level and segment-level timestamps, long audio transcription, and CC-BY-4.0 licensing. NeMo documentation shows `asr_model.transcribe(..., timestamps=True)` and exposes `timestamp['word']`, `timestamp['segment']`, and `timestamp['char']`. Sources: <https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3>, <https://docs.nvidia.com/nemo-framework/user-guide/latest/nemotoolkit/asr/intro.html>

IBM Granite Speech 4.1 2B and 2B Plus are accuracy-first candidates. IBM's docs describe the 4.1 family as compact multilingual ASR/AST models; the Plus variant adds speaker-attributed ASR, timestamps, and keyword-prompted ASR. The Plus model card reports Open ASR Leaderboard WER values and states it works for timestamp tasks up to 5-minute audio segments. Sources: <https://www.ibm.com/granite/docs/models/speech>, <https://huggingface.co/ibm-granite/granite-speech-4.1-2b-plus>

Canary-Qwen 2.5B is a strong English ASR model by leaderboard WER, but it is not the first choice for WebVTT subtitles because the model card emphasizes transcription and transcript post-processing, not native subtitle timestamp output. Source: <https://huggingface.co/nvidia/canary-qwen-2.5b>

Vosk is worth knowing for offline low-resource deployments. It is Apache-2.0, supports many languages, provides small models, and explicitly targets subtitles for movies, lectures, and interviews, but it is not the current SOTA quality option. Sources: <https://github.com/alphacep/vosk-api>, <https://alphacephei.com/vosk/models>

## Implementation Shape for WebVTT

Every viable path should follow the same workflow:

1. Extract mono 16 kHz audio from the input media with `ffmpeg`.
2. Run ASR with segment or word timestamps.
3. Group words into readable subtitle cues using line-length, duration, pause, and sentence-boundary limits.
4. Emit WebVTT:

```text
WEBVTT

00:00:01.200 --> 00:00:04.800
The subtitle text for this cue.
```

WhisperX and Parakeet/NeMo give enough word-level data to build polished subtitle cue grouping. `whisper.cpp` and OpenAI Whisper are better when direct `.vtt` output is more important than custom cue optimization.

## Repo Implementation

The runnable implementation lives in `src/asr` and is installed by the repo-level `pyproject.toml`. The user-facing command is one CLI with three selectable backends:

- `uv run asr-vtt --backend whisperx` is the default and strongest subtitle-alignment path. It uses `faster-whisper-large-v3` for ASR, WhisperX wav2vec2 alignment for word timings, and Silero VAD by default to avoid gated pyannote model requirements.
- `uv run asr-vtt --backend faster-whisper` runs direct `faster-whisper` transcription with `word_timestamps=True`; it is simpler and faster but has less precise cue alignment than WhisperX.
- `uv run asr-vtt --backend parakeet` runs NVIDIA `nvidia/parakeet-tdt-0.6b-v3` through NeMo from the cached `.nemo` checkpoint and uses Parakeet word/segment timestamps.
- `src/asr/model_cache.py` resolves aliases such as `large-v3`, `small.en`, and `parakeet`, downloads the Hugging Face snapshot into `/tmp/asr-model-downloads`, then moves the completed model to `/mnt/nas/home/ml/model/huggingface/<org>/<repo>`. If the target model already has `config.json` plus model weights or a `.nemo` file, it is reused without rewriting the NAS copy.
- `src/asr/media.py` normalizes the first audio stream from video containers or audio-only files as mono 16 kHz PCM WAV through `ffmpeg` for every backend.
- `src/asr/transcribe_vtt.py` selects the backend, groups words by cue length, duration, punctuation, and pauses, then writes a `.vtt` file and a sibling timestamp-free `.txt` transcript.
- `src/asr/cuda_env.py` exposes the `uv`-installed `nvidia-cublas-cu12` and `nvidia-cudnn-cu12` shared libraries before importing CTranslate2, so CUDA inference does not depend on the workstation's system CUDA library layout.
- `src/asr/runtime_env.py` restarts `asr-vtt` once with `/lib/x86_64-linux-gnu:/usr/lib/x86_64-linux-gnu` at the front of `LD_LIBRARY_PATH`, so Python libraries that load FFmpeg prefer Ubuntu's FFmpeg libraries over stale `/usr/local/lib` copies.

Install and inspect the CLI with:

```sh
uv run asr-vtt --help
```

Download models explicitly, staging network writes under `/tmp` before moving completed snapshots to the NAS model volume:

```sh
uv run asr-download-model large-v3 \
  --download-dir /tmp/asr-model-downloads \
  --model-dir /mnt/nas/home/ml/model

uv run asr-download-model parakeet \
  --download-dir /tmp/asr-model-downloads \
  --model-dir /mnt/nas/home/ml/model
```

Generate WebVTT subtitles for the example snow tubing video with the highest-quality default path:

```sh
uv run asr-vtt /mnt/nas/home/media/videos/20220122_snow_tubing/GX010150.MP4 \
  --output /tmp/GX010150.whisperx.large-v3.vtt \
  --backend whisperx \
  --model large-v3 \
  --language en \
  --device cuda \
  --device-index 0 \
  --compute-type float16 \
  --batch-size 32
```

Use direct `faster-whisper` when you want a simpler baseline:

```sh
uv run asr-vtt /mnt/nas/home/media/videos/20220122_snow_tubing/GX010150.MP4 \
  --output /tmp/GX010150.faster-whisper.large-v3.vtt \
  --backend faster-whisper \
  --model large-v3 \
  --language en \
  --device cuda \
  --device-index 0 \
  --compute-type float16
```

Use Parakeet TDT 0.6B v3 when you want NVIDIA's multilingual high-throughput ASR model:

```sh
uv run asr-vtt /mnt/nas/home/media/videos/20220122_snow_tubing/GX010150.MP4 \
  --output /tmp/GX010150.parakeet.vtt \
  --backend parakeet \
  --device cuda \
  --device-index 0
```

## Local Validation

Validated on June 11, 2026 on the Ubuntu workstation with two NVIDIA RTX Pro 6000 Blackwell GPUs visible to `nvidia-smi`. The smoke test used the sample video `/mnt/nas/home/media/videos/20220122_snow_tubing/GX010150.MP4` and verified all three backend selections:

```sh
uv run asr-download-model large-v3 \
  --download-dir /tmp/asr-model-downloads \
  --model-dir /mnt/nas/home/ml/model

uv run asr-download-model parakeet \
  --download-dir /tmp/asr-model-downloads \
  --model-dir /mnt/nas/home/ml/model

uv run asr-vtt /mnt/nas/home/media/videos/20220122_snow_tubing/GX010150.MP4 \
  --output /tmp/GX010150.faster-whisper.large-v3.vtt \
  --backend faster-whisper \
  --model large-v3 \
  --language en \
  --device cuda \
  --device-index 0 \
  --compute-type float16

uv run asr-vtt /mnt/nas/home/media/videos/20220122_snow_tubing/GX010150.MP4 \
  --output /tmp/GX010150.whisperx.large-v3.vtt \
  --backend whisperx \
  --model large-v3 \
  --language en \
  --device cuda \
  --device-index 0 \
  --compute-type float16 \
  --batch-size 32

uv run asr-vtt /mnt/nas/home/media/videos/20220122_snow_tubing/GX010150.MP4 \
  --output /tmp/GX010150.parakeet.vtt \
  --backend parakeet \
  --device cuda \
  --device-index 0
```

The high-quality Whisper model landed at `/mnt/nas/home/ml/model/huggingface/Systran/faster-whisper-large-v3` after staging under `/tmp/asr-model-downloads`. Parakeet landed at `/mnt/nas/home/ml/model/huggingface/nvidia/parakeet-tdt-0.6b-v3/parakeet-tdt-0.6b-v3.nemo`. WhisperX also cached Silero VAD under `/mnt/nas/home/ml/model/torch/hub` and the English wav2vec2 aligner under `/mnt/nas/home/ml/model/torch/whisperx-align`. Re-running `asr-download-model large-v3` and `asr-download-model parakeet` returned NAS paths immediately without download progress, confirming cache reuse.

The end-to-end CUDA transcription completed successfully for all three backends: `faster-whisper` wrote `10` cues to `/tmp/GX010150.faster-whisper.large-v3.vtt`, `whisperx` wrote `17` aligned cues to `/tmp/GX010150.whisperx.large-v3.vtt`, and `parakeet` wrote `14` cues to `/tmp/GX010150.parakeet.vtt`.

The workstation's original `ffmpeg` failure was caused by stale FFmpeg libraries in `/usr/local/lib` shadowing Ubuntu's package libraries; those stale libraries required `libnppig.so.11`, `libnppicc.so.11`, `libnppidei.so.11`, `libnppif.so.11`, and `libx264.so.163`. Because passwordless sudo is not available, the active fix is user-level wrappers at `/home/ssun/.local/bin/ffmpeg` and `/home/ssun/.local/bin/ffprobe`, which execute `/usr/bin/ffmpeg` and `/usr/bin/ffprobe` through the dynamic loader with `/lib/x86_64-linux-gnu:/usr/lib/x86_64-linux-gnu` first. `ffmpeg -version`, `ffprobe`, and 16 kHz mono WAV extraction now work from the normal PATH.
