"""Unit tests for CDC SVI overlay (no network)."""

from __future__ import annotations

import unittest

from app.svi import (
    PRIORITY_FORMULA,
    SviError,
    _svi_value,
    join_heat_to_tracts,
    summarize_svi,
    svi_for_bbox,
)


def _box(x0: float, y0: float, x1: float, y1: float) -> dict:
    ring = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
    return {"type": "Polygon", "coordinates": [ring]}


class SviValueTests(unittest.TestCase):
    def test_excludes_sentinel(self):
        self.assertIsNone(_svi_value(-999))
        self.assertIsNone(_svi_value(None))
        self.assertIsNone(_svi_value("x"))

    def test_clamps_unit_interval(self):
        self.assertEqual(_svi_value(0.8242), 0.8242)
        self.assertEqual(_svi_value(0), 0.0)
        self.assertEqual(_svi_value(1), 1.0)


class SviJoinTests(unittest.TestCase):
    def setUp(self):
        self.tracts = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "id": "hot",
                    "properties": {
                        "fips": "hot",
                        "name": "Census Tract 1",
                        "svi": 0.9,
                        "svi_pct": 90,
                        "high_svi": True,
                    },
                    "geometry": _box(-112.10, 33.40, -112.05, 33.45),
                },
                {
                    "type": "Feature",
                    "id": "cool",
                    "properties": {
                        "fips": "cool",
                        "name": "Census Tract 2",
                        "svi": 0.2,
                        "svi_pct": 20,
                        "high_svi": False,
                    },
                    "geometry": _box(-112.05, 33.40, -112.00, 33.45),
                },
            ],
        }
        self.heatmap = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {"temperature": 42.0},
                    "geometry": _box(-112.09, 33.41, -112.08, 33.42),
                },
                {
                    "type": "Feature",
                    "properties": {"temperature": 41.0},
                    "geometry": _box(-112.085, 33.415, -112.075, 33.425),
                },
                {
                    "type": "Feature",
                    "properties": {"temperature": 30.0},
                    "geometry": _box(-112.04, 33.41, -112.03, 33.42),
                },
            ],
        }

    def test_priority_is_svi_times_heat_norm(self):
        joined = join_heat_to_tracts(self.tracts, self.heatmap)
        by_id = {ft["properties"]["fips"]: ft["properties"] for ft in joined["features"]}
        hot = by_id["hot"]
        cool = by_id["cool"]
        self.assertGreater(hot["mean_c"], cool["mean_c"])
        expected_norm = (hot["mean_c"] - 30.0) / (42.0 - 30.0)
        self.assertAlmostEqual(hot["heat_norm"], expected_norm, places=3)
        self.assertAlmostEqual(hot["priority"], 0.9 * hot["heat_norm"], places=3)
        self.assertLess(cool["priority"], hot["priority"])
        self.assertIn("SVI_percentile", PRIORITY_FORMULA)

    def test_null_svi_excluded_before_join(self):
        self.assertIsNone(_svi_value(-999))

    def test_summary_names_overlap(self):
        joined = join_heat_to_tracts(self.tracts, self.heatmap)
        summary, top = summarize_svi(joined, joined=True)
        self.assertEqual(summary["tract_count"], 2)
        self.assertTrue(top)
        self.assertEqual(top[0]["fips"], "hot")
        self.assertIn("hottest third", summary["planner_sentence"].lower())


class SviBboxTests(unittest.TestCase):
    def test_rejects_non_us(self):
        with self.assertRaises(SviError):
            svi_for_bbox(2.0, 48.0, 2.4, 48.3)

    def test_rejects_huge_box(self):
        with self.assertRaises(SviError):
            svi_for_bbox(-124.0, 25.0, -67.0, 49.0)


if __name__ == "__main__":
    unittest.main()
