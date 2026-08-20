"""Planner brief context compaction (no network)."""

from __future__ import annotations

import unittest

from app.memo import _brief_context, write_memo


class BriefContextTests(unittest.TestCase):
    def test_drops_null_flood_and_empty_satellite(self):
        compact = _brief_context(
            {
                "city": "EaDo",
                "scorecard": {"mean_c": 34.58, "max_c": 34.78, "threshold_c": 35.0},
                "flood": {"zone": None, "caveat": "label only"},
                "satellite_buckets": None,
                "rain": {"daily_precip_mm": 0.4},
            }
        )
        self.assertNotIn("flood", compact)
        self.assertNotIn("satellite_buckets", compact)
        self.assertEqual(compact["rain"]["daily_precip_mm"], 0.4)

    def test_template_uses_satellite_when_present(self):
        doc = write_memo(
            {
                "city": "EaDo",
                "scorecard": {"mean_c": 34.58, "max_c": 34.78, "threshold_c": 35.0},
                "satellite_buckets": {"canopy_pct": 8.2, "impervious_pct": 61.0},
                "svi": {"planner_sentence": "Two high-SVI tracts sit in the hottest third."},
            },
            use_llm=False,
        )
        self.assertEqual(doc["source"], "template")
        self.assertIn("canopy 8.2%", doc["text"])
        self.assertIn("impervious 61.0%", doc["text"])
        self.assertIn("i-Tree", doc["text"])
        self.assertIn("CDC/ATSDR SVI", doc["text"])
        self.assertNotIn("null", doc["text"].lower())
