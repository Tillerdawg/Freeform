#!/usr/bin/env python3
"""Executable documentation tests for Freeform MVP §3.2, §4.1, and §4.2.

This is deliberately independent of product code. It fixes the exact normative examples
and tie-break vectors so an implementer can reproduce the documented algorithms.
"""
import math
from pathlib import Path


FU_PER_YARD = 2880
FU_PER_STEP = 1800
QUARTER_STEP_FU = 450
FIVE_YARD_LINES_FU = tuple(range(0, 100 * FU_PER_YARD + 1, 5 * FU_PER_YARD))
LANDMARKS = (
    (0, "Front Sideline"),
    (51200, "Front Hash"),
    (102400, "Back Hash"),
    (153600, "Back Sideline"),
)


def fail(message):
    raise AssertionError(message)


def assert_equal(actual, expected, context):
    if actual != expected:
        fail(f"{context}: expected {expected!r}, got {actual!r}")


def line_label(line_fu):
    yards = line_fu // FU_PER_YARD
    if yards == 50:
        return "50"
    if yards < 50:
        return f"Side 1 {yards}"
    return f"Side 2 {100 - yards}"


def format_step_value(quarter_steps):
    whole, remainder = divmod(quarter_steps, 4)
    return str(whole) if remainder == 0 else f"{whole}.{remainder * 25:02d}"


def format_steps(offset_fu):
    quarter_steps = (offset_fu + QUARTER_STEP_FU // 2) // QUARTER_STEP_FU
    value = format_step_value(quarter_steps)
    return f"{value} {'Step' if quarter_steps == 4 else 'Steps'}"


def coordinate_horizontal(x_fu):
    distances = sorted((abs(x_fu - line), line) for line in FIVE_YARD_LINES_FU)
    if distances[0][0] == distances[1][0]:
        lower, higher = sorted((distances[0][1], distances[1][1]))
        return f"Splitting {line_label(lower)} & {line_label(higher)}"
    _, line = distances[0]
    if x_fu == line:
        return f"On {line_label(line)}"
    if line == 50 * FU_PER_YARD:
        side = "Side 1" if x_fu < line else "Side 2"
        return f"{format_steps(abs(x_fu - line))} Outside 50 ({side})"
    direction = "Inside" if ((line < 50 * FU_PER_YARD and x_fu > line) or
                             (line > 50 * FU_PER_YARD and x_fu < line)) else "Outside"
    return f"{format_steps(abs(x_fu - line))} {direction} {line_label(line)}"


def coordinate_vertical(y_fu):
    landmark_y, name = min(LANDMARKS, key=lambda landmark: (abs(y_fu - landmark[0]), landmark[0]))
    if y_fu == landmark_y:
        return f"On {name}"
    direction = "In Front Of" if y_fu < landmark_y else "Behind"
    return f"{format_steps(abs(y_fu - landmark_y))} {direction} {name}"


def coordinate(x_fu, y_fu):
    return f"{coordinate_horizontal(x_fu)}, {coordinate_vertical(y_fu)}"


def test_coordinate_grammar():
    cases = (
        ((115200, 51200), "On Side 1 40, On Front Hash", "Side 1 exact line"),
        ((172800, 51200), "On Side 2 40, On Front Hash", "Side 2 exact line"),
        ((144000, 51200), "On 50, On Front Hash", "50 exact line"),
        ((122400, 44000), "Splitting Side 1 40 & Side 1 45, 4 Steps In Front Of Front Hash", "required splitting worked example"),
        ((117000, 51200), "1 Step Inside Side 1 40, On Front Hash", "inside offset"),
        ((113400, 51200), "1 Step Outside Side 1 40, On Front Hash", "outside offset"),
        ((171000, 51200), "1 Step Inside Side 2 40, On Front Hash", "Side 2 inside offset"),
        ((174600, 51200), "1 Step Outside Side 2 40, On Front Hash", "Side 2 outside offset"),
        ((140400, 51200), "2 Steps Outside 50 (Side 1), On Front Hash", "50 Side 1 outside offset"),
        ((147600, 51200), "2 Steps Outside 50 (Side 2), On Front Hash", "50 Side 2 outside offset"),
        ((115200, 25600), "On Side 1 40, 14.25 Steps Behind Front Sideline", "front sideline/front hash tie"),
        ((115200, 76800), "On Side 1 40, 14.25 Steps Behind Front Hash", "front hash/back hash tie"),
        ((115200, 128000), "On Side 1 40, 14.25 Steps Behind Back Hash", "back hash/back sideline tie"),
    )
    for (x_fu, y_fu), expected, context in cases:
        actual = coordinate(x_fu, y_fu)
        assert_equal(actual, expected, context)
        if context in {"inside offset", "outside offset"} and actual.count("Side 1") != 1:
            fail(f"{context}: horizontal label must contain Side 1 exactly once: {actual!r}")
        if context in {"Side 2 inside offset", "Side 2 outside offset"} and actual.count("Side 2") != 1:
            fail(f"{context}: horizontal label must contain Side 2 exactly once: {actual!r}")


def segment_projection(point, start, end, arc_start):
    dx, dy = end[0] - start[0], end[1] - start[1]
    length = math.hypot(dx, dy)
    if length == 0:
        fail("documentation vector has a zero-length FTL segment")
    ratio = max(0.0, min(1.0, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (length * length)))
    projected = (start[0] + ratio * dx, start[1] + ratio * dy)
    return arc_start + ratio * length, math.dist(point, projected), length


def projection_candidates(path, point):
    candidates = []
    arc_start = 0.0
    for start, end in zip(path, path[1:]):
        arc_length, distance, length = segment_projection(point, start, end, arc_start)
        candidates.append((arc_length, distance))
        arc_start += length
    nearest_distance = min(distance for _, distance in candidates)
    return sorted((arc_length for arc_length, distance in candidates if distance <= nearest_distance + 1.0))


def choose_projection_tie(candidates, previous_offset):
    if not candidates:
        fail("projection has no candidates")
    if previous_offset is None:
        return min(candidates)
    return min(candidates, key=lambda arc_length: (abs(arc_length - previous_offset), arc_length))


def test_ftl_projection_tie_break():
    path = ((0, 0), (7200, 7200), (0, 7200), (7200, 0))
    candidates = projection_candidates(path, (3600, 3600))
    expected_low = 3600 * math.sqrt(2)
    expected_high = 7200 + 10800 * math.sqrt(2)
    if len(candidates) != 2:
        fail(f"self-intersection must give two projection candidates, got {candidates!r}")
    if not math.isclose(candidates[0], expected_low, abs_tol=1e-9) or not math.isclose(candidates[1], expected_high, abs_tol=1e-9):
        fail(f"self-intersection candidate arc lengths must be {expected_low!r}, {expected_high!r}; got {candidates!r}")
    leader_choice = choose_projection_tie(candidates, previous_offset=None)
    assert_equal(leader_choice, candidates[0], "leader chooses smallest arc length")
    follower_choice = choose_projection_tie(candidates, previous_offset=22000)
    assert_equal(follower_choice, candidates[1], "follower chooses candidate nearest prior offset")


def linear_position(start, end, numerator, denominator):
    return tuple(start[i] + (end[i] - start[i]) * numerator / denominator for i in (0, 1))


def test_collision_sampling_worked_example():
    counts = 2
    threshold_fu = 2880
    a_start, a_end = (0, 0), (14400, 0)
    b_start, b_end = (14400, 0), (0, 0)
    base_denominator = 4 * counts
    base_times = tuple(range(base_denominator + 1))
    base_sample_distances = []
    for k in base_times:
        a = linear_position(a_start, a_end, k, base_denominator)
        b = linear_position(b_start, b_end, k, base_denominator)
        base_sample_distances.append(math.dist(a, b))
    assert_equal(base_sample_distances[4], 0.0, "base grid t=4/8 distance")
    if base_sample_distances[4] > threshold_fu:
        fail("base grid crossing must require a one-yard warning")
    travel_per_base_interval = 14400 / base_denominator
    assert_equal(travel_per_base_interval, 1800.0, "travel per base interval")
    subdivisions = math.ceil(travel_per_base_interval / 720)
    assert_equal(subdivisions, 3, "required adaptive subdivisions")
    augmented_denominator = base_denominator * subdivisions
    augmented_times = tuple(range(augmented_denominator + 1))
    augmented_step = 14400 / augmented_denominator
    assert_equal(augmented_step, 600.0, "travel per augmented subinterval")
    a = linear_position(a_start, a_end, 12, augmented_denominator)
    b = linear_position(b_start, b_end, 12, augmented_denominator)
    assert_equal(a, (7200.0, 0.0), "augmented grid A at t=12/24")
    assert_equal(b, (7200.0, 0.0), "augmented grid B at t=12/24")
    assert_equal(math.dist(a, b), 0.0, "augmented grid t=12/24 distance")
    if 12 not in augmented_times:
        fail("augmented grid must retain the crossing sample")


def test_spec_text_matches_golden_grammar():
    spec = (Path(__file__).resolve().parent / "freeform-mvp-spec-v1.md").read_text(encoding="utf-8")
    required = (
        "The exact horizontal grammar is one of `On <line>`, `Splitting <lower-line> & <higher-line>`, `<steps> Inside <line>` / `<steps> Outside <line>` for a non-50 line, or `<steps> Outside 50 (Side 1|Side 2)` for a nonzero offset from the 50.",
        'horizontal = "Splitting " + labels(neighbors) # each label includes Side 1/Side 2 or is 50',
        'if line == 50: horizontal = d + " Outside 50 (" + (dot.x < line ? "Side 1" : "Side 2") + ")"',
        "Splitting Side 1 40 & Side 1 45, 4 Steps In Front Of Front Hash",
        "At `t=4/8`, both centers are `(7200,0)`, so the distance is `0 FU <= 2880 FU`",
    )
    for snippet in required:
        if snippet not in spec:
            fail(f"spec no longer contains required executable-documentation grammar/vector: {snippet!r}")


def main():
    test_coordinate_grammar()
    print("PASS: exact coordinate grammar (Side 1, Side 2, 50, splitting, inside/outside, all landmark ties)")
    test_ftl_projection_tie_break()
    print("PASS: deterministic FTL projection tie-break (leader and formation-order prior offset)")
    test_collision_sampling_worked_example()
    print("PASS: collision sampling numeric vector (base t=k/8; adaptive t=j/24; one-yard warning)")
    test_spec_text_matches_golden_grammar()
    print("PASS: prose, pseudocode, worked vectors, and executable documentation tests agree")


if __name__ == "__main__":
    main()
