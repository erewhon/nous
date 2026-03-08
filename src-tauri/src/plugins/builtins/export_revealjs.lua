--[[ [manifest]
id = "nous.builtin.export-revealjs"
name = "Reveal.js Presentation Export"
version = "0.1.0"
description = "Export pages as Reveal.js slide presentations. Headings become slide boundaries."
capabilities = ["export", "page_read"]
hooks = ["export_format:revealjs"]
is_builtin = true
]]

-- Describe the export format
function describe_export(_input_json)
  return nous.json_encode({
    format_id = "revealjs",
    label = "Reveal.js Presentation",
    file_extension = ".html",
    mime_type = "text/html",
    icon_svg = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
    accepts_options = true,
  })
end

-- Render options form (theme selector)
function render_options(_input_json)
  local html = [[
<div style="font-family: -apple-system, system-ui, sans-serif; padding: 16px; color: #e0e0e0;">
  <label style="display: block; margin-bottom: 8px; font-size: 13px; font-weight: 600;">Theme</label>
  <select id="theme" style="width: 100%; padding: 6px 8px; background: #1a1a2e; color: #e0e0e0; border: 1px solid #333; border-radius: 4px; font-size: 13px;">
    <option value="black" selected>Black</option>
    <option value="white">White</option>
    <option value="moon">Moon</option>
    <option value="night">Night</option>
    <option value="solarized">Solarized</option>
    <option value="dracula">Dracula</option>
    <option value="simple">Simple</option>
    <option value="serif">Serif</option>
    <option value="beige">Beige</option>
    <option value="sky">Sky</option>
    <option value="league">League</option>
    <option value="blood">Blood</option>
  </select>

  <label style="display: block; margin-top: 12px; margin-bottom: 8px; font-size: 13px; font-weight: 600;">Transition</label>
  <select id="transition" style="width: 100%; padding: 6px 8px; background: #1a1a2e; color: #e0e0e0; border: 1px solid #333; border-radius: 4px; font-size: 13px;">
    <option value="slide" selected>Slide</option>
    <option value="fade">Fade</option>
    <option value="convex">Convex</option>
    <option value="concave">Concave</option>
    <option value="zoom">Zoom</option>
    <option value="none">None</option>
  </select>

  <label style="display: flex; align-items: center; gap: 8px; margin-top: 12px; font-size: 13px; cursor: pointer;">
    <input type="checkbox" id="showNotes" style="accent-color: #3b82f6;" />
    Show speaker notes
  </label>
</div>

<script>
function getOptions() {
  return {
    theme: document.getElementById('theme').value,
    transition: document.getElementById('transition').value,
    showNotes: document.getElementById('showNotes').checked,
  };
}
// Expose to parent
window.getExportOptions = getOptions;
</script>
]]
  return nous.json_encode({ html = html })
end

-- Convert blocks to Reveal.js slides
function handle_export(input_json)
  local input = nous.json_decode(input_json)
  local page = input.page or {}
  local options = input.options or {}
  local theme = options.theme or "black"
  local transition = options.transition or "slide"
  local title = page.title or "Presentation"
  local content = page.content or {}
  local blocks = content.blocks or {}

  -- Build slides from blocks: each heading starts a new slide
  local slides = {}
  local current_slide = {}

  for _, block in ipairs(blocks) do
    local btype = block.type
    local bdata = block.data or {}

    if btype == "header" then
      -- Start a new slide on headings
      if #current_slide > 0 then
        slides[#slides + 1] = table.concat(current_slide, "\n")
        current_slide = {}
      end
      local level = bdata.level or 2
      local text = bdata.text or ""
      current_slide[#current_slide + 1] = "<h" .. level .. ">" .. text .. "</h" .. level .. ">"

    elseif btype == "paragraph" then
      local text = bdata.text or ""
      if text ~= "" then
        current_slide[#current_slide + 1] = "<p>" .. text .. "</p>"
      end

    elseif btype == "list" then
      local items = bdata.items or {}
      local style = bdata.style or "unordered"
      local tag = style == "ordered" and "ol" or "ul"
      local list_html = "<" .. tag .. ">"
      for _, item in ipairs(items) do
        local item_text = type(item) == "table" and (item.content or item.text or "") or tostring(item)
        list_html = list_html .. "<li>" .. item_text .. "</li>"
      end
      list_html = list_html .. "</" .. tag .. ">"
      current_slide[#current_slide + 1] = list_html

    elseif btype == "checklist" then
      local items = bdata.items or {}
      local list_html = "<ul style='list-style: none; padding-left: 0;'>"
      for _, item in ipairs(items) do
        local checked = item.checked and "&#9745;" or "&#9744;"
        local text = item.text or ""
        list_html = list_html .. "<li>" .. checked .. " " .. text .. "</li>"
      end
      list_html = list_html .. "</ul>"
      current_slide[#current_slide + 1] = list_html

    elseif btype == "code" then
      local code = (bdata.code or ""):gsub("&", "&amp;"):gsub("<", "&lt;"):gsub(">", "&gt;")
      local lang = bdata.language or ""
      current_slide[#current_slide + 1] = "<pre><code" .. (lang ~= "" and (' data-trim data-noescape class="language-' .. lang .. '"') or "") .. ">" .. code .. "</code></pre>"

    elseif btype == "quote" then
      local text = bdata.text or ""
      local caption = bdata.caption or ""
      local q = "<blockquote><p>" .. text .. "</p>"
      if caption ~= "" then
        q = q .. "<footer>" .. caption .. "</footer>"
      end
      q = q .. "</blockquote>"
      current_slide[#current_slide + 1] = q

    elseif btype == "image" then
      local url = ""
      if bdata.file and bdata.file.url then
        url = bdata.file.url
      elseif bdata.url then
        url = bdata.url
      end
      if url ~= "" then
        local caption = bdata.caption or ""
        local img = '<img src="' .. url .. '" style="max-height: 500px;" />'
        if caption ~= "" then
          img = img .. "<p><small>" .. caption .. "</small></p>"
        end
        current_slide[#current_slide + 1] = img
      end

    elseif btype == "delimiter" then
      -- Delimiter always starts a new slide
      if #current_slide > 0 then
        slides[#slides + 1] = table.concat(current_slide, "\n")
        current_slide = {}
      end

    elseif btype == "table" then
      local content_rows = bdata.content or {}
      local with_headings = bdata.withHeadings
      if #content_rows > 0 then
        local tbl = "<table>"
        for i, row in ipairs(content_rows) do
          tbl = tbl .. "<tr>"
          local cell_tag = (with_headings and i == 1) and "th" or "td"
          for _, cell in ipairs(row) do
            tbl = tbl .. "<" .. cell_tag .. ">" .. tostring(cell) .. "</" .. cell_tag .. ">"
          end
          tbl = tbl .. "</tr>"
        end
        tbl = tbl .. "</table>"
        current_slide[#current_slide + 1] = tbl
      end

    else
      -- Unknown block type — try to extract text
      local text = bdata.text or ""
      if text ~= "" then
        current_slide[#current_slide + 1] = "<p>" .. text .. "</p>"
      end
    end
  end

  -- Don't forget the last slide
  if #current_slide > 0 then
    slides[#slides + 1] = table.concat(current_slide, "\n")
  end

  -- If no slides generated, create a title slide
  if #slides == 0 then
    slides[1] = "<h1>" .. (title:gsub("&", "&amp;"):gsub("<", "&lt;"):gsub(">", "&gt;")) .. "</h1>"
  end

  -- Build section tags
  local sections = {}
  for _, slide_content in ipairs(slides) do
    sections[#sections + 1] = "        <section>\n          " .. slide_content .. "\n        </section>"
  end

  -- Build the full HTML document
  local escaped_title = title:gsub("&", "&amp;"):gsub("<", "&lt;"):gsub(">", "&gt;")

  local html = '<!doctype html>\n<html lang="en">\n<head>\n'
    .. '  <meta charset="utf-8">\n'
    .. '  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
    .. '  <title>' .. escaped_title .. '</title>\n'
    .. '  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/reveal.css">\n'
    .. '  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/theme/' .. theme .. '.css">\n'
    .. '  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5/plugin/highlight/monokai.css">\n'
    .. '</head>\n<body>\n'
    .. '  <div class="reveal">\n'
    .. '    <div class="slides">\n'
    .. table.concat(sections, "\n")
    .. '\n    </div>\n'
    .. '  </div>\n'
    .. '  <script src="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/reveal.js"></script>\n'
    .. '  <script src="https://cdn.jsdelivr.net/npm/reveal.js@5/plugin/highlight/highlight.js"></script>\n'
    .. '  <script>\n'
    .. '    Reveal.initialize({\n'
    .. '      hash: true,\n'
    .. '      transition: "' .. transition .. '",\n'
    .. '      plugins: [RevealHighlight]\n'
    .. '    });\n'
    .. '  </script>\n'
    .. '</body>\n</html>'

  local safe_title = title:gsub("[^%w%-_ ]", ""):gsub("%s+", "-")
  if safe_title == "" then safe_title = "presentation" end

  return nous.json_encode({
    content = html,
    encoding = "utf8",
    filename = safe_title .. ".html",
  })
end
