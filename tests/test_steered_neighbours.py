"""REQ-UX-021: steering the semantic neighbourhood toward a user-supplied word.

The maths is exercised against a hand-built vector space rather than the shipped index so
the expected ordering is arguable from the numbers alone: `king` is nearer `warrior` than
`queen` on its own, and nearer `queen` once steered toward `woman`.
"""

import numpy as np
import pytest
from khamlink.bge import BgeIndex

KING, QUEEN, WOMAN, WARRIOR = "d_king", "d_queen", "d_woman", "d_warrior"


def unit(vector):
    """Normalize a synthetic vector for angular assertions."""
    return np.array(vector, dtype=np.float32) / np.linalg.norm(vector)


@pytest.fixture
def index():
    """A four-entry index. The adapter only reads these attributes in `neighbours`."""
    rows = {
        KING: ("w_king", "ราชา", unit([1.0, 0.0, 0.0])),
        QUEEN: ("w_queen", "ราชินี", unit([0.7, 0.7, 0.0])),
        WOMAN: ("w_woman", "ผู้หญิง", unit([0.0, 1.0, 0.0])),
        WARRIOR: ("w_warrior", "นักรบ", unit([0.95, 0.1, 0.3])),
    }
    adapter = object.__new__(BgeIndex)
    adapter.definition_ids = list(rows)
    adapter.row_of_definition = {d: i for i, d in enumerate(adapter.definition_ids)}
    adapter.word_ids = [rows[d][0] for d in adapter.definition_ids]
    adapter.headwords = [rows[d][1] for d in adapter.definition_ids]
    adapter.texts = [f"ความหมายของ {rows[d][1]}" for d in adapter.definition_ids]
    adapter.vectors = np.vstack([rows[d][2] for d in adapter.definition_ids])
    return adapter


def words(neighbours):
    """Extract the result order without hiding score checks in endpoint tests."""
    return [n["word"] for n in neighbours]


def test_unsteered_neighbours_are_unchanged(index):
    """Weight zero, or no steering word at all, must behave exactly as before."""
    plain = index.neighbours([KING], 3)
    assert words(plain)[0] == "นักรบ"
    assert words(index.neighbours([KING], 3, [WOMAN], 0.0)) == words(plain)
    assert words(index.neighbours([KING], 3, [], 1.0)) == words(plain)


def test_steering_reorders_toward_the_steered_concept(index):
    """ราชา steered toward ผู้หญิง puts ราชินี ahead of นักรบ — the brief's own example."""
    steered = words(index.neighbours([KING], 3, [WOMAN], 1.0))
    assert steered[0] == "ราชินี"
    assert steered.index("ราชินี") < steered.index("นักรบ")


def test_steering_is_progressive(index):
    """Raising the weight moves ราชินี up, rather than flipping at a single threshold."""
    ranks = [words(index.neighbours([KING], 3, [WOMAN], w)).index("ราชินี") for w in (0.0, 0.4, 1.0)]
    assert ranks == sorted(ranks, reverse=True)
    assert ranks[0] > ranks[-1]


def test_the_steering_word_is_not_returned_as_a_neighbour(index):
    """It names a direction, not a result; echoing it back would be noise."""
    assert "ผู้หญิง" not in words(index.neighbours([KING], 4, [WOMAN], 1.0))


def test_an_unknown_steering_definition_degrades_to_unsteered(index):
    """A steering word the corpus does not carry must not blank the neighbour list."""
    assert words(index.neighbours([KING], 3, ["d_missing"], 1.0)) == words(index.neighbours([KING], 3))


def build(rows):
    """An index over {definition_id: (word_id, headword, vector)}."""
    adapter = object.__new__(BgeIndex)
    adapter.definition_ids = list(rows)
    adapter.row_of_definition = {d: i for i, d in enumerate(adapter.definition_ids)}
    adapter.word_ids = [rows[d][0] for d in adapter.definition_ids]
    adapter.headwords = [rows[d][1] for d in adapter.definition_ids]
    adapter.texts = [f"ความหมายของ {rows[d][1]}" for d in adapter.definition_ids]
    adapter.vectors = np.vstack([rows[d][2] for d in adapter.definition_ids])
    return adapter


@pytest.fixture
def polysemous():
    """A two-sense centre plus an orthogonal steering word.

    The steering direction is orthogonal to everything the centre is near, so it cannot
    explain any reordering between its senses' neighbours. Anything that moves at a
    negligible weight moved because the aggregation changed, not because of steering.
    """
    return build({
        "d_a1": ("w_centre", "ขัน", unit([1.0, 0.0, 0.0, 0.0])),
        "d_a2": ("w_centre", "ขัน", unit([0.0, 1.0, 0.0, 0.0])),
        "d_p": ("w_p", "ใกล้สุด", unit([0.999, 0.045, 0.0, 0.0])),
        "d_q": ("w_q", "กึ่งกลาง", unit([0.7071, 0.7071, 0.0, 0.0])),
        "d_s": ("w_steer", "ทิศ", unit([0.0, 0.0, 0.0, 1.0])),
    })


def test_a_negligible_weight_does_not_reorder_a_polysemous_centre(polysemous):
    """The slider must be continuous at zero.

    Mean-pooling the centre while steering but max-pooling it otherwise silently swaps the
    ranking at the first notch, for a reason that has nothing to do with the steering word.
    """
    # The steering word itself drops out by design once steering is on, so compare the
    # ordering of everything else — that is what a negligible weight must leave alone.
    plain = [word for word in words(polysemous.neighbours(["d_a1", "d_a2"], 3)) if word != "ทิศ"]
    nudged = words(polysemous.neighbours(["d_a1", "d_a2"], 3, ["d_s"], 0.001))
    assert plain[0] == "ใกล้สุด"
    assert nudged == plain


def test_each_sense_is_steered_rather_than_their_average(polysemous):
    """Aggregation stays max-over-senses in both paths, so a centre's nearest sense keeps
    deciding its neighbours instead of being averaged away."""
    scores = {
        weight: words(polysemous.neighbours(["d_a1", "d_a2"], 3, ["d_s"], weight))
        for weight in (0.0, 0.25, 0.5)
    }
    for ranked in scores.values():
        assert ranked[0] == "ใกล้สุด"


def test_endpoints_are_byte_identical_for_multiple_destination_senses(polysemous):
    """REQ-UX-034: endpoints retain every score, sense, exclusion and ordering."""
    import json

    centre, destination = ["d_s"], ["d_a1", "d_a2"]
    assert json.dumps(polysemous.neighbours(centre, 4, destination, 0)).encode() == json.dumps(
        polysemous.neighbours(centre, 4)
    ).encode()
    assert json.dumps(polysemous.neighbours(centre, 4, destination, 1)).encode() == json.dumps(
        polysemous.neighbours(destination, 4)
    ).encode()


@pytest.mark.parametrize("destination", [[1, 1e-10, 0], [-1, 0, 0], [-1, 1e-7, 0], [0, 1, 0]])
def test_slerp_is_finite_unit_norm_and_moves_at_constant_angular_rate(destination):
    """REQ-UX-034: parallel and antipodal arcs stay deterministic and continuous."""
    from khamlink.bge import slerp

    start, end = unit([1, 0, 0]), unit(destination)
    angle = np.arccos(np.clip(start.astype(float) @ end.astype(float), -1, 1))
    for weight in np.linspace(0, 1, 21):
        target = slerp(start, end, weight)
        assert np.isfinite(target).all()
        assert np.linalg.norm(target) == pytest.approx(1)
        assert np.arccos(np.clip(start @ target, -1, 1)) == pytest.approx(angle * weight, abs=2e-7)
        np.testing.assert_array_equal(target, slerp(start, end, weight))


def test_diversity_reduces_mean_pairwise_cosine_against_round_one():
    """REQ-UX-034: lower mean unordered-pair cosine measures greater set diversity."""
    centre, destination = unit([1, 0, 0]), unit([0, 1, 0])
    adapter = build({
        "c": ("c", "centre", centre),
        "s": ("s", "destination", destination),
        "a": ("a", "a", unit([1, 0.5, 0])),
        "b": ("b", "b", unit([1, 0.51, 0])),
        "d": ("d", "d", unit([1, 0.49, 0])),
        "e": ("e", "e", unit([0.5, 1, 0.4])),
        "f": ("f", "f", unit([0.5, 1, -0.4])),
    })
    old_scores = adapter.vectors @ unit(centre + 0.5 * destination)
    baseline = [int(row) for row in np.argsort(-old_scores) if row not in (0, 1)][:3]
    results = adapter.neighbours(["c"], 3, ["s"], 0.5)
    selected = [adapter.row_of_definition[item["definition_id"]] for item in results]
    old_pairs = adapter.vectors[baseline] @ adapter.vectors[baseline].T
    new_pairs = adapter.vectors[selected] @ adapter.vectors[selected].T
    triangle = np.triu_indices(3, k=1)
    assert new_pairs[triangle].mean() < old_pairs[triangle].mean() - 0.05
    assert results == adapter.neighbours(["c"], 3, ["s"], 0.5)
    assert "destination" not in words(results)
