# Agent Guide

Date: 2026-06-11
Status: Current
Area: repository workflow, agent skills, jj workspaces

## Summary

This repo uses Jujutsu (`jj`) plus per-agent workspace guardrails. Work from the
assigned isolated workspace, keep `.agents/skills` as the source of truth for
skills, and link new documentation from [docs/README.md](docs/README.md).

## Workflow

- Load `.agents/skills/vcs/SKILL.md` before editing, committing, integrating, or
  cleaning up workspaces/bookmarks. Use the helper scripts; do not push unless the
  user explicitly asks.
- Load `.agents/skills/updating-docs/SKILL.md` before writing docs. Search first,
  update existing docs when possible, and keep new docs discoverable from an index.
- Export requested session transcripts with
  `.agents/skills/export-coding-session/SKILL.md` into `docs/coding-sessions/`.
- Treat `.claude/skills` as a symlink to `.agents/skills`; edit only the
  `.agents/skills` source tree.
- For docs-only changes, verify by reading the rendered links, running the
  transcript redaction scan when applicable, and checking `jj status`.
