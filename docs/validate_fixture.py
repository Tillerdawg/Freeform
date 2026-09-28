#!/usr/bin/env python3
"""Dependency-free validation of the published 1.0 schema contract and fixture.

This is documentation-test tooling, not application code. It intentionally checks the
structural constraints exercised by the complete fixture plus the non-expressible
semantic invariants specified in freeform-mvp-spec-v1.md.
"""
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SCHEMA = ROOT / "freeform-1.0.schema.json"
FIXTURE = ROOT / "fixtures" / "freeform-1.0-example.freeform"


def fail(message):
    raise ValueError(message)


def load(path):
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def keys(value, allowed, required, where):
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


def validate(schema, doc):
    if schema["$schema"] != "https://json-schema.org/draft/2020-12/schema":
        fail("schema draft declaration changed")
    if schema["properties"]["format"]["const"] != "freeform":
        fail("schema format contract changed")
    if schema["properties"]["field"]["properties"]["unitsPerYard"]["const"] != 2880:
        fail("schema FU contract changed")

    keys(doc, {"$schema", "format", "formatVersion", "show", "field", "settings", "performers", "sets", "transitions", "annotations", "layers", "extensions"},
         {"format", "formatVersion", "show", "field", "settings", "performers", "sets", "transitions", "annotations"}, "root")
    if doc["format"] != "freeform" or doc["formatVersion"] != "1.0.0":
        fail("wrong format/version")
    if doc["field"] != {"preset": "NFHS_11_PLAYER", "unitsPerYard": 2880, "lengthUnits": 288000, "widthUnits": 153600, "frontHashY": 51200, "backHashY": 102400}:
        fail("field does not match v1 NFHS constants")
    if doc["settings"] != {"collisionThresholdUnits": 2880}:
        fail("fixture must retain the default one-yard collision threshold")

    ids = [p["id"] for p in doc["performers"]]
    ranks = [p["rankCode"].lower() for p in doc["performers"]]
    if len(ids) != len(set(ids)) or len(ranks) != len(set(ranks)):
        fail("performer IDs or rank codes are not unique")
    performer_ids = set(ids)
    sets = {s["id"]: s for s in doc["sets"]}
    if len(sets) != len(doc["sets"]):
        fail("set IDs are not unique")
    for s in doc["sets"]:
        if set(s["positions"]) != performer_ids:
            fail(f"{s['id']}: positions must exactly cover active performers")
        for pid, position in s["positions"].items():
            dot(position, f"{s['id']}.{pid}")

    layers = {l["id"] for l in doc.get("layers", [])}
    for annotation in doc["annotations"]:
        if annotation["layerId"] not in layers:
            fail(f"annotation {annotation['id']}: unknown layer")
        if "anchor" in annotation:
            dot(annotation["anchor"], f"annotation {annotation['id']}")

    for transition in doc["transitions"]:
        if transition["fromSetId"] not in sets or transition["toSetId"] not in sets:
            fail(f"{transition['id']}: unknown set reference")
        if transition["counts"] < 1:
            fail(f"{transition['id']}: nonpositive count length")
        if sets[transition["toSetId"]]["startCount"] - sets[transition["fromSetId"]]["startCount"] != transition["counts"]:
            fail(f"{transition['id']}: count topology mismatch")
        if transition["mode"] != "ftl":
            continue
        ftl = transition["ftl"]
        ordered = [ftl["leaderId"]] + ftl["followerIds"]
        if len(ordered) != len(set(ordered)) or set(ordered) != performer_ids:
            fail(f"{transition['id']}: fixture FTL roster/order mismatch")
        offsets = ftl["offsetUnits"]
        if set(offsets) != set(ordered) or offsets[ftl["leaderId"]] != 0:
            fail(f"{transition['id']}: malformed FTL offsets")
        start = sets[transition["fromSetId"]]["positions"]
        end = sets[transition["toSetId"]]["positions"]
        path = ftl["path"]
        for point in path:
            dot(point, f"{transition['id']}.path")
        distance = ftl["distanceUnits"]
        if type(distance) is not int or distance <= 0:
            fail(f"{transition['id']}: distanceUnits must be a positive integer FU")
        for pid in ordered:
            if start[pid] != polyline_at_x(path, offsets[pid]):
                fail(f"{transition['id']}: {pid} start is not C(offset)")
            derived = polyline_at_x(path, offsets[pid] + distance)
            if end[pid] != derived or ftl["expectedEndPositions"][pid] != derived:
                fail(f"{transition['id']}: {pid} derived end mismatch")
        if end[ftl["leaderId"]] != start["a"]:
            fail("worked FTL vector must place E at A's original dot")
        common_step_size = (distance / 2880) * 8 / transition["counts"]
        if not math.isclose(common_step_size, 5.0):
            fail("worked FTL vector is not 5.0-to-5")


if __name__ == "__main__":
    validate(load(SCHEMA), load(FIXTURE))
    print("PASS: schema contract + semantic fixture validation")
    print("PASS: 5 performers, 2 sets, 1 16-count FTL; each moves 28800 FU (10 yd, 5.0-to-5)")
    print("PASS: canonical NFHS constants and derived FTL endpoints match fixture")
