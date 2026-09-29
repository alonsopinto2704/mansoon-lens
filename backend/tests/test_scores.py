import numpy as np
import pytest
from backend.verification.scores import contingency, fss, gate, scores


def test_contingency_by_hand():
    y = [70, 70, 0, 0]
    p = [70, 0, 70, 0]
    result = contingency(y, p)
    assert (result["hits"], result["misses"], result["false_alarms"], result["correct_negatives"]) == (1, 1, 1, 1)
    assert result["pod"] == result["far"] == result["csi"] * 1.5 == .5
    assert result["ets"] == 0


def test_brier_and_fss():
    assert scores([0, 100], [0, 100], [.1, .9])["brier"] == pytest.approx(.01)
    grid = np.array([[0, 100], [0, 0]])
    assert fss(grid, grid, window=1) == 1


def test_gate_insufficient_events():
    result = gate([0, 0], [0, 0], [0, 0], [0, 0], [1, 1])
    assert result["status"] == "Serving raw"
