# Freeform

Freeform is an open-source, browser-based drill-design project for marching bands and drum corps. It is intended to remove licensing cost as a barrier for solo drill writers working with school and community programs, drawing inspiration from Pyware and the Ultimate Drill Book without copying their proprietary code, assets, or formats. See `IDEA.md` for the original project brief.

## Status

This repository contains the product specification, the file-format schema and fixtures, documentation-test tooling, and implemented application milestones M1 through M9: an app shell and immutable document command store; canonical NFHS geometry and a DOM dot editor with coordinate inspection; set and float-transition playback tools; FTL path/order authoring with derived-end validation; deterministic advisory collision analysis per transition with auditable overrides in the in-memory document model; freehand, structured-label, arrow, reusable-symbol, and performer-note annotations on reorderable layers, each scoped to one set, one transition, or the whole show and rendered correctly for whichever editor context is active; a first-run setup wizard paired with a post-wizard roster editor; save/open, automatic local recovery, version history, and backup for the `.freeform` file format; and downloadable PDF export for both director pages and individual performer packets. The setup wizard collects the drill file name and a section roster (with rank-code prefix suggestions per instrument/equipment) and generates the first laid-out set from a sequence of performer-creation commands. The roster editor then lets the writer add a late arrival to an existing numeric rank-code prefix, remove a departed performer (with an FTL-impact disclosure when the removal would block an existing follow-the-leader transition), and assign display names to the whole roster as one atomic command. The collision disclosure samples each transition deterministically, reports warnings rather than prevention, keeps overridden warnings visible, and records a local actor, timestamp, reason, pair, and motion/threshold signature in that in-memory model. The **Save, open, and backup** section below explains exactly what Freeform protects automatically versus what still requires an explicit Save; the **PDF export** section explains how director and performer-packet PDFs are generated and downloaded. Accessibility hardening, cross-browser hardening, and performance validation are not yet implemented. Anyone starting implementation work should read `docs/freeform-mvp-spec-v1.md`, the implementation-ready MVP specification, and the decision records in `decisions/`, which capture the accepted product and technical choices behind it.

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

Save/open, autosave, version history, and backup/recovery are implemented (M7, see **Save, open, and backup** below). Director-perspective and individual performer-packet PDF export are implemented (M8, see **PDF export** below). The accessibility/cross-browser/performance hardening milestones remain future work.

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
  persistence/                       Save/open (File System Access with a download fallback), the browser's
                                      local-storage working copy and its 2s/30s autosave scheduler, version
                                      history, startup recovery, backup, and the Save/Open/recovery/backup
                                      controls (persistence-ui.ts) wired into the dot editor.
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

Both Windows and macOS need the same three tools, and none of them requires you to install or configure a native compiler yourself. That isn't the same as having no platform-specific dependency at all: the build tooling installs OS- and CPU-specific native binaries automatically through npm (see **Building** below).

- **Git**, to clone the repository.
- **Node.js with npm**, to install dependencies, build the app, run its unit tests, and run the Ajv schema-validation subprocess. This README has documented Node v22.23.1 and npm 12.1.0 as verified versions since September 29, 2026 (commit `05ad140`); no minimum version is pinned, later npm/Node releases are expected to keep working but haven't individually been re-verified, and this correction has not located a separately dated execution log for that original verification beyond the documentation itself. If a command below fails, report `node --version` and `npm --version` alongside the error.
- **Python 3**, to run the documentation/spec validation gate (`docs/validate_fixture.py`). It has no third-party Python dependencies. The same September 29, 2026 documentation recorded Python 3.14.7 as verified on macOS; later Python 3 point releases are expected to work but haven't individually been re-verified.
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

This runs `tsc -p tsconfig.app.json` for a type check, then `vite build`, producing a static, deployable bundle in `dist/`. Vite performs that build through esbuild and Rollup, and `npm ci` installs a platform- and CPU-specific native binary for each of them (for example `@esbuild/darwin-arm64` or `@rollup/rollup-win32-x64-msvc` in `package-lock.json`); npm selects the right one for your machine automatically, so you never choose or install one yourself. The build command itself is identical on both platforms, and the application contains no OS-specific code, so the resulting bundle is expected to behave the same way wherever it's built. That expectation rests on the shared command and the absence of platform-conditional source, not on a side-by-side comparison: this project has not run a Windows-built and a macOS-built `dist/` next to each other to confirm matching behavior, and has not compared them byte-for-byte. Treat "same commands, expected-equivalent output" as the claim here, not a verified behavioral guarantee.

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

Each mark also carries three independent visibility flags: **Show in editor** controls whether it draws in the editor and timeline playback right now; **Mark for future director output** and **Mark for future performer packet output** determine whether the mark is included in the generated director PDF or an individual performer packet, respectively (see **PDF export** below). Performer-packet visibility requires a performer association.

The **Layer manager** creates, reorders, and deletes layers, each with its own visible/print/locked flags; z-order follows the layer list, with later layers drawing on top. Locking a layer disables every create, edit, and delete action for marks already on it and blocks new marks from being added to it, with an inline hint naming the layer to unlock. The **Reusable symbols** panel defines named glyphs that any symbol-kind annotation can reference, each with its own editable rotation (degrees) and scale.

The **Annotation list** shows every mark with its kind, ID, scope, and layer, and lets you select one to load its exact values back into the form for editing, or delete it outright. All annotation, layer, and symbol commands go through the same undo/redo history as every other document edit.

Annotations, layers, and symbols go through the same command store as every other document edit, so they're included automatically in Save, in the local working copy Freeform keeps in this browser, and in version history — see **Save, open, and backup** below for what that does and doesn't protect against.

## Save, open, and backup

A show lives in a `.freeform` file (see **What the MVP specifies** above for the format). Freeform distinguishes three kinds of copy:

- **Your `.freeform` file** — written by Save or Save As, and read back by Open. This is the copy you control directly: you choose where it lives, and it's the one you'd move to another computer or send to someone else.
- **The local working copy** — an automatic copy Freeform keeps in this browser's own storage (tied to this browser profile and this site) while you work. It survives an ordinary browser restart; it's exactly what startup recovery checks for and offers to restore (see **Recovering unsaved work** below). It is not a durable backup, though: it's gone if you clear this browser's browsing data, this browser evicts its own storage under pressure, or you close a private/incognito window, and it never leaves this browser. Opening the show from a different browser or OS profile won't find it either — the data isn't deleted, it's just invisible from anywhere but the profile that wrote it.
- **Version history and backups** — see their own sections below. Explicit backups are also files you control, written on purpose to a destination you choose.

### Save, Save As, and the filename

**Save** (`Ctrl+S`, or `Cmd+S` on Mac) and **Save As…** both write a `.freeform` file. If your browser supports the File System Access API and you've granted it permission to a file, Save writes directly to that file and the status chip reads **Saved**. If not, both controls fall back to a normal browser download; you don't have to choose which path runs; the confirmation message tells you ("Downloaded `<name>.freeform`…") when that happened, and after that, Save keeps producing a new download each time rather than silently overwriting the one in your downloads folder, because the browser hasn't granted Freeform permission to do that. The two paths don't carry the same guarantee: a granted-permission write only reports **Saved** after the browser confirms the file write is closed, so a failure there is caught and reported; a download hand-off only confirms that Freeform asked the browser to save the bytes, not that the browser's own save step finished or wasn't cancelled (the same limit the **PDF export** section describes for PDF downloads below). Save As opens your browser's native save picker when one is available, so you can choose where the file goes.

The filename comes from the show's title (the **Document name** field above the editor), case preserved, with characters a filesystem can't use replaced by a dash; an untitled show saves as `untitled-show.freeform`. For example, a show titled "My Show: Finale" saves as `My Show- Finale.freeform`.

If a save can't complete — permission was denied, the write failed, or your show currently has a problem Freeform can't save as-is (for example, an unresolved follow-the-leader reference) — Freeform tells you so in a message under the title field and leaves your open document exactly as it was. Freeform never reports success for a save it can detect failing — but, as above, it can't detect a browser-level cancellation or a failure inside the download hand-off itself, which is why the **Saved** status below should be read as "Freeform handed the save off successfully," not a guarantee that the bytes are already on disk.

### The status chip

Next to the title field, one label always shows the current save state:

- **Saved** — Freeform successfully wrote this document: either a granted File System Access handle reported its write closed, or (on the download fallback) Freeform handed the bytes to your browser's own save step and has no way to confirm that step finished or wasn't cancelled. If you need certainty that the bytes are on disk, use Save and then check the resulting file (see **Save, Save As, and the filename** above).
- **Unsaved changes** — you have edits since the last save. Freeform is also copying them to the local backup, normally within a couple of seconds, but that local backup isn't a file you control and isn't a substitute for one: Save, and verify the resulting file, if you need these edits durably protected.
- **Saving local backup…** — a brief, transient state while that local-backup copy is being written.
- **Local backup failed** — the local backup couldn't be written (browser storage is full, unavailable, such as in a private window, or hit an unexpected storage error). Your document is still open and editable; save your file now rather than relying on autosave until this clears.
- **Read-only — newer file format** — see **File format versions you can't open normally** below.

### Opening a file, and what happens to unsaved work

**Open…** reads a `.freeform` file you choose. If your current document has unsaved changes, Freeform asks first: **Cancel**, **Discard and Open**, or **Save and Open** — it never discards unsaved work without asking. The same three-way prompt appears before **New show** and before opening a recovered local backup as a copy (below).

If the file can't be opened, Freeform says exactly why and leaves your current document untouched: the file isn't valid Freeform JSON, isn't a Freeform show file at all, uses a format version Freeform can't read, or has a structural or logical problem (such as a duplicate ID) that Freeform won't silently repair.

### File format versions you can't open normally

The `.freeform` file format has its own version number, separate from the app version. Two situations stop a normal open, and Freeform tells you which one applies:

- **A newer major format version** (for example, a 2.x file in an app that only knows format 1.x) opens read-only. A banner explains that the file's format is newer than this app understands and offers **Export original file**, which downloads the file's exact original bytes unchanged. There's no way to view or edit its contents in this app and no inspector for looking inside it; the banner only confirms you can get the bytes back out safely.
- **Any other format version this app doesn't recognize** (a newer minor or patch version, or an older major version with no defined migration) is rejected outright: Freeform tells you the format version it found and that it has no defined upgrade path, and leaves your current document untouched. There's no automatic migration for these — open the file with the Freeform version that created it, or check for an app update.

### Recovering unsaved work after a crash or closed tab

Freeform checks on startup whether this browser holds a local backup newer than the file it belongs to. When it finds one, a **Recover unsaved work?** panel lists it with its name, timestamp, and format version, and offers four choices per entry:

- **Open as a copy** — opens the local backup as a separate document (a new, independent copy), so you can look it over without touching the original. Follows the same unsaved-work prompt as Open if you currently have other changes pending.
- **Replace current with this** — asks you to confirm, then replaces your current document with the local backup. That replacement goes through the same undo history as any other edit, so Ctrl+Z (Cmd+Z on Mac) can bring back what you had before while this session stays open — but that history, like all undo history, is gone once you close or reload Freeform, so don't rely on undo instead of saving the version you actually want to keep.
- **Export backup** — downloads the local backup as a `.freeform` file without changing anything else.
- **Discard** — deletes the local backup. Your actual file, if you have one, is untouched.

A local backup that's gone corrupt in browser storage is reported, not silently loaded; you can still discard it to clear the prompt.

### Version history

When Freeform's local version history is available, it records an entry for an explicit save, for opening a file, and — only when you currently have unsaved changes to a document that's being replaced (opening a different file, starting a new show, or restoring an older version) — a safety checkpoint taken just before that replacement. **Version history** is reachable from its own button in the controls; each entry shows when it was taken and its size, and **Restore this version** makes it your current working document without deleting the version you're moving away from, so you can restore right back if you change your mind.

History recording is a best-effort addition on top of the save or open it rides along with, not a precondition for it: a save always goes through even if recording its history entry fails (Freeform tells you so rather than pretending the history is complete), and opening a newer-major-format file read-only never attempts a history entry, since there's nothing editable to check in. The one case where history blocks an action is the pre-replacement safety checkpoint: if you have unsaved changes and local version history is currently available, Freeform takes that checkpoint before replacing your document, and if the checkpoint attempt fails, the replacement doesn't happen at all and says so, rather than proceeding without a way back. If local version history isn't available at all (for example, this browser's storage is unavailable), there's no checkpoint to attempt and no history to block on, so a clean document, or a dirty one, can still be replaced; in that case any unsaved changes are overwritten in your current editor with nothing to restore from, so save first if you want to keep them. When a pre-replacement checkpoint does succeed, anything you hadn't already saved is replaced in your current editor but recoverable from version history, subject to the retention limits below.

Freeform keeps a document's version history only as long as it's useful: a version is kept if it's both among the 50 most recent for that document and no older than 30 days. A version can age out at 30 days even if it's one of the newest 50, and a version can be pruned by the 50-entry limit even if it's less than 30 days old — the two limits both have to be satisfied, not just one.

### Backup

Backup is separate from both the local-backup autosave and version history: it's a `.freeform` file you create on purpose, meant to leave this browser. **Back up now** writes one immediately. **Choose backup folder…** lets you grant Freeform write access to a folder (where your browser supports it) so backups land there automatically; without a chosen folder, Back Up Now downloads a file instead, exactly like Save's fallback.

When a folder is chosen, Freeform keeps your 10 most recent backups for this show in that folder and deletes older ones with the same name automatically. If you rename the show, older backups filed under the previous name are left alone; you'll need to clean those up yourself.

Freeform also periodically asks if you'd like to back up: the first time you have unsaved edits with no recorded prompt for this show, and then again no sooner than 24 hours after the last time you dismissed or acted on that prompt, with a **Remind me tomorrow** option. That 24-hour clock is tied to the show, not to the browser session, so reopening the show the same day it last prompted you won't trigger another prompt; this check only happens while the app is open in this tab, and Freeform never backs up on a hidden schedule in the background. Choosing a backup folder only affects where a user-triggered backup (the reminder's **Back up now**, or the toolbar's) writes to — it doesn't start an automatic, scheduled backup on its own. Backup stays available by download even if the local working copy's storage in this browser has a problem — the two are independent, so a local-storage failure never takes away your ability to make an explicit backup.

## PDF export

Freeform generates downloadable, app-rendered PDFs directly in the browser: no server round trip, no native app, no cloud service. Two kinds, both US Letter:

- **Director pages** — one full-field landscape page per selected set or transition count, with full fields, rank labels, title, and footer, for the person calling the show.
- **Performer packets** — one portrait booklet per selected performer, with their own coordinates, movement counts, and notes.

### Opening the export panel

The editor's **Export PDF…** button opens the export panel. Choose **Director pages** or **Performer packets** first; the rest of the panel adapts to that choice.

### Choosing what to include

**Which sets?** is **Full show** (every set, in order) or **A range of sets** (pick a *From set* and *To set*; the range includes both and everything between them). A transition is included in a range only if both of its sets are in range.

For director export only, **Include transition pages?** is off by default. Turn on any eligible transition and enter one or more comma-separated counts (for example `0, 8, 16`) to add a page for each exact count during that move, in addition to the static set pages. A transition left off is skipped entirely; a transition turned on needs at least one count. This fieldset is present but disabled for performer-packet export, since transition pages aren't part of a packet.

For performer-packet export only, **Which performers?** lists every performer by rank code and name with **Select all** / **Clear all** shortcuts; check the ones you want a packet for. A packet's movement entries describe float transitions (straight-line) and follow-the-leader transitions (the shared path's common step status) in the terms appropriate to each, never mislabeling a follow-the-leader move as an independently authored static position.

### Overlap warnings

Both export kinds calculate, for each page or packet entry, whether a note's text box may overlap a performer's dot or rank label, using bounds intersection against the same rendered geometry the PDF draws. This is advisory: it never blocks the export, repositions anything, or stops generation. When warnings exist, a summary count appears with the export, and each warning row names the affected performer and annotation by their document IDs, the set or transition+count it belongs to, and the overlap's numeric bounds, so you can open that exact spot in the editor, move the note, and export again to confirm it's clear.

### Download, ready, and Close

Generating can take a moment for a long show; the panel shows a status message while it works. When generation finishes, the panel shows **Your PDF is ready** and a **Download** button, every time, whether or not the panel was closed and reopened while generating. Freeform never auto-starts a download on its own; downloading always requires clicking that button. After you click it, the panel reports that the download started. Closing the panel does not cancel a PDF that's still generating; reopen the panel to pick up where it left off, or download the file once it's ready.

### Limitations

- **Layout is deterministic; exact byte reproducibility is not universal.** The same show and export request always produce the same page layout, text, and geometry. Producing byte-identical PDF files has been confirmed only on specific tested fixtures and runtimes, not guaranteed for every environment.
- **Exported PDFs are untagged.** They have selectable, searchable text, but are not tagged, and have not been verified to work with screen readers. Font glyph rendering has been qualified on specific tested fixtures and renderers, not across every Unicode character or every browser's built-in PDF viewer.
- **A download can't be confirmed to finish, and Close can't cancel it.** Clicking Download only reports that the download started; Freeform cannot detect whether your browser's save step was accepted, cancelled, or completed, and it never claims otherwise. A PDF already generating when you click Close keeps generating in the background.
- **Not in scope for this export.** Automatic note placement (warnings are manual-correction-only), music or native desktop apps, cloud services, and proprietary interchange formats are outside what this export does.

**PDF export verification scope.** M8 was independently reviewed in stages covering the export design, the font/Unicode/determinism/validation foundation, the director renderer, the performer-packet renderer, and the in-app export UI. That review inspected real generated PDFs both as text (extracted content) and visually (rendered page images), using independent PDF tooling, and exercised the export, download, cancellation-limit, failure, and document-unchanged behavior in a real browser rather than a simulated DOM. It is backed by the project's full automated unit-test, documentation-fixture, and build gates, which have run clean on the specific runs recorded for this README's commits (not a claim that every historical run of those commits was clean); see the reliability reservation in **Running the tests** below before treating a clean run as a general reliability guarantee.

## Running the tests

Two independent test suites cover this repository, and both are part of the release gate.

**Reliability reservation.** Earlier runs of the default `npm test` invocation produced unexplained intermittent timeouts and apparent RPC-reservation trouble that was never root-caused. Those failures did not recur on the runs behind this README, but a clean run doesn't prove the underlying cause is fixed — it only shows this particular run was clean. If a test run hangs or fails without a clear assertion message, rerun it before treating it as a real regression, and don't treat a green run as evidence the historical issue was diagnosed.

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

- **macOS (Apple Silicon, arm64):** this section has recorded, since September 29, 2026 (commit `05ad140`), that the full workflow above (clean-clone install, `npm test`, `npm run test:docs`, `npm run build`, and `npm run dev` followed by an HTTP smoke test) passed on macOS 27.0 with Node v22.23.1, npm 12.1.0, and Python 3.14.7, with no native-dependency, permissions, or filesystem issue observed. This correction has not located a separately dated execution log for that original run beyond the documentation's own prose, so treat it as the project's longstanding historical record rather than evidence independently reproduced by current review; it is not a continuously re-run claim about whichever toolchain versions you have installed today.
- **Windows:** GitHub Actions CI has previously run the full automated workflow natively on `windows-latest`. [Run 36722149551](https://github.com/Tillerdawg/Freeform/actions/runs/36722149551) is historical evidence from commit `ce5d083a261a88ececa12f6d31dac75412a47cbb`: its `windows-latest / Node 22.x / Python 3.13` job installed both dependency sets, ran `npm test`, built the application, and ran `npm run test:docs`. It verifies those automated install, test, build, and documentation-validation commands on a native Windows runner for that commit; it is not a claim about whichever commit is currently `main`. It does not by itself demonstrate manual interactive or visual behavior on a physical end-user Windows machine.
- Intel (x86_64) Macs have not been separately verified; no architecture-specific code exists in this repository, so the same commands are expected to work, but this has not been tested on Intel hardware.
- No packaged desktop build or installer exists; "running the app" means the Vite dev server (development) or serving the static `dist/` bundle from any static file host (production-equivalent), not a native executable.
- The specification's ordered implementation milestones (M1 through M12) are listed in `docs/freeform-mvp-spec-v1.md` §8. M1-M9 are implemented and covered by the commands above: M1 provides the app shell, feature detection, and immutable command store; M2 provides canonical NFHS geometry, the dot editor, and coordinate derivation; M3 provides ordered sets, float transitions, step-size status, pair-distance calculation, and keyboard playback; M4 provides FTL path/order authoring and derived-end validation; M5 provides deterministic advisory collision warnings at the required sample grid (including FTL path-corner samples), adaptive <=720-FU movement sampling, an editable document threshold, and auditable local overrides that never suppress a computed warning; M6 provides the annotation, layer, and symbol editor described above, including set/transition/show scope filtering, per-mark editor/print/performer-packet visibility flags, locked-layer protection, and performer-note association; M7 provides save/open with the File System Access API and a download fallback, a local-storage working copy with a 2s-idle/30s-deadline autosave scheduler, startup recovery of unsaved local copies, version history with 50-entry/30-day retention, user-triggered backup with a 10-file retention policy and a periodic reminder, and read-only handling of files saved in a newer major format version (any other unrecognized format version is rejected outright, with no defined migration); M8 provides the director-page and performer-packet PDF export described in **PDF export** above, including the note-overlap advisory warning computed for both export kinds; M9 provides the first-run setup wizard and the post-wizard roster editor. M10-M12 remain future work; in particular, accessibility hardening, cross-browser hardening, and performance validation are not implemented. Collision analysis is sampled advisory detection, not continuous collision prevention; an invalid FTL transition or a transition exceeding the documented 100,000-sample bound reports an actionable analysis failure rather than a safe result.
- **Persistence verification scope.** M7's services (autosave timing, version-history retention, recovery, backup) were independently reviewed and are covered by the Vitest suite above using `fake-indexeddb` and fake timers, plus real-browser exercise of the save/open/recovery/backup UI flows (`persistence-ui.ts`), including the download fallback and injected permission/write failures. The native OS file/folder picker (an actual File System Access grant from a real user gesture) has not been exercised; only the code paths around a granted or simulated handle have been. Manual screen-reader validation of the persistence status chip and dialogs has not been performed; only DOM live-region mutations have been measured.
- **Test-suite reliability reservation.** See **Running the tests** above: historical unexplained default-test-suite timeouts have not been diagnosed, and the clean gates behind this README don't change that.

## License

Freeform is licensed under the MIT License. See [LICENSE](LICENSE).

## Contributing

This is currently a solo-writer project. No formal contribution process has been defined yet. If you're picking up implementation work, start with the Setup and Testing sections above to confirm your environment is working before making changes, and record any product or technical decision you make in `decisions/`, per `IDEA.md`.
