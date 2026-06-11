# React style

Non-negotiable rules (see [../SKILL.md](../SKILL.md)) for **React 19 with the React Compiler
enabled**. Each rule is tagged by how it is enforced:

- **[lint]** — a linter catches it (oxlint or `eslint-plugin-react-hooks` / `eslint-plugin-react`)
- **[type]** — the type-checker catches it
- **[build]** — the React Compiler handles or requires it
- **[review]** — human review; no tool in a typical stack catches it

## 1. Memoization — trust the React Compiler

The React Compiler auto-memoizes components and values at build time. It can even memoize
_conditionally_ and _after early returns_ — cases manual hooks structurally cannot express.

- **DON'T** reach for `useMemo`, `useCallback`, or `memo` as your default performance tool.
  Write plain values and components and let the compiler do it. **[lint]** **[build]**

  ```tsx
  // Good — the compiler memoizes this:
  const visible = getFilteredTodos(todos, filter);

  // Banned — redundant manual memoization:
  const visible = useMemo(() => getFilteredTodos(todos, filter), [todos, filter]);
  ```

- **DO** keep manual memoization _only_ for these measured exceptions, each opted out with a
  one-line reason (see [§6](#6-enforcement)):
  1. A value/function used as a `useEffect` dependency that must stay referentially stable so
     the effect does not re-fire. (Named explicitly on react.dev.)
  2. A value/callback handed to a **non-React / third-party** library that compares by
     reference for its own subscriptions (drag-and-drop, imperative charts/maps/grids, some
     form libraries). The compiler optimizes React render output; it cannot see an external
     library re-registering on identity change.
  3. A computation you have **profiled** and confirmed is expensive — the compiler's cost
     heuristics may treat it as cheap.

  `memo` is likewise legitimate only at a boundary whose child is a **non-compiled /
  third-party** component.

- **DON'T** bulk-delete existing manual memoization to "modernize." Removing it can change
  compiler output and, rarely, surface a latent purity bug. Remove per-item with tests, or
  leave it. Pin the compiler to an exact version.

## 2. Rules of React and Hooks

The compiler _assumes_ your code follows these; violating them causes silent bailouts
(unoptimized output) or, rarely, wrong memoized output.

- **DO** keep components and Hooks pure: same inputs produce the same JSX; no side effects or
  mutation of props, state, or context during render. Mutating an object/array you created
  _during this render_ is fine (local mutation). **[review]**
- **DO** call Hooks only at the top level of a component or custom Hook, before any early
  return, and only from React functions — never in loops, conditions, nested functions, or
  plain JS. Never call a component as a function or pass a Hook around as a value. **[lint]**
- **EXCEPTION:** `use()` _may_ be called conditionally and after early returns — it is not
  bound by the Hook-placement rule.
- **DO** run `<StrictMode>` in development; its double-invoke surfaces impurity.

## 3. React 19 component APIs

- **DO** accept `ref` as a regular prop; drop `forwardRef` in new components. **[lint]**

  ```tsx
  function TextInput({ ref, ...props }: { ref?: React.Ref<HTMLInputElement> }) {
    return <input ref={ref} {...props} />;
  }
  ```

- **DO** render `<Context value={...}>` directly — not `<Context.Provider>` (slated for
  deprecation). Read context with `use()` when you need it conditionally; `useContext`
  otherwise. **[review]**
- **DO** render `<title>`, `<meta>`, and `<link>` inline in components — React 19 hoists them
  to `<head>` across SSR and streaming. Drop `react-helmet`; prefer your framework's metadata
  API where one exists. **[review]**

## 4. Effects and data

Most code does not belong in `useEffect`. Litmus test: code that must run _because the
component was displayed_ → Effect; everything else → render or an event handler.

- **DON'T** mirror props/state into `useState` + `useEffect`; derive during render. **[review]**

  ```tsx
  const fullName = `${first} ${last}`; // not useState + useEffect
  ```

- **DON'T** fetch data in `useEffect` (no SSR, waterfalls, no cache, race conditions). **DO**
  load data with your framework's route loader or a caching data library (TanStack Query,
  SWR), and read it from there. **[review]**
- **DO** reset subtree state with a `key`, not an effect. Put event-specific work (POST on
  submit, toasts) in the handler.
- **DO** handle mutations and forms with **Actions**: `useActionState` (+ `useFormStatus`
  inside the form, `useOptimistic` for optimistic UI). An async function in `startTransition`
  gives pending state, optimistic-revert, and error-boundary handling for free — don't
  hand-roll `isPending`/`error` state.
- **DO** read async resources with `use()` under `<Suspense>` + an error boundary, but the
  promise must come from a loader / framework cache, **not** be created during render.
- Reserve `useEffect` for genuine side effects: subscriptions (prefer `useSyncExternalStore`),
  non-React widgets, browser APIs, analytics-on-display.

## 5. Components and keys

- **DO** write function components only. **DON'T** define a component inside another's render —
  it gets a new identity each render, so React remounts it and loses its state. Hoist it to
  module scope. Render-prop callbacks (names starting with `render`) are the allowed
  exception. **[lint]**
- **DO** give list items a stable identity key (`item.id`), not the array index, whenever the
  list can reorder, insert, or delete. Index keys are acceptable only for a static list that
  never changes order or length. **[lint]** for missing keys; index-key misuse is **[review]**.

## 6. Enforcement

The canonical, reusable oxlint rules for this file live in
[react.oxlintrc.json](react.oxlintrc.json). Consume them from a project's `.oxlintrc.json`
with `extends`:

```jsonc
{
  "extends": ["<path-to-skill>/styles/react.oxlintrc.json"],
  "plugins": ["react"]
}
```

That fragment enforces (oxlint rule names; under ESLint these live in
`eslint-plugin-react-hooks` and `eslint-plugin-react`):

- `react/rules-of-hooks`, `react/exhaustive-deps` — Rules of Hooks and effect deps.
- `react/no-unstable-nested-components` — no component defined inside render.
- `react/jsx-key`, `react/no-array-index-key` — list keys.
- `react/no-children-prop`, `react/no-direct-mutation-state`, `react/no-this-in-sfc`,
  `react/no-unknown-property`, `react/void-dom-elements-no-children`,
  `react/no-danger-with-children`, `react/jsx-no-target-blank`,
  `react/jsx-no-duplicate-props` — correctness/safety the compiler does not fix.
- **Memoization ban** — core `no-restricted-imports`, banning `useMemo`, `useCallback`,
  `memo`, and `forwardRef` from `react` (the rule message points back to §1).

Deliberately **not** linted:

- Inline object/array/function props and constructed context values — no `react-perf` rules.
  That is exactly what the compiler memoizes; flagging it would contradict [§1](#1-memoization--trust-the-react-compiler).
- The compiler reports nothing as a build _failure_; it silently bails out on rule
  violations. No common lint rule checks compiler safety (purity, set-state-in-render). Treat
  that as [§2](#2-rules-of-react-and-hooks) covered by review, or add ESLint's
  `eslint-plugin-react-hooks` (`recommended-latest`) if you want it enforced.

### Opting out of the memoization ban

For a genuine [§1](#1-memoization--trust-the-react-compiler) exception, opt out on the import
line with a reason:

```tsx
// eslint-disable-next-line no-restricted-imports -- stable callback for a non-React DnD lib
import { useCallback } from "react";
```

To debug a suspected compiler issue, opt a single function _out of compilation_ with the
`"use no memo"` directive — temporarily, with a tracking comment, never as configuration.
