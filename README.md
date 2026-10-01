# Freeform

Freeform is an open-source, browser-based drill-design project for marching bands and drum corps. It is intended to remove licensing cost as a barrier for solo drill writers working with school and community programs, drawing inspiration from Pyware and the Ultimate Drill Book without copying their proprietary code, assets, or formats. See `IDEA.md` for the original project brief.

## Status

This repository contains the product specification, the file-format schema and fixtures, documentation-test tooling, and implemented application milestones M1 through M6 plus M9: an app shell and immutable document command store; canonical NFHS geometry and a DOM dot editor with coordinate inspection; set and float-transition playback tools; FTL path/order authoring with derived-end validation; deterministic advisory collision analysis per transition with auditable overrides in the in-memory document model; freehand, structured-label, arrow, reusable-symbol, and performer-note annotations on reorderable layers, each scoped to one set, one transition, or the whole show and rendered correctly for whichever editor context is active; and a first-run setup wizard paired with a post-wizard roster editor. The setup wizard collects the drill file name and a section roster (with rank-code prefix suggestions per instrument/equipment) and generates the first laid-out set from a sequence of performer-creation commands. The roster editor then lets the writer add a late arrival to an existing numeric rank-code prefix, remove a departed performer (with an FTL-impact disclosure when the removal would block an existing follow-the-leader transition), and assign display names to the whole roster as one atomic command. The collision disclosure samples each transition deterministically, reports warnings rather than prevention, keeps overridden warnings visible, and records a local actor, timestamp, reason, pair, and motion/threshold signature in that in-memory model. It does not yet contain persistence (save/open, autosave, version history, backup/recovery), PDF export, accessibility hardening, cross-browser hardening, or performance validation. Anyone starting implementation work should read `docs/freeform-mvp-spec-v1.md`, the implementation-ready MVP specification, and the decision records in `decisions/`, which capture the accepted product and technical choices behind it.

## What the MVP specifies

Per `docs/freeform-mvp-spec-v1.md`, the MVP is a static, local-first browser application for a solo drill writer, covering:

- One NFHS 11-player football field, with performers placed as dots carrying stable rank codes.
- Ordered sets ("pages") connected by count-based transitions, either float (straight-line, constant-speed) or FTL (follow-the-leader along a shared path).
- Per-count timeline playback and scrubbing, including arbitrary contiguous set ranges.
- Advisory step-size status and collision warnings, with documented overrides.
- Line and circular-arc formation-arrangement tools, plus direct manual dot placement for curvilinear/free shapes.
- Freehand, structured, and symbol-based annotations scoped to a set, a transition, or the whole show.
- Director-perspective and individual performer-packet PDF export (US Letter).
- Undo/redo, keyboard access, accessibility (WCAG 2.2 AA), autosave, version history, and backup/recovery, all running offline after initial load.

Deferred, not partially supported: native iOS/Android performer apps, custom/basketball surfaces, music synchronization, accounts/collaboration/cloud sync, automatic PDF note placement, NCAA/NFL field presets, and any Pyware/UDB import, export, or reverse engineering.

## Repository layout

```
IDEA.md                              Original project brief from J.
LICENSE                              MIT license.
decisions/                           Dated decision records (product and technical).
package.json                         Root app: build, dev server, unit tests, and the docs-test launcher.
src/                                 Application source (TypeScript).
  document/                          Immutable command store, document types, and set/transition/annotation
                                      (annotation, layer, symbol) validation (annotations.ts).
  editor/                            DOM dot editor, performer/dot forms, coordinate inspection table,
                                      the interactive SVG field renderer, the first-run setup wizard
                                      (setup-wizard.ts), the post-wizard roster editor (roster-editor.ts),
                                      the annotation/layer/symbol authoring form and field-pointer drawing
                                      surface (annotation-editor.ts), and the shared SVG overlay renderer
                                      that both the editor and timeline playback use to draw annotations
                                      (annotation-renderer.ts).
  geometry/                          Canonical NFHS 11-player field geometry and coordinate derivation.
  platform/                          Browser feature detection.
  timeline/                          Set and float/FTL transition authoring, sampling, playback, status tools,
                                      sampled collision-warning analysis, and the read-only annotation context
                                      view shown during playback.
  main.ts                            Application entry point: renders the setup wizard on a fresh document,
                                      then hands off to the dot editor (which includes the roster editor).
  styles.css                         Application styles.
scripts/run-docs-validation.mjs      Cross-platform launcher that runs docs/validate_fixture.py,
                                      selecting the right Python command per OS (see Testing below).
docs/
  freeform-mvp-spec-v1.md            Implementation-ready MVP specification.
  freeform-1.0.schema.json           Draft 2020-12 JSON Schema for the .freeform file format.
  fixtures/                          Positive and negative .freeform fixtures exercised by the tooling below.
  validate_fixture.py                Documentation-test harness: schema + semantic validation.
  algorithm_edge_tests.py            Executable tests for the coordinate grammar, FTL tie-break, and
                                      collision-sampling algorithms from the spec.
  ajv_validate.mjs                   Node/Ajv subprocess used by validate_fixture.py to perform genuine
                                      Draft 2020-12 schema validation.
  package.json                       Node dependencies (ajv, ajv-formats) for ajv_validate.mjs.
```

The `.freeform` file format is UTF-8 JSON. `docs/freeform-1.0.schema.json` is its normative structural schema, and `docs/fixtures/freeform-1.0-example.freeform` is a complete valid example file.

## Prerequisites

Both Windows and macOS need the same three tools. There is nothing in this project that requires a native build step or a platform-specific dependency.

- **Git**, to clone the repository.
- **Node.js with npm**, to install dependencies, build the app, run its unit tests, and run the Ajv schema-validation subprocess. Verified on macOS with Node v22.23.1 and npm 12.1.0. No minimum version is pinned; if a command below fails, report `node --version` and `npm --version` alongside the error.
- **Python 3**, to run the documentation/spec validation gate (`docs/validate_fixture.py`). It has no third-party Python dependencies. Verified on macOS with Python 3.14.7.
  - **Windows:** install Python from [python.org](https://www.python.org/) using the standard installer, which registers the **Python Launcher** (`py`). The project's `npm run test:docs` command finds it automatically; you do not need to add Python to `PATH` yourself unless you also want to run `python` or `python3` directly.
  - **macOS:** install Python 3 via [python.org](https://www.python.org/) or Homebrew (`brew install python3`). `python3` must resolve on your `PATH`.

## Setup

From the repository root, install both the app dependencies and the documentation-tooling dependencies. These are separate `package.json` files and both installs are required:

```
npm ci
npm --prefix docs ci
```

These commands work unchanged in **cmd.exe**, **Windows PowerShell 5.1 or later** (including PowerShell 7), and macOS shells. `npm --prefix docs ci` runs the second install in `docs` without using shell command chaining or changing the current directory. In particular, do not replace it with `cd docs && npm ci && cd ..` when documenting Windows PowerShell 5.1: Microsoft documents `&&` pipeline-chain operators as beginning in PowerShell 7. If you don't have a lockfile-exact install available (for example, working from a fork with edited dependencies), use `npm install` instead of `npm ci` in each of the two locations (`npm install` and `npm --prefix docs install`).

**Troubleshooting: unrelated packages or unexpected vulnerability warnings.** `npm ci`/`npm install` only work correctly when your shell's current directory contains `package.json`. If you run it from the wrong directory, npm can silently resolve a `package.json` in a parent folder outside the repository and install unrelated dependencies there. Before running any command below, confirm `pwd` (macOS) or `cd` with no arguments (Windows) shows the `freeform` checkout, and that `package.json` exists in that directory.

## Building

```
npm run build
```

This runs `tsc -p tsconfig.app.json` for a type check, then `vite build`, producing a static, deployable bundle in `dist/`. Build output is identical across platforms; Vite's build step does not invoke any OS-specific tooling in this project.

## Running the app locally

```
npm run dev -- --host 127.0.0.1
```

This starts the Vite development server. Open `http://127.0.0.1:5173/` in a browser. Stop the server with Ctrl+C on both platforms.

### Collision warnings

Open the **Collision warnings** disclosure in the transition timeline to see each warned pair's rank codes, closest sampled distance, count/sample, and the editable whole-FU document threshold (default 2880 FU, one yard). A pair at or under the threshold has a text warning; analysis is advisory sampled detection, never continuous collision prevention. Recording an override requires a local actor label and reason, then retains the computed warning and audit record in the in-memory document model. If the warning's pair motion or threshold changes, a stale audit is visibly marked as not applying; it is never silently inherited. Invalid FTL geometry or a transition exceeding the 100,000-sample analysis bound produces an actionable analysis failure, not a safe result.

### Annotations, layers, and notes

The **Annotations, layers, and notes** panel, below the roster editor, authors five mark types: freehand strokes, structured labels, arrows, reusable symbols, and performer notes. Use the form for exact keyboard entry, or pick a tool and draw directly on the field preview; both paths send the same field-unit (FU) command to the document, so neither is more "real" than the other. A freehand stroke or arrow needs at least two points, entered as semicolon-separated `x,y` FU pairs or drawn with a pointer; a label, symbol, or performer note needs one anchor point, typed into the X/Y fields or placed with a click. Performer notes require choosing a performer; the other four types may optionally associate with one.

Every mark belongs to exactly one layer and has exactly one scope, chosen independently:

- **Set** confines a mark to one specific page. It is hidden while any transition into or out of that set is playing.
- **Transition** confines a mark to one specific between-set movement. It is hidden on both of that transition's endpoint sets.
- **Show** keeps a mark visible everywhere: every set and every transition.

The preview panel's **Preview context** selector lets you check this before committing to it: switch between a static set, an active transition, the whole show, or an inclusive set range, and the field redraws with exactly the marks that context would show. An active-transition preview deliberately excludes both endpoint sets' set-scoped marks. The same scope rules already govern the live app, not only this preview: the graphical field editor applies the static-set rule while you work a page, and the transition timeline's playback view applies the active-transition rule while a transition plays.

Each mark also carries three independent visibility flags: **Show in editor** controls whether it draws in the editor and timeline playback right now; **Mark for future director output** and **Mark for future performer packet output** record which marks a director PDF or an individual performer packet would include once that export exists. Setting either print flag does not generate a PDF today: M8 (PDF layouts and export) is not implemented, so these flags only filter which annotations are eligible for that future export. Performer-packet visibility requires a performer association.

The **Layer manager** creates, reorders, and deletes layers, each with its own visible/print/locked flags; z-order follows the layer list, with later layers drawing on top. Locking a layer disables every create, edit, and delete action for marks already on it and blocks new marks from being added to it, with an inline hint naming the layer to unlock. The **Reusable symbols** panel defines named glyphs that any symbol-kind annotation can reference, each with its own editable rotation (degrees) and scale.

The **Annotation list** shows every mark with its kind, ID, scope, and layer, and lets you select one to load its exact values back into the form for editing, or delete it outright. All annotation, layer, and symbol commands go through the same undo/redo history as every other document edit.

Annotations, layers, and symbols live only in the in-memory document model for this session. There is no save, open, autosave, or recovery yet (M7), so a reload loses this work exactly as it loses any other unsaved document change.

## Running the tests

Two independent test suites cover this repository, and both are part of the release gate:

```
npm test
```

Runs the application's Vitest suite (`src/**/*.test.ts` and `scripts/**/*.test.mjs`): the document command store and set validation, NFHS geometry and coordinate derivation, float/FTL transitions, collision sampling/override audit, timeline playback/disclosure, annotation/layer/symbol validation and scope selection, the annotation editor and its live integration into the assembled app, browser feature detection, and the cross-platform docs-test launcher.

```
npm run test:docs
```

Runs the specification/fixture validation gate (`docs/validate_fixture.py`), which:

- Validates the positive fixture (`docs/fixtures/freeform-1.0-example.freeform`) against the JSON Schema using a genuine Draft 2020-12 validator (Ajv, invoked as a Node subprocess).
- Checks semantic invariants the schema alone can't express: unique IDs, in-field dot placement, FTL start/path/end equations, collision-override audit metadata, annotation scope references, and related rules.
- Runs every named fixture in `docs/fixtures/positive/` and `docs/fixtures/negative/`, confirming each is accepted or rejected as the spec requires.
- Imports and runs `docs/algorithm_edge_tests.py` (coordinate-grammar labeling, FTL projection tie-break, collision sampling, and spec/grammar agreement), so `npm run test:docs` is the single command that exercises the whole documentation gate.

`npm run test:docs` invokes `scripts/run-docs-validation.mjs`, which selects the right Python command for your OS automatically: `py -3` first on Windows, `python3` first on macOS and other POSIX systems, falling back to alternate names only when the preferred command isn't found. You never need to type `python3` or `py -3` yourself; running `npm run test:docs` is the same command on both platforms. A missing or broken Node/Ajv toolchain is treated as a hard failure by the validator, not a skipped check, which is why the `docs` install above is required before the first run.

If you want to run the specification tests without Node's platform-selection wrapper, you can call the Python scripts directly (requires the `docs` npm install from Setup to already be done, since `validate_fixture.py` shells out to `ajv_validate.mjs`):

```
cd docs
python3 validate_fixture.py       # macOS
py -3 validate_fixture.py         # Windows
```

## Full workflow, clean checkout to running app

```
git clone https://github.com/Tillerdawg/Freeform.git freeform
cd freeform
npm ci
npm --prefix docs ci
npm test
npm run test:docs
npm run build
npm run dev -- --host 127.0.0.1
```

Open `http://127.0.0.1:5173/` to confirm the app loads, then stop the dev server.

## Verified support and known limitations

- **macOS (Apple Silicon, arm64):** the full workflow above, including clean-clone install, `npm test`, `npm run test:docs`, `npm run build`, and `npm run dev` followed by an HTTP smoke test, has been executed and passed on macOS 27.0 with Node v22.23.1, npm 12.1.0, and Python 3.14.7. No native-dependency, permissions, or filesystem issue was observed.
- **Windows:** GitHub Actions CI has previously run the full automated workflow natively on `windows-latest`. [Run 36722149551](https://github.com/Tillerdawg/Freeform/actions/runs/36722149551) is historical evidence from commit `ce5d083a261a88ececa12f6d31dac75412a47cbb`: its `windows-latest / Node 22.x / Python 3.13` job installed both dependency sets, ran `npm test`, built the application, and ran `npm run test:docs`. It verifies those automated install, test, build, and documentation-validation commands on a native Windows runner for that commit; it is not a claim about whichever commit is currently `main`. It does not by itself demonstrate manual interactive or visual behavior on a physical end-user Windows machine.
- Intel (x86_64) Macs have not been separately verified; no architecture-specific code exists in this repository, so the same commands are expected to work, but this has not been tested on Intel hardware.
- No packaged desktop build or installer exists; "running the app" means the Vite dev server (development) or serving the static `dist/` bundle from any static file host (production-equivalent), not a native executable.
- The specification's ordered implementation milestones (M1 through M12) are listed in `docs/freeform-mvp-spec-v1.md` §8. M1-M6 and M9 are implemented and covered by the commands above: M1 provides the app shell, feature detection, and immutable command store; M2 provides canonical NFHS geometry, the dot editor, and coordinate derivation; M3 provides ordered sets, float transitions, step-size status, pair-distance calculation, and keyboard playback; M4 provides FTL path/order authoring and derived-end validation; M5 provides deterministic advisory collision warnings at the required sample grid (including FTL path-corner samples), adaptive <=720-FU movement sampling, an editable document threshold, and auditable local overrides that never suppress a computed warning; M6 provides the annotation, layer, and symbol editor described above, including set/transition/show scope filtering, per-mark editor/print/performer-packet visibility flags, locked-layer protection, and performer-note association; M9 provides the first-run setup wizard and the post-wizard roster editor. M7, M8, and M10-M12 remain future work; in particular, persistence (save/open, autosave, version history, backup/recovery), PDF export, accessibility hardening, cross-browser hardening, and performance validation are not implemented. Collision analysis is sampled advisory detection, not continuous collision prevention; an invalid FTL transition or a transition exceeding the documented 100,000-sample bound reports an actionable analysis failure rather than a safe result.

## License

Freeform is licensed under the MIT License. See [LICENSE](LICENSE).

## Contributing

This is currently a solo-writer project. No formal contribution process has been defined yet. If you're picking up implementation work, start with the Setup and Testing sections above to confirm your environment is working before making changes, and record any product or technical decision you make in `decisions/`, per `IDEA.md`.
