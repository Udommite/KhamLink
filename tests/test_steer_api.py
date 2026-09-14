"""REQ-UX-021 at the HTTP boundary.

Steering is an optional decoration on /related. These tests pin the two properties that
make it safe to add to an endpoint other things already depend on: it never removes the
map, and it never changes the response for callers that do not ask for it.
"""

import pytest


def body(response):
    assert response.status_code == 200, response.text
    return response.json()["data"]


def test_an_unsteered_request_keeps_exactly_its_previous_shape(system):
    """No steer parameter must mean no new keys — an existing consumer cannot notice this
    feature exists."""
    plain = body(system["client"].get("/api/words/ความสุข/related"))
    assert "steer_state" not in plain
    assert "steer" not in plain


@pytest.mark.parametrize(
    "query",
    [
        "?steer=%20%20%20&steer_weight=0.5",  # whitespace normalises to empty
        "?steer=" + "ก" * 600 + "&steer_weight=0.5",  # over the 512 code-point limit
        "?steer=ไม่มีคำนี้ในพจนานุกรม&steer_weight=0.5",  # simply absent
    ],
)
def test_an_unusable_steering_word_never_takes_the_map_down(system, query):
    """The map is the primary payload. A bad optional parameter degrades itself, it does
    not 400 the centre word, its relationships or its source attribution away."""
    steered = body(system["client"].get("/api/words/ความสุข/related" + query))
    plain = body(system["client"].get("/api/words/ความสุข/related"))
    assert steered["center"] == plain["center"]
    assert steered["relationships"] == plain["relationships"]
    assert steered["semantic_neighbours"] == plain["semantic_neighbours"]
    assert steered["steer_state"] in {"unknown_word", "unavailable"}


@pytest.mark.parametrize("weight", ["nan", "inf", "-5", "1e9"])
def test_a_nonsense_weight_is_clamped_rather_than_trusted(system, weight):
    """Weight arrives from a query string, so it can be anything a float parses."""
    steered = body(system["client"].get(f"/api/words/ความสุข/related?steer=ทุกข์&steer_weight={weight}"))
    assert steered["steer_state"] in {"active", "inactive", "unknown_word", "unavailable"}
    assert steered["center"]["word"] == "ความสุข"


def test_weight_zero_returns_the_unsteered_neighbours(system):
    """Zero is off. The steering word is still echoed back so the UI can label the control,
    but the neighbour list is the unsteered one."""
    zero = body(system["client"].get("/api/words/ความสุข/related?steer=ทุกข์&steer_weight=0"))
    plain = body(system["client"].get("/api/words/ความสุข/related"))
    assert zero["semantic_neighbours"] == plain["semantic_neighbours"]
    assert zero["steer_state"] in {"inactive", "unavailable"}
