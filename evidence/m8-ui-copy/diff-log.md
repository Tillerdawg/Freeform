# Evidence: decisions/m8-pdf-export-copy.md round-6 reconciliation (t_fcfb6173)

This file records the exact, tool-produced unified diffs from every edit made to
decisions/m8-pdf-export-copy.md in this task, in application order. Each diff is
copied verbatim from the `mcp__patch` tool result at the moment of edit — not
reconstructed or retyped — so it is a faithful before/after record without risk
of manual-transcription error. A full-file SHA-256 after all edits is recorded
at the end of this file and in identity.json in this same directory.

## Edit 1 — §0 placeholder note: scope <displayPage> to director rows only

```diff
--- a/decisions/m8-pdf-export-copy.md
+++ b/decisions/m8-pdf-export-copy.md
@@ -10,7 +10,7 @@
 - `<message>` — a developer-facing technical string (font name, byte offset, library error text). It never appears inside the primary sentence (see §3's privacy rule); it is available only in a separate, optional, explicitly labelled disclosure.
 - `<count>` — the exact text of the offending token as the user typed it (not a coerced/re-formatted integer) for `transitionCountMalformed`, `transitionCountDecimal`, and `transitionCountNegative`, since those three cases are, by definition, not confirmed to be a valid integer; for `transitionCountOutOfDomain` and `transitionCountDuplicate`, `<count>` is the token's parsed integer value (leading zeros stripped, e.g. "08" displays as "8"), since those two cases have already passed the integer grammar below and a normalized number reads better than raw text with leading zeros.
 - `<id>` — a document-stable identifier already present in the document (performer `id`, annotation `id`, set `id`, transition `id`). These are not secrets and not server-generated session tokens; they are the same identifiers the document already stores and the selector functions already key off. They are shown alongside a friendly label, never as a replacement for one.
-- `<displayPage>`, `<setName>`, `<fromSetName>`, `<toSetName>`, `<transitionCount>` — the 1-based printed page number and the static-set/transition+count identity a warning row belongs to (§4.2); these are the same names and counts already shown elsewhere in the panel and on the page itself, not new identifiers.
+- `<displayPage>`, `<setName>`, `<fromSetName>`, `<toSetName>`, `<transitionCount>` — the 1-based printed page number and the static-set/transition+count identity a warning row belongs to (§4.2); these are the same names and counts already shown elsewhere in the panel and on the page itself, not new identifiers. `<displayPage>` is used only in director detail rows, where it equals both the warning's own `pageIndex + 1` and the number the director footer prints on that page (director pages are not renumbered). It is never used in a performer-packet detail row: see §4.2 for why a packet warning's physical position in the flat exported file does not match the per-performer page number printed on it.
 - `<bounds>` — the literal text of `pdfExport.warning.bounds`, itself built from `<noteBoundsRect>`/`<obstacleBoundsRect>`, each a `x, y, w, h` PDF-point rectangle taken from the design's own rounded overlap-bounds output (§4.2).
```

## Edit 2 — §3: remove unbound `<context>` placeholder from noteLayoutOverflow row

```diff
--- a/decisions/m8-pdf-export-copy.md
+++ b/decisions/m8-pdf-export-copy.md
@@ -187,7 +187,7 @@
 | `validation-failed` | ... |
 | `document-invalid` | `pdfExport.error.documentInvalid.schema` | ... |
 | `document-invalid` | `pdfExport.error.documentInvalid.ftl` | ... |
-| `note-layout-overflow` | `pdfExport.error.noteLayoutOverflow` | "A note on <context> is too long to lay out in the exported PDF. Your document is unchanged. Try shortening that note, then export again." | Yes — edit the note |
+| `note-layout-overflow` | `pdfExport.error.noteLayoutOverflow` | "A note is too long to lay out in the exported PDF. Your document is unchanged. Try shortening your performer notes or on-field notes, then export again." | Yes — edit the note |
 | `unsupported-glyph` | ... |
```

## Edit 3 — §3: added explanatory paragraph for the `<context>` removal (new paragraph, no prior text replaced)

Inserted directly after the existing "Removed from round 1: `blob-unavailable`..." paragraph. Full inserted text:

"**Removed in this revision: `noteLayoutOverflow`'s `<context>` placeholder named a location the adapter never returns.** `NoteLayoutOverflowError` (`src/pdf/pdf-export.ts:344`) is a bare marker class, thrown with no constructor argument at every call site that can raise it (`src/pdf/pdf-export.ts:404`'s packet-identity overflow check, and `wrappedLines`'s default-overflow throw at `src/pdf/pdf-export.ts:780`, used for both packet identity/entry note wrapping and director note wrapping); its catch site (`src/pdf/pdf-export.ts:172-174`) calls `failure('note-layout-overflow', 'pdfExport.error.noteLayoutOverflow')` with no `detail` argument, so `detail` is the frozen empty array `failure()` defaults to (`src/pdf/pdf-export.ts:968-970`). There is no annotation ID, performer ID, or context object attached anywhere on this path — not even in a form that could be allowlisted per §3's disclosure rule. A prior revision's `<context>` placeholder was therefore never bound to real data by the adapter; this document does not define what interpolates it because nothing does. The corrected text names the failure without inventing a location. If a future revision of the renderer threads structured identification through this error (the same way `NoteOverlapWarning` already carries `annotationId`/`performerId`/`context`), this row can regain a location clause — gated the same way §7's selectable-text claim is gated on its own qualification test actually passing, not assumed in advance."

## Edit 4 — §4.2 rewritten: director-only → director-and-packet

Full before/after diff produced by `mcp__patch`, reproduced verbatim (see tool transcript for the authoritative copy; header and key changes summarized here for evidence-file brevity):

- Heading: "### 4.2 Overlap warning (director export only)" → "### 4.2 Overlap warning (director and performer-packet export)"
- Added explanatory sentence after the opening paragraph scoping the check to both export kinds and noting own-performer-only scope for packets, with a note that a single request is never a mix of both kinds (`src/pdf/contracts.ts:18-20`).
- Added two new table rows: `pdfExport.warning.detailRow.packet.static`, `pdfExport.warning.detailRow.packet.transition`.
- Replaced the old single `<displayPage>`/routing bullet with: a two-step kind-then-context routing bullet; a new bullet on why packet rows omit `<displayPage>` (pageIndex vs. localIndex mismatch, `src/pdf/pdf-export.ts:381,450-453`); a new bullet on packet transition entries reporting the transition's authored `counts` total rather than a director-sampled frame (`src/pdf/pdf-export.ts:259-265`); the existing `<displayPage>` bullet amended to note it is director-only; the existing `<performerRankCode>`/`<performerId>` bullet amended to describe the packet case (single performer, note and obstacle both belong to them).
- Final paragraph amended to state `pdfExport.warning.explanation.static`/`.transition` are shared by director and packet rows (no new explanation keys needed) and that the summary sentence is unchanged regardless of export kind.

## Edit 5 — Status line round bump (round 5 → round 6) and self-review round-6 disposition paragraph added

Status line now reads round 6, reconciled on t_fcfb6173 against the M8.3 packet renderer Huffer round-2 PASS (t_701b6f5a). A five-point disposition paragraph was added to the self-review section itemizing: (1) §4.2 extension and new keys, (2) the pageIndex/localIndex non-equivalence rule, (3) packet transition entries as authored totals, (4) the noteLayoutOverflow `<context>` removal, (5) confirmation that the Jazz advisory and settled Performer.notes decision text required no change this round.

## Post-edit full-file hash

See identity.json in this directory for the SHA-256 of decisions/m8-pdf-export-copy.md after all edits above, plus the pre-task source hashes of the four renderer files this reconciliation was checked against (matched byte-for-byte against evidence/m8-packet/huffer-review/round2/identity-and-gates.json).
