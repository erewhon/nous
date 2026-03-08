--[[ [manifest]
id = "nous.builtin.food-tracker"
name = "Food & Nutrition Tracker"
version = "0.2.0"
description = "Search foods via USDA API, log meals to a database, view nutrition summaries with daily goals, and track macros from the sidebar."
capabilities = ["block_render", "sidebar_panel", "network", "database_read", "database_write", "command_palette"]
hooks = ["block_render:food_search", "database_view:nutrition_summary", "sidebar_panel:food_log", "command_palette"]
is_builtin = true
]]

-- ═══════════════════════════════════════════════════════════════
-- Shared helpers
-- ═══════════════════════════════════════════════════════════════

-- Persistent daily goals (survive across renders within app session)
_food_goals = _food_goals or {
  calories = 2000,
  protein = 150,
  carbs = 250,
  fat = 65,
  fiber = 30,
}

-- Cache the database ID
_food_db_id = _food_db_id or nil

local function esc(s)
  if not s then return "" end
  s = tostring(s)
  return s:gsub("&", "&amp;"):gsub("<", "&lt;"):gsub(">", "&gt;"):gsub('"', "&quot;"):gsub("'", "&#39;")
end

local function find_or_create_food_db(notebook_id)
  if _food_db_id then return _food_db_id end
  if not notebook_id or notebook_id == "" then return nil end

  local ok, list_json = pcall(function() return nous.database_list(notebook_id) end)
  if ok and list_json then
    local databases = nous.json_decode(list_json)
    if type(databases) == "table" then
      for _, db in ipairs(databases) do
        if db.title == "Food Log" then
          _food_db_id = db.id
          return _food_db_id
        end
      end
    end
  end

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

  local ok2, result_json = pcall(function() return nous.database_create(notebook_id, "Food Log", props) end)
  if ok2 and result_json then
    local result = nous.json_decode(result_json)
    if result and result.id then
      _food_db_id = result.id
      return _food_db_id
    end
  end
  return nil
end

local function get_nutrient(food, nutrient_name)
  if not food.foodNutrients then return 0 end
  for _, n in ipairs(food.foodNutrients) do
    if n.nutrientName == nutrient_name then
      return n.value or 0
    end
  end
  return 0
end

local function search_usda(query)
  local encoded = query:gsub(" ", "%%20")
  local url = "https://api.nal.usda.gov/fdc/v1/foods/search?api_key=DEMO_KEY&query=" .. encoded .. "&pageSize=8"

  local ok, resp_json = pcall(nous.http_get, url)
  if not ok then
    return {}, "Network error: " .. tostring(resp_json)
  end

  local resp = nous.json_decode(resp_json)
  if resp.status == 429 then
    return {}, "Rate limit reached (DEMO_KEY allows ~30 req/hr). Try again later."
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
      fiber = math.floor(get_nutrient(food, "Fiber, total dietary") * 10 + 0.5) / 10,
      serving = food.servingSize and (tostring(food.servingSize) .. " " .. (food.servingSizeUnit or "g")) or "100 g"
    })
  end
  return results, nil
end

-- Get today's totals from Food Log database
local function get_today_totals(notebook_id)
  local totals = { calories = 0, protein = 0, carbs = 0, fat = 0, fiber = 0, count = 0 }
  local db_id = find_or_create_food_db(notebook_id)
  if not db_id then return totals end

  local ok, db_json = pcall(function() return nous.database_get(notebook_id, db_id) end)
  if not ok or not db_json then return totals end

  local db = nous.json_decode(db_json)
  local properties = db.properties or {}
  local rows = db.rows or {}

  local col_map = {}
  for _, prop in ipairs(properties) do
    local lower = string.lower(prop.name)
    col_map[lower] = prop.id
  end

  local today = nous.current_date().iso
  for _, row in ipairs(rows) do
    local cells = row.cells or {}
    local date_str = ""
    if col_map["date"] and cells[col_map["date"]] then
      date_str = string.sub(tostring(cells[col_map["date"]]), 1, 10)
    end
    if date_str == today then
      totals.count = totals.count + 1
      totals.calories = totals.calories + (tonumber(cells[col_map["calories"]] or "0") or 0)
      totals.protein = totals.protein + (tonumber(cells[col_map["protein"]] or "0") or 0)
      totals.carbs = totals.carbs + (tonumber(cells[col_map["carbs"]] or "0") or 0)
      totals.fat = totals.fat + (tonumber(cells[col_map["fat"]] or "0") or 0)
      totals.fiber = totals.fiber + (tonumber(cells[col_map["fiber"]] or "0") or 0)
    end
  end
  return totals
end

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

function render_block(input_json)
  local input = nous.json_decode(input_json)
  local data = input.data or {}
  local query = data.query or ""
  local meal = data.meal or "Snack"
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
          ["Meal"] = data.meal or "Snack",
          ["Calories"] = food.calories,
          ["Protein"] = food.protein,
          ["Carbs"] = food.carbs,
          ["Fat"] = food.fat,
          ["Fiber"] = food.fiber or 0,
          ["Serving"] = food.serving,
          ["Date"] = today.iso
        }
      })
      nous.database_add_rows(notebook_id, db_id, rows)
      status_msg = '<div style="padding:8px 12px;background:#064e3b;color:#34d399;border-radius:4px;font-size:13px;margin-bottom:8px;">Logged: ' .. esc(food.name) .. ' (' .. esc(data.meal or "Snack") .. ')</div>'
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
        results_html = results_html .. string.format([[
<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:#1a1a2e;border-radius:4px;gap:8px;">
  <div style="flex:1;min-width:0;">
    <div style="font-size:13px;color:#e0e0e0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">%s%s</div>
    <div style="font-size:11px;color:#888;margin-top:2px;">%s · %dcal · P:%sg C:%sg F:%sg · Fiber:%sg</div>
  </div>
  <button class="food-log-btn" data-index="%d"
    style="padding:3px 10px;font-size:11px;background:#22c55e;color:#fff;border:none;border-radius:4px;cursor:pointer;white-space:nowrap;">Log</button>
</div>
]], esc(r.name), brand_str, esc(r.serving), r.calories, r.protein, r.carbs, r.fat, r.fiber, i)
      end
      results_html = results_html .. '</div>'
      results_html = results_html .. '<script id="food-results-data" type="application/json">' .. nous.json_encode(results) .. '</script>'
    end
  end

  local meals = { "Breakfast", "Lunch", "Dinner", "Snack" }
  local meal_options = ""
  for _, m in ipairs(meals) do
    local sel = (m == meal) and ' selected' or ''
    meal_options = meal_options .. '<option value="' .. m .. '"' .. sel .. '>' .. m .. '</option>'
  end

  local html = string.format([[
<div style="padding:16px;">
  <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#666;margin-bottom:8px;">Food Search</div>
  %s
  <div style="display:flex;gap:8px;margin-bottom:8px;">
    <input id="food-query" type="text" value="%s" placeholder="Search for a food..."
      style="flex:1;background:#1a1a2e;color:#e0e0e0;border:1px solid #333;border-radius:4px;padding:6px 10px;font-size:13px;" />
    <button id="food-search-btn"
      style="padding:6px 14px;font-size:13px;background:#3b82f6;color:white;border:none;border-radius:4px;cursor:pointer;">Search</button>
  </div>
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
    <label style="font-size:12px;color:#888;">Meal:</label>
    <select id="food-meal" style="background:#1a1a2e;color:#e0e0e0;border:1px solid #333;border-radius:4px;padding:4px 8px;font-size:12px;">
      %s
    </select>
  </div>
  <div id="food-results">%s</div>
</div>
<script>
(function() {
  var notebookId = '%s';

  function doSearch() {
    var q = document.getElementById('food-query').value.trim();
    if (!q) return;
    var meal = document.getElementById('food-meal').value;
    window.parent.postMessage({
      type: 'plugin-block-update-data',
      dataJson: JSON.stringify({ query: q, meal: meal, notebook_id: notebookId })
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

    var meal = document.getElementById('food-meal').value;
    window.parent.postMessage({
      type: 'plugin-block-update-data',
      dataJson: JSON.stringify({
        query: document.getElementById('food-query').value,
        meal: meal,
        notebook_id: notebookId,
        action: 'log_food',
        food: food
      })
    }, '*');
  });
})();
</script>
]], status_msg, esc(query), meal_options, results_html, esc(notebook_id))

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
-- Sidebar Panel: Food Log
-- ═══════════════════════════════════════════════════════════════

function describe_panel(_input_json)
  return nous.json_encode({
    panel_id = "food_log",
    label = "Food Log",
    icon_svg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>',
    default_width = 300,
  })
end

function render_panel(input_json)
  local input = nous.json_decode(input_json)
  local ctx = input.context or {}
  local notebook_id = ctx.current_notebook_id or ""
  local goals = _food_goals
  local totals = get_today_totals(notebook_id)

  local function pct(current, goal)
    if goal <= 0 then return 0 end
    return math.min(100, math.floor(current / goal * 100))
  end

  local function bar(label, current, goal, color)
    local p = pct(current, goal)
    local over = current > goal
    return string.format([[
<div style="margin-bottom:10px;">
  <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px;">
    <span style="color:#aaa;">%s</span>
    <span style="color:%s;font-weight:500;">%s / %s%s</span>
  </div>
  <div style="height:6px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden;">
    <div style="height:100%%;width:%d%%;background:%s;border-radius:3px;transition:width 0.3s;%s"></div>
  </div>
</div>]], label,
    over and "#ef4444" or "#ccc",
    tostring(math.floor(current)), tostring(goal),
    label == "Calories" and "" or "g",
    p, color,
    over and "opacity:0.9;" or "")
  end

  -- Macro split percentages
  local total_cal_from_macros = totals.protein * 4 + totals.carbs * 4 + totals.fat * 9
  local prot_pct = total_cal_from_macros > 0 and math.floor(totals.protein * 4 / total_cal_from_macros * 100 + 0.5) or 0
  local carb_pct = total_cal_from_macros > 0 and math.floor(totals.carbs * 4 / total_cal_from_macros * 100 + 0.5) or 0
  local fat_pct = 100 - prot_pct - carb_pct

  local html = string.format([[
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: transparent;
    color: #c8c8d8;
    padding: 12px 14px;
    font-size: 13px;
  }
  .section-title {
    font-size: 10px;
    font-weight: 600;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 14px 0 8px;
  }
  .section-title:first-child { margin-top: 0; }
  .search-row {
    display: flex;
    gap: 6px;
    margin-bottom: 6px;
  }
  .search-row input {
    flex: 1;
    background: rgba(255,255,255,0.05);
    color: #e0e0e0;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 4px;
    padding: 5px 8px;
    font-size: 12px;
  }
  .search-row button {
    background: #3b82f6;
    color: white;
    border: none;
    border-radius: 4px;
    padding: 5px 10px;
    font-size: 12px;
    cursor: pointer;
  }
  .search-row button:hover { opacity: 0.85; }
  .meal-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 6px;
    font-size: 11px;
    color: #888;
  }
  .meal-row select {
    background: rgba(255,255,255,0.05);
    color: #e0e0e0;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 4px;
    padding: 3px 6px;
    font-size: 11px;
  }
  .result-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 8px;
    background: rgba(255,255,255,0.03);
    border-radius: 4px;
    margin-bottom: 4px;
    gap: 6px;
  }
  .result-name {
    font-size: 12px;
    color: #e0e0e0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .result-meta {
    font-size: 10px;
    color: #777;
    margin-top: 1px;
  }
  .log-btn {
    padding: 2px 8px;
    font-size: 10px;
    background: #22c55e;
    color: #fff;
    border: none;
    border-radius: 3px;
    cursor: pointer;
    white-space: nowrap;
  }
  .log-btn:hover { opacity: 0.85; }
  .log-btn:disabled { opacity: 0.5; cursor: default; }
  .macro-ring {
    display: flex;
    gap: 12px;
    justify-content: center;
    margin: 8px 0;
  }
  .macro-stat {
    text-align: center;
    font-size: 10px;
    color: #888;
  }
  .macro-stat .val {
    font-size: 16px;
    font-weight: 700;
    color: #e0e0f0;
  }
  .status-msg {
    padding: 6px 10px;
    border-radius: 4px;
    font-size: 12px;
    margin-bottom: 8px;
  }
  #search-results { max-height: 200px; overflow-y: auto; }
  .error { background: #7f1d1d; color: #fca5a5; }
  .success { background: #064e3b; color: #34d399; }
</style>

<div class="section-title">Today's Progress</div>
%s
%s
%s
%s
%s

<div style="display:flex;justify-content:center;gap:3px;margin:4px 0 2px;height:8px;border-radius:4px;overflow:hidden;background:rgba(255,255,255,0.04);">
  <div style="width:%d%%;background:#22c55e;"></div>
  <div style="width:%d%%;background:#eab308;"></div>
  <div style="width:%d%%;background:#ef4444;"></div>
</div>
<div style="display:flex;justify-content:center;gap:12px;font-size:10px;color:#777;margin-bottom:4px;">
  <span>P %d%%%%</span><span>C %d%%%%</span><span>F %d%%%%</span>
</div>

<div class="macro-ring">
  <div class="macro-stat"><div class="val">%d</div>items</div>
</div>

<div class="section-title">Quick Log</div>
<div class="search-row">
  <input id="panel-query" type="text" placeholder="Search food..." />
  <button id="panel-search">Go</button>
</div>
<div class="meal-row">
  Meal:
  <select id="panel-meal">
    <option value="Breakfast">Breakfast</option>
    <option value="Lunch">Lunch</option>
    <option value="Dinner">Dinner</option>
    <option value="Snack" selected>Snack</option>
  </select>
</div>
<div id="status-area"></div>
<div id="search-results"></div>

<details style="margin-top:12px;">
  <summary style="font-size:10px;color:#666;cursor:pointer;user-select:none;">Daily Goals</summary>
  <div style="margin-top:8px;display:flex;flex-direction:column;gap:6px;">
    <div class="meal-row"><span style="width:60px;">Calories</span><input id="goal-cal" type="number" value="%d" style="width:60px;background:rgba(255,255,255,0.05);color:#e0e0e0;border:1px solid rgba(255,255,255,0.1);border-radius:4px;padding:3px 6px;font-size:11px;text-align:center;"/></div>
    <div class="meal-row"><span style="width:60px;">Protein</span><input id="goal-prot" type="number" value="%d" style="width:60px;background:rgba(255,255,255,0.05);color:#e0e0e0;border:1px solid rgba(255,255,255,0.1);border-radius:4px;padding:3px 6px;font-size:11px;text-align:center;"/> g</div>
    <div class="meal-row"><span style="width:60px;">Carbs</span><input id="goal-carb" type="number" value="%d" style="width:60px;background:rgba(255,255,255,0.05);color:#e0e0e0;border:1px solid rgba(255,255,255,0.1);border-radius:4px;padding:3px 6px;font-size:11px;text-align:center;"/> g</div>
    <div class="meal-row"><span style="width:60px;">Fat</span><input id="goal-fat" type="number" value="%d" style="width:60px;background:rgba(255,255,255,0.05);color:#e0e0e0;border:1px solid rgba(255,255,255,0.1);border-radius:4px;padding:3px 6px;font-size:11px;text-align:center;"/> g</div>
    <div class="meal-row"><span style="width:60px;">Fiber</span><input id="goal-fiber" type="number" value="%d" style="width:60px;background:rgba(255,255,255,0.05);color:#e0e0e0;border:1px solid rgba(255,255,255,0.1);border-radius:4px;padding:3px 6px;font-size:11px;text-align:center;"/> g</div>
    <button id="save-goals" style="align-self:center;padding:4px 12px;font-size:11px;background:#6366f1;color:white;border:none;border-radius:4px;cursor:pointer;margin-top:2px;">Save Goals</button>
  </div>
</details>

<script>
(function() {
  var NOTEBOOK_ID = '%s';

  function doSearch() {
    var q = document.getElementById('panel-query').value.trim();
    if (!q) return;
    document.getElementById('panel-search').textContent = '...';
    window.parent.postMessage({
      type: 'plugin-panel-action',
      payload: { action: 'search', query: q }
    }, '*');
  }

  document.getElementById('panel-search').addEventListener('click', doSearch);
  document.getElementById('panel-query').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') doSearch();
  });

  document.getElementById('save-goals').addEventListener('click', function() {
    window.parent.postMessage({
      type: 'plugin-panel-action',
      payload: {
        action: 'save_goals',
        calories: parseInt(document.getElementById('goal-cal').value) || 2000,
        protein: parseInt(document.getElementById('goal-prot').value) || 150,
        carbs: parseInt(document.getElementById('goal-carb').value) || 250,
        fat: parseInt(document.getElementById('goal-fat').value) || 65,
        fiber: parseInt(document.getElementById('goal-fiber').value) || 30
      }
    }, '*');
  });

  // Handle search results returned from Lua
  window.addEventListener('message', function(e) {
    var msg = e.data;
    if (!msg || msg.type !== 'panel-search-results') return;

    document.getElementById('panel-search').textContent = 'Go';
    var area = document.getElementById('search-results');
    var statusArea = document.getElementById('status-area');

    if (msg.error) {
      area.innerHTML = '<div class="status-msg error">' + msg.error + '</div>';
      return;
    }

    if (!msg.results || msg.results.length === 0) {
      area.innerHTML = '<div style="color:#888;font-size:12px;padding:6px 0;">No results.</div>';
      return;
    }

    var html = '';
    msg.results.forEach(function(r, i) {
      var brand = r.brand ? ' <span style="color:#555;">(' + r.brand + ')</span>' : '';
      html += '<div class="result-item">' +
        '<div style="flex:1;min-width:0;">' +
          '<div class="result-name">' + r.name + brand + '</div>' +
          '<div class="result-meta">' + r.serving + ' · ' + r.calories + 'cal P:' + r.protein + 'g C:' + r.carbs + 'g F:' + r.fat + 'g</div>' +
        '</div>' +
        '<button class="log-btn" data-idx="' + i + '">Log</button>' +
      '</div>';
    });
    area.innerHTML = html;

    // Store results for log buttons
    area._results = msg.results;

    area.addEventListener('click', function handler(ev) {
      var btn = ev.target.closest('.log-btn');
      if (!btn) return;
      var idx = parseInt(btn.getAttribute('data-idx'));
      var food = area._results[idx];
      if (!food) return;
      btn.textContent = '...';
      btn.disabled = true;
      var meal = document.getElementById('panel-meal').value;
      window.parent.postMessage({
        type: 'plugin-panel-action',
        payload: { action: 'log_food', food: food, meal: meal, notebookId: NOTEBOOK_ID }
      }, '*');
    });
  });

  // Handle log confirmation
  window.addEventListener('message', function(e) {
    var msg = e.data;
    if (!msg) return;
    if (msg.type === 'panel-food-logged') {
      var statusArea = document.getElementById('status-area');
      statusArea.innerHTML = '<div class="status-msg success">Logged: ' + (msg.name || 'food') + '</div>';
      setTimeout(function() { statusArea.innerHTML = ''; }, 3000);
    } else if (msg.type === 'panel-goals-saved') {
      var statusArea = document.getElementById('status-area');
      statusArea.innerHTML = '<div class="status-msg success">Goals saved</div>';
      setTimeout(function() { statusArea.innerHTML = ''; }, 2000);
    }
  });
})();
</script>
]],
    bar("Calories", totals.calories, goals.calories, "#6366f1"),
    bar("Protein", totals.protein, goals.protein, "#22c55e"),
    bar("Carbs", totals.carbs, goals.carbs, "#eab308"),
    bar("Fat", totals.fat, goals.fat, "#ef4444"),
    bar("Fiber", totals.fiber, goals.fiber, "#06b6d4"),
    -- macro split bar widths
    prot_pct, carb_pct, fat_pct,
    prot_pct, carb_pct, fat_pct,
    -- item count
    totals.count,
    -- goal inputs
    goals.calories, goals.protein, goals.carbs, goals.fat, goals.fiber,
    -- notebook id for JS
    esc(notebook_id)
  )

  return nous.json_encode({ html = html })
end

function handle_panel_action(input_json)
  local input = nous.json_decode(input_json)
  local action = input.action or ""

  if action == "search" then
    local query = input.query or ""
    if query == "" then
      return nous.json_encode({ handled = true })
    end
    local results, err = search_usda(query)
    -- Return results via a special mechanism: the parent will forward to iframe
    return nous.json_encode({
      forward_to_iframe = true,
      message = {
        type = "panel-search-results",
        results = results,
        error = err
      }
    })

  elseif action == "log_food" then
    local food = input.food
    local meal = input.meal or "Snack"
    local notebook_id = input.notebookId or ""
    if food and notebook_id ~= "" then
      local db_id = find_or_create_food_db(notebook_id)
      if db_id then
        local today = nous.current_date()
        pcall(function()
          nous.database_add_rows(notebook_id, db_id, nous.json_encode({
            {
              ["Food Name"] = food.name,
              ["Meal"] = meal,
              ["Calories"] = food.calories,
              ["Protein"] = food.protein,
              ["Carbs"] = food.carbs,
              ["Fat"] = food.fat,
              ["Fiber"] = food.fiber or 0,
              ["Serving"] = food.serving,
              ["Date"] = today.iso
            }
          }))
        end)
        return nous.json_encode({
          forward_to_iframe = true,
          message = { type = "panel-food-logged", name = food.name }
        })
      end
    end
    return nous.json_encode({ handled = true })

  elseif action == "save_goals" then
    _food_goals.calories = input.calories or 2000
    _food_goals.protein = input.protein or 150
    _food_goals.carbs = input.carbs or 250
    _food_goals.fat = input.fat or 65
    _food_goals.fiber = input.fiber or 30
    return nous.json_encode({
      forward_to_iframe = true,
      message = { type = "panel-goals-saved" }
    })
  end

  return nous.json_encode({ handled = true })
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
  local goals = _food_goals

  local col_map = {}
  local target_cols = { calories = true, protein = true, carbs = true, fat = true, fiber = true, date = true, ["food name"] = true, meal = true }
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

  -- Find max calorie for scaling (at least the goal line)
  local max_cal = goals.calories
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

  -- Goal line
  local goal_y = 10 + chart_h * (1 - goals.calories / max_cal)
  table.insert(svg, string.format('<line x1="0" y1="%.1f" x2="%d" y2="%.1f" stroke="#6366f1" stroke-width="1" stroke-dasharray="4,4" opacity="0.6"/>', goal_y, chart_w, goal_y))
  table.insert(svg, string.format('<text x="%d" y="%.1f" font-size="9" fill="#6366f1" font-family="sans-serif" text-anchor="end" opacity="0.8">Goal</text>', chart_w - 2, goal_y - 3))

  -- Bars
  for i, dt in ipairs(chart_dates) do
    local d = daily[dt]
    local x = bar_gap + (i - 1) * (bar_w + bar_gap)
    local h = chart_h * (d.calories / max_cal)
    local y = 10 + chart_h - h

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

    table.insert(svg, string.format('<text x="%d" y="%d" font-size="10" fill="#ccc" font-family="sans-serif" text-anchor="middle">%d</text>', x + bar_w / 2, y - 4, d.calories))
    local short_date = string.sub(dt, 6)
    table.insert(svg, string.format('<text x="%d" y="%d" font-size="10" fill="#888" font-family="sans-serif" text-anchor="middle">%s</text>', x + bar_w / 2, chart_h + 24, short_date))
  end

  table.insert(svg, '</svg>')

  local legend = [[
<div style="display:flex;gap:16px;margin-top:8px;justify-content:center;">
  <span style="font-size:11px;color:#888;display:flex;align-items:center;gap:4px;"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#22c55e;opacity:0.8;"></span>Protein</span>
  <span style="font-size:11px;color:#888;display:flex;align-items:center;gap:4px;"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#eab308;opacity:0.8;"></span>Carbs</span>
  <span style="font-size:11px;color:#888;display:flex;align-items:center;gap:4px;"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#ef4444;opacity:0.8;"></span>Fat</span>
  <span style="font-size:11px;color:#888;display:flex;align-items:center;gap:4px;"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;border:1px dashed #6366f1;opacity:0.8;"></span>Goal</span>
</div>
]]

  -- Today's summary with macro percentages
  local today = nous.current_date()
  local today_data = daily[today.iso]
  local summary = ""
  if today_data then
    local t = today_data
    local t_macro_cal = t.protein * 4 + t.carbs * 4 + t.fat * 9
    local t_prot_pct = t_macro_cal > 0 and math.floor(t.protein * 4 / t_macro_cal * 100 + 0.5) or 0
    local t_carb_pct = t_macro_cal > 0 and math.floor(t.carbs * 4 / t_macro_cal * 100 + 0.5) or 0
    local t_fat_pct = 100 - t_prot_pct - t_carb_pct

    summary = string.format([[
<div style="margin-top:12px;padding:12px;background:#1a1a2e;border-radius:6px;">
  <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#666;margin-bottom:8px;">Today</div>
  <div style="display:flex;gap:16px;justify-content:center;flex-wrap:wrap;">
    <div style="text-align:center;"><div style="font-size:20px;font-weight:700;color:#e0e0e0;">%d</div><div style="font-size:10px;color:#888;">Calories</div></div>
    <div style="text-align:center;"><div style="font-size:20px;font-weight:700;color:#22c55e;">%sg</div><div style="font-size:10px;color:#888;">Protein (%d%%%%)</div></div>
    <div style="text-align:center;"><div style="font-size:20px;font-weight:700;color:#eab308;">%sg</div><div style="font-size:10px;color:#888;">Carbs (%d%%%%)</div></div>
    <div style="text-align:center;"><div style="font-size:20px;font-weight:700;color:#ef4444;">%sg</div><div style="font-size:10px;color:#888;">Fat (%d%%%%)</div></div>
    <div style="text-align:center;"><div style="font-size:20px;font-weight:700;color:#06b6d4;">%sg</div><div style="font-size:10px;color:#888;">Fiber</div></div>
  </div>
</div>
]], t.calories, t.protein, t_prot_pct, t.carbs, t_carb_pct, t.fat, t_fat_pct, t.fiber)
  end

  -- 7-day averages
  local avg = { calories = 0, protein = 0, carbs = 0, fat = 0, fiber = 0 }
  if #chart_dates > 0 then
    for _, dt in ipairs(chart_dates) do
      local d = daily[dt]
      avg.calories = avg.calories + d.calories
      avg.protein = avg.protein + d.protein
      avg.carbs = avg.carbs + d.carbs
      avg.fat = avg.fat + d.fat
      avg.fiber = avg.fiber + d.fiber
    end
    local nd = #chart_dates
    avg.calories = math.floor(avg.calories / nd)
    avg.protein = math.floor(avg.protein / nd * 10 + 0.5) / 10
    avg.carbs = math.floor(avg.carbs / nd * 10 + 0.5) / 10
    avg.fat = math.floor(avg.fat / nd * 10 + 0.5) / 10
    avg.fiber = math.floor(avg.fiber / nd * 10 + 0.5) / 10
  end

  local avg_html = ""
  if #chart_dates > 1 then
    avg_html = string.format([[
<div style="margin-top:8px;padding:10px;background:rgba(255,255,255,0.03);border-radius:6px;">
  <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#666;margin-bottom:6px;">%d-Day Average</div>
  <div style="display:flex;gap:16px;justify-content:center;flex-wrap:wrap;font-size:12px;">
    <span style="color:#ccc;">%d cal</span>
    <span style="color:#22c55e;">P:%sg</span>
    <span style="color:#eab308;">C:%sg</span>
    <span style="color:#ef4444;">F:%sg</span>
    <span style="color:#06b6d4;">Fiber:%sg</span>
  </div>
</div>
]], #chart_dates, avg.calories, avg.protein, avg.carbs, avg.fat, avg.fiber)
  end

  local html = '<div style="padding:16px;overflow-x:auto;">'
    .. '<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#666;margin-bottom:12px;">Nutrition Summary (Last 7 Days)</div>'
    .. table.concat(svg)
    .. legend
    .. summary
    .. avg_html
    .. '</div>'

  return nous.json_encode({
    html = html,
    styles = "",
    height = chart_h + 260
  })
end

function handle_action(input_json)
  local input = nous.json_decode(input_json)
  return nous.json_encode({ handled = true, action = input.type or "unknown" })
end

-- ═══════════════════════════════════════════════════════════════
-- Command Palette: Quick Log Food
-- ═══════════════════════════════════════════════════════════════

function get_commands(_input_json)
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

    local results, search_err = search_usda(query)
    if search_err then
      return nous.json_encode({ handled = true, message = search_err })
    end
    if #results == 0 then
      return nous.json_encode({ handled = true, message = "No foods found for: " .. query })
    end

    local food = results[1]
    local notebook_id = input.notebook_id or ""
    local db_id = find_or_create_food_db(notebook_id)
    if not db_id then
      return nous.json_encode({ handled = true, message = "Could not find or create Food Log database" })
    end

    local today = nous.current_date()
    local rows = nous.json_encode({
      {
        ["Food Name"] = food.name,
        ["Meal"] = "Snack",
        ["Calories"] = food.calories,
        ["Protein"] = food.protein,
        ["Carbs"] = food.carbs,
        ["Fat"] = food.fat,
        ["Fiber"] = food.fiber or 0,
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
