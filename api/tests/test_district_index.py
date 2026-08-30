"""District index is a HeatCast 0–100 score, not insurance."""

from __future__ import annotations

import unittest

from app.district_index import band_for, district_heatcast_index, intensity_component


class DistrictIndexTests(unittest.TestCase):
    def test_intensity_anchors(self):
        self.assertEqual(intensity_component(29.0, 35.0), 0.0)
        self.assertEqual(intensity_component(35.0, 35.0), 0.5)
        self.assertEqual(intensity_component(41.0, 35.0), 1.0)

    def test_houston_ish_mid_range(self):
        out = district_heatcast_index(
            mean_c=35.5,
            threshold_c=35.0,
            mean_hours_above=5.09,
            mean_streak_hours=3.0,
            source="fortyguard",
        )
        self.assertTrue(out["ok"])
        self.assertEqual(out["kind"], "heatcast_district_index")
        self.assertEqual(out["not_used"], "insurance_fico_parametric")
        self.assertGreaterEqual(out["index"], 40)
        self.assertLessEqual(out["index"], 70)
        self.assertIn(out["band"], {"elevated", "high"})
        self.assertNotIn("svi", out["weights"])
        self.assertIn("not insurance", out["note"].lower())

    def test_svi_is_optional_overlay(self):
        base = district_heatcast_index(
            mean_c=38.0,
            threshold_c=35.0,
            mean_hours_above=8.0,
            unrelieved_ratio=0.8,
        )
        with_svi = district_heatcast_index(
            mean_c=38.0,
            threshold_c=35.0,
            mean_hours_above=8.0,
            unrelieved_ratio=0.8,
            mean_svi=0.9,
        )
        self.assertIn("svi", with_svi["weights"])
        self.assertGreaterEqual(with_svi["index"], base["index"])

    def test_missing_inputs(self):
        out = district_heatcast_index(mean_c=None, mean_hours_above=None)
        self.assertFalse(out["ok"])
        self.assertIsNone(out["index"])

    def test_band_edges(self):
        self.assertEqual(band_for(0), "modest")
        self.assertEqual(band_for(24), "modest")
        self.assertEqual(band_for(25), "elevated")
        self.assertEqual(band_for(74), "high")
        self.assertEqual(band_for(75), "extreme")


if __name__ == "__main__":
    unittest.main()
