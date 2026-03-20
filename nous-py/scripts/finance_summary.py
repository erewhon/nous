#!/usr/bin/env python3
"""Generate monthly financial summary pages in Nous.

Usage:
    python scripts/finance_summary.py [--month 2026-03] [--notebook Finance]
    python scripts/finance_summary.py setup --notebook Finance

The script reads the "Transactions" database from the specified notebook,
computes spending summaries, and creates/updates a summary page.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date, timedelta
from pathlib import Path

# Add SDK to path
sdk_path = Path(__file__).parent.parent.parent / "nous-sdk" / "src"
sys.path.insert(0, str(sdk_path))

from nous_sdk import Nous


def resolve_options(db_data: dict, rows: list[dict]) -> list[dict]:
    """Resolve option IDs to labels in database rows."""
    properties = db_data.get("properties", [])
    prop_id_to_name: dict[str, str] = {}
    option_map: dict[tuple[str, str], str] = {}

    for prop in properties:
        pid = prop.get("id", "")
        name = prop.get("name", "")
        if pid and name:
            prop_id_to_name[pid] = name

        ptype = prop.get("type", "")
        if ptype in ("select", "multiSelect"):
            for opt in prop.get("options", []):
                oid = opt.get("id", "")
                label = opt.get("label", "")
                if pid and oid:
                    option_map[(pid, oid)] = label

    resolved = []
    for row in rows:
        cells = row.get("cells", {})
        flat: dict = {}
        for prop_id, value in cells.items():
            name = prop_id_to_name.get(prop_id, prop_id)
            if isinstance(value, str) and (prop_id, value) in option_map:
                flat[name] = option_map[(prop_id, value)]
            elif isinstance(value, list):
                flat[name] = [
                    option_map.get((prop_id, v), v) if isinstance(v, str) else v
                    for v in value
                ]
            else:
                flat[name] = value
        resolved.append(flat)
    return resolved


def to_float(v) -> float:
    try:
        return float(v) if v is not None else 0.0
    except (ValueError, TypeError):
        return 0.0


def generate_summary(app: Nous, notebook: str, month: str) -> None:
    """Generate a monthly spending summary page."""
    # Find the Transactions database
    databases = app.list_databases(notebook)
    tx_db = next((d for d in databases if d.title.lower() == "transactions"), None)
    if not tx_db:
        print(f"No 'Transactions' database found in notebook '{notebook}'")
        print("Run: python scripts/finance_summary.py setup --notebook <name>")
        return

    # Load and resolve data
    db_data = app.get_database(notebook, tx_db.id)
    raw_rows = db_data.get("database", {}).get("rows", [])
    rows = resolve_options(db_data.get("database", {}), raw_rows)

    # Filter to the target month
    month_rows = [r for r in rows if str(r.get("Date", ""))[:7] == month]
    if not month_rows:
        print(f"No transactions found for {month}")
        return

    # Separate debits and credits
    debits = [
        r for r in month_rows
        if str(r.get("Type", "debit")).lower() != "credit"
        and str(r.get("Category", "")).lower() != "income"
    ]
    credits = [
        r for r in month_rows
        if str(r.get("Type", "")).lower() == "credit"
        or str(r.get("Category", "")).lower() == "income"
    ]

    total_spent = sum(abs(to_float(r.get("Amount"))) for r in debits)
    total_income = sum(abs(to_float(r.get("Amount"))) for r in credits)
    net = total_income - total_spent

    # Days in month
    try:
        y, m = int(month[:4]), int(month[5:7])
        if m == 12:
            days = (date(y + 1, 1, 1) - date(y, m, 1)).days
        else:
            days = (date(y, m + 1, 1) - date(y, m, 1)).days
    except (ValueError, IndexError):
        days = 30

    daily_avg = total_spent / days if days > 0 else 0

    # Category breakdown
    from collections import defaultdict
    cat_totals: dict[str, float] = defaultdict(float)
    cat_counts: dict[str, int] = defaultdict(int)
    for r in debits:
        cat = str(r.get("Category", "Uncategorized"))
        cat_totals[cat] += abs(to_float(r.get("Amount")))
        cat_counts[cat] += 1

    sorted_cats = sorted(cat_totals.items(), key=lambda x: x[1], reverse=True)

    # Top merchants
    merch_totals: dict[str, float] = defaultdict(float)
    merch_counts: dict[str, int] = defaultdict(int)
    for r in debits:
        merch = str(r.get("Merchant", "") or r.get("Description", "Unknown"))
        merch_totals[merch] += abs(to_float(r.get("Amount")))
        merch_counts[merch] += 1

    sorted_merchants = sorted(merch_totals.items(), key=lambda x: x[1], reverse=True)[:10]

    # Largest transactions
    largest = sorted(debits, key=lambda r: abs(to_float(r.get("Amount"))), reverse=True)[:10]

    # Format the summary
    lines = [
        f"Total Spent: ${total_spent:,.2f}",
        f"Total Income: ${total_income:,.2f}",
        f"Net: ${net:,.2f}",
        f"Transactions: {len(month_rows)}",
        f"Daily Average: ${daily_avg:,.2f}",
        "",
        "## Spending by Category",
        "",
    ]

    for cat, total in sorted_cats:
        pct = (total / total_spent * 100) if total_spent > 0 else 0
        lines.append(f"- **{cat}**: ${total:,.2f} ({pct:.0f}%) — {cat_counts[cat]} transactions")

    lines.extend(["", "## Top Merchants", ""])
    for merch, total in sorted_merchants:
        lines.append(f"- **{merch}**: ${total:,.2f} ({merch_counts[merch]} transactions)")

    lines.extend(["", "## Largest Transactions", ""])
    for r in largest:
        desc = r.get("Description", r.get("Merchant", ""))
        amt = abs(to_float(r.get("Amount")))
        d = r.get("Date", "")
        cat = r.get("Category", "")
        lines.append(f"- {d} — **{desc}**: ${amt:,.2f} [{cat}]")

    content = "\n".join(lines)

    # Create or update summary page
    title = f"Finance Summary — {month}"
    try:
        existing = app.get_page(notebook, title)
        app.update_page(notebook, existing.id, content=content, tags=["finance", "summary", "auto-generated"])
        print(f"Updated: {title}")
    except Exception:
        app.create_page(notebook, title=title, content=content, tags=["finance", "summary", "auto-generated"])
        print(f"Created: {title}")


def setup_database(app: Nous, notebook: str) -> None:
    """Verify the Transactions database exists (creation must be done in the app)."""
    databases = app.list_databases(notebook)
    tx_db = next((d for d in databases if d.title.lower() == "transactions"), None)

    if tx_db:
        print(f"Transactions database already exists: {tx_db.id}")
        print(f"  Properties: {tx_db.property_count}, Rows: {tx_db.row_count}")
    else:
        print(f"No 'Transactions' database found in '{notebook}'.")
        print()
        print("Create it in Nous with these properties:")
        print("  - Date (date)")
        print("  - Description (text)")
        print("  - Amount (number)")
        print("  - Category (select): Groceries, Dining, Transport, Housing, Utilities,")
        print("    Entertainment, Shopping, Health, Insurance, Subscriptions, Income, Other")
        print("  - Account (select): your bank/card names")
        print("  - Merchant (text)")
        print("  - Type (select): debit, credit")
        print()
        print("Or use the MCP create_database tool from the AI chat.")


def main():
    parser = argparse.ArgumentParser(description="Nous Financial Summary Generator")
    parser.add_argument("command", nargs="?", default="summary", choices=["summary", "setup"])
    parser.add_argument("--month", help="Month in YYYY-MM format (default: previous month)")
    parser.add_argument("--notebook", default="Finance", help="Notebook name (default: Finance)")
    args = parser.parse_args()

    app = Nous()
    if not app.is_running():
        print("Error: Nous daemon is not running. Start it with: nous-cli daemon start")
        sys.exit(1)

    if args.command == "setup":
        setup_database(app, args.notebook)
    else:
        month = args.month
        if not month:
            # Default to previous month
            today = date.today()
            first = today.replace(day=1)
            prev = first - timedelta(days=1)
            month = prev.strftime("%Y-%m")

        generate_summary(app, args.notebook, month)


if __name__ == "__main__":
    main()
