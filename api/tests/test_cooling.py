from __future__ import annotations

import unittest

from app.cooling import _center


class CoolingParseTests(unittest.TestCase):
    def test_center_from_node(self):
        lat, lon = _center({"lat": 29.75, "lon": -95.36})
        self.assertAlmostEqual(lat, 29.75)
        self.assertAlmostEqual(lon, -95.36)

    def test_center_from_way(self):
        lat, lon = _center({"center": {"lat": 33.45, "lon": -112.07}})
        self.assertAlmostEqual(lat, 33.45)
        self.assertAlmostEqual(lon, -112.07)

    def test_missing_geom(self):
        lat, lon = _center({})
        self.assertIsNone(lat)
        self.assertIsNone(lon)


if __name__ == "__main__":
    unittest.main()
