# TypeScript style

Non-negotiable rules (see [../SKILL.md](../SKILL.md)) for modern TypeScript on a **strict**
config. Each rule is tagged by how it is enforced:

- **[lint]** — a linter catches it (oxlint or `typescript-eslint`)
- **[type]** — the type-checker catches it (`tsc` / `tsgo`)
- **[review]** — human review

## 1. Imports and nullability

These assume `verbatimModuleSyntax` is enabled (recommended): a type-only import is fully
erased, so it must be marked or its runtime side effects are unexpectedly dropped.

- **DO** use `import type` / inline `type` modifiers for type-only imports, and `export type`
  for type-only re-exports. Keep runtime side effects in a separate `import "./x";`. **[lint]**

  ```ts
  import { type ReactNode, useState } from "react";
  import type { Todo } from "./todo";
  ```

- **DON'T** use `any`. Type boundaries as `unknown` and narrow before use. A narrowly-scoped,
  commented cast at a genuine interop seam is the only exception. **[lint]**
- **DON'T** use non-null assertions (`!`). Narrow with a guard or early return, or throw a
  clear error. This matters most under `noUncheckedIndexedAccess`. **[lint]**

## 2. Modeling and assertions

- **DO** default to `type`. Reach for `interface` only when you need declaration merging /
  module augmentation, `extends`/`implements`, or an augmentable public surface — these are
  real cases where `interface` is required or measurably faster than deep `&` intersections.
  When you use `interface` for one of these, opt out of the lint rule with a one-line reason.
  **[lint]**
- **DO** prefer `satisfies` over `as`: it validates the value _and_ keeps the narrow inferred
  type, where `as` only silences the checker. Reserve `as` for audited boundary seams;
  `as const` is encouraged. **DON'T** write `x as unknown as T` outside an isolated, commented
  seam. **[lint]**
- **DON'T** use `enum`, and never `const enum` (it breaks isolated transpilation and
  `verbatimModuleSyntax` rejects exporting one). Use string-literal unions or `as const`
  objects. **[review]**

  ```ts
  const Status = { Idle: "idle", Loading: "loading" } as const;
  type Status = (typeof Status)[keyof typeof Status];
  ```

- **DO** model variant state as a discriminated union with a shared discriminant, and force
  exhaustiveness with an `assertNever` helper (the type-checker errors when a case is missed).
  **[type]**

  ```ts
  type State =
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; data: Todo[] };

  function assertNever(x: never): never {
    throw new Error(`Unhandled: ${JSON.stringify(x)}`);
  }
  ```

## 3. Compiler configuration

- **DO** turn on `strict`. **DON'T** assume it covers everything — it does **not** include
  `noUncheckedIndexedAccess` or `exactOptionalPropertyTypes`. **[type]**
- **DO** add `noUncheckedIndexedAccess` (highest-value extra): index/array access yields
  `T | undefined`, forcing you to narrow. Tuples at known indices are unaffected. Adopt
  `exactOptionalPropertyTypes` deliberately — it can clash with library `field?: T | undefined`
  typings.
- **DO** keep `verbatimModuleSyntax` + `moduleResolution: "bundler"` + `noEmit` when a bundler
  owns emit (the type-checker only checks).
- **DO** type props with a plain function component and an explicit props type; type `children`
  as `React.ReactNode`. `React.FC` is acceptable style (not an anti-pattern since TS 5.1), but
  avoid it for generic components.

## 4. Enforcement

The canonical, reusable oxlint rules for this file live in
[typescript.oxlintrc.json](typescript.oxlintrc.json). Consume them from a project's
`.oxlintrc.json` with `extends` (under `typescript-eslint`, the equivalents are in the
`strict` and `stylistic` configs):

```jsonc
{
  "extends": ["<path-to-skill>/styles/typescript.oxlintrc.json"],
  "plugins": ["typescript"]
}
```

That fragment enforces: `consistent-type-imports` + `no-import-type-side-effects` (§1),
`no-explicit-any` and `no-non-null-assertion` (§1), `consistent-type-definitions` (§2,
`interface` needs an inline opt-out), `consistent-type-assertions` + `prefer-as-const` (§2),
and `array-type`.

Not enforced by oxlint: exhaustiveness (`switch-exhaustiveness-check`) and other type-aware
rules need oxlint's `--type-aware` mode; until then the `assertNever` helper (§2) plus the
type-checker is the portable mechanism. Compiler flags (§3) live in `tsconfig.json`, checked
by `tsc` / `tsgo`.
