# @eslint/jsinspect

A web app for inspecting how `@eslint/jskit` sees a program. Type or paste
JavaScript or TypeScript on the left; the right shows, in three tabs, what
each of its analyses produced:

- **AST** — the ESTree tree from `toAST()`, along with any problems
  `validate()` reported for the chosen source type, dialect, and JSX setting.
- **Scopes** — `toScopeTree()`'s view of the scope buffer `analyze()`
  returned.
- **Control flow** — `toGraphTree()`'s view of the flow buffer
  `createGraph()` returned.

Everything runs client-side: the page ships the toolkit's browser bundle and
reruns all three analyses as you type. Parsing always accepts the
union of everything JavaScript and TypeScript allow; the source type, dialect,
and JSX controls in the header change interpretation (validation problems,
scope details), not what parses.

It is an [Astro](https://astro.build) app with a single React island, styled
with Tailwind CSS and shadcn/ui-style components, with CodeMirror 6 as the
editor.

## Commands

Run from this directory or with `--workspace=@eslint/jsinspect` from the
repository root. `dev` and `build` build `@eslint/jskit` first, because the
app imports its `dist/` bundle.

```bash
npm run dev       # start the dev server on http://localhost:3000
npm run build     # build the static site into dist/
npm run preview   # serve the built site on http://localhost:3000
```
