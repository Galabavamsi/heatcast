"""Same-hour TCM ΔT join (no network)."""

from __future__ import annotations

import unittest

from app.delta import annotate_grad, build_delta_layer, join_tiles


def _square(lon: float, lat: float, half: float = 0.00035) -> dict:
    return {
        "type": "Polygon",
        "coordinates": [
            [
                [lon - half, lat - half],
                [lon + half, lat - half],
                [lon + half, lat + half],
                [lon - half, lat + half],
                [lon - half, lat - half],
            ]
        ],
    }


def _tile(lon: float, lat: float, temp: float, tile_id: str | None = None) -> dict:
    props: dict = {"temperature": temp}
    if tile_id is not None:
        props["tile_id"] = tile_id
    return {"type": "Feature", "geometry": _square(lon, lat), "properties": props}


class DeltaJoinTests(unittest.TestCase):
    def test_join_by_tile_id(self):
        start = [
            _tile(-95.36, 29.75, 30.0, "a"),
            _tile(-95.359, 29.75, 32.0, "b"),
        ]
        end = [
            _tile(-95.36, 29.75, 33.0, "a"),
            _tile(-95.359, 29.75, 31.0, "b"),
        ]
        pairs = join_tiles(start, end)
        how = {(_as_id(s), _as_id(e)): method for s, e, method in pairs}
        self.assertEqual(how[("a", "a")], "tile_id")
        self.assertEqual(how[("b", "b")], "tile_id")
        self.assertEqual(len(pairs), 2)

    def test_join_nearest_centroid_without_ids(self):
        start = [_tile(-95.36, 29.75, 30.0), _tile(-95.358, 29.75, 32.0)]
        end = [_tile(-95.36005, 29.75002, 34.0), _tile(-95.35802, 29.74998, 31.0)]
        pairs = join_tiles(start, end)
        self.assertEqual(len(pairs), 2)
        self.assertTrue(all(method == "nearest" for _s, _e, method in pairs))

    def test_unmatched_end_tile_omitted(self):
        start = [_tile(-95.36, 29.75, 30.0, "a")]
        end = [
            _tile(-95.36, 29.75, 33.0, "a"),
            _tile(-96.0, 30.5, 40.0, "far"),
        ]
        pairs = join_tiles(start, end)
        self.assertEqual(len(pairs), 1)
        self.assertEqual(_as_id(pairs[0][0]), "a")

    def test_delta_values_and_stats(self):
        start = [
            _tile(-95.36, 29.75, 30.0, "a"),
            _tile(-95.359, 29.75, 32.0, "b"),
        ]
        end = [
            _tile(-95.36, 29.75, 33.0, "a"),
            _tile(-95.359, 29.75, 31.0, "b"),
        ]
        layer = build_delta_layer(
            start,
            end,
            hour="15:00",
            start_date="2024-07-15",
            end_date="2024-07-18",
        )
        self.assertIsNotNone(layer)
        assert layer is not None
        self.assertEqual(layer["n_matched"], 2)
        self.assertEqual(layer["mean_delta"], 1.0)  # (3 + -1) / 2
        self.assertEqual(layer["max_delta"], 3.0)
        self.assertEqual(layer["min_delta"], -1.0)
        self.assertEqual(layer["hour"], "15:00")
        feats = layer["heatmap"]["features"]
        self.assertEqual(len(feats), 2)
        by_id = {str(ft["properties"]["tile_id"]): ft["properties"] for ft in feats}
        self.assertEqual(by_id["a"]["delta_c"], 3.0)
        self.assertEqual(by_id["a"]["temperature"], 3.0)
        self.assertEqual(by_id["a"]["delta_abs"], 3.0)
        self.assertEqual(by_id["b"]["delta_c"], -1.0)
        self.assertIn("grad", by_id["a"])
        self.assertGreater(by_id["a"]["grad"], 0)

    def test_grad_higher_at_uneven_edge(self):
        # Three 100 m-ish neighbors: two cool equally, one jumps.
        west = _tile(-95.361, 29.75, 30.0, "w")
        mid = _tile(-95.360, 29.75, 30.0, "m")
        east = _tile(-95.359, 29.75, 30.0, "e")
        start = [west, mid, east]
        end = [
            _tile(-95.361, 29.75, 31.0, "w"),
            _tile(-95.360, 29.75, 31.0, "m"),
            _tile(-95.359, 29.75, 36.0, "e"),
        ]
        layer = build_delta_layer(start, end, hour="15:00", start_date="2024-07-15", end_date="2024-07-16")
        assert layer is not None
        by_id = {str(ft["properties"]["tile_id"]): ft["properties"]["grad"] for ft in layer["heatmap"]["features"]}
        self.assertGreater(by_id["e"], by_id["w"])
        self.assertGreater(by_id["m"], 0)

    def test_empty_end_omits_layer(self):
        start = [_tile(-95.36, 29.75, 30.0, "a")]
        self.assertIsNone(
            build_delta_layer(start, [], hour="15:00", start_date="2024-07-15", end_date="2024-07-16")
        )

    def test_annotate_grad_isolated_tile_is_zero(self):
        feats = [_tile(-95.36, 29.75, 2.0, "solo")]
        feats[0]["properties"]["delta_c"] = 2.0
        out = annotate_grad(feats)
        self.assertEqual(out[0]["properties"]["grad"], 0.0)


def _as_id(ft: dict) -> str:
    return str((ft.get("properties") or {}).get("tile_id"))


if __name__ == "__main__":
    unittest.main()
