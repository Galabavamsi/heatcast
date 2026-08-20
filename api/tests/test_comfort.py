from __future__ import annotations

import unittest

from app.weather import heat_index_c


class HeatIndexTests(unittest.TestCase):
    def test_hot_humid_is_above_air_temp(self):
        hi = heat_index_c(35.0, 70.0)
        self.assertGreater(hi, 35.0)
        self.assertLess(hi, 55.0)

    def test_cool_near_air_temp(self):
        hi = heat_index_c(22.0, 50.0)
        self.assertAlmostEqual(hi, 22.0, delta=3.0)


if __name__ == "__main__":
    unittest.main()
