"""Cooling-plan levers stay on air CE, not LST, and attribute ΔT."""

from __future__ import annotations

import unittest

from app.cooling_plan import (
    PAVE_C_PER_PCT,
    ROOF_C_PER_PCT,
    estimate_cooling_plan,
)


class CoolingPlanTests(unittest.TestCase):
    def test_canopy_matches_existing_air_ce(self):
        out = estimate_cooling_plan(
            canopy_delta_pct=10,
            roof_delta_pct=0,
            pavement_delta_pct=0,
            mean_c=38.0,
            mean_hours=4.0,
            threshold_c=35.0,
        )
        self.assertEqual(out["canopy"]["estimated_delta_c"], 0.15)
        self.assertEqual(out["estimated_delta_c"], 0.15)
        self.assertEqual(out["not_used"], "lst_cooling_efficiency")

    def test_roof_and_pavement_are_smaller_than_canopy(self):
        self.assertLess(ROOF_C_PER_PCT, 0.015)
        self.assertLess(PAVE_C_PER_PCT, ROOF_C_PER_PCT)
        out = estimate_cooling_plan(
            canopy_delta_pct=10,
            roof_delta_pct=10,
            pavement_delta_pct=10,
            mean_c=38.0,
            threshold_c=35.0,
        )
        canopy = out["canopy"]["estimated_delta_c"]
        roof = out["cool_roof"]["estimated_delta_c"]
        pave = out["pavement"]["estimated_delta_c"]
        self.assertEqual(roof, 0.08)
        self.assertEqual(pave, 0.05)
        self.assertAlmostEqual(out["estimated_delta_c"], canopy + roof + pave)
        levers = {row["lever"]: row["delta_c"] for row in out["attribution"]}
        self.assertEqual(levers["canopy"], canopy)
        self.assertEqual(levers["cool_roof"], roof)
        self.assertEqual(levers["pavement"], pave)

    def test_literature_label(self):
        out = estimate_cooling_plan(canopy_delta_pct=0)
        self.assertIn("not a new fortyguard heatmap", out["label"].lower())
        self.assertEqual(out["cool_roof"]["source"], "literature_estimate")


if __name__ == "__main__":
    unittest.main()
