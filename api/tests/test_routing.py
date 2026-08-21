"""OSRM walk helper (no network)."""

from __future__ import annotations

import unittest

from app.routing import OSRM_WALK


class WalkUrlTests(unittest.TestCase):
    def test_url_template_uses_walking_profile(self):
        url = OSRM_WALK.format(lon1=-95.35, lat1=29.75, lon2=-95.36, lat2=29.76)
        self.assertIn("/walking/", url)
        self.assertIn("-95.35,29.75", url)

    def test_requests_full_geojson_overview(self):
        from app.routing import OSRM_PARAMS, WALK_VERTEX_CAP

        self.assertEqual(OSRM_PARAMS["overview"], "full")
        self.assertEqual(OSRM_PARAMS["geometries"], "geojson")
        self.assertGreaterEqual(WALK_VERTEX_CAP, 80)
