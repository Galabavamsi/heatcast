"""Unrelieved-heat ratio (no network)."""

from __future__ import annotations

import unittest

from app.unrelieved import FORMULA, unrelieved_heat_ratio, unrelieved_scorecard


class UnrelievedRatioTests(unittest.TestCase):
    def test_equal_means_is_one(self):
        self.assertEqual(unrelieved_heat_ratio(5, 5), 1.0)

    def test_half(self):
        self.assertEqual(unrelieved_heat_ratio(2.5, 5), 0.5)

    def test_houston_demo_style(self):
        # README-style exceedance mean with a long consecutive run.
        self.assertEqual(unrelieved_heat_ratio(4.2, 5.09), round(4.2 / 5.09, 3))

    def test_clips_above_one(self):
        self.assertEqual(unrelieved_heat_ratio(6, 5), 1.0)

    def test_zero_streak_is_zero(self):
        self.assertEqual(unrelieved_heat_ratio(0, 4), 0.0)

    def test_missing_or_zero_hours_is_none(self):
        self.assertIsNone(unrelieved_heat_ratio(1, 0))
        self.assertIsNone(unrelieved_heat_ratio(1, None))
        self.assertIsNone(unrelieved_heat_ratio(None, 5))
        self.assertIsNone(unrelieved_heat_ratio("x", 5))

    def test_negative_streak_clamps(self):
        self.assertEqual(unrelieved_heat_ratio(-1, 4), 0.0)

    def test_scorecard_payload(self):
        payload = unrelieved_scorecard(4.2, 5.09)
        self.assertIsNotNone(payload)
        assert payload is not None
        self.assertEqual(payload["ratio"], round(4.2 / 5.09, 3))
        self.assertEqual(payload["formula"], FORMULA)
        self.assertIn("niosh", payload["citation_url"].lower())
        self.assertIn("HeatCast index", payload["note"])

    def test_scorecard_none_when_incomplete(self):
        self.assertIsNone(unrelieved_scorecard(None, 5))
        self.assertIsNone(unrelieved_scorecard(3, 0))


if __name__ == "__main__":
    unittest.main()
