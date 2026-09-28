# Research Note: American Football Field Dimensions for Freeform MVP

Status: Research complete, recommendation made. Product/UI design is out of scope for this note.
Researcher: Perceptor (research subagent), for Kanban task t_12800096.
Date compiled: 2026-09-28.

## 1. Executive answer

Recommend **NFHS (high-school) 11-player field geometry** as the single MVP football-field preset,
per the fixed decision in the parent card that the MVP supports exactly one football-field surface.
NFHS was chosen over NCAA/NFL because:

- Marching band and drill-writing software (Pyware, UDB — Freeform's stated inspirations) is written
  primarily for the education market, where NFHS is the field of record for the large majority of
  performance venues (school stadiums).
- NFHS geometry divides the field width into exact thirds (sideline–hash–hash–sideline all equal),
  which is the cleanest, most teachable reference geometry for the 8-to-5-step coordinate system
  Freeform already uses, and matches the historical basis of most drill-writing pedagogy.
- No authoritative source found during this research blocks the choice or shows NFHS geometry is
  ambiguous or contested; state associations may adopt local variations (see §5), which is a
  documented, expected, non-blocking caveat, not a conflict.

NCAA and NFL differ only in hash-mark spacing and goal-post width, not in overall field length or
width. Both are recommended as **deferred presets** (§4) — same normalization scheme, different
hash-inset constants — not merged into the MVP.

## 2. Source quality summary

| Source | Type | Authority | Used for |
|---|---|---|---|
| NFHS official field diagram PDF (2018 edition) | Primary | National Federation of State High School Associations — the rule-making body for NFHS football | 11-player, 9-player, 8/6-player field geometry |
| NFHS official field diagram PDF (2025 edition) | Primary | Same body, current edition | Confirms 2018 figures unchanged for 11-player field |
| Wikipedia, "American football field" | Secondary, high editorial quality, footnoted to rulebooks | General encyclopedic tertiary source | NFL/NCAA hash-mark history, line-width conventions, goalpost rules, cross-level comparison narrative |
| CoverSports.com, "High School Football Field Dimensions Guide" (2025-07-22) | Secondary, vendor/industry content | Field-marking equipment vendor; content is derivative of NFHS rules, not itself authoritative | Corroboration of NFHS numbers in prose/FAQ form, "how to measure" procedural detail |
| Markers, Inc. "College Football Field Dimensions" vendor diagram | Secondary, vendor diagram | Field-marking equipment vendor; explicitly a courtesy diagram, not an NCAA publication | Corroboration of NCAA hash inset (60′) and hash gap (40′), corroboration of overall 360′×160′ footprint |
| NCAA.org "Football Playing Rules" landing page | Primary site, but the actual NCAA rulebook PDF was not retrievable in this session (see §6, Unresolved) | NCAA | Confirms official rule book and field diagram exist and are NCAA-published; did not yield a fetchable PDF this session |
| NFL Football Operations site (operations.nfl.com) | Primary site, but individual rule pages returned crawl/fetch errors in this session | NFL | Not successfully retrieved this session; NFL figures below rely on Wikipedia's cited figures only |

All NFHS numbers below are grounded in the primary-source PDF (retrieved and rendered directly; text
layer was image-only, so figures were read by direct visual inspection of the vector diagram at high
resolution — see §7 for the exact retrieval/verification method). NCAA and NFL numbers rely on
secondary/tertiary corroboration only; I could not reach the NCAA or NFL primary rulebook PDFs this
session (both are behind JS-rendered or otherwise non-crawlable delivery — see §6). This is flagged
explicitly because NCAA/NFL are deferred presets, not the MVP, so the lower verification bar was an
acceptable scoping trade-off, but it should be upgraded before NCAA/NFL presets ship.

Retrieval date for all citations below: 2026-09-28.

## 3. NFHS 11-player field — primary geometry (MVP preset)

Source: NFHS "Football Field Diagram, 11-player Football Field," official diagram PDF.
- 2018 edition: https://assets.nfhs.org/umbraco/media/1019354/football_field_diagrams_2018.pdf
- 2025 edition (confirms unchanged): https://assets.nfhs.org/umbraco/media/4294825/2025_football_field_diagrams.pdf
Both retrieved and rendered to image at 250 DPI; figures below transcribed directly from the vector
diagram labels (both editions agree on every 11-player figure).

Overall footprint
- Total field length (end line to end line): 360 ft = 120 yd, printed as 68′4″ + 23′4″ + 68′4″... — see
  note below on how the diagram composes this dimension.
- Playing field (goal line to goal line): 300 ft = 100 yd.
- End zone depth: 30 ft = 10 yd, each end.
- Field width (sideline to sideline): 160 ft = 53⅓ yd.

Note on the 68′4″ / 23′4″ / 68′4″ top dimension: this is the diagram's *length-axis* label spanning
the end-line width, decomposed as [distance from sideline to near goal post upright] + [goal post
inside width] + [distance from far goal post upright to opposite sideline]. The 23′4″ segment is the
**goal post width** (uprights, inside-to-inside), matching Rule references elsewhere; it is not a
separate field-length dimension. Total end-line width (68′4″×2 + 23′4″) = 160′4″... this does not
reconcile exactly to the stated 160′ sideline width, which is expected: goal posts sit centered on
the end line but their base/upright placement is a superimposed annotation on the same drawing axis,
not a strict subdivision of the 160′ playing width. Treat the goal-post-width figure (23′4″) as
independent of the sideline-width figure (160′); do not sum them for field geometry. This is exactly
the kind of overlapping-annotation trap a technical spec must avoid — flagging explicitly per
acceptance criterion 2.

Hash marks (inbounds lines)
- Distance from each sideline to the near edge of the hash mark: **53 ft 4 in (53′4″)**.
- Because 160 ft ÷ 3 = 53.333 ft exactly, NFHS hash placement divides the field width into three
  exactly equal thirds: sideline → hash, hash → hash, hash → sideline are all 53′4″. This is a clean,
  reproducible geometric fact (not a rounded approximation) and is the basis for the "front hash /
  back hash" thirds referenced in the parent card's coordinate scheme.
- Hash tick marks run at 1-yard intervals between the 5-yard lines; both diagram editions show 2-yard
  intervals between labeled hash ticks along the hash line (each hash "dash" pair spans roughly
  the field's 1-yard grid — see the "3-yard line" callouts below for the standard hash-line
  reference marks used near each goal line).
- "3-yard line" markings appear near each end zone (short interior hash-line marks used for PAT/2-pt
  placement conventions); confirmed present on both NFHS 11-player diagrams but the exact offset from
  the goal line was not separately dimensioned on the diagram — treat as informational, not required
  for MVP geometry.

Yard lines
- Yard lines (5-yard intervals) span the full field width, goal line to goal line, at 5-yard spacing —
  standard "40-30-20-10" numbering pattern shown on both diagrams (each side numbers 10→50→10 mirrored
  from midfield, per standard convention; explicitly drawn on the diagram).
- Yard-number placement: **9 yards** from the sideline to the yard-line number (dimensioned directly
  on the 11-player diagram, "9 YDS." arrow). This differs from the NFL convention (12 yards from
  sideline per Wikipedia — see §4), which is a real, citable NFHS/NFL divergence worth flagging.

Corner / pylon detail
- Pylon: 4″×4″ cross-section, 18″ tall, placed at the intersection of the goal line and sideline
  (dimensioned directly on the diagram corner-detail inset).

Goal posts
- Upright inside width: **23 ft 4 in (23′4″)** — see composition note above; this is the NFHS-specific
  figure and is *wider* than NCAA/NFL (18′6″ — see §4).
- Crossbar height: not separately dimensioned on this diagram; NFHS Rule 1-2-3d (cited secondarily via
  CoverSports guide, not independently verified against the NFHS rulebook text this session) requires
  uprights to extend a minimum of 10 ft above the crossbar. Flagged as secondary-sourced, not primary.
- Diagram also shows "UPRIGHT AT LEAST 20′ HIGH" directly on the 11-player field diagram (primary,
  confirmed).

Restraining lines / team boxes (context only, not consumed by field geometry)
- A 30-ft setback and a "TEAM BOX" / "Restricted Area" band appear outside each sideline on the
  diagram. These are venue/sideline-management markings, not part of the playing-surface geometry a
  drill-writing tool needs to render performer positions, so they are noted for completeness but
  excluded from the normalized geometry in §7.

Line width — not independently confirmed from the NFHS diagram itself (the diagram dimensions pylons
and hash gaps but does not separately label a line-width figure on the 11-player page). Secondary
corroboration only: Wikipedia states yard-line tick marks are generally "2-foot (0.61 m) long, 4-inch
(0.10 m) wide," and a separate NCAA-focused vendor diagram (Markers, Inc.) explicitly labels
"ALL LINES 4″ WIDE." Treat 4-inch line width as a reasonable cross-level convention for rendering
purposes, but it is **not NFHS-primary-sourced** in this research pass — flagged per acceptance
criterion 1 (every numeric dimension should be tied to a citation; this one is secondary-only).

## 4. NCAA and NFL — deferred presets, differences summarized (not merged into MVP)

Overall footprint (length 360 ft / 120 yd total, 300 ft / 100 yd playing field, 160 ft / 53⅓ yd width,
30 ft / 10 yd end zones) is **identical** across NFHS, NCAA, and NFL. The differences that matter for
a drill-writing tool are hash-mark inset and goal-post width:

| Level | Hash inset from sideline | Hash-to-hash gap | Goal-post width (inside) | Yard-number inset from sideline | Source |
|---|---|---|---|---|---|
| NFHS (high school) | 53′4″ (160/3 ft, exact) | 53′4″ | 23′4″ | 9 yd | Primary: NFHS diagram PDF (§3) |
| NCAA (college) | 60′ (20 yd) | 40′ | 18′6″ | not confirmed this session | Secondary: Wikipedia; corroborated by Markers Inc. vendor diagram (60′ label present, though the vendor diagram's exact axis for that label was ambiguous on visual inspection and should be re-verified against the NCAA rulebook before NCAA preset ships) |
| NFL | 70′9″ (21.56 m) | ~18′6″ (in line with goal posts) | 18′6″ | 12 yd | Secondary only: Wikipedia; NFL primary rulebook PDF not retrievable this session (see §6) |

Notes:
- NCAA hash spacing of 40 ft (20 yd from each sideline) has been the standard since 1993; prior to
  that, NCAA used the same one-third-of-field-width hash spacing as NFHS still uses today (per
  Wikipedia's narrative history — secondary source, not independently verified against an NCAA archival
  rulebook this session).
- NFL hash marks have been 70′9″ from each sideline since 1972 (in line with the goal posts), per
  Wikipedia — secondary source only; not verified against the NFL rulebook this session.
- Goal-post width: NCAA and NFL share 18′6″; NFHS is wider at 23′4″. This is a real, citable
  cross-level divergence (Wikipedia, corroborated qualitatively by the visibly different goal-post
  width composition on the NFHS diagram vs. what Wikipedia states for NCAA/NFL). Not independently
  re-verified against an NCAA or NFL primary diagram this session.

**Recommendation for future work**: before implementing NCAA or NFL presets, re-run this research
against the actual current NCAA Football Rules Book and NFL Rulebook (Rule 1, "The Field") once a
reliable extraction path is found (see §6) — do not ship NCAA/NFL presets on Wikipedia-only sourcing.

## 5. Conflicts and reconciliation

1. **State-association variation (NFHS).** Both NFHS diagram editions carry the explicit note: "By
   state association adoption, the dimensions of the field may be altered." This is not a source
   conflict — it is an acknowledged, intentional local-variance allowance built into the NFHS rule
   itself. Recommendation: treat the figures in §3 as the *default* NFHS preset; do not attempt to
   model state-by-state variance in the MVP. Flag as a known, non-blocking limitation.

2. **Goal-post-width figure vs. end-line-width figure (NFHS diagram).** As detailed in §3, the
   68′4″ + 23′4″ + 68′4″ dimension line on the NFHS diagram is easy to misread as "160′ decomposed
   into three lateral field segments" (which would wrongly suggest goal posts split the field into the
   same thirds as the hash marks — they don't; the hash-mark thirds are a separate, coincidentally
   identical-looking geometric fact from §3). Reconciled by treating the two measurements as
   independent annotations on the same drawing, not related figures. This is the most likely
   transcription trap for anyone consuming this note without the original diagram in hand.

3. **NFL line width (6 ft) vs. general "4-inch line" convention.** Wikipedia notes NFL sidelines and
   end lines are specifically 6 ft wide (unusually wide, a boundary/rules feature, not a painted stripe
   width in the drafting sense) while "the lines may be narrower on fields used for multiple sports or
   by college or amateur teams." This is not a conflict with the 4-inch figure used elsewhere — the 6 ft
   NFL figure describes the out-of-bounds boundary itself (sideline as a zone), while the 4-inch figure
   describes painted yard-line/hash tick-mark stripe width. Different measurements, easily confused;
   flagged so the spec doesn't conflate them.

No other numeric conflicts were found between sources for the NFHS figures used in the MVP
recommendation.

## 6. Unresolved / not independently verified this session

- Could not fetch the NCAA Football Rules Book PDF or NFL Rulebook Rule 1 ("The Field") directly —
  both operations.nfl.com and ncaapublications.com pages returned crawl/fetch errors from the
  available extraction tooling, and this session's browser tool was blocked by a local Chromium-profile
  configuration issue (`browser.use_real_profile` requires a supported Chromium browser as OS default,
  which was not available), preventing interactive navigation as a fallback. NCAA/NFL figures above
  rely on Wikipedia's "American football field" article only. This should be closed out before an NCAA
  or NFL preset ships (see recommendation in §4).
- NFHS line width (4 in) is secondary-sourced only, not read directly off the NFHS diagram (see §3).
- NFHS crossbar height and Rule 1-2-3d text were not independently verified against NFHS's actual
  rules-book text (paywalled/membership-gated at nfhs.org — the rules book itself was not reachable
  without an account); relied on a vendor FAQ page (CoverSports) that cites the rule number.
- "3-yard line" marks near each goal line (visible on the NFHS diagram) were not separately dimensioned
  on the diagram and are not required for MVP geometry; flagged as informational only.

## 7. Normalized geometry for the MVP preset (NFHS 11-player)

Freeform's stated step convention: 8 steps = 5 yards (8-to-5), so **1 step = 22.5 inches** (15 ft / 8).
All figures below are derived arithmetically from the primary-sourced NFHS figures in §3; the
arithmetic itself is Perceptor's inference, not a directly-cited figure, and should be sanity-checked
by whoever implements the coordinate system.

Length axis (goal line to goal line, the 100-yard/300-ft playing field):
- 100 yd = 300 ft = 3600 in = 160 steps total, goal line to goal line.
- Each 5-yard line-to-line interval = 8 steps (by definition of the step convention).
- End zone depth = 10 yd = 30 ft = 16 steps, each end (beyond the goal line, if end zones are rendered).

Width axis (sideline to sideline, 53⅓ yd / 160 ft):
- Total width = 160 ft = 1920 in = 85.33 steps (85⅓ steps exactly).
- Sideline → front hash = 53′4″ = 640 in = 28.44 steps (28⅘ steps exactly, since 640/22.5 = 28.4444…).
- Front hash → back hash = 53′4″ = 640 in = 28.44 steps (identical to above — the field's width is
  divided into three exactly equal thirds by the NFHS hash marks, confirmed arithmetically:
  3 × 53′4″ = 160′0″ exactly).
- Back hash → sideline = 53′4″ = 640 in = 28.44 steps (same as above, symmetric).

This means: for NFHS, "distance from a sideline" and "distance from the corresponding hash" are
related by a clean 1:1:1 ratio across the three lateral zones — useful for validating any
coordinate-normalization code against a simple invariant (three equal thirds) rather than an
irregular fraction.

Reference-point definitions for the "closest front sideline / front hash / back hash / back sideline"
relationship named in the parent card:
- Front sideline = the sideline nearer Side 1 (director-left of the 50, per IDEA.md's Side 1/Side 2
  definition) — this note does not resolve which physical sideline is "front" for a given venue
  orientation; that is a product/UI decision explicitly out of scope here.
- Front hash = the hash line 28.44 steps from the front sideline.
- Back hash = the hash line 28.44 steps from the back sideline (equivalently, 56.89 steps from the
  front sideline, i.e., front-sideline-to-front-hash + front-hash-to-back-hash).
- Back sideline = 85.33 steps from the front sideline.

## 8. Recommended MVP preset (concise, spec-ready)

```
preset: NFHS_11_PLAYER  (default/MVP)
length_playing_field_ft: 300         # goal line to goal line (100 yd)
length_end_zone_ft: 30               # each end (10 yd)
width_total_ft: 160                  # 53 1/3 yd, sideline to sideline
hash_inset_from_sideline_ft: 53.333  # = 53'4", exact thirds of field width
hash_gap_ft: 53.333                  # front hash to back hash
goal_post_width_ft: 23.333           # 23'4", inside-to-inside
yard_line_interval_yd: 5
yard_number_inset_from_sideline_yd: 9
step_convention: "8 steps = 5 yards (22.5 in/step)"
step_total_width: 85.333
step_hash_inset: 28.444
line_width_in: 4          # SECONDARY-SOURCED ONLY, not NFHS-primary — verify before relying on it
source_confidence: HIGH for length/width/hash/goalpost figures (NFHS primary diagram);
                    MEDIUM for line width and crossbar height (secondary sources only)
```

Deferred presets (not implemented in MVP, do not merge into the above):
```
preset: NCAA_COLLEGE     (deferred — SOURCE CONFIDENCE: MEDIUM, Wikipedia + vendor diagram only)
hash_inset_from_sideline_ft: 60
hash_gap_ft: 40
goal_post_width_ft: 18.5

preset: NFL               (deferred — SOURCE CONFIDENCE: LOW, Wikipedia only, primary rulebook unreached)
hash_inset_from_sideline_ft: 70.75   # 70'9"
goal_post_width_ft: 18.5
yard_number_inset_from_sideline_yd: 12
```

## 9. Citations (all retrieved 2026-09-28)

1. NFHS. "Football Field Diagram — 11-Player Football Field" (2018 edition), official PDF.
   https://assets.nfhs.org/umbraco/media/1019354/football_field_diagrams_2018.pdf
2. NFHS. "Football Field Diagram — 11-Player Football Field" (2025 edition), official PDF.
   https://assets.nfhs.org/umbraco/media/4294825/2025_football_field_diagrams.pdf
3. Wikipedia. "American football field." https://en.wikipedia.org/wiki/American_football_field
   (accessed 2026-09-28; article text is footnoted to NFL/NCAA rulebooks in its own reference list,
   used here as a secondary/tertiary corroborating source, not primary).
4. CoverSports. "High School Football Field Dimensions Guide," published 2025-07-22.
   https://coversports.com/resources/field-guides/high-school-football-field-dimensions-guide
   (secondary, vendor content).
5. Markers, Inc. "College Football Field Dimensions" (vendor diagram, undated).
   https://www.markersinc.com/athletic/football-field-dimensions.pdf (secondary, vendor diagram;
   explicitly labeled a courtesy diagram, not an NCAA publication).
6. NCAA.org. "NCAA Football Playing Rules" landing page.
   https://www.ncaa.org/championships/playing-rules/football-playing-rules/ (confirms official rule
   book and field diagram exist; the linked rulebook PDF itself was not retrievable this session).

## 10. Repository evidence

- File added: `decisions/2026-09-28-football-field-dimensions.md` (this file).
- Commit SHA and clean-status confirmation: recorded in the Kanban task comment/completion event for
  t_12800096 after commit (see task history for the exact SHA).
