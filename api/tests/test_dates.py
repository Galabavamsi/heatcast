"""Duration window + AnalyzeRequest end_date (no network)."""

from __future__ import annotations

import unittest

from app.dates import MAX_DURATION_DAYS, duration_note, duration_window


class DurationWindowTests(unittest.TestCase):
    def test_same_day_is_filter_type_3(self):
        w = duration_window("2024-07-15", "2024-07-15")
        self.assertEqual(w.start_date, "2024-07-15")
        self.assertIsNone(w.end_date)
        self.assertEqual(w.filter_type, 3)
        self.assertEqual(w.days, 1)
        self.assertFalse(w.clamped)

    def test_missing_end_is_one_day(self):
        w = duration_window("2024-07-15")
        self.assertEqual(w.filter_type, 3)
        self.assertIsNone(w.end_date)

    def test_week_span_is_filter_type_4(self):
        w = duration_window("2024-07-15", "2024-07-21")
        self.assertEqual(w.filter_type, 4)
        self.assertEqual(w.end_date, "2024-07-21")
        self.assertEqual(w.days, 7)
        self.assertFalse(w.clamped)

    def test_two_days_uses_range_product(self):
        w = duration_window("2024-07-15", "2024-07-16")
        self.assertEqual(w.filter_type, 4)
        self.assertEqual(w.days, 2)
        self.assertEqual(w.end_date, "2024-07-16")

    def test_caps_at_seven_inclusive_days(self):
        w = duration_window("2024-07-15", "2024-07-31")
        self.assertTrue(w.clamped)
        self.assertEqual(w.days, MAX_DURATION_DAYS)
        self.assertEqual(w.end_date, "2024-07-21")
        self.assertEqual(w.filter_type, 4)

    def test_end_before_start_collapses_to_from_day(self):
        w = duration_window("2024-07-20", "2024-07-15")
        self.assertEqual(w.start_date, "2024-07-20")
        self.assertEqual(w.filter_type, 3)
        self.assertIsNone(w.end_date)
        self.assertTrue(w.clamped)

    def test_rejects_bad_dates(self):
        with self.assertRaises(ValueError):
            duration_window("07/15/2024")

    def test_note_is_honest(self):
        one = duration_note(duration_window("2024-07-15"))
        self.assertIn("one day", one.lower())
        week = duration_note(duration_window("2024-07-15", "2024-07-21"))
        self.assertIn("7-day", week)
        self.assertNotIn("custom 3-day", week.lower())


class AnalyzeRequestDatesTests(unittest.TestCase):
    def test_end_date_optional_and_accepted(self):
        from app.main import AnalyzeRequest

        body = AnalyzeRequest(start_date="2024-07-15", start_time="15:00")
        self.assertIsNone(body.end_date)
        ranged = AnalyzeRequest(
            start_date="2024-07-15",
            start_time="15:00",
            end_date="2024-07-21",
        )
        self.assertEqual(ranged.end_date, "2024-07-21")

    def test_empty_end_date_is_none(self):
        from app.main import AnalyzeRequest

        body = AnalyzeRequest(start_date="2024-07-15", start_time="15:00", end_date="")
        self.assertIsNone(body.end_date)


if __name__ == "__main__":
    unittest.main()
