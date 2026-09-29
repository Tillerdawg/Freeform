# Freeform

Freeform is an open-source, browser-based drill-design project for marching bands and drum corps. It is intended to remove licensing cost as a barrier for solo drill writers working with school and community programs, drawing inspiration from Pyware and the Ultimate Drill Book without copying their proprietary code, assets, or formats. See `IDEA.md` for the original project brief.

## Status

This repository currently contains the product specification, the file-format schema, fixtures, and documentation-test tooling for the MVP. It does not yet contain application source code (no editor UI, rendering engine, or PDF exporter). Anyone starting implementation work should begin with `docs/freeform-mvp-spec-v1.md`, which is the implementation-ready MVP specification, and the decision records in `decisions/`, which capture the accepted product and technical choices behind it.

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
docs/
  freeform-mvp-spec-v1.md            Implementation-ready MVP specification.
  freeform-1.0.schema.json           Draft 2020-12 JSON Schema for the .freeform file format.
  fixtures/                          Positive and negative .freeform fixtures exercised by the tooling below.
  validate_fixture.py                Documentation-test harness: schema + semantic validation, defined as the single test-gate command.
  algorithm_edge_tests.py            Executable tests for the coordinate grammar, FTL tie-break, and collision-sampling algorithms from the spec.
  ajv_validate.mjs                   Node/Ajv subprocess used by validate_fixture.py to perform genuine Draft 2020-12 schema validation.
  package.json                       Node dependencies (ajv, ajv-formats) for ajv_validate.mjs.
```

The `.freeform` file format is UTF-8 JSON. `docs/freeform-1.0.schema.json` is its normative structural schema, and `docs/fixtures/freeform-1.0-example.freeform` is a complete valid example file.

## Prerequisites

- Python 3. The Python tooling has no third-party Python dependencies; it uses standard-library modules plus the repository's local `algorithm_edge_tests.py` module.
- Node.js with npm, to run the Ajv schema validation subprocess.

Exact minimum Python or Node versions are not pinned anywhere in this repository, so compatibility with every current or older release is not asserted. If the commands below fail, record `python3 --version`, `node --version`, and `npm --version` when reporting the problem.

## Setup

Install the Node dependencies used by the schema validator:

```
cd docs
npm install
```

This installs `ajv` and `ajv-formats` as declared in `docs/package.json`. No Python package installation is required.

## Running the documentation tests

From the repository root, run the release-gate command:

```
cd docs
python3 validate_fixture.py
```

This single command, as documented in its own header:

- Runs the positive fixture (`fixtures/freeform-1.0-example.freeform`) through genuine Draft 2020-12 schema validation via the Node/Ajv subprocess (`ajv_validate.mjs`).
- Runs the semantic validation rules from the spec that the schema alone cannot express (unique IDs, in-field dots, FTL start/path/end equations, annotation scope references, and so on).
- Runs the named positive and negative fixture tables in `docs/fixtures/positive/` and `docs/fixtures/negative/`, confirming each is accepted or rejected as expected.
- Imports and runs `algorithm_edge_tests.py`'s suite (coordinate-grammar labeling, FTL projection tie-break, collision sampling, and spec/grammar agreement), so this one command is the whole test gate.

A missing or broken Node/Ajv toolchain is treated as a hard failure by this harness, not a skipped check, so `npm install` in `docs/` is required before the first run.

`algorithm_edge_tests.py` is also independently runnable on its own:

```
cd docs
python3 algorithm_edge_tests.py
```

Both scripts print `PASS:` lines for successful test groups. Most failures raise immediately; the positive and negative fixture tables finish reporting their rows before raising an aggregate failure.

## Development status and limitations

- No application code exists yet: there is no editor, renderer, or PDF exporter in this repository, only the specification, format, and its documentation tests.
- The specification's ordered implementation milestones (M1 through M12) are listed in `docs/freeform-mvp-spec-v1.md` §8; no implementation of those milestones is present in this repository.
- The MVP specification governs one field preset only (NFHS 11-player); other surfaces, music sync, and native performer apps are explicitly deferred, not partially built.
- Dated product and technical decision records are kept in `decisions/`; consult those records and the MVP specification before treating an open question in `IDEA.md` as unresolved.

## License

Freeform is licensed under the MIT License. See [LICENSE](LICENSE).

## Contributing

This is currently a solo-writer project. No formal contribution process has been defined yet.
