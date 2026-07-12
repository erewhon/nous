--[[ [manifest]
id = "nous.builtin.food-tracker"
name = "Food & Nutrition Tracker"
version = "0.4.0"
description = "Search foods via USDA + OpenFoodFacts APIs and quick-log meals to a Food Log database from the command palette. (The block/panel/view UIs were retired with the Lua UI scaffolding; a first-class nutrition feature is the intended successor.)"
capabilities = ["network", "database_read", "database_write", "command_palette"]
hooks = ["command_palette"]
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

-- Find existing Food Log database (no auto-create)
local function find_food_db(notebook_id)
  if not notebook_id or notebook_id == "" then return nil end

  local ok, list_json = pcall(function() return nous.database_list(notebook_id) end)
  if ok and list_json then
    local databases = nous.json_decode(list_json)
    if type(databases) == "table" then
      -- Validate cache — the database may have been deleted
      if _food_db_id then
        local found = false
        for _, db in ipairs(databases) do
          if db.id == _food_db_id then found = true; break end
        end
        if not found then _food_db_id = nil end
      end
      if _food_db_id then return _food_db_id end
      for _, db in ipairs(databases) do
        if db.title == "Food Log" then
          _food_db_id = db.id
          ensure_food_db_columns(notebook_id, db.id)
          return _food_db_id
        end
      end
    end
  end
  return nil
end

-- Explicitly create the Food Log database
local function create_food_db(notebook_id)
  if not notebook_id or notebook_id == "" then return nil end

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
    local db_id = find_food_db(notebook_id) or create_food_db(notebook_id)
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
