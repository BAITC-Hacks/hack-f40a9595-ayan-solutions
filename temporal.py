"""Daily observations from individual transfers; no intraday ordering is inferred."""

import pandas as pd


def daily_activity(transactions: pd.DataFrame, gid: int) -> pd.DataFrame:
    incoming = transactions.loc[transactions.dst.eq(gid), ["date", "sum_kzt"]]
    outgoing = transactions.loc[transactions.src.eq(gid), ["date", "sum_kzt"]]
    incoming = incoming.groupby("date").agg(in_kzt=("sum_kzt", "sum"), in_tx=("sum_kzt", "size"))
    outgoing = outgoing.groupby("date").agg(out_kzt=("sum_kzt", "sum"), out_tx=("sum_kzt", "size"))
    daily = incoming.join(outgoing, how="outer").fillna(0)
    daily.index = pd.to_datetime(daily.index)
    daily.index.name = "date"
    if daily.empty:
        return pd.DataFrame(columns=["in_kzt", "in_tx", "out_kzt", "out_tx"], index=pd.DatetimeIndex([], name="date"))
    return daily.sort_index().astype({"in_tx": int, "out_tx": int})


def temporal_summary(daily: pd.DataFrame) -> dict:
    if daily.empty:
        return {"active_days": 0, "same_day_both": 0, "max_daily_in_kzt": 0.0, "max_daily_out_kzt": 0.0}
    return {
        "active_days": len(daily),
        "same_day_both": int(((daily.in_tx > 0) & (daily.out_tx > 0)).sum()),
        "max_daily_in_kzt": float(daily.in_kzt.max()),
        "max_daily_out_kzt": float(daily.out_kzt.max()),
    }
