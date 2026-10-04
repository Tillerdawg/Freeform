# M8.2 director print copy: headings, footer, and field captions

Status: new, bounded copy contract for Kanban task `t_dc0b4d80`. Covers only the text drawn *onto* director PDF pages (title/context heading, footer, optional field-perspective captions). It does not touch the export panel, validation, error, or warning copy already approved in `decisions/m8-pdf-export-copy.md` (`t_7dc45aee`, accepted PASS WITH RESERVATIONS); those stay as written. Written against the Huffer-accepted design (`decisions/m8-pdf-export-design.md`), the accepted M8.1 foundation (`t_9007439e`), and spec `docs/freeform-mvp-spec-v1.md` §5 (line 155) and §7.5 (line 190). Read-only against `src/`; no runtime, schema, dependency, or README changes; no commit or push.

Every string below is final text to integrate verbatim unless marked otherwise. `<angle brackets>` mark a runtime value to interpolate; everything else is literal, including punctuation and capitalization. Every string has a stable key so Wheeljack has one lookup table, matching the convention `decisions/m8-pdf-export-copy.md` already established for `pdfExport.*` keys. These keys live under a new `pdfExport.director.*` namespace reserved for printed-page chrome, distinct from the existing `pdfExport.panel.*`/`pdfExport.error.*`/`pdfExport.warning.*` namespaces, which stay UI-facing.

---

## 0. What this document does not decide

1. **Font, subset, and license.** The design's own open questions (`decisions/m8-pdf-export-design.md:54,220`) left font asset, subset strategy, and license unqualified at design time. The accepted M8.1 foundation (`t_9007439e`) has since resolved that: Noto Sans (Latin, Cyrillic) and Noto Emoji ship as reviewed application assets (`src/pdf/assets.ts`, `src/pdf/assets/NOTO-SANS-LICENSE`, `src/pdf/assets/NOTO-EMOJI-LICENSE`), with independently reproduced Unicode extraction and two-renderer visual qualification. This document still names no font and assumes no specific glyph coverage, because choosing or re-qualifying a font is not this contract's job, but the uncertainty it is working around is the foundation's already-resolved font/license/Unicode qualification, not an open question. What remains downstream and genuinely unqualified is layout-specific: whether the qualified font's measured widths, combined with this document's actual header/footer/caption strings and the fixed geometry in §5 below, render without clipping or missing glyphs on a real director page. That is Wheeljack's renderer qualification, not a font-selection question.
2. **Exact point sizes, line counts, or pixel offsets within the header/footer bands.** The design fixes the geometry (`decisions/m8-pdf-export-design.md:118`: landscape 792×612, field rect `x=36..756, y=102..486`, i.e. `{x:36, y:102, width:720, height:384}` matching `DIRECTOR_FIELD_RECT` in `src/pdf/contracts.ts:7`); this document fixes the *text*, Wheeljack fixes the measured layout within the band the design already reserves (title/meta above the field rect, footer below it).
3. **Performer packet copy.** M8.3 scope; not addressed here.
4. **Whether the renderer draws field-perspective captions at all.** §4 below defines the exact text *if* the renderer adds them; the design does not mandate a drawn caption, only the canonical left/right mapping (`decisions/m8-pdf-export-design.md:129`).

---

## 1. Placeholders

- `<showTitle>` — `FreeformDocument.show.title` (`src/document/types.ts:132`), verbatim, never re-cased or truncated by this contract.
- `<setName>` — a `SetPage.name` (`src/document/types.ts:18`), verbatim.
- `<startCount>` — a `SetPage.startCount` (`src/document/types.ts:19`), the document-level count at which that set begins, printed as a plain integer.
- `<fromSetName>`, `<toSetName>` — the `name` of the `Transition`'s `fromSetId`/`toSetId` endpoint sets (`src/document/types.ts:45-46`), verbatim. These are the same two names `decisions/m8-pdf-export-copy.md` §4.2 already prints in warning rows for the identical transition — reuse that exact resolved string, do not re-derive or reformat it differently for the printed page.
- `<localCount>` — the exact requested count `c` for this page (`PdfPageContext` where `kind:'active-transition'`, `src/pdf/contracts.ts:44`; `0 <= c <= transition.counts`). This is the same value `decisions/m8-pdf-export-copy.md` §4.2 calls `<transitionCount>` — one underlying number, two placeholder names because the two documents' audiences differ (printed page vs. UI warning row), but the value, its source, and its meaning are identical. Never relabel count 0 or count equal to `totalCounts` as anything other than this transition's context — both remain transition pages, never a disguised static-set page (design: `decisions/m8-pdf-export-design.md:91,110`).
- `<totalCounts>` — the `Transition.counts` (`src/document/types.ts:47`), the fixed total step count for that transition, printed as a plain integer. Always paired with `<localCount>` so a count of 0 or of the full total is never ambiguous with a static set's `<startCount>`.
- `<displayPage>` — this page's 1-based position within this export's full page sequence, identical in source and meaning to `decisions/m8-pdf-export-copy.md` §4.2's `<displayPage>`: page 1 is the first page produced (static pages first, in document set order, then requested transition frames in document-transition/count order per the design's accepted plan, `decisions/m8-pdf-export-design.md:92,118` and `src/pdf/pdf-export.ts:159-161`). The warning-row page number for a given page and this footer's page number for that same page MUST always be the same integer — they are reporting the same page, not two independently computed numbers.
- `<totalPages>` — the total number of pages in this director export (the full static-plus-transition page sequence's length), a plain integer.

No placeholder in this document ever substitutes template prose for user-owned data: rank codes, performer display names, annotation/label/note text, and symbol glyphs are drawn by the renderer from the document exactly as authored, through the existing selector (`selectAnnotations`, `src/document/annotations.ts:75-109`) and performer records (`src/document/types.ts:8-14`) — this contract supplies only the surrounding chrome (title, context heading, footer, optional field captions), never a replacement for a performer's or annotation's own text.

---

## 2. Header: show title and context heading

Printed once per director page, in the vertical band above the field rectangle (`decisions/m8-pdf-export-design.md:118`: "title/meta above" the field rect, i.e. above PDF y = 486 on the 612-tall landscape page). Three lines, always in this order: show title, context heading, context label.

| Key | Text | When it prints |
|---|---|---|
| `pdfExport.director.header.showTitle` | `<showTitle>` | Every director page. |
| `pdfExport.director.header.context.staticSet` | `<setName>` — starts at count `<startCount>` | Static-set pages (`PdfPageContext.kind === 'static-set'`). |
| `pdfExport.director.header.context.transition` | `<fromSetName>` → `<toSetName>`, count `<localCount>` of `<totalCounts>` | Transition/count pages (`PdfPageContext.kind === 'active-transition'`), including `<localCount> = 0` and `<localCount> = <totalCounts>`. |
| `pdfExport.director.header.contextLabel.staticSet` | Static set | Static-set pages. |
| `pdfExport.director.header.contextLabel.transition` | Transition | Transition/count pages. |

Routing is exhaustive and mirrors the manifest's own discriminant (`PdfPageContext.kind`, `src/pdf/contracts.ts:42-44`) exactly as `decisions/m8-pdf-export-copy.md` §4.2 already routes its two warning-row variants on the same field — do not infer context kind from page position or page number.

The context label (`pdfExport.director.header.contextLabel.*`) exists because the heading line alone (a set name, or two set names joined by an arrow) is not self-describing to a reader who has not seen the export panel: it states in words which of the two page kinds this is, matching the design's "explicit context label" requirement (`decisions/m8-pdf-export-design.md:118`). It is the printed-page analogue of the UI's `pdfExport.kind.director.label` (`decisions/m8-pdf-export-copy.md` §1.1), not a duplicate of the context heading string itself.

A one-set range or full show with zero transitions prints one static header per selected set and no transition heading is ever drawn (design: `decisions/m8-pdf-export-design.md:92`) — there is no "no transitions" or empty-state heading variant to author, because the page itself does not exist in that case.

---

## 3. Footer: export identification, page numbering, context identity

Printed once per director page, in the vertical band below the field rectangle (below PDF y = 102).

| Key | Text |
|---|---|
| `pdfExport.director.footer.identification` | Freeform — Director pages |
| `pdfExport.director.footer.pageNumber` | Page `<displayPage>` of `<totalPages>` |

The footer's context identity is **not** a third, separately authored string: it reuses the exact `pdfExport.director.header.context.staticSet` / `pdfExport.director.header.context.transition` strings verbatim, resolved against that same page. This is deliberate, not an oversight — the design requires the footer "never show a misleading static set title for a transition endpoint" (`decisions/m8-pdf-export-design.md:118`); giving the footer its own independently-worded context string would create exactly the two-sources-of-truth risk the design is guarding against. One resolved string per page, drawn twice (header and footer), is the only way to guarantee they can never disagree.

Footer line order, left to right or stacked per Wheeljack's measured layout: `pdfExport.director.footer.identification`, the context identity string (reused from §2), `pdfExport.director.footer.pageNumber`. Exact visual arrangement within the footer band is Wheeljack's typographic judgment, matching `decisions/m8-pdf-export-copy.md`'s existing precedent of leaving visual sequence (not content or routing) to implementation (see that document's self-review item 6 on warning-row layout).

`<displayPage>`/`<totalPages>` numbering applies only within this director export's own page sequence. It has no relationship to a performer packet's independent `Page n of m` numbering (design: `decisions/m8-pdf-export-design.md:93,140`) — the two are different documents with different page counts even when exported from the same panel session.

---

## 4. Field-perspective captions (optional, renderer's choice)

The design fixes the canonical-to-PDF mapping so that a director standing at the front sideline sees Side 1 on the left and Side 2 on the right (`decisions/m8-pdf-export-design.md:129`, matching the existing editor's presentation inversion, `src/editor/field-geometry.ts:46-53`). The verification matrix confirms this is checked visually ("director view has front sideline bottom, Side 1 left, full field visible," design line 196) — the design does not require a drawn text label to make that true, since the field boundary/yard-line vectors (design line 129) already establish orientation visually, the same way the live editor does without a printed "Side 1" caption today.

If and only if the renderer chooses to add explicit perspective captions beside the field (e.g. because a tester or J finds the vector-only orientation insufficient on a printed page), these are the exact strings:

| Key | Text | Placement |
|---|---|---|
| `pdfExport.director.field.sideCaption.side1` | Side 1 | Along the field rectangle's left edge (`x ≈ 36`). |
| `pdfExport.director.field.sideCaption.side2` | Side 2 | Along the field rectangle's right edge (`x ≈ 756`). |

These captions, if drawn, sit outside the 720×384 field rectangle itself (`DIRECTOR_FIELD_RECT`, `src/pdf/contracts.ts:7`) — in the same margin space the header/footer already use, not overlapping field vectors, dots, or rank labels. No caption text may shrink, reposition, or crop the field rectangle to make room for itself; the geometry is fixed by the design and this contract does not reopen it.

---

## 5. Long names, Unicode, and overflow — correct error routing, no new key

Per the design (`decisions/m8-pdf-export-design.md:140`, applied here by extension) and this card's explicit requirement, no header, footer, or caption string may be silently truncated. The policy is identical in shape to the design's packet-note pagination rule, adapted to the fixed single-page director layout (a director page cannot gain a second page the way a packet can):

1. Measure `<showTitle>`, `<setName>`/`<fromSetName>`/`<toSetName>`, and the composed context-heading line using the embedded PDF font's actual measured widths (the same `measureText` the design already requires for overlap detection, `decisions/m8-pdf-export-design.md:144`), never an estimated/CSS width.
2. If a line does not fit the header or footer band's available width at the chosen size, wrap it across the additional vertical room the design already allocates to that band before failing (`decisions/m8-pdf-export-design.md:118`: "remaining vertical room is allocated deterministically to title/meta above and footer below"). Wrapping a show title or set name never truncates it with an ellipsis or cuts a Unicode grapheme mid-character.
3. If a string still cannot be laid out after measured wrapping — the title/set/transition names are too long even for every line the band has room for — this is **not** a note-layout-overflow. `pdfExport.error.noteLayoutOverflow` (`decisions/m8-pdf-export-copy.md` §3) names its failing object literally: "A note on `<context>` is too long to lay out…" A show title or set/transition name is not a note, and routing a heading failure through that key would misdiagnose what actually failed. DECISION | Optimus | Printed header/footer overflow is not a note overflow | Route unrepresentable show/set/transition heading or footer text through the existing `writer-failed` code and its already-approved `pdfExport.error.writerFailed` key (`decisions/m8-pdf-export-copy.md` §3: "Freeform ran into a problem building this PDF. Your document is unchanged. Try again with a smaller range or fewer performers — if that doesn't help, try again later.") rather than `note-layout-overflow`/`pdfExport.error.noteLayoutOverflow`, and rather than a new copy key | The approved note-overflow sentence names the failing object as a note; using it for show/set names would misdiagnose the failure to the user, and a third error key for the same underlying PDF-layout-writer failure class is unnecessary duplication | No new `pdfExport.director.error.*` key is defined by this document; annotation/performer-note overflow keeps using `pdfExport.error.noteLayoutOverflow` exactly as already approved, unchanged by this section.

No new error row is added by this section. Both existing keys keep their existing, already-approved scope precisely: `pdfExport.error.noteLayoutOverflow` for an annotation or performer-note text box that will not fit (§3's own subject, unchanged), `pdfExport.error.writerFailed` for every other PDF-layout-writer failure, including an unrepresentable show title, set name, or transition heading/footer line that measured wrapping could not resolve. Wheeljack's director renderer must route a post-wrap heading/footer overflow to `writer-failed`, never to `note-layout-overflow`, and must still attempt measured wrapping first in every case. The existing `writerFailed` text's "try again with a smaller range or fewer performers" retry guidance is retained verbatim and unchanged by this document, but it is not a proven cure for a heading/footer overflow specifically: a single selected set with an overlong show title, or a transition whose two set names alone exceed the header band's measured width, fails under the same fixed header/footer bounds regardless of how many performers or how large a count range the export covers, because show titles and set/transition names do not shrink or shorten when the scope shrinks. The sentence's retry wording is retained verbatim as already approved; this document makes no claim that it is a proven remedy for a heading/footer-overflow failure.

---

## 6. Self-review evidence

Read source anchors: `decisions/m8-pdf-export-design.md` (full, especially §"Layout and geometry" lines 114–153 and the recommended-cards table lines 163–213); `decisions/m8-pdf-export-copy.md` (full, especially §4.2's warning-row placeholder definitions and §3's error-key/allowlist pattern, reused rather than duplicated here); `docs/freeform-mvp-spec-v1.md:151-159,190` (annotation scope/visibility and director PDF requirements, applicable layers/marks acceptance); `src/pdf/contracts.ts` (full — `PdfPageContext`, `DIRECTOR_FIELD_RECT`, `LETTER_LANDSCAPE`, `PdfExportErrorCode`); `src/pdf/geometry.ts` (full — `fieldPoint` canonical-to-PDF mapping); `src/pdf/pdf-export.ts` (full — confirms the accepted M8.1 foundation's page-plan ordering, static pages before transition frames, and that its current page text is an explicitly temporary qualification placeholder, not the M8.2 renderer this contract is written for); `src/document/types.ts` (full — `Performer`, `SetPage`, `Transition`, `Annotation` shapes backing every placeholder above).

Read the cumulative Jazz advisory (`t_3a182862` comments 286, 289, 292, 295, 298) and the accepted copy contract's own self-review for prior Huffer corrections. Comment 289 contains a substantial printed-page section, "PACKET TYPOGRAPHY / PAGINATION / READABILITY," covering type-scale hierarchy, per-page repeated headers, footer sizing, and measured-width pagination. That section is written for the performer packet (portrait 612x792), explicitly out of this document's director-only scope (see §0.3 above), and this document does not import its packet-specific point sizes or page-break mechanics. Two of its underlying principles are general enough to apply here regardless of packet/director distinction, and this document already follows them: measuring with the embedded font's actual widths rather than estimating (comment 289, mirrored in design:144 and applied at §5.1 above), and never truncating or silently shrinking text to force a fit (comment 289, applied at §5.2-3 above). The advisory's other major subject, the export-panel keyboard/focus lifecycle (comments 286, 292, 295, 298), concerns UI interaction and does not bear on printed-page chrome at all. The first draft of this section incorrectly stated that the advisory thread contained no printed-page content beyond panel-copy concerns; that was false and is corrected here.

Repository state checked before writing (evidence directory `evidence/m8-pdf-foundation/recovery-r2/huffer-review/identity.json`, HEAD `3df1916315c43e7b4617bd037b62f76a3d0edc9a`):

```text
$ git status --short --untracked-files=all
 M package-lock.json
 M package.json
 M src/persistence/freeform-file.ts
 M src/vite-env.d.ts
?? decisions/m8-pdf-export-copy.md
?? decisions/m8-pdf-export-design.md
?? evidence/m8-pdf-foundation/... (accepted M8/M8.1 evidence tree)
?? scripts/qualify-m8-pdf.mjs
?? src/document/export-snapshot-validation.ts
?? src/document/uri.ts
?? src/pdf/... (accepted M8.1 foundation source)
$ git branch --show-current
main
$ git rev-parse HEAD
3df1916315c43e7b4617bd037b62f76a3d0edc9a
$ git diff --check
(exit 0, no output)
```

This matches the accepted dirty M8 source state recorded in `evidence/m8-pdf-foundation/recovery-r2/huffer-review/identity.json` (`head` and `status` fields) exactly — no unexplained drift, no reset/stash performed. `decisions/m8-pdf-export-copy.md` SHA-256 `f9e87c795a4d07f2849f32a64562179a1399bd3c57c1ba9a8e9b5ab8c66626b7` and `decisions/m8-pdf-export-design.md` SHA-256 `6bd45633b811c22f0d1970a3dbbf52a8bcc0069841c703a56f0d01c17397f9d8` match the identity file's recorded `sourceHashes` for both files, confirming this document was written against the exact accepted copy/design text, not a stale or re-edited copy.

No `npm run test`/`npm run build` was run for this task: it is a new copy-only markdown file, touches no `src/` file, and adds no code path for the existing suite to exercise; the M8.1 foundation's own baseline (241/254 tests passing across the cited evidence chain) is unaffected because nothing here is wired into source yet. `git diff --check` was rerun after writing this file and remains exit 0 with no output (the new file is untracked, so it does not appear in a tracked diff at all — consistent with how `decisions/m8-pdf-export-copy.md` and `decisions/m8-pdf-export-design.md` are already treated in this dirty tree).

Uncertainties and open items:

1. Whether the renderer draws the §4 field-perspective captions at all is left to Wheeljack/Jazz implementation judgment; the design's own verification matrix treats front-sideline/Side-1-left orientation as a visual check on the vector field, not a mandated text label. This document supplies the exact text only in case that judgment goes the other way.
2. Exact visual placement/typography within the fixed header and footer bands (line spacing, font size, left/center/right alignment of footer segments) is Wheeljack's measured-layout judgment, per the design's own allocation of "remaining vertical room" — this document fixes content and order, not pixel layout, matching the precedent `decisions/m8-pdf-export-copy.md`'s self-review item 6 already set for warning-row visual sequence.
3. §5's overflow routing reflects Optimus's mid-task correction (received after this document's first draft, which had incorrectly routed heading/footer overflow through a new `pdfExport.director.error.headingOverflow` key under `note-layout-overflow`): that draft is superseded, §5 now routes exclusively through the existing `writer-failed`/`pdfExport.error.writerFailed` pair with zero new keys. No further action needed unless a future reviewer wants the `writerFailed` sentence's retry wording tuned specifically for a heading/footer cause, which would be a wording refinement to an already-approved key, not a new contract surface.
4. Performer.notes placement (packet scope) is settled — J decided (recorded on `t_673976d6`, 2026-10-03 12:22) that general `Performer.notes` appear once, near the top of each performer's packet, in the identity block. This document is director-only and remains unaffected by and does not address packet content; see `decisions/m8-pdf-export-copy.md` §0/§4.3 for the settled packet copy.
5. Huffer round-1 review (`t_dc0b4d80`) found three factual errors in this self-audit, now corrected: §0.1 wrongly described font/license/Unicode qualification as still open when the accepted M8.1 foundation had already resolved it; §5's closing paragraph wrongly implied that a smaller count range or fewer performers cures a heading/footer width overflow, which it does not since set/transition/title strings do not shrink with scope; and this section wrongly denied that the Jazz advisory (comment 289) contains any printed-page content. Huffer round-2 review found that the round-1 fix to §5's closing paragraph had removed the false "cures the overflow" claim but replaced it with an equally unsupported rename/isolation remedy rationale for the same retry wording; §5 now states only that the retry wording is retained as approved, with no claim that it resolves a heading/footer-overflow failure by any mechanism. All corrections above leave the nine printed keys, placeholder definitions, geometry, and error-key routing unchanged.

Artifact absolute path: `/Users/jatiller/Sync/Dropbox_Replacement/AI_Projects/Freeform/decisions/m8-director-print-copy.md`
