--[[ [manifest]
id = "nous.builtin.writing-analysis"
name = "Writing Analysis"
version = "0.1.0"
description = "Editor decorations that color-code blocks by reading difficulty and flag long sentences."
capabilities = ["editor_decoration", "page_read"]
hooks = ["editor_decoration:writing_analysis"]
is_builtin = true
]]

function describe_decorations(_input_json)
  return nous.json_encode({
    decoration_id = "writing_analysis",
    label = "Writing Analysis",
    description = "Highlights blocks by reading difficulty and flags long sentences",
  })
end

-- Strip HTML tags from text
local function strip_tags(text)
  if not text then return "" end
  return tostring(text):gsub("<[^>]+>", "")
end

-- Extract plain text from inline content (BlockNote format)
local function extract_text(content)
  if type(content) == "string" then
    return strip_tags(content)
  end
  if type(content) ~= "table" then return "" end

  local parts = {}
  for _, item in ipairs(content) do
    if type(item) == "table" then
      if item.type == "text" then
        table.insert(parts, item.text or "")
      elseif item.type == "link" then
        -- Links have nested content
        table.insert(parts, extract_text(item.content))
      elseif item.text then
        table.insert(parts, item.text)
      end
    elseif type(item) == "string" then
      table.insert(parts, item)
    end
  end
  return table.concat(parts)
end

-- Count words in text
local function word_count(text)
  local count = 0
  for _ in text:gmatch("%S+") do count = count + 1 end
  return count
end

-- Count sentences (rough heuristic)
local function sentence_count(text)
  local count = 0
  -- Match sentence-ending punctuation followed by space or end of string
  for _ in text:gmatch("[%.!?]+%s") do count = count + 1 end
  if text:match("[%.!?]%s*$") then count = count + 1 end
  if count == 0 and word_count(text) > 0 then count = 1 end
  return count
end

-- Find the longest sentence length (in words)
local function longest_sentence_words(text)
  local max_words = 0
  -- Split by sentence-ending punctuation
  for sentence in text:gmatch("[^%.!?]+[%.!?]*") do
    local wc = word_count(sentence)
    if wc > max_words then max_words = wc end
  end
  return max_words
end

-- Compute reading level from average words per sentence
local function reading_level(avg_wps)
  if avg_wps < 10 then return "easy"
  elseif avg_wps < 15 then return "standard"
  elseif avg_wps < 20 then return "moderate"
  else return "complex"
  end
end

local level_colors = {
  easy     = { bg = "rgba(34, 197, 94, 0.06)",  border = "#22c55e", badge = "#22c55e", badge_bg = "rgba(34, 197, 94, 0.12)" },
  standard = { bg = "transparent",               border = nil,       badge = "#888",    badge_bg = "rgba(255,255,255,0.04)" },
  moderate = { bg = "rgba(234, 179, 8, 0.06)",   border = "#eab308", badge = "#eab308", badge_bg = "rgba(234, 179, 8, 0.12)" },
  complex  = { bg = "rgba(239, 68, 68, 0.06)",   border = "#ef4444", badge = "#ef4444", badge_bg = "rgba(239, 68, 68, 0.12)" },
}

function compute_decorations(input_json)
  local input = nous.json_decode(input_json)
  local blocks = input.blocks or {}
  local decorations = {}

  for _, block in ipairs(blocks) do
    local btype = block.type or ""
    local props = block.props or {}
    local content = block.content

    -- Only analyze text-bearing blocks
    if btype == "paragraph" or btype == "heading" or btype == "quote" or btype == "bulletListItem" or btype == "numberedListItem" or btype == "checkListItem" then
      local text = ""
      if content then
        text = extract_text(content)
      end
      -- Also check props.text for legacy format
      if text == "" and props.text then
        text = strip_tags(tostring(props.text))
      end

      local wc = word_count(text)
      if wc < 5 then
        -- Skip very short blocks (headings with 1-2 words, etc.)
        goto continue
      end

      local sc = sentence_count(text)
      local avg_wps = sc > 0 and (wc / sc) or wc
      local level = reading_level(avg_wps)
      local colors = level_colors[level]

      -- Block highlight for non-standard levels
      if level ~= "standard" and colors.border then
        table.insert(decorations, {
          block_id = block.id,
          type = "highlight",
          background_color = colors.bg,
          border_color = colors.border,
          border_width = 2,
        })
      end

      -- Badge showing level + word count
      local badge_label = level:sub(1,1):upper() .. level:sub(2) .. " · " .. wc .. "w"
      table.insert(decorations, {
        block_id = block.id,
        type = "badge",
        label = badge_label,
        badge_color = colors.badge,
        badge_bg = colors.badge_bg,
        position = "top-right",
      })

      -- Flag long sentences
      local longest = longest_sentence_words(text)
      if longest > 30 then
        table.insert(decorations, {
          block_id = block.id,
          type = "highlight",
          background_color = "rgba(239, 68, 68, 0.08)",
          border_color = "#ef4444",
          border_width = 2,
        })
      end
    end

    ::continue::
  end

  return nous.json_encode({ decorations = decorations })
end
