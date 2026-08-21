"""AOI area: local WGS84 rectangle, not Web Mercator.

Web ``areaMi2`` in web/src/lib/aoi.ts must use the same metres-per-degree
helper (111_132.954 − 559.822·cos(2φ) + 1.175·cos(4φ) lat; 111.320 km × cos(φ)
lon). There is no JS unit-test runner; this file is the contract.
"""

from __future__ import annotations

import math
import unittest

from app.geo import aoi_from_bbox, polygon_area_mi2

# Share-URL bbox from /app?west=&south=&east=&north= (Houston, 2024-07-15 15:00).
HOUSTON_WEST = -95.40236
HOUSTON_SOUTH = 29.73387
HOUSTON_EAST = -95.37434
HOUSTON_NORTH = 29.75282

# Independent checks for this ring (closed WGS84 rectangle):
#   geographiclib Geodesic.WGS84 PolygonArea ≈ 2.198 mi²
#   haversine NS × mean EW ≈ 2.201 mi²
#   WGS84 series mid-lat rectangle ≈ 2.196 mi²
# Treating 1° lon like 1° lat (no cos) yields ≈ 2.52–2.59 mi².
HOUSTON_MI2 = 2.20
HOUSTON_TOL = 0.05


def _web_area_mi2(west: float, south: float, east: float, north: float) -> float:
    """Mirror of web/src/lib/aoi.ts areaMi2 — keep literals identical."""
    lat = (south + north) / 2.0
    phi = math.radians(lat)
    m_lat = 111132.954 - 559.822 * math.cos(2.0 * phi) + 1.175 * math.cos(4.0 * phi)
    m_lon = 111320.0 * math.cos(phi)
    m2 = (east - west) * m_lon * (north - south) * m_lat
    return m2 / (1609.344 * 1609.344)


class HoustonAoiAreaTests(unittest.TestCase):
    def test_share_url_bbox_is_about_2_20_not_2_59(self):
        aoi = aoi_from_bbox(HOUSTON_WEST, HOUSTON_SOUTH, HOUSTON_EAST, HOUSTON_NORTH)
        area = polygon_area_mi2(aoi)
        self.assertAlmostEqual(area, HOUSTON_MI2, delta=HOUSTON_TOL)
        # Forgetting cos(latitude) on longitude is ~18% high.
        self.assertLess(area, 2.40)

    def test_web_area_mi2_matches_python_helper(self):
        aoi = aoi_from_bbox(HOUSTON_WEST, HOUSTON_SOUTH, HOUSTON_EAST, HOUSTON_NORTH)
        web = _web_area_mi2(HOUSTON_WEST, HOUSTON_SOUTH, HOUSTON_EAST, HOUSTON_NORTH)
        self.assertAlmostEqual(web, polygon_area_mi2(aoi), delta=1e-9)

    def test_same_degree_span_shrinks_with_latitude(self):
        span = 0.02
        equator = polygon_area_mi2(aoi_from_bbox(-95.0, 0.0, -95.0 + span, span))
        houston = polygon_area_mi2(aoi_from_bbox(-95.0, 29.74, -95.0 + span, 29.74 + span))
        anchorage = polygon_area_mi2(aoi_from_bbox(-150.0, 61.2, -150.0 + span, 61.2 + span))
        self.assertGreater(equator, houston)
        self.assertGreater(houston, anchorage)


if __name__ == "__main__":
    unittest.main()
