# Five-Minute Outline for Open and Closed Loops

Date: 2026-06-12
Status: Current
Area: presentation outline, LLMOS, talking-head video
Sources: `brain_dump_20260611_distilled.txt`, `brain_dump_20260611.vtt`, `src/asr/speech_speed.py`

## Summary

This is the five-minute talking-head outline for "Open and Closed Loops: The
Economics of the LLMOS." It condenses the June 11, 2026 brain dump into an
approximately 800-word delivery plan. `src/asr/speech_speed.py` measured the
source WebVTT at 150.5 wpm with the balanced pause profile, 166.7 wpm with the
strict pause profile, and 141.6 wpm with the lenient pause profile; because the
delivery will be more prepared, this outline budgets around 160 wpm for five
minutes.

## 0:00-0:30 - Hook and Thesis

Open with: "The mistake is treating LLMs like a faster library or autocomplete.
The better frame is an operating-system layer for work."

Key concept: LLMOS means persistent context, agents, skills, retrieval, and
iteration.

Core thesis: humans are not removed. Humans become extension points for
judgment, taste, priority, and domain expertise.

## 0:30-1:20 - Open Loops vs Closed Loops

Define the frame simply.

A closed loop is a system that can diagnose, retry, repair, or improve without
constant human intervention.

An open loop is where the human must step in.

Important economic point: open loops are expensive. The question is not "Can I
do this better than the model?" The question is: "Is this the highest-leverage
place for my judgment?"

Use the comparative-advantage line: even if the human has absolute advantage,
the model may still be the better executor because it is cheap, parallel, and
iterative.

## 1:20-2:00 - T-Shaped People and Companies

People, teams, and companies are T-shaped.

LLMs widen the horizontal stroke: general knowledge, drafting, coding, search,
report generation, and orchestration.

That makes the vertical stroke more important: taste, strategy, domain
intuition, and hard-won context.

Key line: open the loop at your vertical; close the loop everywhere else.

## 2:00-2:45 - Context Is the Real Asset

Shift from outputs to recorded journeys.

The reason to route work through an LLM layer is not just that the model writes
faster. It is that the system captures how a decision was made: what context
mattered, what tradeoffs were considered, and what preferences shaped the
result.

Key example: corporate reporting.

Old workflow: someone manually writes a static report for one audience.

LLMOS workflow: the system has the context already, drafts the report for the
specific audience, asks the relevant owner for approval, then sends it.

Key line: reporting becomes an approval workflow, not a production workflow.

## 2:45-4:20 - Key Examples

Use these as quick proof points, not full project tours.

Key example: this presentation. This talk came from a raw brain dump,
transcribed into WebVTT with Whisper/WhisperX, distilled into repo context, then
used to generate the actual presentation structure. Because the transcript has
timestamps, the website presentation can sync visual states to the talking-head
video. The point is that the work captured its own context, and the next agent
can build on it.

Key example: `coding-agent-skills`. Exported coding sessions become durable
memory. Skills are reusable procedures. A future agent does not start from zero;
it reads prior decisions, failures, benchmarks, and preferences. The point is
that this is how closed loops improve over time.

Key example: website and Sapiens art pipeline. The personal website uses Sapiens
to segment a stylized character, find the shirt and arm geometry, and generate
assets like the arm cutout so live text tucks under the arm. The point is that
models are not just chatbots; they become production workflow components.

Key example: AlphaZero and Power Monitor. AlphaZero has self-play, training,
evaluation, telemetry, and dashboards. Power Monitor tracks wall power, GPU
power, and ML training views. The point is that once complex systems expose
state, agents can reason over them, monitor them, and help operate them.

## 4:20-5:00 - Parallel Agents and Close

Bring in the math quickly.

If one agent has probability `p` of succeeding, `n` independent attempts give:

```text
1 - (1 - p)^n
```

At `p = 30%` and `n = 10`, the chance at least one succeeds is about 97.2%.

Caveat out loud: independence is imperfect, but the lesson holds. Cheap
parallelism changes the economics.

Final line: do not bolt LLMs onto the old workflow. Build the workflow so
context is captured, closed loops can improve themselves, and humans open the
loop only where their judgment has real comparative advantage.
