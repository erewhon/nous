--[[ [manifest]
id = "nous.builtin.export-print"
name = "Print-Friendly HTML Export"
version = "0.1.0"
description = "Export pages as clean, print-ready HTML documents with customizable styling."
capabilities = ["export", "page_read"]
hooks = ["export_format:print_html"]
is_builtin = true
]]

function describe_export(_input_json)
  return nous.json_encode({
    format_id = "print_html",
    label = "Print-Friendly HTML",
    file_extension = ".html",
    mime_type = "text/html",
    icon_svg = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>',
    accepts_options = false,
  })
end

function handle_export(input_json)
  local input = nous.json_decode(input_json)
  local page = input.page or {}
  local title = page.title or "Untitled"
  local content = page.content or {}
  local blocks = content.blocks or {}

  local body_parts = {}

  for _, block in ipairs(blocks) do
    local btype = block.type
    local bdata = block.data or {}

    if btype == "header" then
      local level = bdata.level or 2
      local text = bdata.text or ""
      body_parts[#body_parts + 1] = "<h" .. level .. ">" .. text .. "</h" .. level .. ">"

    elseif btype == "paragraph" then
      local text = bdata.text or ""
      if text ~= "" then
        body_parts[#body_parts + 1] = "<p>" .. text .. "</p>"
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
      body_parts[#body_parts + 1] = list_html

    elseif btype == "checklist" then
      local items = bdata.items or {}
      local list_html = "<ul class='checklist'>"
      for _, item in ipairs(items) do
        local checked = item.checked and "checked" or ""
        local text = item.text or ""
        list_html = list_html .. "<li><input type='checkbox' " .. checked .. " disabled /> " .. text .. "</li>"
      end
      list_html = list_html .. "</ul>"
      body_parts[#body_parts + 1] = list_html

    elseif btype == "code" then
      local code = (bdata.code or ""):gsub("&", "&amp;"):gsub("<", "&lt;"):gsub(">", "&gt;")
      body_parts[#body_parts + 1] = "<pre><code>" .. code .. "</code></pre>"

    elseif btype == "quote" then
      local text = bdata.text or ""
      local caption = bdata.caption or ""
      local q = "<blockquote><p>" .. text .. "</p>"
      if caption ~= "" then
        q = q .. "<cite>" .. caption .. "</cite>"
      end
      q = q .. "</blockquote>"
      body_parts[#body_parts + 1] = q

    elseif btype == "delimiter" then
      body_parts[#body_parts + 1] = "<hr />"

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
        body_parts[#body_parts + 1] = tbl
      end

    elseif btype == "image" then
      local url = ""
      if bdata.file and bdata.file.url then
        url = bdata.file.url
      elseif bdata.url then
        url = bdata.url
      end
      if url ~= "" then
        local caption = bdata.caption or ""
        body_parts[#body_parts + 1] = '<figure><img src="' .. url .. '" style="max-width:100%;" />'
          .. (caption ~= "" and ("<figcaption>" .. caption .. "</figcaption>") or "")
          .. '</figure>'
      end

    else
      local text = bdata.text or ""
      if text ~= "" then
        body_parts[#body_parts + 1] = "<p>" .. text .. "</p>"
      end
    end
  end

  local escaped_title = title:gsub("&", "&amp;"):gsub("<", "&lt;"):gsub(">", "&gt;")
  local date = nous.current_date()

  local html = '<!doctype html>\n<html lang="en">\n<head>\n'
    .. '  <meta charset="utf-8">\n'
    .. '  <title>' .. escaped_title .. '</title>\n'
    .. '  <style>\n'
    .. '    @page { margin: 2cm; }\n'
    .. '    body { font-family: Georgia, "Times New Roman", serif; max-width: 700px; margin: 0 auto; padding: 2rem; color: #222; line-height: 1.6; }\n'
    .. '    h1 { font-size: 2rem; margin-bottom: 0.25rem; border-bottom: 2px solid #333; padding-bottom: 0.5rem; }\n'
    .. '    h2 { font-size: 1.5rem; margin-top: 2rem; }\n'
    .. '    h3 { font-size: 1.25rem; margin-top: 1.5rem; }\n'
    .. '    .print-date { color: #666; font-size: 0.9rem; margin-bottom: 2rem; }\n'
    .. '    pre { background: #f5f5f5; padding: 1rem; border-radius: 4px; overflow-x: auto; font-size: 0.85rem; }\n'
    .. '    code { font-family: "SF Mono", Menlo, monospace; }\n'
    .. '    blockquote { border-left: 3px solid #ccc; margin-left: 0; padding-left: 1rem; color: #555; font-style: italic; }\n'
    .. '    blockquote cite { display: block; margin-top: 0.5rem; font-style: normal; font-size: 0.85rem; }\n'
    .. '    table { border-collapse: collapse; width: 100%; margin: 1rem 0; }\n'
    .. '    th, td { border: 1px solid #ddd; padding: 0.5rem; text-align: left; }\n'
    .. '    th { background: #f0f0f0; font-weight: 600; }\n'
    .. '    hr { border: none; border-top: 1px solid #ddd; margin: 2rem 0; }\n'
    .. '    figure { margin: 1rem 0; text-align: center; }\n'
    .. '    figcaption { font-size: 0.85rem; color: #666; margin-top: 0.5rem; }\n'
    .. '    .checklist { list-style: none; padding-left: 0; }\n'
    .. '    .checklist li { margin: 0.25rem 0; }\n'
    .. '    @media print { body { padding: 0; } }\n'
    .. '  </style>\n'
    .. '</head>\n<body>\n'
    .. '  <h1>' .. escaped_title .. '</h1>\n'
    .. '  <div class="print-date">' .. date.iso .. '</div>\n'
    .. table.concat(body_parts, "\n")
    .. '\n</body>\n</html>'

  local safe_title = title:gsub("[^%w%-_ ]", ""):gsub("%s+", "-")
  if safe_title == "" then safe_title = "document" end

  return nous.json_encode({
    content = html,
    encoding = "utf8",
    filename = safe_title .. ".html",
  })
end
