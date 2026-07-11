"""Tests for markdown ↔ Editor.js block conversion."""

from nous_mcp.markdown import (
    _inline_md_to_html,
    blocks_to_markdown,
    markdown_to_blocks,
)


class TestInlineMdToHtml:
    def test_plain_text_unchanged(self):
        assert _inline_md_to_html("just plain text") == "just plain text"

    def test_bold(self):
        assert _inline_md_to_html("a **bold** word") == "a <b>bold</b> word"

    def test_italic(self):
        assert _inline_md_to_html("an *italic* word") == "an <i>italic</i> word"

    def test_bold_italic(self):
        assert _inline_md_to_html("***both***") == "<b><i>both</i></b>"

    def test_bold_and_italic_mixed(self):
        assert _inline_md_to_html("**bold** and *italic*") == "<b>bold</b> and <i>italic</i>"

    def test_code_span(self):
        assert _inline_md_to_html("run `just dev` now") == "run <code>just dev</code> now"

    def test_code_span_protects_markdown_chars(self):
        # Stars and brackets inside code must not be formatted.
        assert _inline_md_to_html("`a ** b [x](y)`") == "<code>a ** b [x](y)</code>"

    def test_code_span_escapes_html(self):
        assert _inline_md_to_html("`<div> & stuff`") == "<code>&lt;div&gt; &amp; stuff</code>"

    def test_link(self):
        assert (
            _inline_md_to_html("see [docs](https://example.com/a?b=1)")
            == 'see <a href="https://example.com/a?b=1">docs</a>'
        )

    def test_wiki_link(self):
        assert _inline_md_to_html("[[My Page]]") == (
            '<wiki-link data-page-title="My Page" data-page-id="">My Page</wiki-link>'
        )

    def test_wiki_link_not_eaten_by_link_regex(self):
        result = _inline_md_to_html("[[Page]] and [text](http://x)")
        assert 'data-page-title="Page"' in result
        assert '<a href="http://x">text</a>' in result

    def test_block_ref(self):
        assert (
            _inline_md_to_html("((1dd47aa4))") == '<block-ref data-block-id="1dd47aa4"></block-ref>'
        )

    def test_strikethrough(self):
        assert _inline_md_to_html("~~gone~~") == "<s>gone</s>"

    def test_highlight(self):
        assert _inline_md_to_html("==hot==") == "<mark>hot</mark>"

    def test_snake_case_untouched(self):
        # Underscore emphasis is deliberately unsupported.
        assert _inline_md_to_html("repo_root and _private_") == "repo_root and _private_"

    def test_multiplication_stars_untouched(self):
        # Emphasis needs non-space content adjacent to the delimiters, so
        # spaced-out stars (arithmetic, globs) stay literal.
        assert _inline_md_to_html("2 * 3 * 4") == "2 * 3 * 4"

    def test_raw_html_passes_through(self):
        assert _inline_md_to_html("<b>already html</b>") == "<b>already html</b>"

    def test_empty(self):
        assert _inline_md_to_html("") == ""


class TestMarkdownToBlocksInline:
    def test_paragraph_bold(self):
        blocks = markdown_to_blocks("**Context:** something happened")
        assert blocks[0]["type"] == "paragraph"
        assert blocks[0]["data"]["text"] == "<b>Context:</b> something happened"

    def test_header_inline(self):
        blocks = markdown_to_blocks("## Fix `parse` in **round 2**")
        assert blocks[0]["type"] == "header"
        assert blocks[0]["data"]["text"] == "Fix <code>parse</code> in <b>round 2</b>"

    def test_list_items_inline(self):
        blocks = markdown_to_blocks("- item with **bold**\n- item with `code`")
        assert blocks[0]["type"] == "list"
        assert blocks[0]["data"]["items"] == [
            "item with <b>bold</b>",
            "item with <code>code</code>",
        ]

    def test_checklist_items_inline(self):
        blocks = markdown_to_blocks("- [ ] check `flag`\n- [x] done **now**")
        assert blocks[0]["type"] == "checklist"
        items = blocks[0]["data"]["items"]
        assert items[0] == {"text": "check <code>flag</code>", "checked": False}
        assert items[1] == {"text": "done <b>now</b>", "checked": True}

    def test_quote_inline(self):
        blocks = markdown_to_blocks("> a *quoted* thought")
        assert blocks[0]["type"] == "quote"
        assert blocks[0]["data"]["text"] == "a <i>quoted</i> thought"

    def test_code_block_contents_untouched(self):
        blocks = markdown_to_blocks("```python\nx = '**not bold**'\n```")
        assert blocks[0]["type"] == "code"
        assert blocks[0]["data"]["code"] == "x = '**not bold**'"

    def test_multiline_paragraph_converts_each_line(self):
        blocks = markdown_to_blocks("first **a**\nsecond *b*")
        assert blocks[0]["data"]["text"] == "first <b>a</b><br>second <i>b</i>"


class TestRoundTrip:
    def test_inline_round_trip(self):
        md = "A **bold** move with `code` and a [link](https://x.dev)"
        blocks = markdown_to_blocks(md)
        assert blocks_to_markdown(blocks) == md

    def test_wiki_link_round_trip(self):
        md = "See [[Other Page]] for details"
        blocks = markdown_to_blocks(md)
        assert blocks_to_markdown(blocks) == md

    def test_structure_round_trip(self):
        md = "## Heading\n\npara with **bold**\n\n- item one\n- item two\n\n---"
        blocks = markdown_to_blocks(md)
        types = [b["type"] for b in blocks]
        assert types == ["header", "paragraph", "list", "delimiter"]
        assert blocks_to_markdown(blocks) == md
