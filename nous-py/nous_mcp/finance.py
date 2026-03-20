"""Financial query engine for the Nous Transactions database.

Reads a Nous database called "Transactions" and provides filtering,
aggregation, and trend analysis. Used by the MCP financial tools.
"""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import date, datetime
from typing import Any


def load_transactions(
    storage: Any,
    notebook_id: str,
    database_title: str = "Transactions",
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Load and resolve all transaction rows from a Nous database.

    Returns (resolved_rows, properties) where each row is a flat dict
    like {"Date": "2026-03-01", "Amount": 42.50, "Category": "Groceries", ...}
    """
    # Find the Transactions database
    db_pages = storage.list_database_pages(notebook_id)
    db_page = None
    for p in db_pages:
        if p.get("title", "").lower() == database_title.lower():
            db_page = p
            break

    if not db_page:
        return [], []

    # Read database content
    db_data = storage.read_database_content(notebook_id, db_page["id"])
    if not db_data:
        return [], []

    properties = db_data.get("properties", [])
    rows = db_data.get("rows", [])

    # Build resolution maps
    prop_id_to_name = {p["id"]: p["name"] for p in properties if "id" in p and "name" in p}
    option_map = _build_option_map(properties)

    # Resolve each row to a flat dict with property names and option labels
    resolved = []
    for row in rows:
        cells = row.get("cells", {})
        flat: dict[str, Any] = {"_id": row.get("id", "")}
        for prop_id, value in cells.items():
            name = prop_id_to_name.get(prop_id, prop_id)
            flat[name] = _resolve_value(value, prop_id, option_map)
        resolved.append(flat)

    return resolved, properties


def _build_option_map(properties: list[dict]) -> dict[tuple[str, str], str]:
    """Build (prop_id, option_id) → label map for select/multiSelect."""
    m: dict[tuple[str, str], str] = {}
    for prop in properties:
        ptype = prop.get("type", "")
        if ptype not in ("select", "multiSelect"):
            continue
        pid = prop.get("id", "")
        for opt in prop.get("options", []):
            oid = opt.get("id", "")
            label = opt.get("label", "")
            if pid and oid:
                m[(pid, oid)] = label
    return m


def _resolve_value(
    value: Any,
    prop_id: str,
    option_map: dict[tuple[str, str], str],
) -> Any:
    """Resolve a cell value — convert option IDs to labels."""
    if isinstance(value, str):
        resolved = option_map.get((prop_id, value))
        return resolved if resolved else value
    if isinstance(value, list):
        return [
            option_map.get((prop_id, v), v) if isinstance(v, str) else v
            for v in value
        ]
    return value


def filter_transactions(
    rows: list[dict[str, Any]],
    start_date: str | None = None,
    end_date: str | None = None,
    category: str | None = None,
    merchant: str | None = None,
    account: str | None = None,
    tx_type: str | None = None,
    min_amount: float | None = None,
    max_amount: float | None = None,
) -> list[dict[str, Any]]:
    """Filter resolved transaction rows by any combination of criteria."""
    result = rows

    if start_date:
        result = [r for r in result if str(r.get("Date", "")) >= start_date]
    if end_date:
        result = [r for r in result if str(r.get("Date", "")) <= end_date]
    if category:
        cat_lower = category.lower()
        result = [r for r in result if str(r.get("Category", "")).lower() == cat_lower]
    if merchant:
        merch_lower = merchant.lower()
        result = [r for r in result if merch_lower in str(r.get("Merchant", "")).lower()]
    if account:
        acct_lower = account.lower()
        result = [r for r in result if str(r.get("Account", "")).lower() == acct_lower]
    if tx_type:
        type_lower = tx_type.lower()
        result = [r for r in result if str(r.get("Type", "")).lower() == type_lower]
    if min_amount is not None:
        result = [r for r in result if _to_float(r.get("Amount")) >= min_amount]
    if max_amount is not None:
        result = [r for r in result if _to_float(r.get("Amount")) <= max_amount]

    return result


def summarize_by_category(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Group by Category, return {category: {total, count, avg}}."""
    groups: dict[str, list[float]] = defaultdict(list)
    for r in rows:
        cat = str(r.get("Category", "Uncategorized"))
        amt = _to_float(r.get("Amount"))
        groups[cat].append(amt)

    result = {}
    for cat, amounts in sorted(groups.items(), key=lambda x: sum(x[1]), reverse=True):
        total = sum(amounts)
        result[cat] = {
            "total": round(total, 2),
            "count": len(amounts),
            "avg": round(total / len(amounts), 2) if amounts else 0,
        }
    return result


def monthly_totals(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Group by YYYY-MM, return {month: {spending, income, net, count}}."""
    months: dict[str, dict[str, float]] = defaultdict(
        lambda: {"spending": 0.0, "income": 0.0, "count": 0}
    )
    for r in rows:
        d = str(r.get("Date", ""))[:7]  # YYYY-MM
        if not d:
            continue
        amt = _to_float(r.get("Amount"))
        tx_type = str(r.get("Type", "debit")).lower()
        m = months[d]
        if tx_type == "credit" or str(r.get("Category", "")).lower() == "income":
            m["income"] += abs(amt)
        else:
            m["spending"] += abs(amt)
        m["count"] += 1

    result = {}
    for month in sorted(months.keys()):
        m = months[month]
        result[month] = {
            "spending": round(m["spending"], 2),
            "income": round(m["income"], 2),
            "net": round(m["income"] - m["spending"], 2),
            "count": int(m["count"]),
        }
    return result


def top_merchants(rows: list[dict[str, Any]], limit: int = 10) -> list[dict[str, Any]]:
    """Top merchants by total spend."""
    groups: dict[str, list[float]] = defaultdict(list)
    for r in rows:
        merchant = str(r.get("Merchant", "") or r.get("Description", ""))
        if not merchant:
            continue
        amt = abs(_to_float(r.get("Amount")))
        groups[merchant].append(amt)

    ranked = sorted(
        [
            {"merchant": name, "total": round(sum(amts), 2), "count": len(amts)}
            for name, amts in groups.items()
        ],
        key=lambda x: x["total"],
        reverse=True,
    )
    return ranked[:limit]


def get_month_summary(rows: list[dict[str, Any]], month: str) -> dict[str, Any]:
    """Comprehensive summary for a single month."""
    month_rows = [r for r in rows if str(r.get("Date", ""))[:7] == month]

    debit_rows = [
        r for r in month_rows
        if str(r.get("Type", "debit")).lower() != "credit"
        and str(r.get("Category", "")).lower() != "income"
    ]
    income_rows = [
        r for r in month_rows
        if str(r.get("Type", "")).lower() == "credit"
        or str(r.get("Category", "")).lower() == "income"
    ]

    total_spent = sum(abs(_to_float(r.get("Amount"))) for r in debit_rows)
    total_income = sum(abs(_to_float(r.get("Amount"))) for r in income_rows)

    # Days in month for daily average
    try:
        y, m = int(month[:4]), int(month[5:7])
        if m == 12:
            days = (date(y + 1, 1, 1) - date(y, m, 1)).days
        else:
            days = (date(y, m + 1, 1) - date(y, m, 1)).days
    except (ValueError, IndexError):
        days = 30

    categories = summarize_by_category(debit_rows)
    merchants = top_merchants(debit_rows, limit=5)

    # Largest transactions
    largest = sorted(debit_rows, key=lambda r: abs(_to_float(r.get("Amount"))), reverse=True)[:5]
    largest_list = [
        {
            "date": r.get("Date", ""),
            "description": r.get("Description", r.get("Merchant", "")),
            "amount": round(abs(_to_float(r.get("Amount"))), 2),
            "category": r.get("Category", ""),
        }
        for r in largest
    ]

    return {
        "month": month,
        "totalSpent": round(total_spent, 2),
        "totalIncome": round(total_income, 2),
        "net": round(total_income - total_spent, 2),
        "transactionCount": len(month_rows),
        "dailyAverage": round(total_spent / days, 2) if days > 0 else 0,
        "topCategories": categories,
        "topMerchants": merchants,
        "largestTransactions": largest_list,
    }


def compare_months(
    rows: list[dict[str, Any]], period1: str, period2: str
) -> dict[str, Any]:
    """Compare spending between two months."""
    s1 = get_month_summary(rows, period1)
    s2 = get_month_summary(rows, period2)

    spent1 = s1["totalSpent"]
    spent2 = s2["totalSpent"]
    diff = spent2 - spent1
    pct_change = (diff / spent1 * 100) if spent1 > 0 else 0

    # Per-category comparison
    all_cats = set(list(s1["topCategories"].keys()) + list(s2["topCategories"].keys()))
    category_comparison = {}
    for cat in sorted(all_cats):
        t1 = s1["topCategories"].get(cat, {}).get("total", 0)
        t2 = s2["topCategories"].get(cat, {}).get("total", 0)
        category_comparison[cat] = {
            period1: t1,
            period2: t2,
            "change": round(t2 - t1, 2),
        }

    return {
        "period1": {**s1, "topCategories": dict(list(s1["topCategories"].items())[:5])},
        "period2": {**s2, "topCategories": dict(list(s2["topCategories"].items())[:5])},
        "difference": round(diff, 2),
        "percentChange": round(pct_change, 1),
        "categoryComparison": category_comparison,
    }


def spending_trends(
    rows: list[dict[str, Any]], months: int = 6, category: str | None = None
) -> dict[str, Any]:
    """Get spending trends over the last N months."""
    # Determine date range
    today = date.today()
    start_month = today.replace(day=1)
    for _ in range(months - 1):
        start_month = (start_month.replace(day=1) - __import__("datetime").timedelta(days=1)).replace(day=1)

    start_str = start_month.strftime("%Y-%m")
    filtered = [r for r in rows if str(r.get("Date", ""))[:7] >= start_str]
    if category:
        cat_lower = category.lower()
        filtered = [r for r in filtered if str(r.get("Category", "")).lower() == cat_lower]

    totals = monthly_totals(filtered)

    # Calculate trend direction
    values = [t["spending"] for t in totals.values()]
    if len(values) >= 2:
        recent_avg = sum(values[-3:]) / min(3, len(values))
        earlier_avg = sum(values[:3]) / min(3, len(values))
        if recent_avg > earlier_avg * 1.1:
            trend = "increasing"
        elif recent_avg < earlier_avg * 0.9:
            trend = "decreasing"
        else:
            trend = "stable"
    else:
        trend = "insufficient_data"

    return {
        "months": totals,
        "trend": trend,
        "category": category,
        "totalSpending": round(sum(t["spending"] for t in totals.values()), 2),
        "averageMonthly": round(
            sum(t["spending"] for t in totals.values()) / max(len(totals), 1), 2
        ),
    }


def _to_float(v: Any) -> float:
    """Safely convert a value to float."""
    if v is None:
        return 0.0
    try:
        return float(v)
    except (ValueError, TypeError):
        return 0.0
