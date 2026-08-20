"""Canopy overlay stays on air-temperature CE, not LST."""

from __future__ import annotations

import unittest

from app.scenario import (
    C_PER_PCT_CENTRAL,
    C_PER_PCT_HIGH,
    C_PER_PCT_LOW,
    CITATIONS,
    estimate_scenario,
)


class AirCeTests(unittest.TestCase):
    def test_central_slope_is_air_not_lst(self):
        self.assertEqual(C_PER_PCT_CENTRAL, 0.015)
        self.assertLess(C_PER_PCT_HIGH, 0.03)
        self.assertGreaterEqual(C_PER_PCT_LOW, 0.01)

    def test_plus_10pct_delta(self):
        out = estimate_scenario(
            canopy_delta_pct=10,
            current_canopy_pct=None,
            mean_c=38.0,
            mean_hours=4.0,
            threshold_c=35.0,
        )
        self.assertEqual(out["estimated_delta_c"], 0.15)
        self.assertEqual(out["estimated_delta_c_range"]["low"], 0.1)
        self.assertEqual(out["estimated_delta_c_range"]["high"], 0.2)
        self.assertEqual(out["metric"], "air_temperature_c")
        self.assertEqual(out["not_used"], "lst_cooling_efficiency")

    def test_du_2024_cited(self):
        titles = " ".join(c["title"] for c in CITATIONS).lower()
        self.assertIn("du et al", titles)
        notes = " ".join(c["note"] for c in CITATIONS).lower()
        self.assertIn("0.006", notes)
        self.assertIn("0.075", notes)
        self.assertIn("lst", notes)


if __name__ == "__main__":
    unittest.main()
