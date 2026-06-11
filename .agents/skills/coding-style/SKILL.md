---
name: coding-style
description: Load BEFORE writing, editing, or reviewing source code in any covered technology, to apply this project's NON-NEGOTIABLE coding-style rules. The body routes by technology to a rules file under styles/ (styles/react.md, styles/typescript.md, styles/cpp.md, ...). Read the file matching each technology you touch and follow every rule in it. Repo-agnostic.
---

# Coding style

The rules in this skill are **non-negotiable**. They are not suggestions, defaults, or
"nice to haves." When you write, edit, or review code in a covered technology you MUST
follow the matching rules file exactly, and you MUST NOT introduce a new violation. Code
you didn't touch is out of scope unless you are explicitly cleaning it up.

Precedence, highest first:

1. An explicit instruction from the user in this session.
2. The rules in the matching `styles/<technology>.md` file.
3. Everything else — your own habits, patterns you see elsewhere in the repo, and
   defaults from your training.

If a rule genuinely blocks correct behavior, do **not** silently ignore it: use the
documented escape hatch in that rules file (and only that), with a one-line comment saying
why.

## How to use this skill

1. Identify every technology in the files you are about to touch — the language **and** its
   major framework. A `.tsx` file is **both** TypeScript and React; apply both files.
2. For each, read the matching file in `styles/` **before** you write code, and apply it.
3. If no file matches a technology, this skill does not constrain it — match the
   conventions of the surrounding code instead.

## Rules by technology

| Technology                  | Rules file                                   | Applies to                           |
| --------------------------- | -------------------------------------------- | ------------------------------------ |
| React (19 + React Compiler) | [styles/react.md](styles/react.md)           | `.jsx`, `.tsx`; components and hooks |
| TypeScript                  | [styles/typescript.md](styles/typescript.md) | `.ts`, `.tsx`                        |

Only the technologies listed above are covered today. To cover another (e.g. C++, Python,
CSS), see below.

## Adding a technology

Create `styles/<technology>.md` and add a row to the table above. Keep each file to one
technology, lead with the binding rules as DO / DON'T, state the real exceptions, and end
with an **Enforcement** section naming the linter / formatter / compiler checks that catch
violations — so the rules are machine-checked wherever possible, not left to memory.

Where a linter can enforce the rules, also ship a reusable config fragment next to the doc
(e.g. `styles/react.oxlintrc.json`, `styles/typescript.oxlintrc.json`) so a host project can
adopt the rules with `extends` instead of copying them. Keep fragments unscoped — let the
consuming project decide which files they apply to.
