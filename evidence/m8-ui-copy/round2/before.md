# M8 PDF export copy: labels, help, validation, and error strings

Status: copy contract for Kanban task `t_7dc45aee`, round 6, reconciled on `t_fcfb6173` against the M8.3 performer-packet renderer that landed after round 5 — independently verified by Huffer (`t_701b6f5a`, PASS, `evidence/m8-packet/huffer-review/round2/verdict.txt` + `identity-and-gates.json`). Authored by Arcee against the Huffer-approved design (`decisions/m8-pdf-export-design.md`, accepted `t_bf6d7829`) and the Huffer-approved cumulative Jazz accessibility/layout advisory (`t_3a182862` comments 286/289/292/295/298, accepted PASS WITH RESERVATIONS, comment300). Read-only against `src/` and `docs/freeform-mvp-spec-v1.md` §5. No runtime, schema, or dependency changes; no commit or push; no README written here.

Every string below is final text to integrate verbatim unless marked "placeholder pending J." `<angle brackets>` mark a runtime value to interpolate; everything else is literal, including punctuation and capitalization. Every label, help string, status, validation message, and warning has a stable `messageKey` so Wheeljack has one lookup table rather than string-matching prose. Nothing here adds a new field to `PdfExportResult` — the `messageKey: string` field the design already specifies (`decisions/m8-pdf-export-design.md:76`) is where every error-path key below lives; `code: PdfExportErrorCode` groups related keys, `messageKey` picks the exact sentence within that group.

Placeholders used throughout:

- `<filename>` — the resolved export filename (see §6).
- `<message>` — a developer-facing technical string (font name, byte offset, library error text). It never appears inside the primary sentence (see §3's privacy rule); it is available only in a separate, optional, explicitly labelled disclosure.
- `<count>` — the exact text of the offending token as the user typed it (not a coerced/re-formatted integer) for `transitionCountMalformed`, `transitionCountDecimal`, and `transitionCountNegative`, since those three cases are, by definition, not confirmed to be a valid integer; for `transitionCountOutOfDomain` and `transitionCountDuplicate`, `<count>` is the token's parsed integer value (leading zeros stripped, e.g. "08" displays as "8"), since those two cases have already passed the integer grammar below and a normalized number reads better than raw text with leading zeros.
- `<id>` — a document-stable identifier already present in the document (performer `id`, annotation `id`, set `id`, transition `id`). These are not secrets and not server-generated session tokens; they are the same identifiers the document already stores and the selector functions already key off. They are shown alongside a friendly label, never as a replacement for one.
- `<displayPage>`, `<setName>`, `<fromSetName>`, `<toSetName>`, `<transitionCount>` — the 1-based printed page number and the static-set/transition+count identity a warning row belongs to (§4.2); these are the same names and counts already shown elsewhere in the panel and on the page itself, not new identifiers. `<displayPage>` is used only in director detail rows, where it equals both the warning's own `pageIndex + 1` and the number the director footer prints on that page (director pages are not renumbered). It is never used in a performer-packet detail row: see §4.2 for why a packet warning's physical position in the flat exported file does not match the per-performer page number printed on it.
- `<bounds>` — the literal text of `pdfExport.warning.bounds`, itself built from `<noteBoundsRect>`/`<obstacleBoundsRect>`, each a `x, y, w, h` PDF-point rectangle taken from the design's own rounded overlap-bounds output (§4.2).

---

## 0. What this document does not decide

One product question remains open above the copy layer; this document writes copy that is correct regardless of how it resolves:

1. **Selected font and license/provenance.** The design (`decisions/m8-pdf-export-design.md:54,220`) leaves the embedded font unqualified. No copy below names a font or claims specific glyph coverage; §7's limitation text is written to stay true regardless of which font ships.

Performer.notes placement is settled: J decided (recorded on `t_673976d6`, 2026-10-03 12:22) that general `Performer.notes` appear once, near the top of each performer's packet, in the identity block, by name/rank — not repeated per page, not omitted. §4.3's packet identity block reflects this. Set/transition-scoped performer-note annotations remain separate and unaffected; they continue to appear at their scoped entries exactly as specified in §4.1-4.2.

---

## 1. Export panel: entry, labels, and structure

The panel is a keyboard-operable `<form>`. Engineering must adapt the existing control constructors (`radio()`, `select()`, `input()`, `submit()`, `labelFor()` from `src/editor/dot-editor.ts:575-626`), not import them unmodified: as written, `input()`/`radio()` set `aria-label` to the raw machine `value`/`id` argument (`dot-editor.ts:580,586`), which a screen reader announces instead of the visible `<label>` text from `labelFor()`. Every control below must have its accessible name set to the exact visible label text in this document, not the value used for `name`/`id`/`value`. This is a required correction to the helper's call sites for this feature, not a restatement of existing proven behavior.

Panel heading (`#export-panel-heading`, the dedicated focusable `h2`+`id`+`tabindex="-1"` the advisory requires as a focus-restoration fallback target for a redraw whose intended control is missing or disabled — see §2's non-field-error note for how this differs from the status node, distinct from the app's shell `h1`):

| Key | Text |
|---|---|
| `pdfExport.panel.heading` | **Export PDF** |
| `pdfExport.panel.invoke` | Export PDF… |

### 1.1 Export kind (fieldset legend + two radios)

| Key | Text |
|---|---|
| `pdfExport.kind.legend` | What do you want to export? |
| `pdfExport.kind.director.label` | Director pages |
| `pdfExport.kind.director.help` | One full-field page per set or transition count, for the person calling the show. |
| `pdfExport.kind.packet.label` | Performer packets |
| `pdfExport.kind.packet.help` | One booklet per performer, with their own coordinates and notes. |

### 1.2 Scope (fieldset legend + two radios + two selects)

| Key | Text |
|---|---|
| `pdfExport.scope.legend` | Which sets? |
| `pdfExport.scope.fullShow.label` | Full show |
| `pdfExport.scope.fullShow.help` | Every set in the show, in order. |
| `pdfExport.scope.range.label` | A range of sets |
| `pdfExport.scope.range.fromSet.label` | From set |
| `pdfExport.scope.range.toSet.label` | To set |
| `pdfExport.scope.range.help` | Includes both sets you choose, and every set between them. A transition is included only if both of its sets are in range. |

Set options in both selects are each set's existing display name, in document order; do not invent a secondary label scheme.

**Disabled-not-removed, corrected.** When **Full show** is selected, the two set selects are disabled but stay visible at their position in the DOM. This is not the same as "keeping their place in tab order": a disabled control is skipped by sequential (Tab) navigation entirely — that is native, unavoidable browser behavior, not a design choice — while remaining visible, labelled, and programmatically marked `aria-disabled`/`disabled` so a screen reader reports it as present but inactive rather than removing it from the page's structure. Their helper text is unchanged and stays visible too. Re-enabling (switching to **A range of sets**) returns them to the Tab sequence at the same position with no further announcement needed beyond the state change itself.

### 1.3 Transition frames (fieldset legend)

| Key | Text |
|---|---|
| `pdfExport.transitions.legend` | Include transition pages? |
| `pdfExport.transitions.intro` | Off by default. Turn on a transition below to also export a page for one or more exact counts during that move. |
| `pdfExport.transitions.packetDisabledHelp` | Transition pages aren't part of performer packets. |

This fieldset is **present for both export kinds**, matching the advisory's disabled-not-removed pattern rather than hiding packet-inapplicable controls: for **Performer packets**, every control in this fieldset is disabled and `pdfExport.transitions.packetDisabledHelp` replaces the intro text, instead of the fieldset being absent from the DOM. (Earlier round-1 text said this fieldset was "hidden/absent entirely for performer-packet export" — that contradicted the accepted advisory's retain/disable policy used everywhere else in this panel, e.g. §1.2's set selects; this section now matches it.)

For **Director pages**, each eligible transition (per the current scope selection) is one row:

| Key | Text |
|---|---|
| `pdfExport.transitions.row.label` | **<fromSetName> → <toSetName>** (checkbox label) |
| `pdfExport.transitions.row.countsLabel` | Counts |
| `pdfExport.transitions.row.countsPlaceholder` | e.g. 0, 8, 16 |
| `pdfExport.transitions.row.countsHelp` | Comma-separated whole numbers from 0 through <counts>. A checked transition needs at least one count; leave the checkbox unchecked to skip it entirely. |

Correction to the count-help wording: it must not say a blank field skips a *checked* transition (that contradicted §2's "Transition checked but its count field is blank" validation row, which is an error, not a silent skip). Skipping a transition means leaving its checkbox unchecked. A checked transition with a blank count field is always an error.

The checkbox and its count input are linked: the text input is disabled until its row's checkbox is checked, keeping it visible and inert per the same disabled-not-removed rule as §1.2, and leaving sequential navigation the same way a native `disabled` attribute always does.

### 1.4 Performer selection (fieldset legend + checklist; performer-packet export only)

| Key | Text |
|---|---|
| `pdfExport.performers.legend` | Which performers? |
| `pdfExport.performers.selectAll` | Select all |
| `pdfExport.performers.clearAll` | Clear all |
| `pdfExport.performers.row.label` | **<rankCode> — <displayName>** (checkbox label) |
| `pdfExport.performers.emptyState` | This show has no performers yet. Add performers before exporting packets. |

**Select all** / **Clear all** are convenience controls, non-binding: they only check/uncheck boxes already in the list and do not change the explicit-selection semantic contract the design requires.

`pdfExport.performers.emptyState` covers the case the §2 table's "no performers checked" row does not: a show with zero performers has no checkboxes to check in the first place. When the roster is empty, show this text in place of the checklist and disable the Export button for performer-packet export (the checklist being empty is not itself an error to surface in the live region; it is a static, visible condition in the fieldset).

### 1.5 Submit / close

| Key | Text |
|---|---|
| `pdfExport.submit.label` | Export |
| `pdfExport.close.label` | Close |
| `pdfExport.submit.busyLabel` | Generating… |
| `pdfExport.status.generating` | Generating your PDF. This can take a moment for a long show. |
| `pdfExport.close.generatingHelp` | Closing this panel doesn't stop an export already underway. Reopen it to download the file once it's ready. |

The secondary button is named **Close**, not **Cancel** — it closes the panel and does not stop generation already in progress (per the Jazz advisory's close-lifecycle policy, `t_3a182862` comment 292/295/298: close is not cancellation unless the adapter itself is actually cancelled, which it is not here). `pdfExport.close.generatingHelp` is shown near the Close button only while a request is in flight, so a user who closes mid-generation knows reopening will show the result rather than losing it. Reopening the panel while a closed-but-still-running request later resolves shows the matching §4.1 ready/error state immediately — it must never auto-dispatch a download on reopen.

---

## 2. Validation — labels, field association, and exact messages

Per spec §5 and the design's validation rules (`decisions/m8-pdf-export-design.md:88`), every validation failure happens before a PDF is created, is associated with its specific control via `aria-describedby`/`aria-invalid` (per the Jazz advisory), and never implies the open document changed — because it hasn't; validation runs on a frozen export request, not the working document.

`messageKey` below is the literal value of the `PdfExportResult`'s `messageKey` field when `code: 'validation-failed'`; it is the only sub-reason-routing mechanism this contract needs, because the design's result shape already carries a free-form `messageKey: string` — Wheeljack switches on that string directly rather than inventing an additional field.

| Condition | messageKey | Associated control | Message |
|---|---|---|---|
| No performers checked (performer-packet export, roster non-empty) | `pdfExport.error.validation.noPerformersSelected` | The performer checklist's first checkbox | "Choose at least one performer." |
| Duplicate performer somehow selected twice (defensive) | `pdfExport.error.validation.duplicatePerformerSelected` | Performer checklist | "Each performer can only be selected once." |
| Unknown performer ID in the request (defensive) | `pdfExport.error.validation.unknownPerformer` | Performer checklist | "One of the selected performers is no longer in this show." |
| Range selected but "From set" / "To set" not chosen | `pdfExport.error.validation.rangeNotChosen` | The empty select | "Choose a set." |
| "From set" is later in the show than "To set" (reversed range) | `pdfExport.error.validation.rangeReversed` | The "To set" select | "This set comes before the one you chose as \"From set.\" Choose a later set, or switch the order." |
| Unknown set ID (defensive — e.g. a set was deleted in another tab) | `pdfExport.error.validation.unknownSet` | The affected select | "This set is no longer in the show. Choose another." |
| Unknown transition ID in the request (defensive) | `pdfExport.error.validation.unknownTransition` | That transition's checkbox, or the transitions fieldset if the transition's row no longer renders | "This transition is no longer in the show." |
| The same transition requested twice, whether or not the counts match (defensive) | `pdfExport.error.validation.duplicateTransitionRequest` | That transition's checkbox | "This transition was selected more than once. Remove the duplicate." |
| Transition checked but its count field is blank | `pdfExport.error.validation.transitionCountBlank` | That transition's count input | "Enter at least one count, or turn this transition off." |
| A token in the count field is not a plain whole number at all (letters, stray punctuation, empty token from a doubled/trailing/leading comma, a sign other than a single leading "-", more than one "." or "-") | `pdfExport.error.validation.transitionCountMalformed` | That transition's count input | "Use whole numbers separated by commas, like 0, 8, 16." |
| A token is a number but written with a decimal point (e.g. "1.5") | `pdfExport.error.validation.transitionCountDecimal` | That transition's count input | "<count> isn't a whole number. Counts can't have a decimal point." |
| A token is a negative whole number (a single leading "-" followed only by digits, e.g. "-1") | `pdfExport.error.validation.transitionCountNegative` | That transition's count input | "<count> can't be negative. Counts start at 0." |
| A token is a non-negative whole number but greater than the transition's total counts | `pdfExport.error.validation.transitionCountOutOfDomain` | That transition's count input | "<count> isn't a valid count for this transition. Use a whole number from 0 through <counts>." |
| A non-negative in-domain whole number repeats an earlier token in the same field (e.g. "8, 8, 16") | `pdfExport.error.validation.transitionCountDuplicate` | That transition's count input | "<count> is listed more than once. Remove the duplicate." |
| A checked transition's two endpoint sets aren't both inside the selected range | `pdfExport.error.validation.transitionOutsideRange` | That transition's checkbox | "This transition isn't fully inside the sets you chose, so it can't be included." |

**Blank field is checked before any splitting happens, and only for a checked transition.** If the transition's checkbox is checked and the raw field text is empty or contains only whitespace, the row is `transitionCountBlank` and none of the token rules below ever run — an empty string split on commas would otherwise produce one empty token that could be mistaken for a malformed token, so blank is decided first, on the raw string, not post-split. If the checkbox is unchecked, the field's text (blank or not) is never read or validated at all; it is ignored exactly as if the row did not exist.

**Count-field predicate is disjoint by construction, not by guesswork.** Once the blank check above has passed (checkbox checked, field non-blank), split the raw field text on commas and trim whitespace from each token. Classify the *first failing token, left to right*, by testing these rules **in this exact order** and stopping at the first match — a token can only ever match one rule, so no count value, including boundary cases like `-1`, `.`, `-`, `-.`, or a signed decimal like `-1.5`, can satisfy two rows at once:

1. **Malformed** (`transitionCountMalformed`) if any of the following is true: the token is empty (e.g. a doubled or trailing/leading comma); it contains any character other than ASCII digits, `-`, or `.`; it contains more than one `-`; it contains more than one `.`; a `-` appears anywhere other than as the token's first character (so an embedded sign like `1-2` is malformed, not negative); or — the digit-presence test — the token contains **no ASCII digit at all**. That last clause is what correctly catches `.`, `-`, `-.`, and `--`: none of those contain a digit, so none of them can be classified as a decimal or a negative number no matter how permissive the character set looks. A token only reaches rule 2 or 3 below if it contains at least one digit.
2. **Decimal** (`transitionCountDecimal`) if the token contains a `.` (it already passed rule 1, so it is a clean run of digits — with an optional single leading `-` — around exactly one `.`, and it has at least one digit somewhere; `1.5` and `-1.5` both land here, before rule 3 ever sees the leading `-`).
3. **Negative** (`transitionCountNegative`) if the token starts with `-` (it already passed rules 1–2, so it has no `.` and is a leading `-` followed only by digits, e.g. `-1`, `-08`).
4. **Out of domain** (`transitionCountOutOfDomain`) if the token parses as a non-negative integer greater than the transition's `counts`.
5. **Duplicate** (`transitionCountDuplicate`) if the token parses as a non-negative in-domain integer that already appeared earlier in this same field (string-equal after trimming leading zeros, so "08" and "8" count as the same token).
6. Otherwise the token is valid.

Report only the first failing token's row; do not enumerate every bad token in one message. This is why `-1` is `transitionCountNegative`, never `transitionCountMalformed` or `transitionCountOutOfDomain` (rule 3 claims it first), and why `.`, `-`, and `-.` are all `transitionCountMalformed`, never `transitionCountDecimal` or `transitionCountNegative` — the digit-presence clause in rule 1 claims all three before rule 2 or 3 is ever reached, because none of them actually names a number.

All rows above are pre-submission, client-shaped checks that mirror the frozen-snapshot validation the adapter performs. If the adapter itself rejects the same request after submit (e.g. a race where the document changed between opening the panel and submitting), route the returned `messageKey` to the matching row above rather than a generic "something went wrong" — the table above is keyed by the exact string the adapter is expected to return, not by a UI-only guess.

**Non-field errors use the persistent status node, not the panel heading — and only when it is safe to take focus.** Not every failure has a specific control to attach to (document-level and font/writer/download failures in §3 below, plus a reopened panel whose result is now an error). For those there is no `aria-describedby` target. Two distinct mechanisms apply, and they must not be merged; both are lifecycle-gated, not unconditional:

- **Error focus (this card's concern).** The export panel has one persistent, always-rendered status node (`#pdf-export-status`, `role="status"`, `aria-live="polite"`, `tabindex="-1"` — the same node described in §5, not a new one).
- **Heading fallback (a different, narrower mechanism, unchanged from the advisory).** The panel heading (`#export-panel-heading`, `tabindex="-1"`) is reserved exclusively for the Jazz advisory's redraw/rebuild branch (`t_3a182862` comment 298, branch 3): the panel is open, focus was already captured inside it, and the specific control that focus belongs on after a shell rebuild is missing or disabled. That branch is about *where to put focus back after a DOM rebuild*, not about announcing an error.

Both mechanisms obey the same no-steal lifecycle rule the advisory already established for everything else in this panel (`t_3a182862` comments 289/295/298): an async result arriving after the user has moved on must never yank focus away from whatever they are doing now. The state table below is exhaustive — every combination not listed updates `#pdf-export-status`'s *text* (so the information is never lost; a sighted user glancing back at the panel still sees it) but never calls `.focus()`:

| State when a result/redraw event arrives | Panel open/closed | User's current focus | Action |
|---|---|---|---|
| New §3 error (first submission) | Open | Inside the panel (anywhere) | Update `#pdf-export-status` text, then move focus to it. |
| New §3 error (first submission) | Open | Outside the panel (user already tabbed/clicked away, or is mid-edit in the field editor) | Update `#pdf-export-status` text only. Do not call `.focus()`. The status node's `aria-live="polite"` region still announces the text to a screen-reader user without stealing their keyboard position, same as any other polite live region. |
| In-flight request resolves to a §3 error while the panel is **closed** | Closed | n/a | Retain the error result and update the node's text for whenever the panel next opens. Zero focus calls, no auto-open, no auto-dispatch of anything. This is the same "closed means hands off" rule as the advisory's own close-lifecycle branch (`t_3a182862` comment 295). |
| Panel is **reopened** and its retained result is the §3 error from the row above | Just transitioned closed → open | n/a (this is the open action itself) | Update `#pdf-export-status` text and move focus to it — this is the one case where focus moves on reopen, because reopening is itself a deliberate user action requesting the panel's current state, not an unrelated async arrival. |
| A stale result arrives for a request the user has already superseded (e.g. they resubmitted before the first request's promise settled) | Any | n/a | No-op entirely: no text update, no focus call. Only the most recent request's result may ever reach the status node or focus. |
| Redraw/rebuild event (shell structure changes under an open panel) and the control focus was on is still present and enabled | Open | Inside the panel | Restore focus to that same control. Not a §3 error path at all. |
| Redraw/rebuild event and the control focus was on is now missing or disabled | Open | Inside the panel | Move focus to `#export-panel-heading` (the heading-fallback branch — never `#pdf-export-status` for this case, since no error occurred). |
| Redraw/rebuild event | Closed, or focus already outside the panel | n/a | No panel focus call at all — same no-steal rule as the advisory's outside-focus branches elsewhere. |

Ready-action-before-warnings precedence (§4.1) is unaffected by this table: when both a ready-to-download state and a warnings summary are present, the ready button is the priority focus target within whichever "move focus" row above applies — this table governs *whether and where* focus moves, §4.1 governs which element within the panel wins once it does.

This separation resolves what the two mechanisms are for: a new or retained error gets the status node, but only while it's safe to take focus; a redraw with a missing restoration target gets the heading, also only while it's safe to take focus; and nothing here ever overrides the user's own current focus location.

---

## 3. PdfExportErrorCode → messageKey → exact text

This is the stable key contract the design asks for (`decisions/m8-pdf-export-design.md:76`: `{ ok: false; code: PdfExportErrorCode; messageKey: string; detail: readonly string[] }`). `messageKey` is the lookup key Wheeljack binds to the exact string below; `detail` entries are technical, developer-facing strings (library error text, byte offsets) that may appear in logs or behind a separate, explicitly labelled "technical details" disclosure that the user must choose to open. They never replace the sentence below and never appear interpolated inside it — see the privacy rule below the table.

Every row ends with the same closing clause for a reason: validation, document, font, PDF-writer, and download failures all leave the command-store document, its revision/history/undo/redo state, dirty/saved indicator, IndexedDB, explicit file handle, version history, and backup schedule byte-for-byte unchanged (`decisions/m8-pdf-export-design.md:100`). That is a factual guarantee from the design, not reassurance copy layered on afterward.

| `PdfExportErrorCode` | `messageKey` | Exact text | Retry guidance |
|---|---|---|---|
| `validation-failed` | (one of §2's `pdfExport.error.validation.*` keys) | (Field-associated per §2; no standalone banner text.) | n/a — routes to §2 |
| `document-invalid` | `pdfExport.error.documentInvalid.schema` | "This show's data couldn't be read for export. Your document is unchanged. Try to save or download your current work first. Only reload this page once you've confirmed that save or download actually completed — if it fails, if you cancel it, or if you're not sure it finished, stay on this page instead; reloading can wait, and a reload with no confirmed saved or downloaded copy risks losing unsaved edits. Version History's \"Restore this version\" replaces your current working document and warns that anything not saved or backed up will be lost — use it only once you've confirmed your current work is safely saved or downloaded first." | Yes — save first (conditionally), confirm it, only then consider Restore |
| `document-invalid` | `pdfExport.error.documentInvalid.ftl` | "One of this show's follow-the-leader transitions has mismatched data and can't be exported. Your document is unchanged. Check that transition's follower assignments in the editor, then export again." | Yes — fix the transition, then retry |
| `note-layout-overflow` | `pdfExport.error.noteLayoutOverflow` | "A note is too long to lay out in the exported PDF. Your document is unchanged. Try shortening your performer notes or on-field notes, then export again." | Yes — edit the note |
| `unsupported-glyph` | `pdfExport.error.unsupportedGlyph` | "This show uses a character that can't be drawn in the exported PDF. Your document is unchanged. Try removing or replacing that character in the note or label, then export again." | Yes — edit the offending text |
| `font-load-failed` | `pdfExport.error.fontLoad` | "Freeform couldn't load the font needed to build this PDF. Your document is unchanged. Try again — if this keeps happening, save or download your work first. Only reload the page once you've confirmed that save or download actually completed; if it fails, if you cancel it, or if you're not sure it finished, stay on this page instead." | Yes — retry, then confirm a save before reloading |
| `writer-failed` | `pdfExport.error.writerFailed` | "Freeform ran into a problem building this PDF. Your document is unchanged. Try again with a smaller range or fewer performers — if that doesn't help, try again later." | Yes — narrow the request, then retry |
| `blob-unavailable` | `pdfExport.error.blobUnavailable` | "This browser can't prepare a PDF for download right now. Your document is unchanged. Try a different browser or window." | Yes — environment-level |
| `url-unavailable` | `pdfExport.error.urlUnavailable` | "Freeform built your PDF but this browser couldn't start the download from it. Your document is unchanged. Try a different browser or window." | Yes — environment-level |
| `download-dispatch-failed` | `pdfExport.error.downloadFailed` | "Freeform built your PDF but couldn't start the download. Your document is unchanged. Check your browser's download settings and try again." | Yes |
| `cancelled` | `pdfExport.error.cancelled` | No error dialog. A quiet, auto-dismissing status line: "Export cancelled." | n/a — not a failure to recover from |

**Privacy and detail separation.** The sentence in the "Exact text" column is always shown exactly as written — never with a library's `<message>` text spliced into it. If `detail` is non-empty, show it only behind a separate, collapsed control labelled with the fixed key `pdfExport.error.detailsDisclosure` ("Technical details"), placed after the primary sentence, never merged into it.

Detail content is **allowlisted, not blocklisted**: "scrub anything that looks like a secret" is not an implementable rule, because there is no complete test for what a secret looks like. Instead, only ever populate `detail` from these specific, pre-approved sources, and nothing else:

- The literal `PdfExportErrorCode` string (e.g. `font-load-failed`).
- A font asset's registered name/identifier from the application's own shipped font manifest (never a filesystem path to that asset).
- An annotation, performer, set, or transition `id` already permitted as a technical identifier elsewhere in this document (§4.2, Placeholders).
- A byte offset or page/count number produced by the adapter's own structured manifest fields.
- A fixed, pre-written short reason string that this document or a future Arcee revision explicitly authors for a specific failure mode (e.g. "glyph not present in embedded font subset").

Never populate `detail` from a caught exception's `.message`, `.stack`, a filesystem path, a URL, or any other arbitrary library/runtime string — those are dropped entirely, by default, with no attempt to redact them, because an unreviewed string cannot be safely partially shown. The same allowlist applies anywhere these details might be written to a console/log, not only the UI disclosure: an engineering log statement gets the same allowlisted fields, never a raw caught-error object. If no allowlisted field applies to a given failure, `detail` is empty and the disclosure control does not render at all — an empty disclosure is worse than no disclosure. The primary sentence above must read correctly and completely with the disclosure absent.

Removed from round 1: `blob-unavailable`'s text no longer diagnoses "restricted/private window with storage disabled" — that is speculation the UI cannot verify (a `Blob`/`URL` failure doesn't tell you *why*), and a wrong diagnosis is worse than none. It now gives the one thing that's actually actionable: try a different browser or window.

**Removed in this revision: `noteLayoutOverflow`'s `<context>` placeholder named a location the adapter never returns.** `NoteLayoutOverflowError` (`src/pdf/pdf-export.ts:344`) is a bare marker class, thrown with no constructor argument at every call site that can raise it (`src/pdf/pdf-export.ts:404`'s packet-identity overflow check, and `wrappedLines`'s default-overflow throw at `src/pdf/pdf-export.ts:780`, used for both packet identity/entry note wrapping and director note wrapping); its catch site (`src/pdf/pdf-export.ts:172-174`) calls `failure('note-layout-overflow', 'pdfExport.error.noteLayoutOverflow')` with no `detail` argument, so `detail` is the frozen empty array `failure()` defaults to (`src/pdf/pdf-export.ts:968-970`). There is no annotation ID, performer ID, or context object attached anywhere on this path — not even in a form that could be allowlisted per §3's disclosure rule. A prior revision's `<context>` placeholder was therefore never bound to real data by the adapter; this document does not define what interpolates it because nothing does. The corrected text names the failure without inventing a location. If a future revision of the renderer threads structured identification through this error (the same way `NoteOverlapWarning` already carries `annotationId`/`performerId`/`context`), this row can regain a location clause — gated the same way §7's selectable-text claim is gated on its own qualification test actually passing, not assumed in advance.

**No-reload/no-restore-without-confirmed-preservation safeguard, and why it applies to `document-invalid.schema` specifically.** `src/persistence/freeform-file.ts:32-34,81-87` validates the document's shape before encoding it; `src/persistence/save-adapter.ts:47-51` returns an `encode-failed` result before any write happens if that validation fails. That means the exact condition that produces `document-invalid` (malformed document data) can *also* make the ordinary Save/download path fail for the same document — "save first" is not a safe unconditional instruction if save itself can refuse the same data for the same reason. A completed dispatch is also not confirmed preservation on its own: `save-adapter.ts:75-77` and `:93` ("Started downloading") report that a save or download *started*, not that it reached disk — see §4.1. So both `documentInvalid.schema` and `fontLoad` above require the user to actually confirm the save or download completed (not merely attempt it) before reloading is reasonable; if it fails, is cancelled, or completion is uncertain, the copy explicitly tells the user to stay on the page rather than reload, because a reload with no confirmed preserved copy risks losing in-memory edits with no backup to fall back on. Neither row promises that a save attempt will succeed, and neither row names a raw-backup or auto-recovery facility that does not exist in this codebase — "stay on this page" is the entire safeguard: it costs nothing and loses nothing, which a reload cannot promise.

The schema row's Version History reference is written against the actual control, not an invented one: `src/persistence/persistence-ui.ts:581,589-592` shows the only action available is a button literally labelled "Restore this version," which opens a confirmation dialog ("Restore this version?") that itself states "Anything in your current document that isn't saved or backed up yet will be lost" before replacing the current working document. There is no "open a copy" or side-by-side-compare action in this codebase — round 3's phrasing invented one. The copy therefore names the real control ("Restore this version") and its real effect (replaces current working document; the existing confirmation dialog already warns about unsaved loss) and makes the gate explicit at the Arcee-copy level too: only reach for Restore once the user has confirmed their current work is saved or downloaded, not as a casual alternative to saving. This still relies on Wheeljack's existing confirmation dialog doing its job; this document does not add a second dialog, it only says when the user should press through it.

**Unavailable-URL vs. blob-unavailable.** These are kept as two distinct codes/keys because they are two distinct points of failure (`src/persistence/save-adapter.ts:84-97`'s `browserDownload` pattern, adapted for PDF bytes): a `Blob` constructor failure happens before any object URL exists (`blob-unavailable`), while a `URL.createObjectURL` failure happens after the PDF bytes and `Blob` already exist (`url-unavailable`) — the second case can honestly say "Freeform built your PDF," the first cannot.

**Cancel, unchanged from the design's boundary** (`decisions/m8-pdf-export-design.md:99`): "Cancel" has exactly one honest meaning — the user dismissed a native picker that gives a real completion signal (an `AbortError`-style rejection, the same shape `save-adapter.ts:67,117`'s `isAbort()` already detects for `.freeform` saves) after bytes were ready. If the PDF download instead uses an invisible-anchor `click()` dispatch like `browserDownload` (`save-adapter.ts:84-97`), there is no such signal at all — clicking an anchor never tells the page whether the browser's own save dialog was then accepted or dismissed. In that case, `cancelled` is not reachable and must not be invented: an anchor-dispatch path that doesn't throw is `download-dispatch-failed` only if the dispatch itself throws, and otherwise proceeds to §4.1's ready/download-started text. Do not guess a cancel you cannot detect.

---

## 4. Success and the overlap warning

### 4.1 Success / download-ready

Two distinct moments, matching the design's async-generation and gesture-expiry handling (`decisions/m8-pdf-export-design.md:161`):

| Key | Text |
|---|---|
| `pdfExport.status.downloadStarted` | Started downloading <filename>. |
| `pdfExport.status.ready` | Your PDF is ready. |
| `pdfExport.action.download` | Download <filename> |

- **Direct dispatch succeeded** (the same user gesture started the download): `pdfExport.status.downloadStarted`. This reports that the browser's download was *started*, not that it finished, was saved to disk, or was accepted by the user — `browserDownload`'s `anchor.click()` (`save-adapter.ts:93`) proves dispatch, nothing past it. Do not write "Downloaded" as if completion were observed.
- **Generation outlived the triggering gesture** (browser now requires a fresh click to start the download), **or the panel was closed while generating and is now reopened with a result waiting**: `pdfExport.status.ready`, plus an explicit, keyboard-operable **Download <filename>** button. This is the priority focus target over the warnings summary when both are present (advisory round 3 correction, `t_3a182862` comment 298: fallback first, actionable before informational). "Ready" means bytes exist, not that dispatch has occurred.

Do not invent a third state implying guaranteed completed delivery before either of the above is actually true. A spinner or "Generating…" status (§1.5) is the only state allowed before one of these two resolves.

### 4.2 Overlap warning (director and performer-packet export)

Per the design (`decisions/m8-pdf-export-design.md:142-153`) and spec §5, the overlap check is bounds intersection only, is advisory, never blocks or auto-moves anything, and the export completes regardless. This applies to both export kinds: director rendering computes it against every performer's dot/rank-label on each director page (`src/pdf/pdf-export.ts:611` area), and performer-packet rendering computes it too, scoped to each performer's own packet (`drawPacketEntry`, `src/pdf/pdf-export.ts:480-519`) — a packet note can only be flagged against that same performer's own dot or rank label on that same entry, never against another performer's mark, because a packet has no visibility into anyone else's position. A single export request is always one kind or the other (`PdfExportRequest`, `src/pdf/contracts.ts:18-20`), so a given export's warnings are never a mix of director and packet rows.

| Key | Text |
|---|---|
| `pdfExport.warning.summary` | <count> possible overlaps in this export |
| `pdfExport.warning.detailRow.static` | ⚠ Page <displayPage>, Set <setName>: a note (<annotationLabel>, id <annotationId>) near <performerRankCode> may overlap <obstacleKind> for <performerRankCode> (id <performerId>). Bounds: <bounds>. |
| `pdfExport.warning.detailRow.transition` | ⚠ Page <displayPage>, <fromSetName> → <toSetName>, count <transitionCount>: a note (<annotationLabel>, id <annotationId>) near <performerRankCode> may overlap <obstacleKind> for <performerRankCode> (id <performerId>). Bounds: <bounds>. |
| `pdfExport.warning.detailRow.packet.static` | ⚠ <performerRankCode> (id <performerId>) packet, Set <setName>: a note (<annotationLabel>, id <annotationId>) may overlap <obstacleKind> on this performer's own entry. Bounds: <bounds>. |
| `pdfExport.warning.detailRow.packet.transition` | ⚠ <performerRankCode> (id <performerId>) packet, <fromSetName> → <toSetName>, count <transitionCount>: a note (<annotationLabel>, id <annotationId>) may overlap <obstacleKind> on this performer's own entry. Bounds: <bounds>. |
| `pdfExport.warning.bounds` | note <noteBoundsRect>; <obstacleKind> <obstacleBoundsRect> |
| `pdfExport.warning.explanation.static` | Freeform found possible overlaps between note text and dots or labels on these pages. It doesn't move anything automatically. Open <setName> in the editor, move the note, and export again to check it. |
| `pdfExport.warning.explanation.transition` | Freeform found possible overlaps between note text and dots or labels on these pages. It doesn't move anything automatically. Open the transition <fromSetName> → <toSetName> in the editor at count <transitionCount>, move the note, and export again to check it. |

Warning summary control (a `<details>`/`<summary>` pattern matching the existing collision-panel precedent in `src/timeline/timeline-panel.ts:300-324`), shown when `warnings.length > 0`. `<obstacleKind>` is "a dot" or "a rank label." Each row includes a text/icon marker (never color alone, per the advisory), both the document's own `id` fields and a friendly label (because friendly labels alone cannot uniquely identify the affected object), the static-set or transition+count context that produced the page (because "Page 3" alone does not tell the author which editor view to open to fix it), and the rounded bounds the design's overlap algorithm already reports (`decisions/m8-pdf-export-design.md:150`, rounded to 0.01 points for reporting) so a manual fix has a numeric target, not just a visual guess:

- **Which detail-row key applies is a two-step lookup, not a single discriminant.** First check the warning's own manifest page `kind` (`'director'` or `'performer-packet'`, `PdfManifestPage.kind`, `decisions/m8-pdf-export-design.md`'s manifest shape / `src/pdf/contracts.ts:47`): director pages route to `pdfExport.warning.detailRow.static`/`.transition`; performer-packet pages route to `pdfExport.warning.detailRow.packet.static`/`.packet.transition`. Only after that, within either branch, check the warning's `context.kind` (`'static-set'` or `'active-transition'`, `decisions/m8-pdf-export-design.md:95,108-110`) to pick `.static` vs `.transition`. Do not infer either branch from the page number.
- **Performer-packet detail rows never include a page number, by design, not by omission.** A `NoteOverlapWarning`'s `pageIndex` (`src/pdf/contracts.ts:87`) is always this warning's position in the single flat, multi-performer PDF file — `manifestPages.length` at the moment the page was added (`src/pdf/pdf-export.ts:381`), counting every performer's prior pages. The number actually printed in that performer's own packet footer is a *different*, independently-counted value: `localIndex + 1` of `totalPages` (`src/pdf/pdf-export.ts:453`), which restarts at 1 for every performer by design (`src/pdf/pdf-export.ts:450-452`'s own comment: "independent performers' packets each number their own pages starting at 1, never a position within the flat multi-performer PDF page sequence"). Those two numbers only coincide by accident for the very first performer's very first page. Labeling a packet warning "Page <pageIndex + 1>" would show the reader a number that does not match what is printed on the page the warning is about, for every performer after the first. `pdfExport.warning.detailRow.packet.*` therefore identifies the affected page by performer (`<performerRankCode>`, `<performerId>`) and context (`<setName>`, or `<fromSetName>`/`<toSetName>`/`<transitionCount>`) instead — both already uniquely locate one page within that one performer's packet, since a performer has at most one entry per set or transition count.
- **Transition packet entries report the transition's full authored count list, not a director-style sampled frame.** A packet's transition entries are built from every set in the selected range's transitions directly (`src/pdf/pdf-export.ts:259-265`), with `context.count` set to the transition's own authored `counts` total — the comment at the call site is explicit: "Packet requests select transitions by scoped range, not a director-style sampled-count list. The entry's movement count is its authored total." `<transitionCount>` in a packet row is therefore always that authored total, never one of the specific per-count frames a director export may have been asked to render (§1.3); the two numbers can legitimately differ for the same transition in the same export when a director request also exists, and this document does not conflate them.
- `<displayPage>` is the page's 1-based position within this export's full page sequence (page 1 is the first page produced, matching the page numbers printed on the PDF itself, e.g. `pdfExport.warning.detailRow.*`'s page number is the same number the director footer shows on that page, not a 0-based array index). This placeholder is used only in `pdfExport.warning.detailRow.static`/`.transition` (director); see the point above for why it is absent from the `.packet.*` keys.
- `<annotationLabel>` is the annotation's own visible text when it has one (a label annotation's `text`, a performer-note annotation's `text`), or the literal word "note" when the annotation type has no display text of its own; `<annotationId>` is always shown alongside it, because two annotations can carry identical text, and a show-scoped label annotation has no `performerId` to disambiguate it by performer at all (`src/document/types.ts:93-97`). The `id` is not a secret — it is the same stable identifier `selectAnnotations` (`src/document/annotations.ts:75-109`) already keys off, shown here so the editor's "find this annotation" tooling (present or future) has something unambiguous to search for.
- `<performerRankCode>` and `<performerId>` are shown together for the same reason: rank codes are meant to be human-memorable, not guaranteed unique indefinitely, and the `id` gives a precise manual-correction target. In a director row both the note's nearby performer and the obstacle's owning performer are named this way (they can differ); in a packet row there is only one performer to name, since the note and its obstacle both belong to the packet's own performer.
- `<noteBoundsRect>` and `<obstacleBoundsRect>` are each `x <x>, y <y>, w <width>, h <height>` in PDF points, taken directly from the design's rounded `NoteBounds`/`ObstacleBounds` (`decisions/m8-pdf-export-design.md:148-150`); this is the one place a raw numeric/technical value belongs in the primary sentence rather than behind the §3 detail disclosure, because it is not a developer diagnostic, it is the actual correction target the explanation text asks the author to use.

Each matching `pdfExport.warning.explanation.*` variant names the same set or transition+count the row is about, so "open this and move the note" has a concrete place to open; it deliberately does not say "fix" or "resolve" as if the tool will do it — per the design, this is manual-correction-only. `pdfExport.warning.explanation.static`/`.transition` are shared by director and packet rows: the note being moved is the same document-level annotation either way, edited in the same editor view regardless of which export kind surfaced the warning, so there is no separate packet-specific explanation key to author. The summary (`pdfExport.warning.summary`) stays a single fixed sentence regardless of how many rows mix static and transition contexts underneath it, or whether they are director or packet rows.

### 4.3 Performer-notes placement in the packet (settled)

Packet identity block (first block of every performer's packet, printed once): rank code, display name, and (per J's settled placement decision, §0) the performer's `notes` field if non-empty, labeled plainly:

| Key | Text |
|---|---|
| `pdfExport.packet.notesLabel` | Notes: |

> **Notes:** <Performer.notes text>

This block prints once, near the top of the packet, regardless of how many sets or transitions the packet covers; it is not repeated per page. `pdfExport.packet.notesLabel` is reusable wherever it appears.

---

## 5. Live region / status association

One `#pdf-export-status` node, `role="status"` / `aria-live="polite"` / `tabindex="-1"`, inside the panel, matching the existing app pattern (`src/editor/svg-field-editor.ts:66-69`, `src/persistence/persistence-ui.ts:196`). Unlike `svg-field-editor.ts`'s always-present readout, this region should exist in the DOM from panel mount (a persistent node, not conditionally inserted during a shell rebuild the way `dot-editor.ts`'s message node is, per Huffer's round-1 source-pattern correction on the sibling advisory card). It carries exactly one of these texts at a time, replacing rather than appending. Focus for this node is governed entirely by §2's state table — only the open/inside and reopen-with-retained-error rows of that table move focus here; open/outside, closed, and stale-superseded never do. The panel heading (`#export-panel-heading`) is never the error-focus target — it is reserved for the advisory's redraw-fallback branch only.

- Idle (panel just opened, nothing submitted yet): no text / empty (do not force an announcement on open).
- Generating: `pdfExport.status.generating`.
- Download started (direct dispatch): `pdfExport.status.downloadStarted`.
- Ready (fallback button shown, including after a close/reopen cycle): `pdfExport.status.ready`.
- Cancelled: `pdfExport.error.cancelled` text ("Export cancelled.").
- Any §3 error: the exact §3 sentence for that `messageKey` (the live region is how a screen-reader user hears the same text sighted users see next to the dialog/banner — never a shorter "something failed" variant for the live region alone).

Field-level validation errors (§2) are associated with their control via `aria-describedby`, not announced through this shared region — the advisory's "no spam" requirement means a per-keystroke validation re-check must not re-announce the same message on every keystroke, only on blur/submit transitions.

---

## 6. Filename guidance

Pattern: `<show title>-<export kind>-<scope>.pdf`, following the existing `.freeform` filename convention's sanitization rules (strip characters invalid in filenames; `freeformFilename()` precedent, `src/persistence/save-adapter.ts:100-103`). Exact slug rules are Wheeljack's to implement against that existing helper; this document's requirement is only that the user-visible name is human-readable and never a raw UUID, timestamp-only name, or internal request hash. Examples for Wheeljack's reference, not literal required strings:

- `Friday Night Lights-director-full-show.pdf`
- `Friday Night Lights-performer-packets-set-3-to-set-7.pdf`

---

## 7. Honest limitations: selectable text and tagging

Per the design's accessibility/tagging boundary (`decisions/m8-pdf-export-design.md:58`), no copy anywhere in the app may claim the exported PDF is "accessible," "screen-reader friendly," or "tagged" until that is independently proven with a PDF accessibility checker. The same gate applies to the selectable/searchable-text claim: it is true only once the implementation card's own Unicode/selectable-text qualification test (`decisions/m8-pdf-export-design.md:56`, the verification matrix's "keyboard/accessibility/selectable text/tags where permitted" row) has actually passed against the shipped font and writer, not merely because the design intends text operators over rasterized output. This document is written for that post-qualification state; it must not be rendered anywhere in the running app before qualification evidence exists.

| Key | Text | When it may render |
|---|---|---|
| `pdfExport.help.limitation` | Exported PDFs have selectable, searchable text. They are not tagged, and have not been verified to work with screen readers — if that matters for your use, let us know. | Only after the selectable-text qualification test above has passed for the shipped build. |
| `pdfExport.help.limitation.unqualified` | Freeform is still verifying that exported PDFs have selectable, searchable text. They are not tagged, and have not been verified to work with screen readers — if that matters for your use, let us know. | Default/fallback: shown whenever the qualification test has not passed, or its status is unknown at render time. Never silently omit the limitation disclosure instead of showing this variant. |

If the implementation has no mechanism to know its own qualification status at render time, treat that as "qualification unknown" and always render `pdfExport.help.limitation.unqualified` — do not default to the stronger claim. Flipping to `pdfExport.help.limitation` is a one-line copy swap once Wheeljack/Huffer have the passing test result; it is not a decision this document is making now.

Round-1 correction, unchanged in this revision: the previous wording ("not currently verified as fully accessible") left out that the PDF is specifically untagged, which could read as "probably accessible, just not checked yet." Both variants above state the untagged condition directly rather than only the unverified-accessibility condition, since tagging is a structural property this design does not implement at all (`decisions/m8-pdf-export-design.md:58,221`), not merely an unproven one. Do not add "fully accessible" as an unqualified claim anywhere else (README included, out of scope for this card) until independent verification proves it one way or the other.

---

## 8. Keyboard help panel entry

New row for the existing help panel/tooltip table (`decisions/2026-10-01-m7.3-ui-copy-inventory.md` §9 is the precedent format; this is the one new row M8 adds):

| Key | Action | Shortcut shown | Help text |
|---|---|---|---|
| `pdfExport.help.keyboardRow` | Export PDF | (no dedicated shortcut; opened via its button) | "Opens a panel to export director pages or performer packets as a PDF. Doesn't change your saved file." |

---

## Self-review evidence

Read source anchors: `decisions/m8-pdf-export-design.md` (full); `docs/freeform-mvp-spec-v1.md:151-193`; `src/document/types.ts:1-153` (performer/annotation/transition shape, confirming `LabelAnnotation`/`PerformerNoteAnnotation` have no display-name field distinct from `text`, and `performerId` is optional per `AnnotationBase`); `src/persistence/save-adapter.ts:1-134` (full file — `browserDownload`'s anchor-click dispatch has no completion/cancel signal; `isAbort()`/`writeActiveHandle` shows the one place in this codebase an `AbortError`-shaped cancel signal actually exists, for the File System Access picker, not for anchor downloads); `src/editor/dot-editor.ts:555-627` (full helper block — confirms `input()`/`radio()` set `aria-label` to the machine value, not the `labelFor()` visible text); `src/timeline/timeline-panel.ts:300-325` (`<details>`/`<summary>` warning precedent); `src/editor/svg-field-editor.ts:60-99`, `src/persistence/persistence-ui.ts:180-209` (existing `role="status"`/`aria-live` conventions). Read the full cumulative Jazz advisory (`t_3a182862` comments 286, 289, 292, 295, 298) and all five of Huffer's review rounds on that card (comments 3, 6, 9, 12, 15) plus Huffer's PASS WITH RESERVATIONS (comment 300) and Huffer's round-1 FAIL on this card before writing this revision, so every required change maps to a specific cited finding rather than a guess at what was meant.

Read Optimus's standing correction on `t_7dc45aee` (2026-10-02 23:09) before writing §4.3 and §0.1: Performer.notes placement is explicitly flagged provisional, not approved.

Disposition of this round (round 6, `t_fcfb6173`): reconciling §4.2 against the M8.3 performer-packet renderer accepted by Huffer round 2 (`t_701b6f5a`, PASS, `evidence/m8-packet/huffer-review/round2/verdict.txt`, `identity-and-gates.json`) and fixing an unbound placeholder found while doing it.

1. **§4.2 extended from director-only to director-and-packet, with packet-specific keys.** `drawPacketEntry` (`src/pdf/pdf-export.ts:480-519`) pushes `NoteOverlapWarning`s for performer-packet pages exactly the way `renderDirectorPage` does for director pages — against that entry's own rendered dot and rank-label bounds (`src/pdf/pdf-export.ts:500-517`) — so the prior "(director export only)" heading and the absence of any packet routing were stale against source, not merely under-specified. New keys `pdfExport.warning.detailRow.packet.static`/`.packet.transition` identify a packet warning by performer rank+ID and the static-set/transition+count context, per this card's explicit scope. The existing `pdfExport.warning.explanation.static`/`.transition` keys are reused rather than duplicated, since the fix action (open the same annotation in the same editor) does not differ by export kind.
2. **Packet rows never carry `<displayPage>`.** A `NoteOverlapWarning.pageIndex` is always the warning's position in the flat, cross-performer PDF (`manifestPages.length` at push time, `src/pdf/pdf-export.ts:381`); the number a performer actually sees printed in their own packet is the independently-counted, per-performer-restarting `localIndex + 1` of `totalPages` (`src/pdf/pdf-export.ts:453`, with the renderer's own comment at `:450-452` confirming the restart-at-1 design). Equating the two for a packet row, as the director-only template would have done if naively extended, would print a page number on screen that does not match the number printed on the actual PDF page for any performer after the first. §4.2 now states this distinction as a named rule with file:line evidence rather than leaving it to be inferred.
3. **Packet transition entries documented as authored totals, not director frame samples.** `src/pdf/pdf-export.ts:259-265`'s packet-entry builder and its own comment confirm a packet's transition entries always report the transition's full authored `counts`, independent of whatever specific per-count frames a concurrent director request selects in §1.3. §4.2 now states this so `<transitionCount>` is never misread as "the frame the director picked" when it appears in a packet row.
4. **Removed the unbound `<context>` placeholder from `pdfExport.error.noteLayoutOverflow`.** `NoteLayoutOverflowError` (`src/pdf/pdf-export.ts:344`) is thrown with no payload at both its call sites (`:404`, and `wrappedLines`'s default throw at `:780`), and its catch site (`:172-174`) builds a zero-`detail` result via `failure()`'s own default (`:968-970`). The prior text's `<context>` placeholder was never bound to anything the adapter returns; §3 now says this plainly and names a location-free sentence instead of implying a specificity the result never carries. This is a factual correction, not a style change — the placeholder was undefined in §0 before this revision too.
5. **Jazz advisory and settled Performer.notes decision left untouched.** Checked §0's settled-decision text and §4.3 against this card's carried-forward decision text (J, `t_673976d6`, 2026-10-03 12:22) and the Jazz advisory comments cited throughout (286/289/292/295/298, comment300) — both already match verbatim what this card restates, so neither required a change. The Optimus download-ready/anchor-dispatch decision this card also restates was likewise already reflected in §1.5/§4.1 (Close-not-Cancel, `downloadStarted` vs `ready`, no auto-dispatch on reopen) before this round; it required no change either.

Disposition of Huffer's round-4 two required corrections (comment, 2026-10-03 00:16):

1. **Removed surviving unconditional error-focus sentence; §2's table is the single authority.** §5's old normative sentence ("every §3 non-field error ... additionally moves keyboard focus to this node") contradicted §2's own open/outside, closed, and stale-superseded no-steal rows. §5 now says focus for `#pdf-export-status` is governed entirely by §2's table, names which two rows move focus (open/inside, reopen-with-retained-error) and which three never do (open/outside, closed, stale-superseded), instead of restating a separate, broader claim that could be implemented in contradiction to the table.
2. **No-reload/no-restore-without-confirmed-preservation; real Version History control named.** The `document-invalid.schema` and `font-load-failed` rows now require the user to *confirm* save/download completed, not merely attempt it, before reloading — a non-failing anchor/picker dispatch (`save-adapter.ts:75-77,93`, "Started downloading") is explicitly named as not itself confirmed disk delivery. The schema row's history reference now names the actual control: `persistence-ui.ts:581,589-592`'s "Restore this version" button and its existing "Restore this version?" confirmation dialog (which already warns that unsaved/unbacked-up work will be lost) — there is no "open a copy"/compare action in this codebase, so round 3's phrasing is replaced rather than kept. The explanatory paragraph below the table was rewritten to match and cites the real file/line evidence for both points.

Disposition of Huffer's round-3 three required corrections (comment, 2026-10-03 00:04):

1. **Numeric-token grammar / digit-presence test.** §2's `<count>` placeholder definition (Placeholders, §0) now distinguishes the raw offending token (used for malformed/decimal/negative) from the parsed integer (used for out-of-domain/duplicate). The ordered predicate gained an explicit digit-presence clause in rule 1: a token with no ASCII digit at all (`.`, `-`, `-.`, `--`) is malformed, never decimal or negative, because rules 2 and 3 can now only be reached by a token already proven to contain a digit. A new blank-field paragraph runs before the split step, on the raw string, so an empty/whitespace-only checked field is `transitionCountBlank` directly rather than becoming a post-split empty token; an unchecked field's text is never read at all. Covers `.`, `-`, `-.`, `-1`, `-1.5`, `1.5`, `abc`, embedded `-` (`1-2`, malformed), `08`/`8` duplicate, checked/unchecked blank, `0`, and `N`.
2. **Lifecycle-gated status focus.** §2's non-field-error note is rewritten around an explicit nine-row state table (open/inside → focus; open/outside → text-only, no steal; closed → retain, zero focus calls; reopen-with-retained-error → focus, because reopening is itself the user's action; stale superseded result → no-op entirely; three redraw/rebuild rows unchanged from the advisory). "Whenever a non-field error becomes current" is gone; every row now names the panel's open/closed state and the user's current focus location before deciding whether `.focus()` is called, closing the closed/outside no-steal gap Huffer reproduced against a DOM model where the status node could take focus from an outside button.
3. **No-reload-if-preservation-fails, and confirmed-replacement history wording.** A new paragraph after the `document-invalid` row cites `freeform-file.ts:32-34,81-87` (validation before encoding) and `save-adapter.ts:47-51` (`encode-failed` returned before any write) to explain why "save first" cannot be an unconditional imperative: the same malformed data that triggers `document-invalid` can make Save/download fail too. Both `documentInvalid.schema` and `fontLoad` rows are now conditional ("try to… if that also fails, stay on this page rather than reload") instead of promising a backup will succeed, and the schema row says "open a copy from Version History to compare" rather than "restore," naming the non-destructive verb directly instead of relying on an unstated confirm dialog.

Disposition of Huffer's round-2 five required corrections (comment, 2026-10-02 23:53):

1. **Disjoint/complete count validation** — §2's count table now has five mutually exclusive rows (malformed, decimal, negative, out-of-domain, duplicate) plus a numbered, ordered predicate ("Count-field predicate is disjoint by construction") that fixes precedence so a value like `-1` can only ever match one rule (negative, tested before malformed/out-of-domain are reached); duplicate-transition-request now explicitly fires "whether or not the counts match."
2. **Status-node focus vs. heading fallback** — §2's "Non-field errors" note and §5 now name and separate two mechanisms: a persistent `#pdf-export-status` node (role=status, aria-live=polite, tabindex=-1) that receives focus for every §3 error and every reopened-with-error state, versus `#export-panel-heading`, reserved only for the Jazz advisory's redraw/rebuild-target-missing branch. §1's heading entry cross-references this split so the two targets can't be conflated.
3. **Warning context, page numbering, bounds, manual correction** — §4.2 now has separate static/transition detail-row and explanation keys, each naming the specific set or transition+count a warning belongs to; `<displayPage>` is defined as the 1-based printed page number; a new `pdfExport.warning.bounds` key surfaces the design's own rounded note/obstacle rectangles as the numeric manual-correction target.
4. **Allowlisted diagnostics, keyed disclosure label, unsaved-safe reload/history advice** — §3's privacy section replaces "scrub anything that looks like a secret" with a five-item allowlist (error code, font manifest name, already-permitted document IDs, manifest-derived offsets/counts, pre-written fixed reason strings) and a default-drop rule for anything else, applied to both the UI disclosure and logs; the disclosure control now has its own key (`pdfExport.error.detailsDisclosure`). The `document-invalid` (schema) row now tells the user to save/download first and explicitly not overwrite their current version via Version History, instead of recommending an immediate reload.
5. **Gated selectable-text claim** — §7 now has two keyed variants: `pdfExport.help.limitation` (post-qualification) and `pdfExport.help.limitation.unqualified` (default/fallback whenever the selectable-text qualification test hasn't passed or its status is unknown), with an explicit instruction never to default to the stronger claim.

Disposition of Huffer's round-1 six required changes (carried forward, unchanged by round 3 unless noted above): keyed completeness and routing; disabled-control/tab-order and naming; unprovable download/cancel claims; affected IDs in warnings (now also carries context/bounds per round 2 item 3); privacy/detail separation (tightened to an allowlist per round 2 item 4); honest limitation (now gated per round 2 item 5).

No `npm run test`/`npm run build` was run for this task — it authors copy only, touches no `src/` files, and the design/advisory's own verification already established the current test/build baseline (`decisions/m8-pdf-export-design.md:230-234`: 29 files / 241 tests passed, build succeeded, at the same HEAD this document is written against; Huffer's round-2 review independently reran `npm run test && npm run test:docs && npm run build && git diff --check` at this same HEAD with exit 0, 241 tests passing). Live repo state checked before writing this revision: `git rev-parse HEAD` = `3df1916315c43e7b4617bd037b62f76a3d0edc9a`, `git status --short` shows only the two pre-existing untracked decision files, `git diff --check` reports nothing tracked changed (exit 0).

Uncertainties and open items:

1. Exact filename slugging (§6) delegates to Wheeljack's implementation against the existing `freeformFilename()` precedent.
2. The font asset is unqualified; §7's limitation text is gated on the qualification test passing, with an explicit unqualified-default variant so it stays true before that.
3. Whether the implementation uses an anchor-click dispatch (`browserDownload` precedent, no cancel signal, `cancelled` code effectively unreachable) or a picker-style API (real `AbortError` signal, `cancelled` reachable) for the PDF download is an implementation choice this document does not make; §3's cancel row is written to be correct under either choice, but Wheeljack must not wire `cancelled` to fire from a dispatch mechanism that cannot actually detect it.
4. This document assumes the Jazz-advisory control structure (fieldsets, disabled-not-removed pattern, focus-restoration mechanics, Close-not-Cancel close semantics, the status-node/heading split in §2) ships as accepted; if Wheeljack's implementation deviates from that structure in a way that changes which control an error should associate with, the §2 "Associated control" column needs a matching update, not just the message text.
5. §4.2's exact visual order of friendly label vs. `id` vs. bounds within a warning row is left to Wheeljack/Jazz's rendering judgment; the requirement this document fixes is that all three appear with correct static/transition context, not their exact visual sequence.
6. The allowlist in §3 is deliberately conservative (five sources only); if a future failure mode needs a diagnostic value not on that list, it requires an explicit addition to the allowlist by Arcee, not an implementer exception at the call site.

Artifact absolute path: `/Users/jatiller/Sync/Dropbox_Replacement/AI_Projects/Freeform/decisions/m8-pdf-export-copy.md`
