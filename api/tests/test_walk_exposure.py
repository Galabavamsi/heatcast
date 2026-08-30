"""Walk exposure samples nearest TCM tiles — not cargo or WBGT."""

from __future__ import annotations

import unittest

from app.walk_exposure import hottest_stretch, sample_walk_exposure


def _tile(lon: float, lat: float, temp: float, tile_id: str) -> dict:
    ring = [
        [lon - 0.0005, lat - 0.0005],
        [lon + 0.0005, lat - 0.0005],
        [lon + 0.0005, lat + 0.0005],
        [lon - 0.0005, lat + 0.0005],
        [lon - 0.0005, lat - 0.0005],
    ]
    return {
        "type": "Feature",
        "geometry": {"type": "Polygon", "coordinates": [ring]},
        "properties": {"tile_id": tile_id, "temperature": temp},
    }


class WalkExposureTests(unittest.TestCase):
    def test_samples_nearest_tile(self):
        heatmap = {
            "type": "FeatureCollection",
            "features": [
                _tile(-95.35, 29.75, 36.0, "cool"),
                _tile(-95.34, 29.75, 38.5, "hot"),
            ],
        }
        path = [[-95.35, 29.75], [-95.345, 29.75], [-95.34, 29.75]]
        out = sample_walk_exposure(path, heatmap, threshold_c=35.0)
        self.assertTrue(out["ok"])
        self.assertEqual(out["not_used"], "cargo_vaccine_wbgt_osha")
        self.assertEqual(out["max_c"], 38.5)
        self.assertGreaterEqual(out["mean_c"], 36.0)
        self.assertEqual(out["samples"][0]["tile_id"], "cool")
        self.assertEqual(out["samples"][-1]["tile_id"], "hot")
        stretch = out["hottest_stretch"]
        self.assertIsNotNone(stretch)
        self.assertGreaterEqual(stretch["max_c"], 36.0)

    def test_hottest_stretch_window(self):
        samples = [
            {"temp_c": 30.0, "along_m": 0},
            {"temp_c": 37.0, "along_m": 100},
            {"temp_c": 38.0, "along_m": 200},
            {"temp_c": 31.0, "along_m": 300},
        ]
        stretch = hottest_stretch(samples, window=2)
        self.assertEqual(stretch["start_index"], 1)
        self.assertEqual(stretch["mean_c"], 37.5)

    def test_empty_path(self):
        out = sample_walk_exposure([], {"features": []})
        self.assertFalse(out["ok"])


if __name__ == "__main__":
    unittest.main()
