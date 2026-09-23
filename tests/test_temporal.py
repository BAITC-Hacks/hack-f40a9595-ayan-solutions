import pandas as pd

from temporal import daily_activity, temporal_summary


def test_daily_overlap_counts_days_not_individual_transfers():
    transactions = pd.DataFrame({
        "src": [1, 1, 2, 1, 3],
        "dst": [2, 2, 1, 3, 1],
        "date": pd.to_datetime(["2026-07-01", "2026-07-01", "2026-07-01", "2026-07-03", "2026-07-04"]),
        "sum_kzt": [10000.0, 20000.0, 15000.0, 25000.0, 30000.0],
    })
    daily = daily_activity(transactions, 1)
    summary = temporal_summary(daily)
    assert summary["active_days"] == 3
    assert summary["same_day_both"] == 1
    assert summary["max_daily_in_kzt"] == 30000.0
    assert summary["max_daily_out_kzt"] == 30000.0
    assert daily.loc[pd.Timestamp("2026-07-01"), "out_tx"] == 2


def test_isolate_has_no_observed_activity():
    transactions = pd.DataFrame({
        "src": [1], "dst": [2], "date": pd.to_datetime(["2026-07-01"]), "sum_kzt": [5000.0]
    })
    assert temporal_summary(daily_activity(transactions, 3))["active_days"] == 0
