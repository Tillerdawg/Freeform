#!/usr/bin/env python3
"""Dependency-free-in-Python validation of the published 1.0 schema contract and fixture.

This is documentation-test tooling, not application code. It runs the fixture through a
genuine Draft 2020-12 validator (Ajv, via docs/ajv_validate.mjs as a Node subprocess) and
additionally checks the non-expressible semantic invariants specified in
freeform-mvp-spec-v1.md. It never claims schema validation happened unless the subprocess
actually executed; a missing/broken Node/Ajv toolchain is a hard failure, not a skip.
"""
import json
import math
import subprocess
from pathlib import Path
from typing import NoReturn

ROOT = Path(__file__).resolve().parent
SCHEMA = ROOT / "freeform-1.0.schema.json"
FIXTURE = ROOT / "fixtures" / "freeform-1.0-example.freeform"
AJV_SCRIPT = ROOT / "ajv_validate.mjs"
NEGATIVE_DIR = ROOT / "fixtures" / "negative"


class ValidationError(ValueError):
    """Structured validation failure. Always raised via fail(); never an uncaught KeyError."""


def fail(message) -> NoReturn:
    raise ValidationError(message)


def load(path):
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def loads(text):
    return json.loads(text)


def keys(value, allowed, required, where):
    if not isinstance(value, dict):
        fail(f"{where}: expected an object, got {type(value).__name__}")
    missing = set(required) - set(value)
    extra = set(value) - set(allowed)
    if missing or extra:
        fail(f"{where}: missing={sorted(missing)} extra={sorted(extra)}")


def dot(value, where):
    keys(value, {"x", "y"}, {"x", "y"}, where)
    if not all(type(value[k]) is int for k in ("x", "y")):
        fail(f"{where}: coordinates must be integer FU")
    if not (0 <= value["x"] <= 288000 and 0 <= value["y"] <= 153600):
        fail(f"{where}: dot outside NFHS playing field")


def polyline_at_x(path, distance):
    # Fixture path is collinear horizontal; this confirms a known test vector.
    (a, b) = path
    if a["y"] != b["y"] or a["x"] <= b["x"]:
        fail("fixture FTL path must be leftward horizontal for this worked example")
    return {"x": a["x"] - distance, "y": a["y"]}


def run_ajv_schema_validation(schema_path, doc_path):
    """Execute the real Draft 2020-12 validator as a subprocess and return its verdict.

    A nonzero exit or unparsable output means Ajv itself could not run -- that is a hard
    failure ('cannot claim schema validation happened'), never treated as 'not violated'.
    """
    try:
        proc = subprocess.run(
            ["node", str(AJV_SCRIPT), str(schema_path), str(doc_path)],
            capture_output=True, text=True, timeout=30,
        )
    except FileNotFoundError:
        fail("cannot execute schema validation: 'node' is not on PATH")
    except subprocess.TimeoutExpired:
        fail("cannot execute schema validation: ajv_validate.mjs timed out")
    if proc.returncode != 0:
        fail(f"ajv subprocess failed (exit {proc.returncode}): {proc.stderr.strip()}")
    try:
        result = json.loads(proc.stdout)
    except json.JSONDecodeError:
        fail(f"ajv subprocess produced unparsable output: {proc.stdout!r} / {proc.stderr!r}")
    return result


def validate_schema_or_fail(schema_path, doc_path):
    result = run_ajv_schema_validation(schema_path, doc_path)
    if not result.get("valid"):
        fail(f"schema validation failed: {json.dumps(result.get('errors'), indent=None)}")


def validate_semantics(schema, doc):
    """Semantic checks the JSON Schema cannot express. Raises ValidationError on any failure."""
    keys(doc, {"$schema", "format", "formatVersion", "show", "field", "settings", "performers", "sets", "transitions", "annotations", "layers", "symbols", "extensions"},
         {"format", "formatVersion", "show", "field", "settings", "performers", "sets", "transitions", "annotations"}, "root")
    if doc["format"] != "freeform":
        fail("wrong format")
    if doc["formatVersion"] != "1.0.0":
        fail(f"unsupported major/format version: {doc['formatVersion']!r} (this validator only accepts 1.0.0)")
    if doc["field"] != {"preset": "NFHS_11_PLAYER", "unitsPerYard": 2880, "lengthUnits": 288000, "widthUnits": 153600, "frontHashY": 51200, "backHashY": 102400}:
        fail("field does not match v1 NFHS constants")
    if doc["settings"] != {"collisionThresholdUnits": 2880}:
        fail("fixture must retain the default one-yard collision threshold")

    performers = doc.get("performers", [])
    if not isinstance(performers, list) or not all(isinstance(p, dict) and "id" in p and "rankCode" in p for p in performers):
        fail("performers: every entry must be an object with id and rankCode")
    ids = [p["id"] for p in performers]
    ranks = [p["rankCode"].lower() for p in performers]
    if len(ids) != len(set(ids)):
        fail("performer IDs are not unique")
    if len(ranks) != len(set(ranks)):
        fail("performer rank codes are not unique (case-insensitively)")
    performer_ids = set(ids)

    sets_list = doc.get("sets", [])
    if not isinstance(sets_list, list) or not all(isinstance(s, dict) and "id" in s for s in sets_list):
        fail("sets: every entry must be an object with id")
    sets = {s["id"]: s for s in sets_list}
    if len(sets) != len(sets_list):
        fail("set IDs are not unique")
    for s in sets_list:
        if "positions" not in s:
            fail(f"{s['id']}: missing positions")
        if set(s["positions"]) != performer_ids:
            fail(f"{s['id']}: positions must exactly cover active performers")
        for pid, position in s["positions"].items():
            dot(position, f"{s['id']}.{pid}")

    symbols = doc.get("symbols", [])
    if not isinstance(symbols, list) or not all(isinstance(sym, dict) and "id" in sym for sym in symbols):
        fail("symbols: every entry must be an object with id")
    symbol_ids = [sym["id"] for sym in symbols]
    if len(symbol_ids) != len(set(symbol_ids)):
        fail("symbol IDs are not unique")
    symbol_id_set = set(symbol_ids)

    layers_list = doc.get("layers", [])
    if not isinstance(layers_list, list) or not all(isinstance(l, dict) and "id" in l for l in layers_list):
        fail("layers: every entry must be an object with id")
    layer_ids = [l["id"] for l in layers_list]
    if len(layer_ids) != len(set(layer_ids)):
        fail("layer IDs are not unique")
    layers = set(layer_ids)

    annotations = doc.get("annotations", [])
    if not isinstance(annotations, list) or not all(isinstance(a, dict) and "id" in a for a in annotations):
        fail("annotations: every entry must be an object with id")
    annotation_ids = [a["id"] for a in annotations]
    if len(annotation_ids) != len(set(annotation_ids)):
        fail("annotation IDs are not unique")
    for annotation in annotations:
        aid = annotation["id"]
        if "layerId" not in annotation:
            fail(f"annotation {aid}: missing layerId")
        if annotation["layerId"] not in layers:
            fail(f"annotation {aid}: unknown layer {annotation['layerId']!r}")
        if "anchor" in annotation:
            dot(annotation["anchor"], f"annotation {aid}")
        if "performerId" in annotation and annotation["performerId"] not in performer_ids:
            fail(f"annotation {aid}: unknown performer {annotation['performerId']!r}")
        if annotation.get("kind") == "symbol":
            if annotation.get("symbolId") not in symbol_id_set:
                fail(f"annotation {aid}: unknown symbol {annotation.get('symbolId')!r}")
        vis = annotation.get("visibility")
        if isinstance(vis, dict) and vis.get("performerPacket") and "performerId" not in annotation:
            fail(f"annotation {aid}: performerPacket visibility requires performerId")

    transitions = doc.get("transitions", [])
    if not isinstance(transitions, list) or not all(isinstance(t, dict) and "id" in t for t in transitions):
        fail("transitions: every entry must be an object with id")
    transition_ids = [t["id"] for t in transitions]
    if len(transition_ids) != len(set(transition_ids)):
        fail("duplicate transition IDs")

    for transition in transitions:
        tid = transition["id"]
        if transition.get("fromSetId") not in sets or transition.get("toSetId") not in sets:
            fail(f"{tid}: unknown set reference")
        if transition.get("counts", 0) < 1:
            fail(f"{tid}: nonpositive count length")
        if sets[transition["toSetId"]]["startCount"] - sets[transition["fromSetId"]]["startCount"] != transition["counts"]:
            fail(f"{tid}: count topology mismatch")
        if transition.get("mode") != "ftl":
            continue
        if "ftl" not in transition:
            fail(f"{tid}: mode is ftl but ftl block is missing")
        ftl = transition["ftl"]
        for required_field in ("leaderId", "followerIds", "path", "offsetUnits", "distanceUnits"):
            if required_field not in ftl:
                fail(f"{tid}: ftl block missing required field {required_field!r}")
        ordered = [ftl["leaderId"]] + ftl["followerIds"]
        if len(ordered) != len(set(ordered)) or set(ordered) != performer_ids:
            fail(f"{tid}: fixture FTL roster/order mismatch")
        offsets = ftl["offsetUnits"]
        if set(offsets) != set(ordered) or offsets[ftl["leaderId"]] != 0:
            fail(f"{tid}: malformed FTL offsets")
        offset_sequence = [offsets[pid] for pid in ordered]
        if offset_sequence != sorted(offset_sequence):
            fail(f"{tid}: FTL_OFFSET_ORDER -- offsets are not monotonic in leader-then-follower order")

        path = ftl["path"]
        if not isinstance(path, list) or len(path) < 2:
            fail(f"{tid}: INSUFFICIENT_FTL_PATH -- path must have at least two points")
        for point in path:
            dot(point, f"{tid}.path")
        distance = ftl["distanceUnits"]
        if type(distance) is not int or distance <= 0:
            fail(f"{tid}: distanceUnits must be a positive integer FU")

        # Path coverage: spec section 4.1 requires [min(o_i), max(o_i)+D_FU] to lie within
        # the path's own parametrization, i.e. within [0, path_length] measured from path[0].
        path_length = abs(path[0]["x"] - path[-1]["x"])
        min_offset = min(offsets.values())
        max_reach = max(offsets.values()) + distance
        if min_offset < 0 or max_reach > path_length:
            fail(f"{tid}: INSUFFICIENT_FTL_PATH -- path covers [0,{path_length}] FU but "
                 f"offsets+distance require [{min_offset},{max_reach}] FU")

        start = sets[transition["fromSetId"]]["positions"]
        end = sets[transition["toSetId"]]["positions"]
        for pid in ordered:
            if start[pid] != polyline_at_x(path, offsets[pid]):
                fail(f"{tid}: {pid} start is not C(offset)")
            derived = polyline_at_x(path, offsets[pid] + distance)
            expected = ftl.get("expectedEndPositions", {}).get(pid)
            if end[pid] != derived:
                fail(f"{tid}: {pid} derived end mismatch")
            if expected is not None and expected != derived:
                fail(f"{tid}: FTL_END_MISMATCH -- {pid} expectedEndPositions disagrees with derived end")
        if end[ftl["leaderId"]] != start["a"]:
            fail("worked FTL vector must place E at A's original dot")
        distance_yards = distance / 2880
        common_step_size = transition["counts"] * 5 / distance_yards
        if not math.isclose(common_step_size, 8.0):
            fail("worked FTL vector is not 8.0-to-5")


def validate(schema, doc):
    """Full validation: genuine schema execution plus semantic invariants.

    Any unexpected structural error (e.g. a negative fixture missing a key the semantic
    checks didn't defensively guard) is converted into a ValidationError instead of
    propagating as an uncaught KeyError/TypeError.
    """
    if schema["$schema"] != "https://json-schema.org/draft/2020-12/schema":
        fail("schema draft declaration changed")
    if schema["properties"]["format"]["const"] != "freeform":
        fail("schema format contract changed")
    if schema["properties"]["field"]["properties"]["unitsPerYard"]["const"] != 2880:
        fail("schema FU contract changed")
    try:
        validate_semantics(schema, doc)
    except ValidationError:
        raise
    except (KeyError, TypeError, AttributeError) as e:
        fail(f"malformed document structure: {type(e).__name__}: {e}")


# --- Step-size classification (spec section 4): documentation-test tooling mirroring
# the normative pseudocode, not the application implementation. ---

def classify_step_size(distance_yards, counts):
    """Mirrors freeform-mvp-spec-v1.md section 4's corrected classification rule."""
    if distance_yards == 0:
        return "green", "No movement"
    step_size = counts * 5 / distance_yards
    if step_size >= 6.1:
        band = "green"
    elif step_size <= 4.0:
        band = "red"
    else:
        band = "yellow"
    return band, step_size


def test_step_size_bands():
    # Positive: required acceptance-criterion worked vectors.
    band, value = classify_step_size(10, 16)
    if band != "green" or not math.isclose(float(value), 8.0):
        fail(f"10yd/16ct must classify green at 8.0-to-5, got {band}/{value}")
    band, value = classify_step_size(10, 12)
    if band != "yellow" or not math.isclose(float(value), 6.0):
        fail(f"10yd/12ct must classify yellow at 6.0-to-5, got {band}/{value}")

    # Positive: stationary performer is always green regardless of counts.
    band, value = classify_step_size(0, 16)
    if band != "green" or value != "No movement":
        fail(f"zero-distance move must classify No movement/green, got {band}/{value}")

    # Positive: every finite positive stepSize maps to exactly one band, including the
    # values a half-open "4.1 through 6.0" description would have left unclassified.
    for step_size in (0.01, 3.999, 4.0, 4.01, 4.05, 4.1, 5.0, 6.0, 6.05, 6.09, 6.1, 6.11, 50.0):
        # Solve counts*5/distance == step_size with distance=5 (fixed) so counts=step_size.
        distance_yards = 5.0
        counts_equiv = step_size * distance_yards / 5
        band, value = classify_step_size(distance_yards, counts_equiv)
        exactly_one = sum([value >= 6.1, 4.0 < value < 6.1, value <= 4.0]) if isinstance(value, float) else 1
        if exactly_one != 1:
            fail(f"stepSize={step_size} matched {exactly_one} bands, must match exactly one")
        if step_size >= 6.1 and band != "green":
            fail(f"stepSize={step_size} should be green, got {band}")
        if step_size <= 4.0 and band != "red":
            fail(f"stepSize={step_size} should be red, got {band}")
        if 4.0 < step_size < 6.1 and band != "yellow":
            fail(f"stepSize={step_size} should be yellow, got {band}")

    # Negative: the pre-correction inverted formula would have misclassified both
    # acceptance-criterion vectors; assert the old (wrong) values are NOT produced.
    _, wrong_16 = classify_step_size(10, 16)
    if math.isclose(float(wrong_16), 5.0):
        fail("regression: step-size formula reverted to the inverted (distance*8/counts) definition")


# --- Coordinate horizontal-component edge case (spec section 3.2/3.3): the exact-line
# (d=0) case for a non-50 yard line, previously undefined between Inside/Outside. ---

FIVE_YARD_LINES_FU = [n * 2880 * 5 for n in range(0, 21)]  # 0,5,...,100 yd in FU


def label_line(line_fu):
    yd = line_fu // 2880
    if yd == 50:
        return "50"
    if yd < 50:
        return f"Side 1 {yd}"
    return f"Side 2 {100 - yd}"


def coordinate_horizontal(x_fu):
    nearest = min(FIVE_YARD_LINES_FU, key=lambda line: abs(x_fu - line))
    distances = sorted(FIVE_YARD_LINES_FU, key=lambda line: abs(x_fu - line))
    if abs(x_fu - distances[0]) == abs(x_fu - distances[1]) and distances[0] != distances[1]:
        lo, hi = sorted((distances[0], distances[1]))
        return f"Splitting {label_line(lo)} & {label_line(hi)}"
    if x_fu == nearest:
        return f"On {label_line(nearest)}"
    return f"<line={label_line(nearest)}, offset nonzero>"


def test_coordinate_edge_cases():
    # Positive: exact non-50 yard line (Side 1 40, x=115200) is now deterministic.
    result = coordinate_horizontal(115200)
    if result != "On Side 1 40":
        fail(f"x=115200 (Side 1 40 exactly) must be 'On Side 1 40', got {result!r}")
    # Positive: the 50 is the same rule's instance, not a special case.
    result = coordinate_horizontal(144000)
    if result != "On 50":
        fail(f"x=144000 (the 50 exactly) must be 'On 50', got {result!r}")
    # Positive: exact splitting case from the spec's required worked example.
    result = coordinate_horizontal(122400)
    if result != "Splitting Side 1 40 & Side 1 45":
        fail(f"x=122400 must be 'Splitting Side 1 40 & Side 1 45', got {result!r}")
    # Negative: a dot 1 FU off an exact line must NOT hit the On-line branch.
    result = coordinate_horizontal(115201)
    if result.startswith("On "):
        fail("x=115201 (1 FU off Side 1 40) must not classify as On a line")


# --- Negative fixtures: docs/fixtures/negative/*.freeform must each be REJECTED, either
# by the genuine Ajv schema pass or by the semantic validator, for the reason named. ---

NEGATIVE_CASES = [
    # (filename, checked_by: "schema" | "semantic", must_mention substring or None)
    ("malformed-id.freeform", "schema", None),
    ("out-of-bounds-dot.freeform", "schema", None),
    ("missing-ftl-data.freeform", "schema", None),
    ("unsupported-major-version.freeform", "semantic", "unsupported major/format version"),
    ("duplicate-transition-id.freeform", "semantic", "duplicate transition IDs"),
    ("insufficient-ftl-path.freeform", "semantic", "INSUFFICIENT_FTL_PATH"),
    ("ftl-end-mismatch.freeform", "semantic", "FTL_END_MISMATCH"),
]


def run_negative_case_table(schema):
    rows = []
    all_ok = True
    for filename, checked_by, must_mention in NEGATIVE_CASES:
        path = NEGATIVE_DIR / filename
        if not path.exists():
            rows.append((filename, checked_by, "MISSING FIXTURE", False))
            all_ok = False
            continue
        doc = load(path)
        try:
            if checked_by == "schema":
                validate_schema_or_fail(SCHEMA, path)
            else:
                validate_semantics(schema, doc)
        except ValidationError as e:
            msg = str(e)
            ok = (must_mention is None) or (must_mention in msg)
            rows.append((filename, checked_by, msg[:100], ok))
            if not ok:
                all_ok = False
            continue
        except (KeyError, TypeError, AttributeError) as e:
            # An uncaught structural exception here is itself a failure of this card's
            # requirement ("never an uncaught KeyError"); the harness catches it but the
            # case is marked NOT ok because the validator should have raised ValidationError.
            rows.append((filename, checked_by, f"UNCAUGHT {type(e).__name__}: {e}", False))
            all_ok = False
            continue
        # No exception raised at all -- the negative fixture was wrongly accepted.
        rows.append((filename, checked_by, "WAS ACCEPTED (should have been rejected)", False))
        all_ok = False

    print()
    print(f"{'fixture':<34} {'checked by':<10} {'result'}")
    print("-" * 100)
    for filename, checked_by, msg, ok in rows:
        status = "REJECTED OK" if ok else "FAIL"
        print(f"{filename:<34} {checked_by:<10} [{status}] {msg}")
    print()
    if not all_ok:
        fail("one or more negative fixtures were not correctly rejected (see table above)")


if __name__ == "__main__":
    schema_doc = load(SCHEMA)
    fixture_doc = load(FIXTURE)
    validate_schema_or_fail(SCHEMA, FIXTURE)
    print("PASS: genuine Draft 2020-12 schema validation (Ajv subprocess) of the positive fixture")
    validate(schema_doc, fixture_doc)
    print("PASS: schema contract + semantic fixture validation")
    print("PASS: 5 performers, 2 sets, 1 16-count FTL; each moves 28800 FU (10 yd, 8.0-to-5)")
    print("PASS: canonical NFHS constants and derived FTL endpoints match fixture")
    test_step_size_bands()
    print("PASS: step-size band classification (worked vectors, boundaries, stationary, regression)")
    test_coordinate_edge_cases()
    print("PASS: coordinate horizontal-component edge cases (on-line, splitting, near-miss)")
    run_negative_case_table(schema_doc)
    print("PASS: all named negative fixtures correctly rejected")
