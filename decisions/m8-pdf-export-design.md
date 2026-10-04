# M8 PDF export design

Status: implementation-ready technical design; no production PDF code, dependency installation, commit, or publication was performed by this card.

## Evidence and boundaries

Repository state was checked before investigation:

```text
$ git status --short
(empty)
$ git branch --show-current
main
$ git rev-parse HEAD
3df1916315c43e7b4617bd037b62f76a3d0edc9a
$ git ls-remote --heads origin main
3df1916315c43e7b4617bd037b62f76a3d0edc9a refs/heads/main
```

The required accepted base exists locally as a commit and the local tracking ref equals it. No reset, stash, dependency installation, commit, or push occurred.

The current application has no PDF implementation or PDF dependency (`package.json:7-22`). It does have the required seams: immutable command-store documents (`src/document/types.ts:127-158`), explicit print/packet annotation filtering (`src/document/annotations.ts:75-109`), canonical field constants and coordinate inspection (`src/geometry/nfhs.ts:3-16`, `:71-80`), presentation-only SVG geometry (`src/editor/field-geometry.ts:38-63`), float and FTL sampling (`src/timeline/float.ts:36-56`, `src/timeline/ftl.ts:138-153`), and a browser Blob download primitive (`src/persistence/save-adapter.ts:83-98`).

Normative requirements are in `docs/freeform-mvp-spec-v1.md:31-40, :151-159, :178-191`. In particular, this design does not let the exporter become a persistence authority, mutate the command store, or make a PDF an autosave/history input.

## Decision record

DECISION | Wheeljack | M8 implementation recommendation | Use browser-local `pdf-lib` pinned to exactly `1.17.1`, with `@pdf-lib/fontkit` pinned to exactly `1.1.1` only if custom Unicode fonts are embedded | The primary project documentation states that pdf-lib is pure JavaScript, browser-capable, can add exact-size pages, draw text/vector graphics/SVG paths, measure text, and embed fonts; npm metadata returned MIT for both packages | Add two reviewed production dependencies only in the implementation card; library qualification must pass before the dependency card is accepted; a tagged-PDF requirement cannot be claimed as solved by this choice.

DECISION | Wheeljack | Director page geometry | Use landscape US Letter for director pages (792 x 612 PDF points), 36-point margins, and a 720 x 384-point 15:8 field rectangle | The canonical playing field is 288000:153600 = 15:8 (`src/geometry/nfhs.ts:9-16`); landscape Letter leaves a full-width field plus 156 vertical points for title/footer/clearance | Director PDFs are one set/context per page; packet pages use portrait Letter unless a later layout advisory changes only packet presentation.

DECISION | Wheeljack | Export context | Director export defaults to static set pages only. A transition page or count frame exists only after the user explicitly selects transition IDs and integer count(s) | The normative context rule distinguishes static sets from active transitions and forbids endpoint set-scope leakage (`docs/freeform-mvp-spec-v1.md:151-155`) | No hidden “all counts” default; selected transition frames can make a large PDF and are intentionally visible in the export plan.

DECISION | Wheeljack | Note collision behavior | Compute and report note-box overlap against rendered dot and rank-label bounds; never move an annotation automatically | J already selected warning plus manual correction (`decisions/2026-09-28-mvp-specification-decisions.md:31`) | Export still completes with warnings; author moves boxes in the editor and exports a new immutable snapshot.

DECISION | Wheeljack | Reproducibility | Freeze a document snapshot and normalized export request before validation/layout; keep one stable page plan, library version, embedded font bytes, metadata policy, and draw order | An export must not update working state and persistence marks PDFs as derived artifacts (`docs/freeform-mvp-spec-v1.md:155, :170`) | Require byte-determinism qualification; until demonstrated, compare page plan/text/geometry rather than claim byte identity.

## Library recommendation and qualification boundary

Recommendation: `pdf-lib@1.17.1`, MIT. The project’s primary source at the `v1.17.1` tag describes browser support, pages, vector drawing, text metrics, custom-font embedding, and UTF-8/UTF-16 font support. Its API documents `PDFDocument.addPage([width,height])`, `PDFDocument.registerFontkit`, `PDFDocument.embedFont`, and `PDFPage.drawText`. Registry retrieval during this design returned `pdf-lib` unpacked size 19,461,112 bytes and `@pdf-lib/fontkit` unpacked size 4,299,890 bytes; those are package contents, not a measured Vite gzip bundle cost.

Primary sources retrieved for this recommendation:

- https://github.com/Hopding/pdf-lib/blob/v1.17.1/package.json — exact package version and MIT license field.
- https://github.com/Hopding/pdf-lib/blob/v1.17.1/LICENSE.md — MIT license text.
- https://github.com/Hopding/pdf-lib/blob/v1.17.1/README.md — browser support; vectors/text; measured custom font and Unicode examples.
- https://github.com/Hopding/pdf-lib/blob/v1.17.1/src/api/PDFDocument.ts — `registerFontkit` is required before custom-font embedding; `embedFont` accepts font bytes.
- https://pdf-lib.js.org/docs/api/classes/pdfdocument — documented `addPage`, `embedFont`, `registerFontkit`, `save`, and metadata methods.
- https://github.com/Hopding/pdf-lib/blob/v1.17.1/src/api/PDFPage.ts — documented text draw and measured line breaking through `maxWidth`.

Offline and text policy:

1. Ship the selected font bytes as reviewed, immutable application assets. Do not fetch fonts at export time and do not rely on installed operating-system fonts.
2. Use an embeddable font with the required glyph coverage, a verified distribution license, and metric data. The implementation card must choose the font asset and record its source hash/license; this card deliberately does not pretend that a font has already been qualified.
3. Register fontkit and embed/subset that asset. Use the same font for measurement and drawing. Draw all rank codes, names, titles, coordinates, counts, footers, and note text through text operators; do not rasterize text or use an SVG screenshot as the packet/director source.
4. Run a Unicode fixture containing non-ASCII Latin, combining marks, non-Latin text, and an emoji. The acceptance test must prove extraction and visible glyph results with the selected actual font. An unsupported glyph is an export error, not replacement text.

Accessibility/tagging: `pdf-lib` documents language metadata (`setLanguage`) but its published high-level API does not document a structure-tree/tagging authoring API. The library source/demos are evidence of text/vector creation, not evidence of a tagged-PDF implementation. Therefore M8 must produce selectable text and set language metadata where supported, but MUST NOT state that its PDFs are tagged/fully accessible until an independently reviewed prototype proves structural tags with a PDF accessibility checker. If tagged output is a release gate, open a separate library-evaluation decision rather than bypassing this limitation through undocumented internal objects.

Bundle tradeoff: pdf-lib has a relatively large unpacked package; custom font bytes and fontkit add more. This is acceptable only if the production Vite build reports the resulting chunk size and a representative export stays usable on the §7 baseline. The implementation must lazy-load the PDF module from an explicit Export action so ordinary authoring does not pay the initial parse/transfer cost. No runtime CDN is permitted.

Deterministic bytes: pdf-lib exposes metadata setters and source code indicates `create()` defaults `updateMetadata` to true. Date metadata, compression/object stream behavior, font subsetting order, or library changes may make otherwise identical exports differ byte-for-byte. The proposed contract is strict: fixed pinned package/font inputs, no current-time metadata, explicitly set title/creator/producer/language, stable sort orders, and stable draw order. A qualification test exports the same frozen snapshot twice in one runtime and fresh runtimes and compares SHA-256. If it fails, the implementation card is not accepted until it identifies/configures the cause or chooses a PDF writer that passes. Do not weaken the normative deterministic-byte-stream requirement silently.

## Export contracts

### Pure adapter surface

Create a new pure export adapter; it receives data and returns data. It does not receive a `CommandStore`, persistence adapter, DOM element, or mutable editor selection.

```text
buildPdfExport(snapshot: FreeformDocument, request: PdfExportRequest, assets: PdfAssets)
  -> Promise<PdfExportResult>

PdfExportResult =
  | { ok: true; bytes: Uint8Array; filename: string; manifest: PdfExportManifest; warnings: PdfWarning[] }
  | { ok: false; code: PdfExportErrorCode; messageKey: string; detail: readonly string[] }
```

Immediately deep-clone/freeze or `structuredClone` the input snapshot at the UI boundary before asynchronous font load or PDF writing. Validate that snapshot before layout. `PdfExportRequest` is an immutable discriminated union:

```text
{ kind: 'director'; scope: { kind: 'full-show' } | { kind: 'inclusive-set-range'; firstSetId; lastSetId }; transitionFrames: readonly { transitionId; counts: readonly number[] }[] }
{ kind: 'performer-packet'; performerIds: readonly Identifier[]; scope: { kind: 'full-show' } | { kind: 'inclusive-set-range'; firstSetId; lastSetId } }
```

Validation rules:

- Empty `performerIds`, duplicated IDs, unknown IDs, duplicate transition/count requests, non-integer/out-of-domain count, unknown IDs, reversed range, and a selected transition outside a selected range are failures before a PDF is created.
- `full-show` means all ordered static sets. It does not infer transition frames.
- `inclusive-set-range` means document-order sets from first through last, including both. Its eligible transitions are only those whose two endpoint set IDs occur inside that selected range (`src/document/annotations.ts:128-141`).
- A requested frame is emitted once for its exact active transition context and exact `c` where `0 <= c <= transition.counts`; `c=0` and `c=counts` remain transition contexts, never static set contexts.
- A one-set range/full show produces one static director page and one static entry per requested performer, with no transitions. A document with zero transitions retains every selected static set: a full show or inclusive range containing N selected sets produces N static director pages and N static entries per requested performer, with zero movement entries. No synthetic transition/count page is generated.
- Packet export uses selected/all performers in document performer order and respects the same scope; each packet can span multiple portrait Letter pages with continuous `Page n of m` numbering for that performer.

`PdfExportManifest` is test-facing semantic evidence, not user-facing copy: document ID/revision-independent content fingerprint, request, page sequence, US-Letter dimensions, page context IDs/counts, annotation IDs selected, packet performer ID, font asset hash, and warnings. It gives a reproducible comparison when binary-PDF tooling varies.

Failure/cancel contract:

- “Cancel” means only the user cancels the browser download/save picker after bytes are ready; a download failure is a failed derived-artifact dispatch. Adapter cancellation before dispatch returns `{ok:false, code:'cancelled'}`.
- All validation, font, PDF, and download failures leave the command-store reference/revision/history/redo state, dirty/saved indicator, IndexedDB, explicit file handle, version history, backup schedule, and working document byte-for-byte unchanged. The UI may show an error/live-region status only.
- Successful export likewise does not mark saved, alter dirty state, write history, autosave, explicit file, or persistence baseline. It downloads a `Blob` using a dedicated PDF download helper patterned after `browserDownload` (`src/persistence/save-adapter.ts:83-98`) with MIME `application/pdf` and revokes its object URL only after dispatch.
- The UI must detect `URL`/`Blob`/download dispatch failure and give an actionable retry/download-settings route. Exact human-facing strings, help text, and README text are Arcee-owned.

### Annotation selection and print gates

Never reproduce the selection rules locally. Call `selectAnnotations(snapshot, selection)` with `audience: 'director-print'` or `audience: 'performer-packet'` (`src/document/annotations.ts:75-109`). This preserves layer order. Director output requires exactly `annotation.visibility.print && layer.print`; it intentionally does not consult `annotation.visibility.editor` or `layer.visible`, so editor-hidden but printable annotations remain in director output. Performer-packet selection requires exactly `annotation.visibility.performerPacket && annotation.performerId === performerId`; it does not apply either editor/print visibility or layer flags.

Director static page: `{ audience:'director-print', context:{kind:'static-set',setId} }`. It contains only printable show plus that set scope.

Director transition/count page: `{ audience:'director-print', context:{kind:'active-transition',transitionId} }`. It contains only printable show plus that transition scope, even at count 0/counts; it never contains either endpoint set scope.

Packet static entry: `{ audience:'performer-packet', performerId, context:{kind:'static-set',setId} }`. Packet transition entry uses the equivalent active transition context. The selector already excludes another performer’s marks (`src/document/annotations.ts:83-102`), but the packet builder must also test this result explicitly. The source Performer `notes` field (`src/document/types.ts:8-14`) is a separate performer-level text source and must appear in each applicable packet according to the final content policy; it must not be confused with scoped annotations.

## Layout and geometry

### Director page

Landscape Letter is exactly 792 x 612 points. Margin is 36 points. The field rectangle is x=36..756, width=720; height=384; its lower y is 102 and upper y is 486. The remaining vertical room is allocated deterministically to title/meta above and footer below. Header contains show title, static set name/start count or transition name/count, plus explicit context label. Footer contains page number, export type, and context identity; it must never show a misleading static set title for a transition endpoint.

The PDF field transform is a pure canonical-to-PDF function, not reuse of CSS/SVG pixel constants:

```text
fieldPoint(dot, rect, field) = {
  x: rect.x + dot.x / field.lengthUnits * rect.width,
  y: rect.y + dot.y / field.widthUnits * rect.height
}
```

This uses canonical front sideline `y=0` as the lower PDF edge, so a director at the front sideline sees Side 1 on the left and Side 2 on the right, matching the normative coordinate frame (`docs/freeform-mvp-spec-v1.md:48-63`) and the existing renderer’s presentation inversion (`src/editor/field-geometry.ts:46-53`). Draw boundaries, five-yard lines, hashes, and optional step grid as vectors; derive dot positions by `fieldPoint`; draw rank labels with a stable, documented offset from each dot. Use the actual field record, not hard-coded field constants, although current schema fixes the preset.

Each static page’s dot positions are the named set positions. Each transition page’s dot positions come from `sampleFloatTransition` or `sampleFtlTransition` for the exact requested count (`src/timeline/float.ts:36-56`; `src/timeline/ftl.ts:138-153`). A sampled float position can be fractional FU; it is presentation output only and never returns to document state.

### Performer packet

Use portrait Letter, 612 x 792 points, 36-point margins. One packet begins with rank code and display name; then ordered set/count entries in document order, followed by eligible transition movement entries. Each static set entry prints set name/start count, exact canonical `(x,y) FU`, `inspectCoordinate(position).notation`, and any eligible packet annotation/note. A transition entry prints from/to set names, counts, mode, transition note if present, and movement data:

- Float: endpoint coordinate(s), travel distance/step status from `calculateTransitionStepStatuses` and its movement count. Stationary behavior remains `No movement` (`src/timeline/float.ts:59-85`).
- FTL: the common path distance and common step status from `calculateFtlStepSizeStatus`, formation position/order, and movement count; do not mislabel derived FTL samples as independently authored coordinates.

Line wrapping uses the embedded font’s measured widths and fixed leading. Before a row is drawn, determine whether it fits; otherwise start the next packet page, repeat packet identity/context, and update page numbers after the packet page plan is complete. A very long note must either paginate by measured lines or fail with an actionable “note exceeds supported layout” error; it must never draw off-page or silently truncate.

### Overlap warning algorithm

The implementation must add `measureText` and `boundsForRenderedItem` functions using the exact embedded PDF font, point size, line height, label placement policy, and director field transform. It must not estimate browser CSS text bounds.

For every director page context:

1. Build `ObstacleBounds` for every dot as the rendered circle bounding box plus a defined 1-point stroke allowance and every rank code as measured text bounds at its actual label origin. Associate both with performer ID.
2. Build `NoteBounds` for printable label and performer-note annotations (and any annotation type rendered as a text box), including padding and every wrapped line. Associate with annotation ID. Arrow/freehand/symbol geometry is not a note box unless the renderer gives it one.
3. Intersect axis-aligned page-point rectangles with positive-area overlap. Sort warnings by page index, annotation ID, performer ID, then obstacle kind. Each warning includes context, annotation ID, performer ID, dot/label kind, and both bounds rounded to 0.01 points only for reporting; comparisons retain full numeric precision.
4. Return these warnings before download. The UI keeps the export available, announces/counts affected annotation and performer IDs, and offers no auto-move action. The writer repositions the persisted annotation manually and exports a new snapshot.

This has deliberate limits: it detects bounds intersection, not visual occlusion through transparency, lines crossing a dot, or arbitrary rotated-symbol geometry. Those are future scope, not silently treated as solved.

## Controls and accessibility implementation requirements

Jazz owns layout/accessibility advisory before the UI-writing lane begins; Arcee owns every user-visible label, help, error, success, and README phrase. Engineering must provide semantic controls and state hooks, not author unreviewed final copy.

The export panel needs a keyboard-operable `form` with a radio/selectable export kind, full-show/range controls with labelled set selectors, transition-frame opt-in controls, performer multi-select/checklist, submit button, cancel/close control, warning summary linked to warning detail, and a polite status/live region. Form validation must place focus on the first invalid control; an export error must be associated with its control where applicable. Focus order must remain logical when transition options appear. The control must not use color as the only warning signal.

The implementation must call the browser download in the actual submit user gesture path where browser policy requires it. If asynchronous generation causes that gesture to expire, show an explicit “download ready” action that is keyboard-operable; do not claim automatic download succeeded. Test fallback where direct download dispatch throws or browser capabilities are unavailable.

> **Superseded for M8.4 by an explicit Optimus decision recorded on `t_fcfb6173` (2026-10-03):** for the PDF export feature specifically, always show the "download ready" action after every successful generation and dispatch only on a fresh Download-button gesture — never attempt a same-gesture direct dispatch on promise resolution. This removes the above paragraph's implied same-gesture-first/expiry-fallback branching for this feature only; the fallback behavior it describes becomes the only behavior. See `decisions/m8-pdf-export-copy.md` §4.1 for the exact copy and `src/pdf/download.ts` for the implemented anchor-click adapter. This note does not change the paragraph above as a general requirement for other features that may reuse it.

## Recommended implementation cards (Optimus-owned; do not create duplicates here)

All cards serialize writes in this order to avoid `src/persistence/persistence-ui.ts`/editor assembly collision. No card may alter normative requirements or use a CDN.

1. M8.1 PDF dependency and pure export foundation
   Dependencies: M2, M4, M6; this design approved by Huffer; no UI work.
   Scope: add pinned dependencies only after lockfile review; add `src/pdf/` pure contracts, snapshot validation, field transform, deterministic page-plan/manifest, local assets/font loader, and PDF download adapter.
   Exact acceptance: package lock resolves exactly `pdf-lib@1.17.1` and, if used, `@pdf-lib/fontkit@1.1.1`; no network at export; Letter page dimensions are exact; same frozen fixture exports twice with an evidenced byte SHA-256 comparison; no command-store/persistence import in pure modules; failed validation/font/PDF/download leaves fixture store revision/history/dirty state unchanged.

2. M8.2 Director renderer and print-context correctness
   Dependencies: M8.1; Jazz advisory delivered; no persistence UI edit until M8.1 is accepted.
   Scope: vector director static/explicit transition frames, canonical geometry, rank labels, context footer/title, selector-driven print annotations, and bounds-overlap warnings.
   Exact acceptance: generated PDFs contain landscape Letter pages, full 15:8 director field, rank labels, title/count/footer, static/transition context isolation including counts 0 and N, printable layer gates, inclusive/full scope behavior, stable warning IDs/bounds, and no auto relocation.

3. M8.3 Performer packet renderer
   Dependencies: M8.1; M8.2 selector/manifest seam accepted.
   Scope: portrait packet page plan, selected performer packets, coordinate/movement/FTL content, scoped packet annotations/notes, pagination, and page numbers.
   Exact acceptance: packets show rank/name, ordered set/count entries, canonical-derived coordinate text from `inspectCoordinate`, correct float/FTL movement counts, no other performer annotations, zero-transition/single-set output, Unicode/multipage behavior, and page-number accuracy.

4. M8.4 Export panel and application integration
   Dependencies: M8.2 and M8.3; Arcee-approved UI/help/error/README copy; Jazz layout/accessibility advisory.
   Scope: integrate export form into editor shell, immutable snapshot capture, keyboard/focus/status behavior, warning presentation, browser download and fallback; do not alter save/history semantics.
   Exact acceptance: controls are keyboard-operated; invalid fields focus correctly; cancel/error/download failure paths are actionable and non-destructive; an export changes no store/persistence/history/dirty/save state; production Vite build reports lazy chunk effect; browser integration test exercises director and packet download fallback.

5. M8.5 Independent verification and release evidence
   Dependencies: M8.1-M8.4; must be assigned to Huffer or an independent verifier, never implementer.
   Scope: run matrix below, inspect primary artifacts, independently test no-state-change and library qualification, and record limitations.
   Exact acceptance: all specified unit/integration/PDF inspection evidence exists; generated files/text/page-size output are retained as test artifacts; Huffer verifies scope against this design and the normative spec; tagging claim is either independently proven or accurately recorded as unavailable/not claimed.

## Verification matrix

| Normative requirement | Test fixture/action | Automated assertion/evidence | Independent visual/manual check |
|---|---|---|---|
| §5 director Letter/director/full field/ranks/title/footer | two-set float fixture | parse generated director PDF; each page MediaBox is 792x612; manifest is landscape, page context/field rect/rank labels/title/footer are present in extracted text | director view has front sideline bottom, Side 1 left, full field visible |
| §5 enabled printable layers and static scope | annotation matrix derived from `src/document/annotations.test.ts:38-49` | director manifest/text has only show + selected static-set IDs; includes annotations with `visibility.editor:false` or `layer.visible:false` when both print gates are true; excludes annotations when either `annotation.visibility.print` or `layer.print` is false, plus transition/other-set IDs | labels/symbols have expected layer ordering |
| §5 transition/count only when explicitly requested | request no frames, then transition 0/mid/N frame request | no-frame page sequence contains no transition context; requested sequence contains exact IDs/counts; endpoint frames exclude endpoint set annotations | count heading/context is unambiguous |
| §5 selected-range context behavior | three-set/two-transition fixture; range set-1..set-2 | includes exactly static sets 1/2 and transition 1; rejects/request-excludes transition 2 | page order matches range, not active editor page |
| §5 overlap warning/manual correction | note label box intersects a dot label; non-intersecting control | sorted warning has annotation+performer+kind+numeric bounds; PDF bytes/layout do not alter annotation coordinates | warning identifies an actually affected location; author moves it manually then reexports |
| §5 packet identity/order/coordinates/counts/page numbers | 3-set mixed float fixture with long notes | text extraction has rank/name, ordered sets/start counts, exact FU, `inspectCoordinate` result, movement counts, page n/m; long content generates multiple pages | packet is readable and repeated header/page numbers make sense |
| §5 packet scoped performer notes | p1/p2 show/set/transition annotation fixture, with editor-hidden and print-disabled layer/visibility variants | p1 packet only reports p1-associated eligible show/set/transition IDs and `visibility.performerPacket:true` annotations regardless of `visibility.editor`, `visibility.print`, `layer.visible`, or `layer.print`; p2 content never appears in p1 PDF | no leaked annotations in packet pages |
| §5 FTL | valid FTL fixture and invalid mismatch fixture | packet manifest/text reports FTL mode, counts, common distance/status; invalid FTL fails prior to bytes/download | derived movement description is not presented as a static authored end dot |
| §5 zero-transition and single-set behavior | (a) one-set show/range with no transitions; (b) multi-set full-show and inclusive range with `transitions:[]` | (a) has one static director page and one static entry per selected performer; (b) has one static director page and one static entry per selected performer for every selected set, zero movement entries, and no synthetic transition frame | reviewer confirms every selected static set is retained and no transition page appears |
| §5 immutable local PDF generation | freeze a snapshot then edit source while async export test is gated; offline browser test | output manifest matches snapshot-before-edit; source store revision/history/dirty/persistence spy unchanged; blocked-network export succeeds after assets loaded | none beyond browser download confirmation |
| §5 keyboard/accessibility/selectable text/tags where permitted | keyboard-only DOM integration plus text-extraction PDF | logical focus/order, submit/error focus/live status; extracted labels/coordinates are searchable/selectable; set language metadata if available | keyboard smoke; PDF accessibility checker records actual tagging finding rather than assumed tag support |
| §7.5 visual/text verification of Letter/director/ranks/coordinates/counts/marks/overlap | golden director, packet, range, FTL, overlap PDFs | `pdfinfo`/parser page-size result; `pdftotext`/parser expected tokens; deterministic manifest snapshot; rendered-page image diff after deliberate approval | independent reviewer visually inspects every generated golden PDF at 100% and print-preview scale |
| §7.5 applicable marks | print-gate plus packet-scope fixture | annotation-ID manifest exactly equals selector results for every page | reviewer spot-checks rendered marks |
| §7.5 PDF overlap behavior | overlap fixture above | warnings retained in manifest/test JSON; reexport after manual move removes only resolved warning | reviewer compares before/after pages |
| §7.5 Unicode | non-ASCII/combining/emoji fixture using selected actual font | no `UnsupportedGlyph` result; extracted text equals normalized expected string; rendered glyph inspection artifact | reviewer checks glyphs, no tofu/replacement characters |
| Failure/cancel/non-destructive requirement | invalid range, invalid FTL, font load failure, writer throw, Blob/download throw, user cancel | state identity/revision/undo/redo/dirty/history/persistence spies unchanged; no bytes downloaded on adapter failure; cancellation result classified | error paths use Arcee-approved actionable wording |
| Byte determinism | same frozen valid fixture twice per runtime and across fresh runtime | SHA-256 byte equality; on failure the card blocks and attaches differing manifests/metadata investigation | Huffer confirms not substituted by semantic-only comparison |

Generated regression PDFs should be stored as CI artifacts, not committed binaries unless a later repository policy explicitly allows fixtures. Tests may use a pure PDF parser/text extractor in Node and a renderer/image tool in CI; tools and versions must be pinned in the implementation card. Never test only raw PDF bytes for layout correctness.

## Open product/implementation questions

1. Exact user interaction for selecting many transition counts: recommended initial control is checkbox per transition plus comma-separated integer count list validated before export; Jazz must advise whether a tabular chooser is clearer. This is not an authorization for a bulk “all counts” default.
2. ~~Packet content policy for `Performer.notes` versus only `performerNote` annotations is not explicit in the current spec.~~ **Settled.** J decided (recorded on `t_673976d6`, 2026-10-03 12:22): general `Performer.notes` appear once, near the top of each performer's packet, in the identity block, by name/rank — not repeated per page, not omitted. This matches the recommendation above. Set/transition-scoped performer-note annotations remain separate and are unaffected; they continue to appear at their scoped entries per `decisions/m8-pdf-export-copy.md` §4.1-4.2.
3. The selected font asset, license/provenance, subset strategy, PDF accessibility checker, and byte-determinism configuration remain unqualified. M8.1 must resolve them with executable evidence before claiming capability.
4. Full tagged-PDF support is unresolved; it is not available from documented pdf-lib high-level APIs inspected for this design. Selectable text is required; tagging must be truthfully limited to what the qualified library/output proves.

## Self-review evidence

Read source anchors: `package.json:7-22`; `src/document/types.ts:8-21,43-151`; `src/document/annotations.ts:72-142`; `src/geometry/nfhs.ts:3-16,50-80`; `src/editor/field-geometry.ts:38-63`; `src/editor/svg-field-editor.ts:246-285`; `src/timeline/float.ts:36-85`; `src/timeline/ftl.ts:138-167`; `src/persistence/save-adapter.ts:36-98`; `src/persistence/persistence-ui.ts:58-68,331-389`.

Executed baseline verification after read-only investigation:

```text
$ npm run test && npm run build
Test Files  29 passed (29)
Tests  241 passed (241)
✓ built in 282ms
```

This document is a design and verification plan, not evidence that M8 PDFs or the recommended library behavior have been implemented.
