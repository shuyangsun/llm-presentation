# Agent Guide

Date: 2026-06-12
Status: Current
Area: repository workflow, agent skills, jj workspaces

## Summary

Work from the assigned isolated workspace. This repo uses Jujutsu (`jj`),
repo-local skills, and durable documentation as project memory.

## Required References

- Project context: [README.md](README.md) and [docs/README.md](docs/README.md).
- Presentation source material:
  [brain dump](docs/archive/20260611/brain_dump_20260611_distilled.txt) and
  [five-minute outline](docs/archive/20260611/llmos_5_minute_outline.md).
- VCS workflow: load `.agents/skills/vcs/SKILL.md` before edits, commits,
  integration, cleanup, or publishing. Use the helper scripts; do not publish
  unless the user explicitly asks.
- Documentation workflow: load `.agents/skills/updating-docs/SKILL.md` before
  writing docs. Search first and keep docs linked from an index.
- Session exports: use `.agents/skills/export-transcript/SKILL.md` only when
  requested; write transcripts under `docs/transcripts/`.
- Skills source of truth: edit `.agents/skills`, not `.claude/skills`.
- Docs-only verification: check linked files and `jj status`.
