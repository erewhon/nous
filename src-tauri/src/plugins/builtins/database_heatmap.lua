--[[ [manifest]
id = "nous.builtin.database-heatmap"
name = "Database Heatmap View"
version = "0.1.0"
description = "Renders a date-based heatmap (GitHub contribution graph style) from a date column and a number column."
capabilities = ["database_read", "database_view"]
hooks = ["database_view:heatmap"]
is_builtin = true
]]

-- Describe the view type for the frontend
function describe_view(_input_json)
  return nous.json_encode({
    view_type = "heatmap",
    label = "Heatmap",
    icon_svg = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="4" height="4" rx="0.5"/><rect x="10" y="3" width="4" height="4" rx="0.5"/><rect x="17" y="3" width="4" height="4" rx="0.5"/><rect x="3" y="10" width="4" height="4" rx="0.5"/><rect x="10" y="10" width="4" height="4" rx="0.5"/><rect x="17" y="10" width="4" height="4" rx="0.5"/><rect x="3" y="17" width="4" height="4" rx="0.5"/><rect x="10" y="17" width="4" height="4" rx="0.5"/><rect x="17" y="17" width="4" height="4" rx="0.5"/></svg>'
  })
end

-- Render the heatmap view
function render_view(input_json)
  local input = nous.json_decode(input_json)
  local content = input.content
  local properties = content.properties or {}
  local rows = content.rows or {}

  -- Find a date column and a number column
  local date_prop_id = nil
  local num_prop_id = nil
  local date_prop_name = "Date"
  local num_prop_name = "Value"

  for _, prop in ipairs(properties) do
    if prop.type == "date" and not date_prop_id then
      date_prop_id = prop.id
      date_prop_name = prop.name
    end
    if prop.type == "number" and not num_prop_id then
      num_prop_id = prop.id
      num_prop_name = prop.name
    end
  end

  if not date_prop_id then
    return nous.json_encode({
      html = '<div style="padding:20px;color:#999;text-align:center;">No date column found. Add a date property to use the heatmap view.</div>',
      styles = "",
      height = 80
    })
  end

  -- Collect date -> value mapping
  local date_values = {}
  local max_val = 1

  for _, row in ipairs(rows) do
    local cells = row.cells or {}
    local date_str = cells[date_prop_id]
    if date_str and type(date_str) == "string" and date_str ~= "" then
      -- Normalize to YYYY-MM-DD
      local date_key = string.sub(date_str, 1, 10)
      local val = 1
      if num_prop_id and cells[num_prop_id] then
        val = tonumber(cells[num_prop_id]) or 1
      end
      date_values[date_key] = (date_values[date_key] or 0) + val
      if date_values[date_key] > max_val then
        max_val = date_values[date_key]
      end
    end
  end

  -- Build SVG heatmap for the last 52 weeks (364 days)
  local cell_size = 12
  local cell_gap = 2
  local total_size = cell_size + cell_gap

  -- Use nous date helpers (no os library in sandbox)
  local today = nous.current_date()
  local today_iso = today.iso

  -- Color scale (5 levels)
  local colors = {
    "#1a1a2e",  -- empty (level 0)
    "#0e4429",  -- low
    "#006d32",  -- medium-low
    "#26a641",  -- medium-high
    "#39d353",  -- high
  }

  local function get_color(val)
    if not val or val == 0 then return colors[1] end
    local ratio = val / max_val
    if ratio <= 0.25 then return colors[2]
    elseif ratio <= 0.50 then return colors[3]
    elseif ratio <= 0.75 then return colors[4]
    else return colors[5]
    end
  end

  -- Day-of-week labels (Sun=index 1 in our grid)
  local dow_labels = { "", "Mon", "", "Wed", "", "Fri", "" }
  local label_width = 30

  -- Go back ~364 days and adjust to start on Sunday
  local back363 = nous.date_offset(today_iso, -363)
  local start_wday = back363.wday  -- 1=Sun
  local adjust = start_wday - 1
  local start_date = nous.date_offset(today_iso, -363 - adjust)
  local total_days = 364 + adjust

  -- Pre-compute all dates we need
  local day_dates = {}
  for i = 0, total_days - 1 do
    day_dates[i] = nous.date_offset(start_date.iso, i)
  end

  -- Start building SVG
  local svg_parts = {}
  local num_weeks = math.ceil(total_days / 7)
  table.insert(svg_parts, string.format(
    '<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" style="display:block;">',
    num_weeks * total_size + label_width + 10,
    7 * total_size + 30
  ))

  -- Day-of-week labels
  for i, label in ipairs(dow_labels) do
    if label ~= "" then
      table.insert(svg_parts, string.format(
        '<text x="0" y="%d" font-size="10" fill="#666" font-family="sans-serif" dominant-baseline="middle">%s</text>',
        20 + (i - 1) * total_size + cell_size / 2,
        label
      ))
    end
  end

  -- Month labels
  local month_names = { "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec" }
  local last_month = -1

  -- Generate cells
  for day_offset = 0, total_days - 1 do
    local d = day_dates[day_offset]
    local date_key = d.iso
    local week = math.floor(day_offset / 7)
    local dow = day_offset % 7  -- 0=Sun

    -- Month label (on the top)
    if d.month ~= last_month then
      table.insert(svg_parts, string.format(
        '<text x="%d" y="10" font-size="10" fill="#666" font-family="sans-serif">%s</text>',
        label_width + week * total_size,
        month_names[d.month]
      ))
      last_month = d.month
    end

    local val = date_values[date_key]
    local color = get_color(val)
    local x = label_width + week * total_size
    local y = 18 + dow * total_size

    local title = date_key
    if val and val > 0 then
      title = title .. ": " .. tostring(val)
    end

    table.insert(svg_parts, string.format(
      '<rect x="%d" y="%d" width="%d" height="%d" rx="2" fill="%s" data-action=\'{"type":"cell_click","date":"%s","value":%s}\'><title>%s</title></rect>',
      x, y, cell_size, cell_size, color,
      date_key, tostring(val or 0), title
    ))
  end

  table.insert(svg_parts, '</svg>')

  -- Legend
  local legend = '<div style="display:flex;align-items:center;gap:8px;margin-top:8px;padding-left:' .. label_width .. 'px;">'
  legend = legend .. '<span style="font-size:11px;color:#666;">Less</span>'
  for _, c in ipairs(colors) do
    legend = legend .. string.format('<span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:%s;"></span>', c)
  end
  legend = legend .. '<span style="font-size:11px;color:#666;">More</span>'
  legend = legend .. '<span style="font-size:11px;color:#888;margin-left:auto;">' .. date_prop_name
  if num_prop_id then
    legend = legend .. ' / ' .. num_prop_name
  end
  legend = legend .. '</span>'
  legend = legend .. '</div>'

  local html = '<div style="padding:16px;overflow-x:auto;">'
    .. table.concat(svg_parts)
    .. legend
    .. '</div>'

  local svg_height = 7 * total_size + 30
  local total_height = svg_height + 60  -- padding + legend

  return nous.json_encode({
    html = html,
    styles = "",
    height = total_height
  })
end

-- Handle cell click action
function handle_action(input_json)
  local input = nous.json_decode(input_json)
  -- Just return the clicked date info for now
  return nous.json_encode({
    handled = true,
    date = input.date,
    value = input.value
  })
end
