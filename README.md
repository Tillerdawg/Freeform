# Freeform

Freeform is an open-source, browser-based drill-design project for marching bands and drum corps. It is intended to remove licensing cost as a barrier for solo drill writers working with school and community programs, drawing inspiration from Pyware and the Ultimate Drill Book without copying their proprietary code, assets, or formats. See `IDEA.md` for the original project brief.

## Status

This repository contains the product specification, the file-format schema and fixtures, documentation-test tooling, and the first milestone of the application itself (M1: app shell, static build, browser feature detection, and the immutable document command store). It does not yet contain the editor UI, the field renderer, or the PDF exporter. Anyone starting implementation work should read `docs/freeform-mvp-spec-v1.md`, the implementation-ready MVP specification, and the decision records in `decisions/`, which capture the accepted product and technical choices behind it.

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
src/                                 Application source (TypeScript). Currently the M1 app shell,
                                      browser feature detection, and the document command store.
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
cd docs && npm ci && cd ..
```

`npm ci` is identical on Windows (PowerShell or cmd.exe) and macOS; there is no shell-specific syntax in either install step. If you don't have a lockfile-exact install available (for example, working from a fork with edited dependencies), use `npm install` instead of `npm ci` in each of the two directories.

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

## Running the tests

Two independent test suites cover this repository, and both are part of the release gate:

```
npm test
```

Runs the application's Vitest suite (`src/**/*.test.ts` and `scripts/**/*.test.mjs`): the document command store, browser feature detection, and the cross-platform docs-test launcher itself.

```
npm run test:docs
```

Runs the specification/fixture validation gate (`docs/validate_fixture.py`), which:

- Validates the positive fixture (`docs/fixtures/freeform-1.0-example.freeform`) against the JSON Schema using a genuine Draft 2020-12 validator (Ajv, invoked as a Node subprocess).
- Checks semantic invariants the schema alone can't express: unique IDs, in-field dot placement, FTL start/path/end equations, annotation scope references, and related rules.
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
git clone https://github.com/Tillerdawg/Freeform.git
cd freeform
npm ci
cd docs && npm ci && cd ..
npm test
npm run test:docs
npm run build
npm run dev -- --host 127.0.0.1
```

Open `http://127.0.0.1:5173/` to confirm the app loads, then stop the dev server.

## Verified support and known limitations

- **macOS (Apple Silicon, arm64):** the full workflow above, including clean-clone install, `npm test`, `npm run test:docs`, `npm run build`, and `npm run dev` followed by an HTTP smoke test, has been executed and passed on macOS 27.0 with Node v22.23.1, npm 12.1.0, and Python 3.14.7. No native-dependency, permissions, or filesystem issue was observed.
- **Windows:** no Windows machine, VM, or WSL environment was available to run this workflow directly, so Windows support is not independently confirmed end-to-end. The Windows-specific piece of the workflow, the `py`-before-`python`-before-`python3` command selection in `scripts/run-docs-validation.mjs`, is covered by focused unit tests (`scripts/run-docs-validation.test.mjs`) that simulate Windows without requiring a Windows host, and static review found no POSIX-only shell syntax, hard-coded path separators, or `/tmp`-style paths anywhere in the build, test, or docs-validation code. Treat Windows as expected-to-work but not yet independently verified until someone runs the full workflow above on a real Windows 10/11 machine and records the results.
- Intel (x86_64) Macs have not been separately verified; no architecture-specific code exists in this repository, so the same commands are expected to work, but this has not been tested on Intel hardware.
- No packaged desktop build or installer exists; "running the app" means the Vite dev server (development) or serving the static `dist/` bundle from any static file host (production-equivalent), not a native executable.
- The specification's ordered implementation milestones (M1 through M12) are listed in `docs/freeform-mvp-spec-v1.md` §8. Only M1 is implemented; commands above build and test what currently exists, not the full planned application.

## License

Freeform is licensed under the MIT License. See [LICENSE](LICENSE).

## Contributing

This is currently a solo-writer project. No formal contribution process has been defined yet. If you're picking up implementation work, start with the Setup and Testing sections above to confirm your environment is working before making changes, and record any product or technical decision you make in `decisions/`, per `IDEA.md`.
