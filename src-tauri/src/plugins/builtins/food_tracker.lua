--[[ [manifest]
id = "nous.builtin.food-tracker"
name = "Food & Nutrition Tracker"
version = "0.1.0"
description = "Search foods via USDA API, log to a database, and view nutrition summaries."
capabilities = ["block_render", "network", "database_read", "database_write", "command_palette"]
hooks = ["block_render:food_search", "database_view:nutrition_summary", "command_palette"]
is_builtin = true
]]

-- ═══════════════════════════════════════════════════════════════
-- Block: Food Search
-- ═══════════════════════════════════════════════════════════════

function describe_block(_input_json)
  return nous.json_encode({
    block_type = "food_search",
    label = "Food Search",
    icon_svg = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>'
  })
end

-- HTML-escape helper
local function esc(s)
  if not s then return "" end
  s = tostring(s)
  return s:gsub("&", "&amp;"):gsub("<", "&lt;"):gsub(">", "&gt;"):gsub('"', "&quot;"):gsub("'", "&#39;")
end

-- Find or create the Food Log database
local function find_or_create_food_db(notebook_id)
  if not notebook_id or notebook_id == "" then return nil end

  -- Search existing databases
  local list_json = nous.database_list(notebook_id)
  local databases = nous.json_decode(list_json)

  if type(databases) == "table" then
    for _, db in ipairs(databases) do
      if db.title == "Food Log" then
        return db.id
      end
    end
  end

  -- Create new database
  local props = nous.json_encode({
    { name = "Food Name", type = "text" },
    { name = "Meal", type = "select", options = {
      { label = "Breakfast", color = "#f59e0b" },
      { label = "Lunch", color = "#10b981" },
      { label = "Dinner", color = "#3b82f6" },
      { label = "Snack", color = "#8b5cf6" },
    }},
    { name = "Calories", type = "number" },
    { name = "Protein", type = "number" },
    { name = "Carbs", type = "number" },
    { name = "Fat", type = "number" },
    { name = "Fiber", type = "number" },
    { name = "Serving", type = "text" },
    { name = "Date", type = "date" }
  })
  local result_json = nous.database_create(notebook_id, "Food Log", props)
  local result = nous.json_decode(result_json)
  if result and result.id then
    return result.id
  end
  return nil
end

-- Extract nutrient value from USDA food item
local function get_nutrient(food, nutrient_name)
  if not food.foodNutrients then return 0 end
  for _, n in ipairs(food.foodNutrients) do
    if n.nutrientName == nutrient_name then
      return n.value or 0
    end
  end
  return 0
end

-- Search USDA FoodData Central
-- Returns (results, error_string_or_nil)
local function search_usda(query)
  local encoded = query:gsub(" ", "%%20")
  local url = "https://api.nal.usda.gov/fdc/v1/foods/search?api_key=DEMO_KEY&query=" .. encoded .. "&pageSize=8"

  local ok, resp_json = pcall(nous.http_get, url)
  if not ok then
    return {}, "Network error: " .. tostring(resp_json)
  end

  local resp = nous.json_decode(resp_json)
  if resp.status == 429 then
    return {}, "USDA API rate limit reached (DEMO_KEY allows 30 requests/hour). Try again later."
  end
  if resp.status ~= 200 then
    return {}, "USDA API error: HTTP " .. tostring(resp.status)
  end
  if not resp.body then
    return {}, "USDA API returned empty response"
  end

  local data = nous.json_decode(resp.body)
  if not data.foods or #data.foods == 0 then return {}, nil end

  local results = {}
  for i, food in ipairs(data.foods) do
    if i > 8 then break end
    table.insert(results, {
      name = food.description or "Unknown",
      brand = food.brandName or food.brandOwner or "",
      calories = math.floor(get_nutrient(food, "Energy") + 0.5),
      protein = math.floor(get_nutrient(food, "Protein") * 10 + 0.5) / 10,
      carbs = math.floor(get_nutrient(food, "Carbohydrate, by difference") * 10 + 0.5) / 10,
      fat = math.floor(get_nutrient(food, "Total lipid (fat)") * 10 + 0.5) / 10,
      serving = food.servingSize and (tostring(food.servingSize) .. " " .. (food.servingSizeUnit or "g")) or "100 g"
    })
  end
  return results, nil
end

function render_block(input_json)
  local input = nous.json_decode(input_json)
  local data = input.data or {}
  local query = data.query or ""
  local notebook_id = data.notebook_id or ""
  local status_msg = ""

  -- Check for pending log action
  if data.action == "log_food" and data.food then
    local food = data.food
    local db_id = find_or_create_food_db(notebook_id)
    if db_id then
      local today = nous.current_date()
      local rows = nous.json_encode({
        {
          ["Food Name"] = food.name,
          ["Calories"] = food.calories,
          ["Protein"] = food.protein,
          ["Carbs"] = food.carbs,
          ["Fat"] = food.fat,
          ["Serving"] = food.serving,
          ["Date"] = today.iso
        }
      })
      nous.database_add_rows(notebook_id, db_id, rows)
      status_msg = '<div style="padding:8px 12px;background:#064e3b;color:#34d399;border-radius:4px;font-size:13px;margin-bottom:8px;">Logged: ' .. esc(food.name) .. '</div>'
    else
      status_msg = '<div style="padding:8px 12px;background:#7f1d1d;color:#fca5a5;border-radius:4px;font-size:13px;margin-bottom:8px;">Could not find or create Food Log database</div>'
    end
  end

  -- Search results
  local results_html = ""
  if query ~= "" then
    local results, search_err = search_usda(query)
    if search_err then
      results_html = '<div style="color:#ef4444;font-size:13px;padding:8px 0;">' .. esc(search_err) .. '</div>'
    elseif #results == 0 then
      results_html = '<div style="color:#888;font-size:13px;padding:8px 0;">No results found.</div>'
    else
      results_html = '<div style="display:flex;flex-direction:column;gap:6px;margin-top:8px;max-height:350px;overflow-y:auto;">'
      for i, r in ipairs(results) do
        local brand_str = r.brand ~= "" and (' <span style="color:#666;">(' .. esc(r.brand) .. ')</span>') or ""
        local food_json = nous.json_encode(r):gsub("'", "\\'")
        results_html = results_html .. string.format([[
<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:#1a1a2e;border-radius:4px;gap:8px;">
  <div style="flex:1;min-width:0;">
    <div style="font-size:13px;color:#e0e0e0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">%s%s</div>
    <div style="font-size:11px;color:#888;margin-top:2px;">%s · %dcal · P:%sg C:%sg F:%sg</div>
  </div>
  <button class="food-log-btn" data-index="%d"
    style="padding:3px 10px;font-size:11px;background:#22c55e;color:#fff;border:none;border-radius:4px;cursor:pointer;white-space:nowrap;">Log</button>
</div>
]], esc(r.name), brand_str, esc(r.serving), r.calories, r.protein, r.carbs, r.fat, i)
      end
      results_html = results_html .. '</div>'

      -- Embed results data for JS
      results_html = results_html .. '<script id="food-results-data" type="application/json">' .. nous.json_encode(results) .. '</script>'
    end
  end

  local query_val = esc(query)

  local html = string.format([[
<div style="padding:16px;">
  <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#666;margin-bottom:8px;">Food Search</div>
  %s
  <div style="display:flex;gap:8px;">
    <input id="food-query" type="text" value="%s" placeholder="Search for a food..."
      style="flex:1;background:#1a1a2e;color:#e0e0e0;border:1px solid #333;border-radius:4px;padding:6px 10px;font-size:13px;" />
    <button id="food-search-btn"
      style="padding:6px 14px;font-size:13px;background:#3b82f6;color:white;border:none;border-radius:4px;cursor:pointer;">Search</button>
  </div>
  <div id="food-results">%s</div>
</div>
<script>
(function() {
  var notebookId = '%s';

  function doSearch() {
    var q = document.getElementById('food-query').value.trim();
    if (!q) return;
    window.parent.postMessage({
      type: 'plugin-block-update-data',
      dataJson: JSON.stringify({ query: q, notebook_id: notebookId })
    }, '*');
  }

  document.getElementById('food-search-btn').addEventListener('click', doSearch);
  document.getElementById('food-query').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') doSearch();
  });

  document.addEventListener('click', function(e) {
    var btn = e.target.closest('.food-log-btn');
    if (!btn) return;
    var idx = parseInt(btn.getAttribute('data-index'));
    var dataEl = document.getElementById('food-results-data');
    if (!dataEl) return;
    var results = JSON.parse(dataEl.textContent);
    var food = results[idx - 1];
    if (!food) return;

    btn.textContent = 'Logging...';
    btn.disabled = true;

    window.parent.postMessage({
      type: 'plugin-block-update-data',
      dataJson: JSON.stringify({
        query: document.getElementById('food-query').value,
        notebook_id: notebookId,
        action: 'log_food',
        food: food
      })
    }, '*');
  });
})();
</script>
]], status_msg, query_val, results_html, esc(notebook_id))

  return nous.json_encode({
    html = html,
    styles = "",
    height = 400
  })
end

function handle_block_action(input_json)
  local input = nous.json_decode(input_json)
  return nous.json_encode({ handled = true, action = input.type or "unknown" })
end

-- ═══════════════════════════════════════════════════════════════
-- Database View: Nutrition Summary
-- ═══════════════════════════════════════════════════════════════

function describe_view(_input_json)
  return nous.json_encode({
    view_type = "nutrition_summary",
    label = "Nutrition Summary",
    icon_svg = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>'
  })
end

function render_view(input_json)
  local input = nous.json_decode(input_json)
  local content = input.content
  local properties = content.properties or {}
  local rows = content.rows or {}

  -- Find relevant columns by name
  local col_map = {}
  local target_cols = { calories = true, protein = true, carbs = true, fat = true, fiber = true, date = true, ["food name"] = true }
  for _, prop in ipairs(properties) do
    local lower = string.lower(prop.name)
    if target_cols[lower] then
      col_map[lower] = prop.id
    end
  end

  if not col_map["calories"] then
    return nous.json_encode({
      html = '<div style="padding:20px;color:#999;text-align:center;">No "Calories" column found. This view works with Food Log databases.</div>',
      styles = "",
      height = 80
    })
  end

  -- Aggregate by date
  local daily = {}
  local dates_order = {}

  for _, row in ipairs(rows) do
    local cells = row.cells or {}
    local date_str = "Unknown"
    if col_map["date"] and cells[col_map["date"]] then
      date_str = string.sub(tostring(cells[col_map["date"]]), 1, 10)
    end

    if not daily[date_str] then
      daily[date_str] = { calories = 0, protein = 0, carbs = 0, fat = 0, fiber = 0, count = 0 }
      table.insert(dates_order, date_str)
    end
    local d = daily[date_str]
    d.count = d.count + 1
    d.calories = d.calories + (tonumber(cells[col_map["calories"]] or "0") or 0)
    if col_map["protein"] then d.protein = d.protein + (tonumber(cells[col_map["protein"]] or "0") or 0) end
    if col_map["carbs"] then d.carbs = d.carbs + (tonumber(cells[col_map["carbs"]] or "0") or 0) end
    if col_map["fat"] then d.fat = d.fat + (tonumber(cells[col_map["fat"]] or "0") or 0) end
    if col_map["fiber"] then d.fiber = d.fiber + (tonumber(cells[col_map["fiber"]] or "0") or 0) end
  end

  -- Sort dates descending, take last 7
  table.sort(dates_order, function(a, b) return a > b end)
  local display_dates = {}
  for i = 1, math.min(7, #dates_order) do
    table.insert(display_dates, dates_order[i])
  end
  -- Reverse so chart goes left to right chronologically
  local chart_dates = {}
  for i = #display_dates, 1, -1 do
    table.insert(chart_dates, display_dates[i])
  end

  if #chart_dates == 0 then
    return nous.json_encode({
      html = '<div style="padding:20px;color:#999;text-align:center;">No data to display yet.</div>',
      styles = "",
      height = 80
    })
  end

  -- Find max calorie for scaling
  local max_cal = 1
  for _, dt in ipairs(chart_dates) do
    if daily[dt].calories > max_cal then max_cal = daily[dt].calories end
  end

  -- Build SVG bar chart
  local chart_w = 500
  local chart_h = 200
  local bar_gap = 8
  local n = #chart_dates
  local bar_w = math.floor((chart_w - (n + 1) * bar_gap) / n)
  if bar_w < 20 then bar_w = 20 end

  local svg = {}
  table.insert(svg, string.format('<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" style="display:block;">', chart_w, chart_h + 40))

  -- Grid lines
  for i = 0, 4 do
    local y = 10 + (chart_h / 4) * i
    local val = math.floor(max_cal * (1 - i / 4))
    table.insert(svg, string.format('<line x1="0" y1="%d" x2="%d" y2="%d" stroke="#222" stroke-width="1"/>', y, chart_w, y))
    table.insert(svg, string.format('<text x="2" y="%d" font-size="9" fill="#555" font-family="sans-serif">%d</text>', y - 2, val))
  end

  -- Bars
  for i, dt in ipairs(chart_dates) do
    local d = daily[dt]
    local x = bar_gap + (i - 1) * (bar_w + bar_gap)
    local h = chart_h * (d.calories / max_cal)
    local y = 10 + chart_h - h

    -- Stacked: fat (top), carbs (middle), protein (bottom) within the calorie bar
    local total_macros = d.protein * 4 + d.carbs * 4 + d.fat * 9
    if total_macros > 0 then
      local fat_h = h * (d.fat * 9 / total_macros)
      local carb_h = h * (d.carbs * 4 / total_macros)
      local prot_h = h - fat_h - carb_h

      table.insert(svg, string.format('<rect x="%d" y="%d" width="%d" height="%d" rx="2" fill="#ef4444" opacity="0.8"><title>Fat: %sg</title></rect>', x, y, bar_w, fat_h, d.fat))
      table.insert(svg, string.format('<rect x="%d" y="%d" width="%d" height="%d" fill="#eab308" opacity="0.8"><title>Carbs: %sg</title></rect>', x, y + fat_h, bar_w, carb_h, d.carbs))
      table.insert(svg, string.format('<rect x="%d" y="%d" width="%d" height="%d" rx="2" fill="#22c55e" opacity="0.8"><title>Protein: %sg</title></rect>', x, y + fat_h + carb_h, bar_w, prot_h, d.protein))
    else
      table.insert(svg, string.format('<rect x="%d" y="%d" width="%d" height="%d" rx="2" fill="#3b82f6" opacity="0.8"/>', x, y, bar_w, h))
    end

    -- Calorie label on top
    table.insert(svg, string.format('<text x="%d" y="%d" font-size="10" fill="#ccc" font-family="sans-serif" text-anchor="middle">%d</text>', x + bar_w / 2, y - 4, d.calories))
    -- Date label
    local short_date = string.sub(dt, 6)  -- MM-DD
    table.insert(svg, string.format('<text x="%d" y="%d" font-size="10" fill="#888" font-family="sans-serif" text-anchor="middle">%s</text>', x + bar_w / 2, chart_h + 24, short_date))
  end

  table.insert(svg, '</svg>')

  -- Legend
  local legend = [[
<div style="display:flex;gap:16px;margin-top:8px;justify-content:center;">
  <span style="font-size:11px;color:#888;display:flex;align-items:center;gap:4px;"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#22c55e;opacity:0.8;"></span>Protein</span>
  <span style="font-size:11px;color:#888;display:flex;align-items:center;gap:4px;"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#eab308;opacity:0.8;"></span>Carbs</span>
  <span style="font-size:11px;color:#888;display:flex;align-items:center;gap:4px;"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#ef4444;opacity:0.8;"></span>Fat</span>
</div>
]]

  -- Today's summary
  local today = nous.current_date()
  local today_data = daily[today.iso]
  local summary = ""
  if today_data then
    summary = string.format([[
<div style="display:flex;gap:16px;margin-top:12px;padding:10px;background:#1a1a2e;border-radius:6px;justify-content:center;flex-wrap:wrap;">
  <div style="text-align:center;"><div style="font-size:20px;font-weight:700;color:#e0e0e0;">%d</div><div style="font-size:10px;color:#888;">Calories</div></div>
  <div style="text-align:center;"><div style="font-size:20px;font-weight:700;color:#22c55e;">%sg</div><div style="font-size:10px;color:#888;">Protein</div></div>
  <div style="text-align:center;"><div style="font-size:20px;font-weight:700;color:#eab308;">%sg</div><div style="font-size:10px;color:#888;">Carbs</div></div>
  <div style="text-align:center;"><div style="font-size:20px;font-weight:700;color:#ef4444;">%sg</div><div style="font-size:10px;color:#888;">Fat</div></div>
  <div style="text-align:center;"><div style="font-size:20px;font-weight:700;color:#06b6d4;">%sg</div><div style="font-size:10px;color:#888;">Fiber</div></div>
  <div style="text-align:center;"><div style="font-size:20px;font-weight:700;color:#ccc;">%d</div><div style="font-size:10px;color:#888;">Items</div></div>
</div>
]], today_data.calories, today_data.protein, today_data.carbs, today_data.fat, today_data.fiber, today_data.count)
  end

  local html = '<div style="padding:16px;overflow-x:auto;">'
    .. '<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#666;margin-bottom:12px;">Nutrition Summary (Last 7 Days)</div>'
    .. table.concat(svg)
    .. legend
    .. summary
    .. '</div>'

  return nous.json_encode({
    html = html,
    styles = "",
    height = chart_h + 160
  })
end

function handle_action(input_json)
  local input = nous.json_decode(input_json)
  return nous.json_encode({ handled = true, action = input.type or "unknown" })
end

-- ═══════════════════════════════════════════════════════════════
-- Command Palette: Quick Log Food
-- ═══════════════════════════════════════════════════════════════

function describe_commands(_input_json)
  return nous.json_encode({
    commands = {
      {
        id = "log_food",
        label = "Log Food",
        description = "Quick-log a food item to your Food Log database"
      }
    }
  })
end

function handle_command(input_json)
  local input = nous.json_decode(input_json)

  if input.command_id == "log_food" then
    local query = input.query or input.text or ""
    if query == "" then
      return nous.json_encode({
        handled = true,
        prompt = "Enter a food name to search and log"
      })
    end

    -- Search and log first result
    local results, search_err = search_usda(query)
    if search_err then
      return nous.json_encode({
        handled = true,
        message = search_err
      })
    end
    if #results == 0 then
      return nous.json_encode({
        handled = true,
        message = "No foods found for: " .. query
      })
    end

    local food = results[1]
    local notebook_id = input.notebook_id or ""
    local db_id = find_or_create_food_db(notebook_id)
    if not db_id then
      return nous.json_encode({
        handled = true,
        message = "Could not find or create Food Log database"
      })
    end

    local today = nous.current_date()
    local rows = nous.json_encode({
      {
        ["Food Name"] = food.name,
        ["Calories"] = food.calories,
        ["Protein"] = food.protein,
        ["Carbs"] = food.carbs,
        ["Fat"] = food.fat,
        ["Serving"] = food.serving,
        ["Date"] = today.iso
      }
    })
    nous.database_add_rows(notebook_id, db_id, rows)

    return nous.json_encode({
      handled = true,
      message = string.format("Logged: %s (%d cal, P:%sg C:%sg F:%sg)", food.name, food.calories, food.protein, food.carbs, food.fat)
    })
  end

  return nous.json_encode({ handled = false })
end
