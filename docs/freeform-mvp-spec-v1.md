# Freeform MVP product and technical specification, v1.0

Status: implementation-ready MVP specification
Owner/assignee: Wheeljack, Kanban `t_dcda77f3`
Scope: specification only; this document does not authorize application implementation.
Normative words: MUST, SHOULD, and MAY have their RFC 2119 meanings. “Deferred” is explicitly outside this release.
Sources: `IDEA.md`; decisions recorded in Kanban task `t_932c8cf7`; `decisions/2026-09-28-mvp-specification-decisions.md`; and `decisions/2026-09-28-football-field-dimensions.md` (NFHS citations retrieved 2026-09-28).

## 1. Product boundary and workflows

Primary persona: a solo drill writer working on one show locally in a desktop-class browser. The writer creates performers/rank codes, places dots into ordered sets, creates float or FTL transitions, evaluates safety/movement, rehearses any contiguous set range count by count, annotates charts, saves/recovers the show, and exports a director chart or performer packet.

MVP MUST provide:

- One NFHS 11-player American-football surface; performer dots with stable unique rank codes; ordered sets/pages and transitions with integer counts.
- Float (the default): straight-line, constant-speed interpolation. Curves, arrival timing, facing, step style, and body orientation are note text, not animated semantics.
- FTL: shared ordered path with continuous equal-distance/equal-step movement for every selected member.
- Timeline playback/scrubbing at every integer count; arbitrary contiguous inclusive set ranges; no music timing.
- Advisory step-size status, collision warnings, pair-distance-in-steps utility, and documented override state.
- Freehand, structured labels, arrows, reusable symbols, layers, performer-specific notes, and print-only annotations.
- US-Letter director-perspective full-field PDFs and individual performer coordinate/count packets.
- Undo/redo, keyboard access, accessibility, local autosave/history/backup/recovery, save/open `.freeform`, and static offline-capable operation after loading.

MVP SHOULD provide a setup wizard collecting performer count, labels/rank-code prefixes, and show/piece count length. It must be skippable and must not discard a partially authored show.

Deferred, not hidden “partial support”: native offline iOS 18+/Android 11+ performer apps; custom/basketball surfaces; music synchronization/MP3/MIDI; accounts/collaboration/cloud sync; automatic PDF note placement; NCAA/NFL presets; Pyware/UDB import/export; and proprietary file-format reverse engineering. No product-enforced performer/set/count cap exists; the performance target defines only the supported baseline.

## 2. Architecture, data ownership, and boundaries

The MVP is a static browser application: immutable versioned assets served from a local/self-hosted static origin, no required backend, no account, and no network request needed for authoring after assets load. The document model is an in-memory immutable command state persisted to browser IndexedDB. Rendering and PDF creation run locally.

Interfaces:

1. Editor state -> geometry/motion engine: canonical integer dots and transition definitions in; sampled positions, labels, warnings, and derived FTL ends out.
2. Document model -> persistence adapter: schema-valid document + version metadata in; IndexedDB snapshots, user-selected files, export byte streams, and recovery candidates out.
3. Document model + layout -> PDF adapter: resolved director or performer view in; a deterministic US-Letter PDF byte stream out. A PDF consumer is never a persistence authority.
4. Import adapter -> validator/migrator: bytes in; read-only rejection, a migrated current document, or structured validation errors out.

No copied Pyware/UDB code, UI assets, brand assets, access-control bypass, or proprietary interchange implementation is permitted. Field geometry and drill terminology are public factual conventions only.

## 3. Canonical field geometry and coordinate notation

### 3.1 Canonical model

The sole MVP preset is `NFHS_11_PLAYER`, sourced by the cited research note: playing field 100 yd (not end zones) by 160 ft = 53 1/3 yd; front and back hashes are each 53 ft 4 in = 17 7/9 yd from their nearest sideline. End zones may render as non-authoring context but performer dots MUST stay in the 100-yard playing field in v1.

Coordinate origin is `(0,0)` at Side 1 goal line/front sideline. `x` increases Side 1 -> Side 2; `y` increases front sideline -> back sideline. A director faces the field from the front sideline, so Side 1 is director-left and Side 2 director-right. This resolves an ambiguity in the field research note: a sideline cannot be “nearer Side 1”; front/back are the y axis, Side 1/2 the x axis.

All stored coordinates are integers in field units (FU): `2880 FU = 1 yard`. Therefore:

```
playing length x: 288000 FU       (100 yd)
field width y:    153600 FU       (160 ft)
front hash y:      51200 FU       (160/3 ft)
back hash y:      102400 FU
one 8-to-5 step:    1800 FU       (5/8 yd)
quarter step:        450 FU
```

A dot is valid iff `0 <= x <= 288000` and `0 <= y <= 153600`. All math uses integer FU until a final presentation conversion; screen pixels and JavaScript floating-point values are never saved. A renderer may invert y for its canvas but MUST preserve this canonical frame in the file.

### 3.2 Deriving a user-facing coordinate

For a canonical `x,y`, derive the first component using five-yard lines `L={0,5,...,100}` in FU. For each line, its side-relative label is `Side 1 n` for `x <= 50 yd` and `Side 2 (100-n)` for `x >= 50 yd`; the 50 is simply `50`. Select the nearest line. If `x` is exactly halfway between adjacent five-yard lines, output `Splitting <lower-side label> & <higher-side label>` and no inside/outside offset. Otherwise convert `abs(x-line)/1800` to steps. Label it `Inside` if movement from that line is toward the 50, `Outside` if away; output the step value rounded to a quarter step, half away from zero. A 50-yard-line dot uses `On 50` plus its front-to-back component.

For the second component choose the nearest landmark among `front sideline=0`, `front hash=51200`, `back hash=102400`, and `back sideline=153600`. If equidistant, choose the smaller y (frontward) landmark. Convert absolute difference to steps and format with quarter-step rounding. Use `In Front Of` if the dot y is smaller than the landmark and `Behind` if larger. Exact landmark is `On <landmark>`.

Worked example required by J: `x=122400, y=44000`. `x` is exactly halfway between Side 1 40 (`115200`) and 45 (`129600`), so it is `Side 1, Splitting 40 & 45`. `y` is `7200 FU = 4` steps in front of front hash (`51200`), so the full output is `Side 1, Splitting 40 & 45, 4 Steps In Front Of Front Hash`.

### 3.3 Pseudocode

```
FU_PER_STEP = 1800
roundQuarter(s) = sign(s) * floor(abs(s)*4 + 0.5) / 4

coordinate(dot):
  assert valid(dot)
  nearestX = all five-yard lines minimizing abs(dot.x - line)
  if two adjacent lines tie: horizontal = "Splitting " + labels(neighbors)
  else:
    line = nearestX
    d = roundQuarter(abs(dot.x-line)/FU_PER_STEP)
    horizontal = side(line) + ", " + d + (toward50(dot.x,line) ? " Steps Inside " : " Steps Outside ") + label(line)
  ref = landmark minimizing (abs(dot.y-landmark.y), landmark.y) # front tie-break
  d = roundQuarter(abs(dot.y-ref.y)/FU_PER_STEP)
  vertical = d == 0 ? "On "+ref.name : d+" Steps "+(dot.y < ref.y ? "In Front Of " : "Behind ")+ref.name
  return horizontal + ", " + vertical
```

The application MUST expose the unrounded FU and exact raw step distance in an inspection view so display rounding cannot conceal a safety classification.

## 4. Sets, interpolation, FTL, and analysis

A set has complete position coverage: exactly one valid dot per active performer. A transition joins adjacent ordered sets; `counts` is a positive integer. A count sample is `t=c/counts`, `c=0..counts`. Set start counts must be strictly ascending and transition `to.startCount - from.startCount == counts`.

Float for performer `p` is:

```
Pp(t) = A_p + t * (B_p - A_p), 0 <= t <= 1
D_p_FU = hypot(Bx-Ax, By-Ay)
stepSize_p = (D_p_FU / 2880 yards) * 8 / counts    # steps per five yards
```

Classify using the unrounded `stepSize_p`: zero => `No movement` green; >= 6.1 green; 4.1 through 6.0 yellow; <= 4.0 red. This is advisory only. Example: a 10-yard, 16-count move has `10*8/16 = 5.0-to-5`, yellow. A 10-yard, 12-count move is `6.666…-to-5`, green under J's specified bands even though it is physically demanding; color conveys the agreed convention rather than a safety guarantee.

Pair-distance utility for selected dots `A,B`: `distanceFU=hypot(B.x-A.x,B.y-A.y)` and `distanceSteps=distanceFU/1800`. It displays raw decimal steps (minimum 3 decimals), raw yards, and quarter-step display; it does not alter dots.

### 4.1 FTL semantics

An FTL transition stores leader ID, ordered followers, a polyline `C(s)` parameterized by arc length in FU, each member's nonnegative formation offset `o_i`, and a positive integer `distanceUnits=D`. Leader offset is zero. All members use exactly the same stored path distance during the transition:

```
P_i(t) = C(o_i + t*D),    0 <= t <= 1
D = counts * commonStepSize * 5/8 yard
```

The authoring UI derives `o_i` by projecting each selected start dot onto the path; it must expose offsets and let the writer set order. Starts must agree with `C(o_i)` within 1 FU (or be rejected as invalid). The path coverage must include `[min(o_i), max(o_i)+D]`; otherwise it is an `INSUFFICIENT_FTL_PATH` error. All `P_i(t)` must be defined for every sample. The end dots are derived as `C(o_i+D)`. An independently placed target end set may be saved only as `expectedEndPositions`; each target must match the derived dot within 1 FU, otherwise `FTL_END_MISMATCH` blocks export and playback of that transition until fixed, converted to float, or removed. No member may stop, mark time, or take a different distance.

Worked FTL fixture: `docs/fixtures/freeform-1.0-example.freeform` has A..E on the front hash from Side 1 40 to the 50, 2.5 yd (7,200 FU) apart. E is leader at 50, with offsets E=0, D=7,200, C=14,400, B=21,600, A=28,800. The common horizontal path is from `x=144000` to `x=86400`; `D=28800 FU=10 yd`, over 16 counts => 5.0-to-5. At count 16 E is at `115200` (A's original Side 1 40), while every member has moved 10 yd continuously. This is intentional and fixes the earlier stopped-follower contradiction.

### 4.2 Collision warnings

For each transition, evaluate all unordered performer pairs at t=0, 1 and at least `t=k/(4*counts)` for every integer `k=0..4*counts`; adaptively subdivide any interval in which either member travels more than 720 FU (0.25 yd) between samples. Warn when Euclidean center distance is `<= threshold`; default threshold is 2880 FU (one yard). Store threshold with document settings and store an override as user, timestamp, reason, transition/pair, and warning signature. Overrides never delete the warning computation. The UI labels results “warning”, not “collision prevented.”

## 5. Annotation, playback, PDFs, accessibility, and interaction

Annotations have type, layer, anchor/geometry, visibility (`editor`, `print`, `performerPacket`), and optional performer association. MVP types are freehand strokes, structured labels, arrows, reusable symbols, and performer notes. Layers are named, ordered, visible/locked, and independently print-enabled. Print-only annotations exist in the model and do not appear in ordinary playback.

Playback supports play/pause, previous/next count, drag scrub, direct count entry, and a contiguous inclusive set range. It MUST pause/render each exact count, including transition endpoints. A selected range has no effect on document ordering or export scope unless the user explicitly selects a range export.

Director PDF requirements: US Letter (8.5 x 11 in), director perspective, full field scaled to printable page, rank-code labels, set/count title/footer, and enabled printable layers. The exporter MUST calculate note-box vs performer-label/dot overlap and warn with affected IDs; user manually moves boxes and re-exports. Individual packet PDF requirements: rank code/name, ordered set/count list, derived coordinate text, movement counts, applicable performer notes/annotations, and page numbers. PDF generation runs locally; a PDF export is immutable and does not update working state.

Keyboard: every function is operable without a pointer; focus order is visible and logical; shortcuts include Save, Undo, Redo, Delete with a confirmation only for destructive multi-selection, play/pause, count navigation, and help. Shortcuts do not fire while editing ordinary text. Undo/redo is command-based, covers dot/transition/annotation/layer edits and wizard completion, has at least 100 commands per document session, and marks the saved checkpoint. Browser-native text undo remains available in text fields.

Accessibility: meet WCAG 2.2 AA for editor UI; semantic form controls/labels; keyboard-visible focus; no color-only step/collision state (include text/icon); minimum 4.5:1 text contrast; motion-reduction preference disables autoplay; screen-reader announcements for validation/error changes without spam; PDF output preserves selectable text/tags where the PDF library permits. Canvas dots must have an equivalent accessible table/list with rank code, canonical coordinate, derived coordinate, and warning state.

## 6. Persistence, recovery, and file format

Layers are deliberately distinct:

- Working state: current in-memory document and IndexedDB copy, updated after each committed command.
- Explicit file: a user-named `.freeform` JSON snapshot written only via Save/Save As/download. Browser sandbox limitations mean the app must never claim it can overwrite a local file unless the File System Access API permission is active; otherwise it downloads a new version.
- Autosave: local IndexedDB snapshot after 2 seconds of editing idle time, no later than 30 seconds during continuous edits, retained for the current document.
- Version history: immutable local checkpoints on explicit save, import, and before destructive bulk operation; retain latest 50 or 30 days (whichever removes first), with timestamp/size/source.
- Backup: user-triggered and scheduled downloadable `.freeform` snapshots; default prompt once per 24 h of unsaved-origin editing; retain last 10 named backups when filesystem permission exists. Users choose a backup destination.
- Export: PDFs and other output are derived artifacts, never autosave inputs.

On startup, list recovery candidates when IndexedDB is newer than its explicit-file ancestry, clearly showing document title, source, timestamp, and schema version. User can open copy, replace working state after confirmation, export backup, or discard. Validate before writing any imported/recovered state. Storage quota, malformed file, permission denial, PDF failure, migration failure, and unsupported browser must show actionable non-destructive errors and preserve the last valid working state. Before any migration, create a raw backup copy.

`docs/freeform-1.0.schema.json` is the normative structural schema and `docs/fixtures/freeform-1.0-example.freeform` is a complete valid fixture. A `.freeform` file is UTF-8 JSON with `format:"freeform"` and semantic version `formatVersion`. Schema controls structural validity; the following semantic validation is also mandatory: unique performer/rank/set/transition IDs; rank codes unique case-insensitively; all set positions exactly cover active performer IDs; ordered transition topology; in-field dots; no unknown IDs; FTL start/path/end equations; annotation layer references; and no future-major write.

Compatibility/migration policy: 1.x readers load 1.0.0 and additive 1.x files only when unknown fields are in `extensions` using a reverse-DNS key. A future minor has a defaultable additive migration. A major change is a new schema and deterministic pure migration `old bytes -> new bytes + migration report`; retain original bytes and write a new file, never in-place overwrite. Higher-major files open read-only with backup/export support and a clear upgrade-required message. Older readers refuse editing a newer file. Invalid input is not “best-effort repaired.”

## 7. Browser, security, performance, and release criteria

Supported current and previous stable browser families: Chromium, Firefox, Safari on desktop-class macOS/Windows/Linux where the browser supports IndexedDB, ES modules, Web Workers, and local PDF generation. Feature-detect File System Access API and use download fallback. No browser-specific storage behavior may be called a durable backup.

Performance reference test hardware: Apple MacBook Air M2, 16 GB RAM, macOS 27.0; Chromium current stable, hardware acceleration enabled. Baseline fixture: 500 performers, 250 ordered sets, 10,000 total counts, 499 float transitions, 20 visible annotations per set, all warning analysis enabled. Measure five runs after warm cache: open, select/move 50 dots, undo/redo, scrub 1,000 counts, and playback of 1,000 counts. Passing is median editor input-to-render <=100 ms, p95 <=250 ms for selected move/undo, scrub frame response <=100 ms, and >=30 rendered fps playback with no main-thread task >100 ms for more than 1% of sampled frames. Record browser/version, OS, hardware, fixture SHA, run data, and any degraded behavior. Firefox and Safari must pass functional smoke tests; performance is reported separately, not assumed identical.

Release acceptance is measurable:

1. Schema fixture validates against the published schema; negative fixtures reject malformed IDs, out-of-bounds dots, missing FTL data, and unsupported major versions.
2. Unit tests cover coordinate derivation/ties, FU invariants, float endpoint/half-count interpolation, all step bands from unrounded values, pair-distance, FTL equations/insufficient path/end mismatch, collision sampling/override, migration, and persistence failure recovery.
3. Browser integration tests execute the solo-writer workflow in current Chromium/Firefox/Safari: create/show wizard, author set/float/FTL, isolate range, undo/redo, save/open/autosave recovery, accessible keyboard path, and both PDFs.
4. Accessibility audit has no critical/serious WCAG 2.2 AA violations; manual keyboard/screen-reader smoke findings are recorded.
5. PDFs visually and textually verify US Letter, director orientation, rank labels, coordinates/counts, applicable marks, and overlap warning behavior.
6. Baseline performance evidence meets this section's thresholds; no artificial hard cap is introduced.
7. Offline test blocks network after app cache/load and proves open/edit/save/export/recovery still work; backup limitations are disclosed.

## 8. Ordered implementation milestones

| ID | Atomic milestone | Depends on | Evidence to accept |
|---|---|---|---|
| M1 | App shell, static build, feature detection, document command store | none | offline smoke, browser matrix, command undo/redo test |
| M2 | Canonical NFHS geometry, dot editor, coordinate derivation | M1 | golden FU/label tests including splitting/hash ties |
| M3 | Sets, float timeline, step status, pair-distance | M2 | endpoint/interpolation/band tests and keyboard playback |
| M4 | FTL path/order editor and derived-end validation | M3 | fixture replay, equal-distance, insufficient-path and mismatch tests |
| M5 | Collision analyzer and documented override | M3, M4 | sampled/adaptive proximity tests, persisted override audit |
| M6 | Annotation/layer/notes editor | M2 | layer visibility/print/performer-note tests |
| M7 | Local persistence, save/open, autosave/history/backup/recovery, migration | M1, M4 | quota/permission/malformed/migration recovery integration tests |
| M8 | PDF layouts and export validation | M2, M4, M6 | visual/text PDF regression and note-overlap warning test |
| M9 | Setup wizard, accessibility, browser/performance hardening | M1-M8 | WCAG audit, three-browser E2E, documented reference-hardware results |

M1-M9 are implementation cards, not work performed by this specification card. Each must preserve scope and receive independent verification before release.

## 9. Traceability

| Requirement/source | Spec location | Disposition |
|---|---|---|
| IDEA.md lines 1-3: browser drill authoring, dots, sets, scrub/play | §§1, 4, 5 | MUST |
| IDEA.md line 7: 8-to-5, float, FTL, step feedback | §§3-4 | MUST |
| IDEA.md line 9: count-by-count pause | §5 | MUST |
| IDEA.md line 13: decisions/version control | decision record; §6 | MUST for project/file discipline |
| J clarification: solo author, static/no backend, browsers | §§1-2, 7 | MUST |
| J clarification: coordinate prose | §3 | MUST |
| J clarification: exact step bands/advisory status | §4 | MUST |
| J clarification: uninterrupted equal-distance FTL | §4.1 | MUST |
| J clarification: 1-yard configurable collision and pair distance | §4.2 | MUST / pair utility MUST |
| J clarification: markup/packets/US Letter/manual overlap | §5 | MUST |
| J clarification: undo, accessibility, autosave, history, backup | §§5-6 | MUST |
| J clarification: setup wizard | §1 | SHOULD |
| J clarification: 500/250/10,000 and 30 fps | §7 | release benchmark |
| Field research §§3,7: NFHS dimensions/hashes | §3.1 | MUST |
| Deferred decisions: native apps, custom surface, music, collaboration, interoperability | §1 | Deferred |

## 10. Assumptions and residual risks

Assumptions: the director views from the front sideline; quarter-step display is adequate while FU remains exact; all performers are active for each v1 set; and FTL uses a piecewise-linear path. Risks: NFHS permits state-level field variation, so the sole preset may not match every venue; browser storage can be evicted; Safari/Firefox have different file-system capabilities; PDF tagging depends on the selected library; and sampled collision warnings are advisory rather than biomechanical proof. NCAA/NFL geometry and proprietary interoperability must receive fresh primary-source/legal review before any implementation card adds them.
