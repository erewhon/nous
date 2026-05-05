"""Daemon-backed data access for Nous notebooks, sections, folders, pages,
inbox, goals, and daily notes.

Historical note: this module used to read directly from disk. As of the
2026-05-04 daemon migration, every read and write goes through the daemon
HTTP API via :class:`NousDaemonClient`. The class keeps the same method
names and dict-shape return values so existing call sites work unchanged.

The ``library_path`` attribute is preserved (best-effort) for backwards
compatibility with ``nous_ai`` which still constructs path-based helpers
from it. In the remote-MCP case it will be ``None``.
"""

from __future__ import annotations

import json
import logging
import re
import sys
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

from nous_mcp.daemon_client import DaemonError, NousDaemonClient

logger = logging.getLogger(__name__)

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)


def _default_data_dir() -> Path:
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "nous"
    return Path.home() / ".local" / "share" / "nous"


def _libraries_path() -> Path:
    return _default_data_dir() / "libraries.json"


def _try_resolve_local_library(name: str | None) -> Path | None:
    """Best-effort lookup of the local library directory.

    Returns the on-disk path when the daemon and the MCP server live on
    the same machine — useful for backwards compatibility with
    ``nous_ai.chat`` which still constructs disk-backed helpers from it.
    Returns None when ``libraries.json`` is missing (remote-MCP setup).
    """
    path = _libraries_path()
    if not path.exists():
        return None
    try:
        libraries = json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return None
    if not libraries:
        return None
    if name:
        try:
            match = _resolve_name(name, libraries, key="name")
            return Path(match["path"])
        except ValueError:
            return None
    for lib in libraries:
        if lib.get("isDefault"):
            return Path(lib["path"])
    return Path(libraries[0]["path"])


class NousStorage:
    """Daemon-backed access to Nous data.

    Construct with an explicit :class:`NousDaemonClient`, or via
    :meth:`from_library_name` which honors ``NOUS_DAEMON_URL`` /
    ``NOUS_API_KEY`` env vars and falls back to the local daemon.
    """

    def __init__(
        self,
        client: NousDaemonClient,
        library_path: Path | None = None,
    ) -> None:
        self.client = client
        # Preserved for nous_ai.chat compatibility — None when running
        # against a remote daemon (no local library directory).
        self.library_path = library_path

    @classmethod
    def from_library_name(cls, name: str | None = None) -> NousStorage:
        """Create a NousStorage backed by the daemon.

        ``name`` is used to resolve a local library path for backwards
        compatibility (the daemon already chose its library at startup;
        the MCP doesn't get to override it from this side). When no
        local library is found, ``library_path`` is None and
        ``library_path``-using callers should handle the remote case.
        """
        client = NousDaemonClient()
        library_path = _try_resolve_local_library(name)
        if library_path is None and name is not None:
            logger.info(
                "Library '%s' not resolvable locally — running daemon-only",
                name,
            )
        return cls(client, library_path)

    # --- Notebooks ---

    def list_notebooks(self) -> list[dict]:
        return self.client.list_notebooks()

    def resolve_notebook(self, name_or_id: str) -> dict:
        if UUID_RE.match(name_or_id):
            for nb in self.list_notebooks():
                if nb["id"] == name_or_id:
                    return nb
            raise ValueError(f"Notebook not found: {name_or_id}")
        return _resolve_name(name_or_id, self.list_notebooks(), key="name")

    # --- Sections ---

    def list_sections(self, notebook_id: str) -> list[dict]:
        return self.client.list_sections(notebook_id)

    def resolve_section(self, notebook_id: str, name_or_id: str) -> dict:
        sections = self.list_sections(notebook_id)
        if UUID_RE.match(name_or_id):
            for s in sections:
                if s["id"] == name_or_id:
                    return s
            raise ValueError(f"Section not found: {name_or_id}")
        return _resolve_name(name_or_id, sections, key="name")

    # --- Folders ---

    def list_folders(
        self,
        notebook_id: str,
        section_id: str | None = None,
        include_archived: bool = False,
    ) -> list[dict]:
        folders = self.client.list_folders(notebook_id)
        results = []
        for f in folders:
            if not include_archived and f.get("isArchived", False):
                continue
            if section_id and f.get("sectionId") != section_id:
                continue
            results.append(f)
        return results

    def resolve_folder(self, notebook_id: str, name_or_id: str) -> dict:
        folders = self.list_folders(notebook_id, include_archived=True)
        if UUID_RE.match(name_or_id):
            for f in folders:
                if f["id"] == name_or_id:
                    return f
            raise ValueError(f"Folder not found: {name_or_id}")
        return _resolve_name(name_or_id, folders, key="name")

    def create_folder(
        self,
        notebook_id: str,
        name: str,
        parent_id: str | None = None,
        section_id: str | None = None,
    ) -> dict:
        result = self.client.create_folder(
            notebook_id,
            name,
            parent_id=parent_id,
            section_id=section_id,
        )
        return {"id": result["id"], "name": result.get("name", name)}

    # --- Files / Databases ---

    def read_database_content(self, notebook_id: str, page_id: str) -> dict | None:
        try:
            resp = self.client.get_database(notebook_id, page_id)
        except DaemonError:
            return None
        return resp.get("database")

    def write_database_content(self, notebook_id: str, page_id: str, content: dict) -> None:
        self.client.put_database(notebook_id, page_id, content)

    def list_database_pages(
        self,
        notebook_id: str,
        folder_id: str | None = None,
        section_id: str | None = None,
    ) -> list[dict]:
        # `client.list_databases` returns enriched entries already
        # (id, title, tags, propertyCount, rowCount). Apply local
        # folder/section filters.
        databases = self.client.list_databases(notebook_id)
        results = []
        for db in databases:
            if folder_id and db.get("folderId") != folder_id:
                continue
            if section_id and db.get("sectionId") != section_id:
                continue
            results.append(db)
        return results

    # --- Pages ---

    def list_pages(
        self,
        notebook_id: str,
        folder_id: str | None = None,
        section_id: str | None = None,
        tag: str | None = None,
        limit: int = 50,
    ) -> list[dict]:
        pages = self.client.list_pages(notebook_id)
        results = []
        for page in pages:
            if page.get("isArchived", False):
                continue
            if page.get("deletedAt") is not None:
                continue
            if folder_id and page.get("folderId") != folder_id:
                continue
            if section_id and page.get("sectionId") != section_id:
                continue
            if tag and tag.lower() not in [t.lower() for t in page.get("tags", [])]:
                continue
            results.append(page)
        results.sort(key=lambda p: p.get("updatedAt", ""), reverse=True)
        return results[:limit]

    def read_page(self, notebook_id: str, page_id: str) -> dict | None:
        try:
            return self.client.get_page(notebook_id, page_id)
        except DaemonError:
            return None

    def resolve_page(self, notebook_id: str, title_or_id: str) -> dict:
        if UUID_RE.match(title_or_id):
            page = self.read_page(notebook_id, title_or_id)
            if page is None:
                raise ValueError(f"Page not found: {title_or_id}")
            return page
        try:
            return self.client.resolve_page(notebook_id, title_or_id)
        except DaemonError as e:
            # Daemon returns 404 for "not found" — surface as ValueError
            # for parity with the legacy disk-based behavior.
            raise ValueError(str(e))

    # --- Inbox ---

    def list_inbox_items(self, include_processed: bool = False) -> list[dict]:
        return self.client.list_inbox(include_processed=include_processed)

    def delete_inbox_item(self, item_id: str) -> bool:
        try:
            self.client.delete_inbox_item(item_id)
            return True
        except DaemonError:
            return False

    # --- Daily Notes ---

    def list_daily_notes(self, notebook_id: str, limit: int = 10) -> list[dict]:
        return self.client.list_daily_notes(notebook_id, limit=limit)

    def get_daily_note(self, notebook_id: str, date: str) -> dict | None:
        return self.client.get_daily_note(notebook_id, date)

    # --- Goals ---

    def list_goals(self, include_archived: bool = False) -> list[dict]:
        return self.client.list_goals(include_archived=include_archived)

    def get_goal_progress(self, goal_id: str) -> list[dict]:
        return self.client.get_goal_progress(goal_id)

    def calculate_goal_stats(self, goal_id: str) -> dict:
        """Calculate statistics for a goal: streaks, completion rate, etc.

        Mirrors the Rust ``GoalsStorage::calculate_stats`` semantics. The
        daemon doesn't expose a ``stats`` endpoint per goal yet, so this
        is computed client-side from list_goals + get_goal_progress.
        """
        goals = self.list_goals(include_archived=True)
        goal = next((g for g in goals if g["id"] == goal_id), None)
        if goal is None:
            raise ValueError(f"Goal not found: {goal_id}")

        entries = self.get_goal_progress(goal_id)
        if not entries:
            return {
                "goalId": goal_id,
                "currentStreak": 0,
                "longestStreak": 0,
                "totalCompleted": 0,
                "completionRate": 0.0,
            }

        completed_dates = sorted(
            {e["date"] for e in entries if e.get("completed", False)}
        )

        today = date.today()
        frequency = goal.get("frequency", "daily").capitalize()

        current_streak = _calculate_current_streak(frequency, completed_dates, today)
        longest_streak = _calculate_longest_streak(frequency, completed_dates)
        total_completed = len(completed_dates)

        thirty_days_ago = today - timedelta(days=30)
        recent_completed = sum(
            1 for d in completed_dates
            if thirty_days_ago.isoformat() <= d <= today.isoformat()
        )
        freq_lower = frequency.lower()
        days_tracked = {"daily": 30, "weekly": 4, "monthly": 1}.get(freq_lower, 30)
        completion_rate = min(recent_completed / days_tracked, 1.0) if days_tracked > 0 else 0.0

        return {
            "goalId": goal_id,
            "currentStreak": current_streak,
            "longestStreak": longest_streak,
            "totalCompleted": total_completed,
            "completionRate": round(completion_rate, 3),
        }

    def get_goals_summary(self) -> dict:
        return self.client.get_goals_summary()

    # --- Energy ---

    def list_energy_checkins(self) -> list[dict]:
        return self.client.get_energy_checkins()

    def get_energy_checkins_range(self, start: str, end: str) -> list[dict]:
        return self.client.get_energy_checkins(start=start, end=end)

    def calculate_energy_patterns(self, checkins: list[dict]) -> dict:
        """Calculate energy patterns from supplied check-in data.

        The daemon also exposes ``GET /api/energy/patterns`` which does the
        same calculation server-side; kept here for callers that already
        have checkins in hand and want to avoid the extra round-trip.
        """
        energy_totals: dict[str, list[float]] = defaultdict(list)
        mood_totals: dict[str, list[float]] = defaultdict(list)

        for c in checkins:
            d = c.get("date", "")
            if not d:
                continue
            try:
                parsed = date.fromisoformat(d)
            except ValueError:
                continue

            day_name = parsed.strftime("%A").lower()

            if c.get("energyLevel") is not None:
                energy_totals[day_name].append(float(c["energyLevel"]))
            elif c.get("energy_level") is not None:
                energy_totals[day_name].append(float(c["energy_level"]))

            if c.get("mood") is not None:
                mood_totals[day_name].append(float(c["mood"]))

        day_of_week_averages = {
            day: round(sum(vals) / len(vals), 2)
            for day, vals in energy_totals.items()
        }
        mood_day_of_week_averages = {
            day: round(sum(vals) / len(vals), 2)
            for day, vals in mood_totals.items()
        }

        typical_low_days = [d for d, avg in day_of_week_averages.items() if avg < 2.5]
        typical_high_days = [d for d, avg in day_of_week_averages.items() if avg >= 4.0]

        current_streak = self._calculate_energy_streak()

        return {
            "dayOfWeekAverages": day_of_week_averages,
            "moodDayOfWeekAverages": mood_day_of_week_averages,
            "currentStreak": current_streak,
            "typicalLowDays": typical_low_days,
            "typicalHighDays": typical_high_days,
        }

    def _calculate_energy_streak(self) -> int:
        """Consecutive days with check-ins ending at today."""
        checkins = self.list_energy_checkins()
        if not checkins:
            return 0

        checkin_dates = {c.get("date", "") for c in checkins}
        today = date.today()
        check_date = today

        if check_date.isoformat() not in checkin_dates:
            check_date = today - timedelta(days=1)
            if check_date.isoformat() not in checkin_dates:
                return 0

        streak = 0
        while check_date.isoformat() in checkin_dates:
            streak += 1
            check_date -= timedelta(days=1)

        return streak

    # --- Search ---

    def search_pages(
        self,
        query: str,
        notebook_id: str | None = None,
        limit: int = 20,
    ) -> list[dict]:
        """Search pages via the daemon's Tantivy backend.

        Returns the daemon's ``SearchHit`` shape: ``pageId``, ``notebookId``,
        ``title``, ``snippet``, ``score``, ``pageType``. Callers that need
        ``notebookName`` and ``tags`` (like the legacy disk-based search
        returned) should look those up separately from list_notebooks /
        get_page.
        """
        return self.client.search_pages(query, notebook_id=notebook_id, limit=limit)


# --- Helpers (client-side) ---


def _calculate_current_streak(
    frequency: str, completed_dates: list[str], today: date
) -> int:
    """Calculate the current consecutive streak ending at today (or yesterday)."""
    if not completed_dates:
        return 0

    if frequency == "Daily":
        check = today
        if today.isoformat() not in completed_dates:
            check = today - timedelta(days=1)
            if check.isoformat() not in completed_dates:
                return 0

        streak = 0
        date_set = set(completed_dates)
        while check.isoformat() in date_set:
            streak += 1
            check -= timedelta(days=1)
        return streak

    elif frequency == "Weekly":
        completed_weeks = set()
        for d in completed_dates:
            try:
                parsed = date.fromisoformat(d)
                completed_weeks.add(parsed.isocalendar()[:2])
            except ValueError:
                continue

        current_week = today.isocalendar()[:2]
        prev_week = (today - timedelta(weeks=1)).isocalendar()[:2]

        check_week_date = today
        if current_week not in completed_weeks:
            check_week_date = today - timedelta(weeks=1)
            if prev_week not in completed_weeks:
                return 0

        streak = 0
        while check_week_date.isocalendar()[:2] in completed_weeks:
            streak += 1
            check_week_date -= timedelta(weeks=1)
        return streak

    elif frequency == "Monthly":
        completed_months = set()
        for d in completed_dates:
            try:
                parsed = date.fromisoformat(d)
                completed_months.add((parsed.year, parsed.month))
            except ValueError:
                continue

        current_month = (today.year, today.month)
        if current_month not in completed_months:
            first = date(today.year, today.month, 1)
            prev = first - timedelta(days=1)
            current_month = (prev.year, prev.month)
            if current_month not in completed_months:
                return 0

        streak = 0
        y, m = current_month
        while (y, m) in completed_months:
            streak += 1
            m -= 1
            if m == 0:
                m = 12
                y -= 1
        return streak

    return 0


def _calculate_longest_streak(frequency: str, completed_dates: list[str]) -> int:
    """Calculate the longest ever consecutive streak."""
    if not completed_dates:
        return 0

    if frequency == "Daily":
        dates_sorted = sorted(completed_dates)
        longest = 1
        current = 1
        for i in range(1, len(dates_sorted)):
            try:
                prev = date.fromisoformat(dates_sorted[i - 1])
                curr = date.fromisoformat(dates_sorted[i])
                if (curr - prev).days == 1:
                    current += 1
                elif (curr - prev).days > 1:
                    longest = max(longest, current)
                    current = 1
            except ValueError:
                longest = max(longest, current)
                current = 1
        return max(longest, current)

    elif frequency == "Weekly":
        weeks = sorted({
            date.fromisoformat(d).isocalendar()[:2]
            for d in completed_dates
            if _is_valid_date(d)
        })
        if not weeks:
            return 0
        longest = 1
        current = 1
        for i in range(1, len(weeks)):
            prev_date = date.fromisocalendar(weeks[i - 1][0], weeks[i - 1][1], 1)
            curr_date = date.fromisocalendar(weeks[i][0], weeks[i][1], 1)
            if (curr_date - prev_date).days == 7:
                current += 1
            else:
                longest = max(longest, current)
                current = 1
        return max(longest, current)

    elif frequency == "Monthly":
        months = sorted({
            (date.fromisoformat(d).year, date.fromisoformat(d).month)
            for d in completed_dates
            if _is_valid_date(d)
        })
        if not months:
            return 0
        longest = 1
        current = 1
        for i in range(1, len(months)):
            y1, m1 = months[i - 1]
            y2, m2 = months[i]
            if (y2 * 12 + m2) - (y1 * 12 + m1) == 1:
                current += 1
            else:
                longest = max(longest, current)
                current = 1
        return max(longest, current)

    return 0


def _is_valid_date(s: str) -> bool:
    try:
        date.fromisoformat(s)
        return True
    except ValueError:
        return False


def _resolve_name(name: str, items: list[dict], key: str) -> dict:
    """Resolve by exact case-insensitive match first, then prefix match.

    Raises ValueError on no match or ambiguity.
    """
    name_lower = name.lower()

    exact = [item for item in items if item.get(key, "").lower() == name_lower]
    if len(exact) == 1:
        return exact[0]

    prefix = [item for item in items if item.get(key, "").lower().startswith(name_lower)]
    if len(prefix) == 1:
        return prefix[0]
    if len(prefix) > 1:
        names = [item.get(key, "") for item in prefix]
        raise ValueError(f"Ambiguous name '{name}', matches: {', '.join(names)}")

    available = [item.get(key, "") for item in items]
    raise ValueError(f"Not found: '{name}'. Available: {', '.join(available)}")
