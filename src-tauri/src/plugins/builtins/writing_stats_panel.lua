--[[ [manifest]
id = "nous.builtin.writing-stats-panel"
name = "Writing Statistics Panel"
version = "0.1.0"
description = "Sidebar panel showing word count, reading time, character count, and readability metrics for the current page."
capabilities = ["sidebar_panel", "page_read"]
hooks = ["sidebar_panel:writing_stats"]
is_builtin = true
]]

function describe_panel(_input_json)
  return nous.json_encode({
    panel_id = "writing_stats",
    label = "Writing Stats",
    icon_svg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/><line x1="12" y1="6" x2="12" y2="13"/><line x1="9" y1="10" x2="15" y2="10"/></svg>',
    default_width = 240,
  })
end

function render_panel(input_json)
  local input = nous.json_decode(input_json)
  local ctx = input.context or {}
  local page_id = ctx.current_page_id or ""
  local notebook_id = ctx.current_notebook_id or ""

  -- Defaults
  local word_count = 0
  local char_count = 0
  local sentence_count = 0
  local paragraph_count = 0
  local heading_count = 0
  local page_title = "No page selected"

  if page_id ~= "" and notebook_id ~= "" then
    local ok, page = pcall(function()
      return nous.json_decode(nous.page_get(notebook_id, page_id))
    end)

    if ok and page then
      page_title = page.title or "Untitled"
      local content = page.content or {}
      local blocks = content.blocks or {}

      for _, block in ipairs(blocks) do
        local btype = block.type or ""
        local data = block.data or {}

        if btype == "header" then
          heading_count = heading_count + 1
          local text = (data.text or ""):gsub("<[^>]+>", "")
          for _ in text:gmatch("%S+") do word_count = word_count + 1 end
          char_count = char_count + #text

        elseif btype == "paragraph" then
          local text = (data.text or ""):gsub("<[^>]+>", "")
          if text:match("%S") then
            paragraph_count = paragraph_count + 1
            for _ in text:gmatch("%S+") do word_count = word_count + 1 end
            char_count = char_count + #text
            -- Count sentences (rough: split on . ! ?)
            for _ in text:gmatch("[%.!?]+%s") do sentence_count = sentence_count + 1 end
            -- Count trailing sentence end
            if text:match("[%.!?]%s*$") then sentence_count = sentence_count + 1 end
          end

        elseif btype == "list" or btype == "checklist" then
          local items = data.items or {}
          for _, item in ipairs(items) do
            local text = ""
            if type(item) == "table" then
              text = (item.content or item.text or ""):gsub("<[^>]+>", "")
            else
              text = tostring(item):gsub("<[^>]+>", "")
            end
            for _ in text:gmatch("%S+") do word_count = word_count + 1 end
            char_count = char_count + #text
          end

        elseif btype == "code" then
          local code = data.code or ""
          for _ in code:gmatch("%S+") do word_count = word_count + 1 end
          char_count = char_count + #code

        elseif btype == "quote" then
          local text = (data.text or ""):gsub("<[^>]+>", "")
          for _ in text:gmatch("%S+") do word_count = word_count + 1 end
          char_count = char_count + #text
          paragraph_count = paragraph_count + 1
        end
      end

      -- Ensure at least 1 sentence if we have words
      if sentence_count == 0 and word_count > 0 then
        sentence_count = 1
      end
    end
  end

  -- Derived metrics
  local reading_time_min = math.max(1, math.floor(word_count / 238 + 0.5))
  local speaking_time_min = math.max(1, math.floor(word_count / 150 + 0.5))
  local avg_words_per_sentence = sentence_count > 0 and math.floor(word_count / sentence_count * 10 + 0.5) / 10 or 0

  -- Reading level (Flesch-Kincaid approximation using word/sentence ratio)
  local reading_level = "—"
  if sentence_count > 0 and word_count > 20 then
    local wps = word_count / sentence_count
    if wps < 10 then reading_level = "Easy"
    elseif wps < 15 then reading_level = "Standard"
    elseif wps < 20 then reading_level = "Academic"
    else reading_level = "Complex"
    end
  end

  local function fmt(n)
    if n >= 1000 then
      return string.format("%.1fk", n / 1000)
    end
    return tostring(n)
  end

  local html = [[
<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: transparent;
    color: #c8c8d8;
    padding: 12px 16px;
    font-size: 13px;
    line-height: 1.5;
  }
  .title {
    font-size: 11px;
    font-weight: 600;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 12px;
  }
  .stat-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-bottom: 16px;
  }
  .stat-card {
    background: rgba(255,255,255,0.04);
    border-radius: 8px;
    padding: 10px 12px;
  }
  .stat-value {
    font-size: 20px;
    font-weight: 700;
    color: #e0e0f0;
    line-height: 1.2;
  }
  .stat-label {
    font-size: 10px;
    color: #777;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-top: 2px;
  }
  .detail-list {
    list-style: none;
    padding: 0;
  }
  .detail-item {
    display: flex;
    justify-content: space-between;
    padding: 5px 0;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    font-size: 12px;
  }
  .detail-item:last-child { border-bottom: none; }
  .detail-label { color: #999; }
  .detail-value { color: #c8c8d8; font-weight: 500; }
  .section-title {
    font-size: 10px;
    font-weight: 600;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 16px 0 6px;
  }
  .no-page {
    color: #666;
    font-size: 12px;
    text-align: center;
    padding: 20px 0;
  }
</style>
</head><body>
]]

  if page_id == "" then
    html = html .. '<div class="no-page">No page selected</div>'
  else
    html = html .. '<div class="title">Writing Stats</div>'

    html = html .. '<div class="stat-grid">'
    html = html .. '<div class="stat-card"><div class="stat-value">' .. fmt(word_count) .. '</div><div class="stat-label">Words</div></div>'
    html = html .. '<div class="stat-card"><div class="stat-value">' .. fmt(char_count) .. '</div><div class="stat-label">Characters</div></div>'
    html = html .. '<div class="stat-card"><div class="stat-value">' .. reading_time_min .. 'm</div><div class="stat-label">Read Time</div></div>'
    html = html .. '<div class="stat-card"><div class="stat-value">' .. speaking_time_min .. 'm</div><div class="stat-label">Speak Time</div></div>'
    html = html .. '</div>'

    html = html .. '<div class="section-title">Structure</div>'
    html = html .. '<ul class="detail-list">'
    html = html .. '<li class="detail-item"><span class="detail-label">Paragraphs</span><span class="detail-value">' .. paragraph_count .. '</span></li>'
    html = html .. '<li class="detail-item"><span class="detail-label">Sentences</span><span class="detail-value">' .. sentence_count .. '</span></li>'
    html = html .. '<li class="detail-item"><span class="detail-label">Headings</span><span class="detail-value">' .. heading_count .. '</span></li>'
    html = html .. '<li class="detail-item"><span class="detail-label">Avg words/sentence</span><span class="detail-value">' .. avg_words_per_sentence .. '</span></li>'
    html = html .. '</ul>'

    html = html .. '<div class="section-title">Readability</div>'
    html = html .. '<ul class="detail-list">'
    html = html .. '<li class="detail-item"><span class="detail-label">Level</span><span class="detail-value">' .. reading_level .. '</span></li>'
    html = html .. '</ul>'
  end

  html = html .. '</body></html>'

  return nous.json_encode({
    html = html,
  })
end

function handle_panel_action(input_json)
  return nous.json_encode({ handled = true })
end
