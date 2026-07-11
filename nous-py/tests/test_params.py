"""Tests for str-or-list MCP parameter normalization."""

from nous_mcp.params import as_list


class TestAsList:
    def test_none_is_empty(self):
        assert as_list(None) == []

    def test_empty_string_is_empty(self):
        assert as_list("") == []
        assert as_list("  ") == []

    def test_string_splits_on_commas(self):
        assert as_list("a, b ,c") == ["a", "b", "c"]

    def test_list_entries_taken_whole(self):
        # The whole point: a list entry may contain commas.
        assert as_list(["tag, with comma", "plain"]) == ["tag, with comma", "plain"]

    def test_list_strips_and_drops_empties(self):
        assert as_list([" a ", "", None, "b"]) == ["a", "b"]

    def test_empty_list_is_empty(self):
        assert as_list([]) == []
