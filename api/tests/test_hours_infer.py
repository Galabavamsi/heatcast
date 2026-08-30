"""Peak / compound hours are Open-Meteo air proxies, not MW or CO2."""

from __future__ import annotations

import unittest

from app.hours_infer import heat_load_index, infer_compound_hours, infer_peak_hours, unrelieved_streak


class HoursInferTests(unittest.TestCase):
    def test_heat_load_is_degree_hours(self):
        self.assertEqual(heat_load_index(38.0, 35.0), 3.0)
        self.assertEqual(heat_load_index(30.0, 35.0), 0.0)
        self.assertEqual(heat_load_index(None, 35.0), 0.0)

    def test_unrelieved_streak(self):
        temps = [28, 36, 37, 38, 34, 36, 36]
        streak = unrelieved_streak(temps, 35.0)
        self.assertEqual(streak["hours"], 3)
        self.assertEqual(streak["start_index"], 1)
        self.assertEqual(streak["end_index"], 3)

    def test_peak_hours_hottest_and_solar(self):
        times = [f"2024-07-15T{h:02d}:00" for h in range(24)]
        temps = [28.0] * 12 + [36.0, 39.0, 38.0] + [30.0] * 9
        ghi = [0] * 10 + [400, 700, 900, 800] + [0] * 10
        out = infer_peak_hours(times=times, temps=temps, ghi=ghi, threshold_c=35.0)
        self.assertEqual(out["kind"], "neighborhood_heat_load")
        self.assertEqual(out["not_used"], "transformer_mw_duck_curve_eia")
        self.assertEqual(out["hottest"]["temp_c"], 39.0)
        self.assertEqual(out["hottest"]["hour"], "13:00")
        self.assertEqual(out["hours_above"], 3)
        self.assertEqual(out["unrelieved_streak_h"], 3)
        self.assertEqual(out["solar_peak"]["hour"], "12:00")
        self.assertIn("not transformer", out["label"].lower())

    def test_compound_uses_aqi_when_present(self):
        times = ["00:00", "01:00", "14:00", "15:00"]
        temps = [28.0, 36.0, 38.0, 37.0]
        rh = [40.0, 40.0, 70.0, 55.0]
        aqi = [40.0, 40.0, 120.0, 80.0]
        out = infer_compound_hours(
            times=times,
            temps=temps,
            rh=rh,
            us_aqi=aqi,
            threshold_c=35.0,
        )
        self.assertTrue(out["has_us_aqi"])
        self.assertEqual(out["aqi_compound_hours"], 1)
        self.assertEqual(out["humidity_compound_hours"], 1)
        self.assertEqual(out["compound_hours"], 1)
        self.assertEqual(out["not_used"], "co2_methane_fortyguard_aqi")

    def test_compound_falls_back_to_humidity(self):
        times = ["14:00", "15:00"]
        temps = [38.0, 30.0]
        rh = [70.0, 70.0]
        out = infer_compound_hours(times=times, temps=temps, rh=rh, us_aqi=[], threshold_c=35.0)
        self.assertFalse(out["has_us_aqi"])
        self.assertEqual(out["compound_hours"], 1)
        self.assertIn("humidity", (out["aqi_note"] or "").lower())


if __name__ == "__main__":
    unittest.main()
