--[[ [manifest]
id = "nous.builtin.food-tracker"
name = "Food & Nutrition Tracker"
version = "0.3.0"
description = "Search foods via USDA + OpenFoodFacts APIs with AI fallback, log meals to a database, view nutrition and micronutrient summaries with daily goals, and track macros from the sidebar."
capabilities = ["block_render", "sidebar_panel", "network", "database_read", "database_write", "command_palette"]
hooks = ["block_render:food_search", "database_view:nutrition_summary", "database_view:food_entry", "sidebar_panel:food_log", "command_palette"]
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

-- Ensure the Food Log database has all expected columns (migrates older schemas)
local _food_db_migrated = false

local function ensure_food_db_columns(notebook_id, db_id)
  if _food_db_migrated then return end
  _food_db_migrated = true

  local ok, db_json = pcall(function() return nous.database_get(notebook_id, db_id) end)
  if not ok or not db_json then return end

  local db = nous.json_decode(db_json)
  local existing = {}
  for _, prop in ipairs(db.properties or {}) do
    existing[string.lower(prop.name)] = true
  end

  -- Columns that should exist (name → type)
  local expected = {
    { name = "Qty", type = "number" },
    { name = "Sodium", type = "number" },
    { name = "Potassium", type = "number" },
    { name = "Calcium", type = "number" },
    { name = "Iron", type = "number" },
    { name = "Vitamin A", type = "number" },
    { name = "Vitamin C", type = "number" },
    { name = "Vitamin D", type = "number" },
  }

  local missing = {}
  for _, col in ipairs(expected) do
    if not existing[string.lower(col.name)] then
      table.insert(missing, col)
    end
  end

  if #missing > 0 then
    pcall(function()
      nous.database_update_properties(notebook_id, db_id, nous.json_encode(missing))
    end)
    nous.log_info(string.format("Food tracker: added %d missing column(s) to Food Log", #missing))
  end
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
          ensure_food_db_columns(notebook_id, db.id)
          return _food_db_id
        end
      end
    end
  end

  local props = nous.json_encode({
    { name = "Food Name", type = "text" },
    { name = "Qty", type = "number" },
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
    { name = "Sodium", type = "number" },
    { name = "Potassium", type = "number" },
    { name = "Calcium", type = "number" },
    { name = "Iron", type = "number" },
    { name = "Vitamin A", type = "number" },
    { name = "Vitamin C", type = "number" },
    { name = "Vitamin D", type = "number" },
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
  local url = "https://api.nal.usda.gov/fdc/v1/foods/search?api_key=DEMO_KEY&query=" .. encoded .. "&pageSize=6"

  local ok, resp_json = pcall(nous.http_get, url)
  if not ok then
    return {}
  end

  local resp = nous.json_decode(resp_json)
  if resp.status ~= 200 or not resp.body then
    return {}
  end

  local data = nous.json_decode(resp.body)
  if not data.foods or #data.foods == 0 then return {} end

  local results = {}
  for i, food in ipairs(data.foods) do
    if i > 6 then break end
    table.insert(results, {
      name = food.description or "Unknown",
      brand = food.brandName or food.brandOwner or "",
      calories = math.floor(get_nutrient(food, "Energy") + 0.5),
      protein = math.floor(get_nutrient(food, "Protein") * 10 + 0.5) / 10,
      carbs = math.floor(get_nutrient(food, "Carbohydrate, by difference") * 10 + 0.5) / 10,
      fat = math.floor(get_nutrient(food, "Total lipid (fat)") * 10 + 0.5) / 10,
      fiber = math.floor(get_nutrient(food, "Fiber, total dietary") * 10 + 0.5) / 10,
      sodium = math.floor(get_nutrient(food, "Sodium, Na") + 0.5),
      potassium = math.floor(get_nutrient(food, "Potassium, K") + 0.5),
      calcium = math.floor(get_nutrient(food, "Calcium, Ca") + 0.5),
      iron = math.floor(get_nutrient(food, "Iron, Fe") * 10 + 0.5) / 10,
      vitA = math.floor(get_nutrient(food, "Vitamin A, RAE") + 0.5),
      vitC = math.floor(get_nutrient(food, "Vitamin C, total ascorbic acid") * 10 + 0.5) / 10,
      vitD = math.floor(get_nutrient(food, "Vitamin D (D2 + D3)") * 10 + 0.5) / 10,
      serving = food.servingSize and (tostring(food.servingSize) .. " " .. (food.servingSizeUnit or "g")) or "100 g",
      source = "USDA"
    })
  end
  return results
end

local function search_openfoodfacts(query)
  local encoded = query:gsub(" ", "%%20")
  local url = "https://world.openfoodfacts.org/cgi/search.pl?search_terms=" .. encoded .. "&search_simple=1&action=process&json=1&page_size=6&fields=product_name,brands,nutriments,serving_size"

  local ok, resp_json = pcall(nous.http_get, url)
  if not ok then
    return {}
  end

  local resp = nous.json_decode(resp_json)
  if resp.status ~= 200 or not resp.body then
    return {}
  end

  local data = nous.json_decode(resp.body)
  if not data.products or #data.products == 0 then return {} end

  local results = {}
  for i, p in ipairs(data.products) do
    if i > 6 then break end
    local n = p.nutriments or {}
    local name = p.product_name
    if name and name ~= "" then
      table.insert(results, {
        name = name,
        brand = p.brands or "",
        calories = math.floor((n["energy-kcal_100g"] or n["energy-kcal"] or 0) + 0.5),
        protein = math.floor((n["proteins_100g"] or n["proteins"] or 0) * 10 + 0.5) / 10,
        carbs = math.floor((n["carbohydrates_100g"] or n["carbohydrates"] or 0) * 10 + 0.5) / 10,
        fat = math.floor((n["fat_100g"] or n["fat"] or 0) * 10 + 0.5) / 10,
        fiber = math.floor((n["fiber_100g"] or n["fiber"] or 0) * 10 + 0.5) / 10,
        sodium = math.floor((n["sodium_100g"] or 0) * 1000 + 0.5),
        potassium = math.floor((n["potassium_100g"] or 0) * 1000 + 0.5),
        calcium = math.floor((n["calcium_100g"] or 0) * 1000 + 0.5),
        iron = math.floor((n["iron_100g"] or 0) * 10 + 0.5) / 10,
        vitA = math.floor((n["vitamin-a_100g"] or 0) * 1000000 + 0.5),
        vitC = math.floor((n["vitamin-c_100g"] or 0) * 1000 + 0.5) / 10,
        vitD = math.floor((n["vitamin-d_100g"] or 0) * 1000000 + 0.5) / 10,
        serving = p.serving_size or "100 g",
        source = "OFF"
      })
    end
  end
  return results
end

local function search_foods(query)
  -- Search USDA first; only hit OpenFoodFacts if USDA returns few results
  -- (avoids two sequential HTTP requests which freeze the UI)
  local usda = search_usda(query)

  -- If USDA gave enough results, return them directly
  if #usda >= 4 then
    return usda, nil
  end

  -- Supplement with OpenFoodFacts for branded/packaged foods
  local off = search_openfoodfacts(query)

  if #usda == 0 and #off == 0 then
    return {}, "No results found. Try different keywords."
  end

  -- Merge: USDA first (more precise nutrition data), then OFF
  local results = {}
  local seen = {}
  for _, r in ipairs(usda) do
    local key = string.lower(r.name)
    if not seen[key] then
      seen[key] = true
      table.insert(results, r)
    end
  end
  for _, r in ipairs(off) do
    local key = string.lower(r.name)
    if not seen[key] and #results < 10 then
      seen[key] = true
      table.insert(results, r)
    end
  end
  return results, nil
end

-- AI-powered nutrition estimation for items not found in databases
local function ai_estimate_nutrition(description)
  local prompt = string.format(
    'Estimate the nutrition facts for one serving of: "%s"\n\n' ..
    'Respond ONLY with a JSON object (no markdown, no explanation) with these fields:\n' ..
    '{"name":"<product name>","brand":"<brand if known, else empty>","serving":"<serving size>",' ..
    '"calories":<number>,"protein":<number>,"carbs":<number>,"fat":<number>,"fiber":<number>,' ..
    '"sodium":<mg>,"potassium":<mg>,"calcium":<mg>,"iron":<mg>,' ..
    '"vitA":<mcg RAE>,"vitC":<mg>,"vitD":<mcg>}',
    description
  )

  local ok, response = pcall(nous.ai_complete, prompt,
    "You are a nutrition facts estimator. Given a food or product description, estimate its nutrition per serving. " ..
    "Use your knowledge of common foods, brands, and restaurant items. Be as accurate as possible. " ..
    "Always respond with ONLY valid JSON, no other text.")

  if not ok or not response or response == "" then
    return nil, "AI estimation unavailable. Configure an AI provider in Settings → AI."
  end

  -- Extract JSON from response (handle possible markdown wrapping)
  local json_str = response:match("```json%s*(.-)%s*```") or response:match("(%{.+%})") or response
  local parse_ok, data = pcall(nous.json_decode, json_str)
  if not parse_ok or type(data) ~= "table" then
    return nil, "AI returned unexpected format"
  end

  return {
    name = data.name or description,
    brand = data.brand or "",
    calories = tonumber(data.calories) or 0,
    protein = tonumber(data.protein) or 0,
    carbs = tonumber(data.carbs) or 0,
    fat = tonumber(data.fat) or 0,
    fiber = tonumber(data.fiber) or 0,
    sodium = tonumber(data.sodium) or 0,
    potassium = tonumber(data.potassium) or 0,
    calcium = tonumber(data.calcium) or 0,
    iron = tonumber(data.iron) or 0,
    vitA = tonumber(data.vitA) or 0,
    vitC = tonumber(data.vitC) or 0,
    vitD = tonumber(data.vitD) or 0,
    serving = data.serving or "1 serving",
    source = "AI"
  }, nil
end

-- Build a row for the Food Log database from a food result.
-- Nutrition values are stored PER SERVING; Qty is stored separately.
-- Totals are computed at read time as value * qty.
local function build_food_row(food, meal, qty)
  local today = nous.current_date()
  local q = tonumber(qty) or 1
  if q <= 0 then q = 1 end
  return {
    ["Food Name"] = food.name,
    ["Qty"] = q,
    ["Meal"] = meal or "Snack",
    ["Calories"] = tonumber(food.calories) or 0,
    ["Protein"] = tonumber(food.protein) or 0,
    ["Carbs"] = tonumber(food.carbs) or 0,
    ["Fat"] = tonumber(food.fat) or 0,
    ["Fiber"] = tonumber(food.fiber) or 0,
    ["Sodium"] = tonumber(food.sodium) or 0,
    ["Potassium"] = tonumber(food.potassium) or 0,
    ["Calcium"] = tonumber(food.calcium) or 0,
    ["Iron"] = tonumber(food.iron) or 0,
    ["Vitamin A"] = tonumber(food.vitA) or 0,
    ["Vitamin C"] = tonumber(food.vitC) or 0,
    ["Vitamin D"] = tonumber(food.vitD) or 0,
    ["Serving"] = food.serving or "1 serving",
    ["Date"] = today.iso
  }
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
      local qty = tonumber(col_map["qty"] and cells[col_map["qty"]] or "1") or 1
      totals.count = totals.count + 1
      totals.calories = totals.calories + (tonumber(cells[col_map["calories"]] or "0") or 0) * qty
      totals.protein = totals.protein + (tonumber(cells[col_map["protein"]] or "0") or 0) * qty
      totals.carbs = totals.carbs + (tonumber(cells[col_map["carbs"]] or "0") or 0) * qty
      totals.fat = totals.fat + (tonumber(cells[col_map["fat"]] or "0") or 0) * qty
      totals.fiber = totals.fiber + (tonumber(cells[col_map["fiber"]] or "0") or 0) * qty
    end
  end
  return totals
end

-- Get frequently logged foods (top N by occurrence count, with most recent nutrition data)
local function get_frequent_foods(notebook_id, limit)
  limit = limit or 6
  local db_id = find_or_create_food_db(notebook_id)
  if not db_id then return {} end

  local ok, db_json = pcall(function() return nous.database_get(notebook_id, db_id) end)
  if not ok or not db_json then return {} end

  local db = nous.json_decode(db_json)
  local properties = db.properties or {}
  local rows = db.rows or {}

  local col_map = {}
  for _, prop in ipairs(properties) do
    col_map[string.lower(prop.name)] = prop.id
  end

  -- Count occurrences by food name, keep most recent row data
  local freq = {}     -- name -> count
  local latest = {}   -- name -> { calories, protein, carbs, fat, fiber, serving, meal }
  local order = {}    -- insertion order for stable sorting

  for _, row in ipairs(rows) do
    local cells = row.cells or {}
    local name = col_map["food name"] and cells[col_map["food name"]] or nil
    if name and name ~= "" then
      if not freq[name] then
        freq[name] = 0
        table.insert(order, name)
      end
      freq[name] = freq[name] + 1
      -- Always overwrite with the latest row (rows are in chronological order)
      latest[name] = {
        name = name,
        calories = tonumber(cells[col_map["calories"]] or "0") or 0,
        protein = tonumber(cells[col_map["protein"]] or "0") or 0,
        carbs = tonumber(cells[col_map["carbs"]] or "0") or 0,
        fat = tonumber(cells[col_map["fat"]] or "0") or 0,
        fiber = tonumber(cells[col_map["fiber"]] or "0") or 0,
        serving = col_map["serving"] and cells[col_map["serving"]] or "",
        meal = col_map["meal"] and cells[col_map["meal"]] or "Snack",
      }
    end
  end

  -- Sort by frequency descending, then by most recent appearance
  table.sort(order, function(a, b)
    if freq[a] ~= freq[b] then return freq[a] > freq[b] end
    return false  -- stable: keep original order (later = more recent)
  end)

  local result = {}
  for i = 1, math.min(limit, #order) do
    local name = order[i]
    local item = latest[name]
    item.count = freq[name]
    table.insert(result, item)
  end
  return result
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
      local rows = nous.json_encode({ build_food_row(food, data.meal or "Snack") })
      nous.database_add_rows(notebook_id, db_id, rows)
      status_msg = '<div style="padding:8px 12px;background:#064e3b;color:#34d399;border-radius:4px;font-size:13px;margin-bottom:8px;">Logged: ' .. esc(food.name) .. ' (' .. esc(data.meal or "Snack") .. ')</div>'
    else
      status_msg = '<div style="padding:8px 12px;background:#7f1d1d;color:#fca5a5;border-radius:4px;font-size:13px;margin-bottom:8px;">Could not find or create Food Log database</div>'
    end
  end

  -- Search results
  local results_html = ""
  if query ~= "" then
    local results, search_err = search_foods(query)
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
  local frequent = get_frequent_foods(notebook_id, 6)

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

  -- Build frequent foods section
  local freq_html = ""
  if #frequent > 0 then
    local items = {}
    for i, f in ipairs(frequent) do
      table.insert(items, string.format(
        '<div class="quick-item" data-freq-idx="%d">'
        .. '<span class="qi-name">%s</span>'
        .. '<span class="qi-meta">%dcal</span>'
        .. '<span class="qi-add">+</span>'
        .. '</div>',
        i, esc(f.name), math.floor(f.calories + 0.5)
      ))
    end
    freq_html = '<div class="section-title">Quick Add</div>' .. table.concat(items)
  end

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
  .quick-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 5px 8px;
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 5px;
    margin-bottom: 3px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .quick-item:hover { background: rgba(255,255,255,0.07); }
  .quick-item:active { background: rgba(99,102,241,0.15); }
  .quick-item .qi-name {
    font-size: 12px;
    color: #ddd;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
  }
  .quick-item .qi-meta {
    font-size: 10px;
    color: #666;
    white-space: nowrap;
    margin-left: 8px;
  }
  .quick-item .qi-add {
    color: #22c55e;
    font-size: 14px;
    font-weight: 700;
    margin-left: 6px;
    flex-shrink: 0;
  }
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

%s

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

  // Quick Add: click handler for frequent food items
  document.addEventListener('click', function(e) {
    var item = e.target.closest('.quick-item');
    if (!item) return;
    var name = item.querySelector('.qi-name').textContent;
    var meal = document.getElementById('panel-meal').value;
    item.style.opacity = '0.5';
    item.style.pointerEvents = 'none';
    window.parent.postMessage({
      type: 'plugin-panel-action',
      payload: { action: 'quick_log', foodName: name, meal: meal, notebookId: NOTEBOOK_ID }
    }, '*');
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
    if (msg.type === 'panel-food-logged' || msg.type === 'panel-quick-logged') {
      var statusArea = document.getElementById('status-area');
      statusArea.innerHTML = '<div class="status-msg success">Logged: ' + (msg.name || 'food') + '</div>';
      setTimeout(function() { statusArea.innerHTML = ''; }, 3000);
      // Re-enable quick-add items
      document.querySelectorAll('.quick-item').forEach(function(el) {
        el.style.opacity = '';
        el.style.pointerEvents = '';
      });
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
    -- frequent foods section
    freq_html,
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
    local results, err = search_foods(query)
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
        pcall(function()
          nous.database_add_rows(notebook_id, db_id, nous.json_encode({ build_food_row(food, meal) }))
        end)
        return nous.json_encode({
          forward_to_iframe = true,
          message = { type = "panel-food-logged", name = food.name }
        })
      end
    end
    return nous.json_encode({ handled = true })

  elseif action == "quick_log" then
    local food_name = input.foodName or ""
    local meal = input.meal or "Snack"
    local notebook_id = input.notebookId or ""
    if food_name ~= "" and notebook_id ~= "" then
      -- Look up the most recent entry for this food name from the database
      local freq = get_frequent_foods(notebook_id, 100)
      local food = nil
      for _, f in ipairs(freq) do
        if f.name == food_name then
          food = f
          break
        end
      end
      if food then
        local db_id = find_or_create_food_db(notebook_id)
        if db_id then
          pcall(function()
            nous.database_add_rows(notebook_id, db_id, nous.json_encode({ build_food_row(food, meal) }))
          end)
          return nous.json_encode({
            forward_to_iframe = true,
            message = { type = "panel-quick-logged", name = food.name }
          })
        end
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

function describe_view(input_json)
  local input = input_json and nous.json_decode(input_json) or {}
  local vt = input.view_type or "nutrition_summary"

  if vt == "food_entry" then
    return nous.json_encode({
      view_type = "food_entry",
      label = "Food Entry",
      icon_svg = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>'
    })
  end

  return nous.json_encode({
    view_type = "nutrition_summary",
    label = "Nutrition Summary",
    icon_svg = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>'
  })
end

function render_view(input_json)
  local input = nous.json_decode(input_json)

  -- Dispatch to food_entry view if requested
  if input.view_type == "food_entry" then
    return render_food_entry_view(input)
  end

  local content = input.content
  local properties = content.properties or {}
  local rows = content.rows or {}
  local goals = _food_goals

  local col_map = {}
  local target_cols = {
    calories = true, protein = true, carbs = true, fat = true, fiber = true,
    date = true, ["food name"] = true, meal = true, qty = true,
    sodium = true, potassium = true, calcium = true, iron = true,
    ["vitamin a"] = true, ["vitamin c"] = true, ["vitamin d"] = true
  }
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
      daily[date_str] = { calories = 0, protein = 0, carbs = 0, fat = 0, fiber = 0,
        sodium = 0, potassium = 0, calcium = 0, iron = 0, vitA = 0, vitC = 0, vitD = 0, count = 0 }
      table.insert(dates_order, date_str)
    end
    local d = daily[date_str]
    local qty = tonumber(col_map["qty"] and cells[col_map["qty"]] or "1") or 1
    d.count = d.count + 1
    d.calories = d.calories + (tonumber(cells[col_map["calories"]] or "0") or 0) * qty
    if col_map["protein"] then d.protein = d.protein + (tonumber(cells[col_map["protein"]] or "0") or 0) * qty end
    if col_map["carbs"] then d.carbs = d.carbs + (tonumber(cells[col_map["carbs"]] or "0") or 0) * qty end
    if col_map["fat"] then d.fat = d.fat + (tonumber(cells[col_map["fat"]] or "0") or 0) * qty end
    if col_map["fiber"] then d.fiber = d.fiber + (tonumber(cells[col_map["fiber"]] or "0") or 0) * qty end
    if col_map["sodium"] then d.sodium = d.sodium + (tonumber(cells[col_map["sodium"]] or "0") or 0) * qty end
    if col_map["potassium"] then d.potassium = d.potassium + (tonumber(cells[col_map["potassium"]] or "0") or 0) * qty end
    if col_map["calcium"] then d.calcium = d.calcium + (tonumber(cells[col_map["calcium"]] or "0") or 0) * qty end
    if col_map["iron"] then d.iron = d.iron + (tonumber(cells[col_map["iron"]] or "0") or 0) * qty end
    if col_map["vitamin a"] then d.vitA = d.vitA + (tonumber(cells[col_map["vitamin a"]] or "0") or 0) * qty end
    if col_map["vitamin c"] then d.vitC = d.vitC + (tonumber(cells[col_map["vitamin c"]] or "0") or 0) * qty end
    if col_map["vitamin d"] then d.vitD = d.vitD + (tonumber(cells[col_map["vitamin d"]] or "0") or 0) * qty end
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
    table.insert(svg, string.format('<line x1="0" y1="%.0f" x2="%.0f" y2="%.0f" stroke="#222" stroke-width="1"/>', y, chart_w, y))
    table.insert(svg, string.format('<text x="2" y="%.0f" font-size="9" fill="#555" font-family="sans-serif">%.0f</text>', y - 2, val))
  end

  -- Goal line
  local goal_y = 10 + chart_h * (1 - goals.calories / max_cal)
  table.insert(svg, string.format('<line x1="0" y1="%.1f" x2="%.0f" y2="%.1f" stroke="#6366f1" stroke-width="1" stroke-dasharray="4,4" opacity="0.6"/>', goal_y, chart_w, goal_y))
  table.insert(svg, string.format('<text x="%.0f" y="%.1f" font-size="9" fill="#6366f1" font-family="sans-serif" text-anchor="end" opacity="0.8">Goal</text>', chart_w - 2, goal_y - 3))

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

      table.insert(svg, string.format('<rect x="%.0f" y="%.0f" width="%.0f" height="%.0f" rx="2" fill="#ef4444" opacity="0.8"><title>Fat: %sg</title></rect>', x, y, bar_w, fat_h, d.fat))
      table.insert(svg, string.format('<rect x="%.0f" y="%.0f" width="%.0f" height="%.0f" fill="#eab308" opacity="0.8"><title>Carbs: %sg</title></rect>', x, y + fat_h, bar_w, carb_h, d.carbs))
      table.insert(svg, string.format('<rect x="%.0f" y="%.0f" width="%.0f" height="%.0f" rx="2" fill="#22c55e" opacity="0.8"><title>Protein: %sg</title></rect>', x, y + fat_h + carb_h, bar_w, prot_h, d.protein))
    else
      table.insert(svg, string.format('<rect x="%.0f" y="%.0f" width="%.0f" height="%.0f" rx="2" fill="#3b82f6" opacity="0.8"/>', x, y, bar_w, h))
    end

    table.insert(svg, string.format('<text x="%.0f" y="%.0f" font-size="10" fill="#ccc" font-family="sans-serif" text-anchor="middle">%.0f</text>', x + bar_w / 2, y - 4, d.calories))
    local short_date = string.sub(dt, 6)
    table.insert(svg, string.format('<text x="%.0f" y="%.0f" font-size="10" fill="#888" font-family="sans-serif" text-anchor="middle">%s</text>', x + bar_w / 2, chart_h + 24, short_date))
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

  -- Micronutrient section for today
  local micro_html = ""
  if today_data then
    local t = today_data
    -- Daily Values (FDA reference amounts)
    local dvs = {
      { label = "Sodium", val = t.sodium, dv = 2300, unit = "mg", color = "#f97316" },
      { label = "Potassium", val = t.potassium, dv = 4700, unit = "mg", color = "#14b8a6" },
      { label = "Calcium", val = t.calcium, dv = 1300, unit = "mg", color = "#e0e0e0" },
      { label = "Iron", val = t.iron, dv = 18, unit = "mg", color = "#a3a3a3" },
      { label = "Vitamin A", val = t.vitA, dv = 900, unit = "mcg", color = "#fb923c" },
      { label = "Vitamin C", val = t.vitC, dv = 90, unit = "mg", color = "#fbbf24" },
      { label = "Vitamin D", val = t.vitD, dv = 20, unit = "mcg", color = "#38bdf8" },
    }

    local has_micros = false
    for _, m in ipairs(dvs) do
      if m.val > 0 then has_micros = true; break end
    end

    if has_micros then
      local micro_rows = {}
      for _, m in ipairs(dvs) do
        local pct = m.dv > 0 and math.min(150, math.floor(m.val / m.dv * 100 + 0.5)) or 0
        local bar_pct = math.min(100, pct)
        local over = pct > 100
        local val_str
        if m.val == math.floor(m.val) then
          val_str = tostring(math.floor(m.val))
        else
          val_str = tostring(math.floor(m.val * 10 + 0.5) / 10)
        end
        table.insert(micro_rows, string.format([[
<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
  <div style="width:72px;font-size:11px;color:#aaa;text-align:right;">%s</div>
  <div style="flex:1;height:8px;background:rgba(255,255,255,0.06);border-radius:4px;overflow:hidden;">
    <div style="height:100%%;width:%d%%;background:%s;border-radius:4px;opacity:%s;"></div>
  </div>
  <div style="width:80px;font-size:10px;color:%s;text-align:right;">%s%s <span style="color:#555;">(%d%%DV)</span></div>
</div>]], m.label, bar_pct, m.color, over and "1" or "0.7",
        over and "#ef4444" or "#ccc", val_str, m.unit, pct))
      end

      micro_html = string.format([[
<div style="margin-top:12px;padding:12px;background:#1a1a2e;border-radius:6px;">
  <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#666;margin-bottom:10px;">Micronutrients (Today)</div>
  %s
</div>]], table.concat(micro_rows))
    end
  end

  local html = '<div style="padding:16px;overflow-x:auto;">'
    .. '<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#666;margin-bottom:12px;">Nutrition Summary (Last 7 Days)</div>'
    .. table.concat(svg)
    .. legend
    .. summary
    .. micro_html
    .. avg_html
    .. '</div>'

  local extra_height = micro_html ~= "" and 200 or 0
  return nous.json_encode({
    html = html,
    styles = "",
    height = chart_h + 260 + extra_height
  })
end

--- ═══════════════════════════════════════════════════════════════
--- Food Entry Database View — search USDA + log directly from the database
--- ═══════════════════════════════════════════════════════════════

function render_food_entry_view(input)
  local html = [[
<style>
  @keyframes spin { to { transform: rotate(360deg); } }
  .fe-spinner { display:inline-block;width:14px;height:14px;border:2px solid #555;border-top-color:#3b82f6;border-radius:50%;animation:spin 0.6s linear infinite;vertical-align:middle;margin-right:6px; }
  .fe-search-btn { padding:8px 16px;border-radius:6px;border:none;background:#3b82f6;color:white;font-size:14px;cursor:pointer;white-space:nowrap;min-width:80px; }
  .fe-search-btn:disabled { opacity:0.7;cursor:default; }
  .fe-qty { width:48px;padding:3px 4px;border-radius:4px;border:1px solid #444;background:#1a1a1a;color:#e0e0e0;font-size:11px;text-align:center; }
</style>
<div style="font-family:system-ui,-apple-system,sans-serif;color:#e0e0e0;padding:16px;max-width:600px;">
  <div style="margin-bottom:16px;">
    <div style="display:flex;gap:8px;">
      <input id="food-search" type="text" placeholder="Search for a food (e.g. chicken breast, banana, Atkins shake)..."
        style="flex:1;padding:8px 12px;border-radius:6px;border:1px solid #444;background:#1a1a1a;color:#e0e0e0;font-size:14px;outline:none;"
        onkeydown="if(event.key==='Enter')doSearch()"/>
      <button id="search-btn" class="fe-search-btn" onclick="doSearch()">Search</button>
    </div>
  </div>
  <div id="search-status" style="display:none;padding:8px;color:#999;font-size:13px;"></div>
  <div id="search-results" style="display:none;"></div>
  <div id="ai-section" style="display:none;margin-top:8px;padding:10px;border:1px dashed #555;border-radius:6px;background:rgba(139,92,246,0.04);">
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <div style="font-size:12px;color:#999;">Not finding what you need? Get an <strong style="color:#8b5cf6;">AI estimate</strong> based on your search.</div>
      <button id="ai-estimate-btn" style="padding:5px 12px;border-radius:6px;border:1px solid #8b5cf6;background:transparent;color:#8b5cf6;font-size:12px;cursor:pointer;white-space:nowrap;margin-left:8px;">
        Estimate
      </button>
    </div>
    <span id="ai-status" style="font-size:12px;color:#888;display:block;margin-top:4px;"></span>
    <div id="ai-results" style="margin-top:6px;"></div>
  </div>

  <div style="margin-top:16px;border-top:1px solid #333;padding-top:12px;">
    <div style="font-size:12px;color:#666;margin-bottom:8px;">Recently logged</div>
    <div id="recent-entries">]] .. render_recent_entries(input) .. [[</div>
  </div>
</div>

<script>
var _searching = false;

function doSearch() {
  var q = document.getElementById('food-search').value.trim();
  if (!q || _searching) return;
  _searching = true;
  var btn = document.getElementById('search-btn');
  var status = document.getElementById('search-status');
  var results = document.getElementById('search-results');
  var aiSection = document.getElementById('ai-section');
  btn.disabled = true;
  btn.innerHTML = '<span class="fe-spinner"></span>';
  status.style.display = 'block';
  status.innerHTML = '<span class="fe-spinner"></span> Searching USDA & OpenFoodFacts...';
  results.style.display = 'none';
  results.innerHTML = '';
  aiSection.style.display = 'none';
  document.getElementById('ai-results').innerHTML = '';
  parent.postMessage({ type: 'plugin-view-action', payload: { action: 'search_food', query: q } }, '*');
}

function doAiEstimate() {
  var q = document.getElementById('food-search').value.trim();
  if (!q) return;
  var aiStatus = document.getElementById('ai-status');
  var aiBtn = document.getElementById('ai-estimate-btn');
  aiStatus.innerHTML = '<span class="fe-spinner"></span> Asking AI...';
  aiBtn.disabled = true;
  parent.postMessage({ type: 'plugin-view-action', payload: { action: 'ai_estimate', query: q } }, '*');
}

document.getElementById('ai-estimate-btn').addEventListener('click', doAiEstimate);

function renderFoodRow(f, idx, isAi) {
  var brand = f.brand ? ' <span style="color:#666;font-size:11px;">(' + esc(f.brand) + ')</span>' : '';
  var srcTag = f.source ? ' <span style="color:#555;font-size:9px;">(' + f.source + ')</span>' : '';
  if (isAi) srcTag = ' <span style="color:#8b5cf6;font-size:9px;">(AI estimate)</span>';
  var logFn = isAi ? 'logAiFood' : 'logFood';
  var idxArg = isAi ? '' : idx + ',';

  var html = '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-radius:6px;margin-bottom:4px;background:#1a1a1a;border:1px solid #333;">'
    + '<div style="flex:1;min-width:0;">'
    + '<div style="font-size:13px;color:#e0e0e0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(f.name) + brand + '</div>'
    + '<div style="font-size:11px;color:#888;margin-top:2px;">' + f.calories + ' cal · P:' + f.protein + 'g · C:' + f.carbs + 'g · F:' + f.fat + 'g · ' + esc(f.serving) + srcTag + '</div>'
    + '</div>'
    + '<div style="display:flex;align-items:center;gap:6px;margin-left:8px;flex-shrink:0;">'
    + '<input type="number" class="fe-qty" value="1" min="0.25" max="99" step="0.25" data-idx="' + (isAi ? 'ai' : idx) + '" title="Quantity (e.g. 0.5 for half)" />';
  var meals = ['Breakfast','Lunch','Dinner','Snack'];
  var colors = ['#f59e0b','#10b981','#3b82f6','#8b5cf6'];
  for (var m = 0; m < meals.length; m++) {
    html += '<button onclick="' + logFn + '(' + idxArg + '\'' + meals[m] + '\')" title="Log as ' + meals[m] + '"'
      + ' style="padding:3px 8px;border-radius:4px;border:1px solid ' + colors[m] + ';background:transparent;color:' + colors[m] + ';font-size:10px;cursor:pointer;line-height:1.2;">'
      + meals[m].charAt(0) + '</button>';
  }
  html += '</div></div>';
  return html;
}

function getQty(idx) {
  var el = document.querySelector('.fe-qty[data-idx="' + idx + '"]');
  return el ? (parseFloat(el.value) || 1) : 1;
}

window.addEventListener('message', function(e) {
  var msg = e.data;
  if (!msg) return;
  if (msg.type === 'search-results') {
    _searching = false;
    var btn = document.getElementById('search-btn');
    var status = document.getElementById('search-status');
    var container = document.getElementById('search-results');
    var aiSection = document.getElementById('ai-section');
    btn.disabled = false;
    btn.textContent = 'Search';

    // Always show AI section after a search
    aiSection.style.display = 'block';

    if (!msg.foods || msg.foods.length === 0) {
      status.textContent = msg.error || 'No results found in USDA or OpenFoodFacts.';
      container.style.display = 'none';
      return;
    }
    status.style.display = 'none';
    container.style.display = 'block';
    var html = '';
    for (var i = 0; i < msg.foods.length; i++) {
      html += renderFoodRow(msg.foods[i], i, false);
    }
    container.innerHTML = html;
    window._searchResults = msg.foods;
  } else if (msg.type === 'food-logged') {
    var status = document.getElementById('search-status');
    status.style.display = 'block';
    status.innerHTML = '<span style="color:#22c55e;">&#10003; ' + esc(msg.message || 'Logged!') + '</span>';
    setTimeout(function() { status.style.display = 'none'; }, 3000);
    if (msg.recentHtml) {
      document.getElementById('recent-entries').innerHTML = msg.recentHtml;
    }
  } else if (msg.type === 'ai-estimate-result') {
    var aiStatus = document.getElementById('ai-status');
    var aiBtn = document.getElementById('ai-estimate-btn');
    var aiResults = document.getElementById('ai-results');
    aiBtn.disabled = false;
    if (msg.error) {
      aiStatus.innerHTML = '<span style="color:#ef4444;">' + esc(msg.error) + '</span>';
      return;
    }
    if (msg.food) {
      aiStatus.textContent = '';
      aiResults.innerHTML = renderFoodRow(msg.food, 0, true);
      window._aiFood = msg.food;
    }
  }
});

function logFood(idx, meal) {
  if (!window._searchResults || !window._searchResults[idx]) return;
  var f = window._searchResults[idx];
  var qty = getQty(idx);
  parent.postMessage({ type: 'plugin-view-action', payload: {
    action: 'log_food_entry', food: f, meal: meal, qty: qty
  }}, '*');
}

function logAiFood(meal) {
  if (!window._aiFood) return;
  var qty = getQty('ai');
  parent.postMessage({ type: 'plugin-view-action', payload: {
    action: 'log_food_entry', food: window._aiFood, meal: meal, qty: qty
  }}, '*');
}

function esc(s) { if (!s) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
</script>
]]

  return nous.json_encode({
    html = html,
    styles = "",
    height = 500
  })
end

function render_recent_entries(input)
  local content = input.content
  local properties = content.properties or {}
  local rows = content.rows or {}

  local col_map = {}
  for _, prop in ipairs(properties) do
    local lower = string.lower(prop.name)
    if lower == "food name" or lower == "calories" or lower == "meal" or lower == "date" or lower == "protein" or lower == "carbs" or lower == "fat" or lower == "qty" then
      col_map[lower] = prop.id
    end
  end

  if #rows == 0 or not col_map["food name"] then
    return '<div style="color:#555;font-size:12px;">No entries yet</div>'
  end

  -- Show last 5 rows (most recent first)
  local html = {}
  local start = math.max(1, #rows - 4)
  for i = #rows, start, -1 do
    local r = rows[i]
    local c = r.cells or {}
    local name = c[col_map["food name"]] or "?"
    local cal_raw = tonumber(c[col_map["calories"]] or "0") or 0
    local qty = tonumber(col_map["qty"] and c[col_map["qty"]] or "1") or 1
    local cal = math.floor(cal_raw * qty + 0.5)
    local meal = c[col_map["meal"]] or ""
    local date = c[col_map["date"]] or ""
    -- Resolve meal option ID to label
    if meal ~= "" then
      for _, prop in ipairs(properties) do
        if prop.id == col_map["meal"] and prop.options then
          for _, opt in ipairs(prop.options) do
            if opt.id == meal then meal = opt.label; break end
          end
          break
        end
      end
    end
    local qty_label = ""
    if qty ~= 1 then qty_label = " ×" .. qty end
    table.insert(html, string.format(
      '<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:12px;border-bottom:1px solid #222;">'
      .. '<span style="color:#ccc;">%s%s</span>'
      .. '<span style="color:#888;">%s · %s cal · %s</span></div>',
      esc(tostring(name)), qty_label, esc(tostring(meal)), tostring(cal), esc(tostring(date))
    ))
  end
  return table.concat(html)
end

function handle_action(input_json)
  local input = nous.json_decode(input_json)
  local action = input.action or ""

  if action == "search_food" then
    local query = input.query or ""
    if query == "" then
      return nous.json_encode({
        forward_to_iframe = true,
        message = { type = "search-results", foods = {}, error = "Enter a search term" }
      })
    end

    local results, search_err = search_foods(query)
    if search_err then
      return nous.json_encode({
        forward_to_iframe = true,
        message = { type = "search-results", foods = {}, error = search_err }
      })
    end

    return nous.json_encode({
      forward_to_iframe = true,
      message = { type = "search-results", foods = results }
    })

  elseif action == "ai_estimate" then
    local query = input.query or ""
    if query == "" then
      return nous.json_encode({
        forward_to_iframe = true,
        message = { type = "ai-estimate-result", error = "Enter a food description" }
      })
    end

    local food, err = ai_estimate_nutrition(query)
    if err then
      return nous.json_encode({
        forward_to_iframe = true,
        message = { type = "ai-estimate-result", error = err }
      })
    end

    return nous.json_encode({
      forward_to_iframe = true,
      message = { type = "ai-estimate-result", food = food }
    })

  elseif action == "log_food_entry" then
    local food = input.food
    local meal = input.meal or "Snack"
    local qty = tonumber(input.qty) or 1
    local notebook_id = input.notebookId or ""

    if not food or notebook_id == "" then
      return nous.json_encode({
        forward_to_iframe = true,
        message = { type = "food-logged", message = "Missing food or notebook" }
      })
    end

    local db_id = find_or_create_food_db(notebook_id)
    if not db_id then
      return nous.json_encode({
        forward_to_iframe = true,
        message = { type = "food-logged", message = "Could not find Food Log database" }
      })
    end

    pcall(function()
      nous.database_add_rows(notebook_id, db_id, nous.json_encode({ build_food_row(food, meal, qty) }))
    end)

    local qty_str = qty ~= 1 and (tostring(qty) .. "x ") or ""
    local total_cal = math.floor((tonumber(food.calories) or 0) * qty)
    local msg = string.format("%s%s logged as %s (%s cal)", qty_str, food.name, meal, tostring(total_cal))
    return nous.json_encode({
      forward_to_iframe = true,
      refresh_database = true,
      message = { type = "food-logged", message = msg }
    })
  end

  return nous.json_encode({ handled = true })
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

    local results, search_err = search_foods(query)
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

    nous.database_add_rows(notebook_id, db_id, nous.json_encode({ build_food_row(food, "Snack") }))

    return nous.json_encode({
      handled = true,
      message = string.format("Logged: %s (%d cal, P:%sg C:%sg F:%sg)", food.name, food.calories, food.protein, food.carbs, food.fat)
    })
  end

  return nous.json_encode({ handled = false })
end
