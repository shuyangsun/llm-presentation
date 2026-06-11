# Open-source ASR Models for WebVTT Subtitles

Date: 2026-06-10
Status: Current research snapshot
Area: ASR, subtitles, WebVTT, local inference
Sources: OpenAI Whisper, faster-whisper, WhisperX, whisper.cpp, NVIDIA NeMo/Parakeet, IBM Granite Speech, Hugging Face Open ASR Leaderboard, local model-cache inspection

## Summary

For converting a video file into timestamped `.vtt` subtitles, the most practical free local path is still a Whisper-family pipeline: use `faster-whisper` or `whisper.cpp` for fast transcription, and use `WhisperX` when accurate word-level timestamps or speaker diarization matter. OpenAI Whisper itself can directly emit `.vtt` via `--output_format vtt`, but its native subtitle timing is segment-level unless word timestamp options are enabled, and WhisperX exists because raw Whisper timings can drift on long-form audio.

For state-of-the-art open ASR accuracy, benchmark newer speech-specific models too: `ibm-granite/granite-speech-4.1-2b-plus` supports speaker-attributed ASR and word-level timestamps, and NVIDIA `parakeet-tdt-0.6b-v3` supports 25 European languages with accurate word-level and segment-level timestamps. These models are stronger ASR candidates than general LLMs/VLMs, but their WebVTT export path is less plug-and-play than Whisper tooling.

The existing downloaded local models visible in the user's NAS LLM cache are not ASR models. Their `model_type` values include `gemma4`, `nemotron_h`, `qwen3_5_moe`, `llava`, `vit`, and evaluation classifiers; none matched Whisper, Parakeet, Canary, Granite Speech, Vosk, wav2vec, HuBERT, NeMo ASR, Moonshine, SenseVoice, FunASR, or related ASR families. Those LLM/VLM models may help clean or summarize a finished transcript, but they should not be used to create reliable audio timestamps.

## Recommendation

Use this decision order:

1. Best practical subtitle pipeline today: `WhisperX` with a large Whisper model when you need word-level alignment, speaker labels, or subtitle chunks that track speech closely.
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

1. Extract mono 16 kHz audio from the video with `ffmpeg`.
2. Run ASR with segment or word timestamps.
3. Group words into readable subtitle cues using line-length, duration, pause, and sentence-boundary limits.
4. Emit WebVTT:

```text
WEBVTT

00:00:01.200 --> 00:00:04.800
The subtitle text for this cue.
```

WhisperX and Parakeet/NeMo give enough word-level data to build polished subtitle cue grouping. `whisper.cpp` and OpenAI Whisper are better when direct `.vtt` output is more important than custom cue optimization.
