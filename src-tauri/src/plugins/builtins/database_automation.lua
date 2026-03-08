--[[ [manifest]
id = "database_automation"
name = "Database Automations"
version = "1.0.0"
description = "Reacts to database row changes: auto-set timestamps, cascade status updates, and log activity."
capabilities = ["database_read", "database_write", "command_palette"]
hooks = ["on_database_row_added", "on_database_row_updated", "command_palette"]
]]

--[[
  Database Automations Plugin

  Listens for row add/update events and applies rules:
  1. Auto-set "Created" date property on new rows (if column exists)
  2. When a task Status changes to "Done", set "Completed Date" (if column exists)
  3. When a task Status changes to "Blocked", log a warning
  4. Auto-increment a "Row #" number property for new rows

  Users can extend this plugin or use it as a reference for writing their own
  database automation plugins.
]]

-- Command palette entry for managing automations
function get_commands()
  return nous.json_encode({
    {
      id = "list_automations",
      title = "Database Automations: View Rules",
      subtitle = "See which automatic rules are active for database changes",
      keywords = { "automation", "database", "rules", "triggers" },
    },
  })
end

function handle_command(input_json)
  local input = nous.json_decode(input_json)

  if input.command_id == "list_automations" then
    return nous.json_encode({
      success = true,
      message = table.concat({
        "Active Database Automation Rules:",
        "",
        "1. Auto-set 'Created' date on new rows (if column exists)",
        "2. Auto-set 'Completed Date' when Status = 'Done' (if columns exist)",
        "3. Auto-number 'Row #' for new rows (if column exists)",
        "4. Log warnings when Status changes to 'Blocked'",
        "",
        "These rules apply to all databases automatically.",
        "To customize, edit the database_automation plugin.",
      }, "\n"),
    })
  end

  return nous.json_encode({ success = false, error = "Unknown command" })
end

-- ─── Event: rows added ──────────────────────────────────────────────────────

function on_database_row_added(input_json)
  local input = nous.json_decode(input_json)
  local notebook_id = input.notebook_id
  local database_id = input.database_id
  local row_ids = input.row_ids or {}

  if #row_ids == 0 then return end

  -- Load the database to inspect its schema
  local db_json = nous.database_get(notebook_id, database_id)
  local db = nous.json_decode(db_json)
  local properties = db.properties or {}

  -- Find automation-relevant properties by name
  local created_prop = find_property(properties, { "Created", "Created Date", "Date Created" })
  local row_num_prop = find_property(properties, { "Row #", "Row Number", "#" })

  if not created_prop and not row_num_prop then
    return -- No automation-relevant properties found
  end

  local updates = {}
  local total_rows = #(db.rows or {})

  for i, row_id in ipairs(row_ids) do
    local cells = {}
    local has_update = false

    -- Auto-set created date
    if created_prop then
      cells[created_prop.name] = nous.current_date().iso
      has_update = true
    end

    -- Auto-number (based on position: total_rows - #row_ids + i)
    if row_num_prop then
      cells[row_num_prop.name] = total_rows - #row_ids + i
      has_update = true
    end

    if has_update then
      table.insert(updates, { row = row_id, cells = cells })
    end
  end

  if #updates > 0 then
    nous.database_update_rows(notebook_id, database_id, nous.json_encode(updates))
    nous.log_info(string.format(
      "Database automation: auto-filled %d new row(s) in '%s'",
      #updates, input.database_title or database_id
    ))
  end
end

-- ─── Event: rows updated ────────────────────────────────────────────────────

function on_database_row_updated(input_json)
  local input = nous.json_decode(input_json)
  local notebook_id = input.notebook_id
  local database_id = input.database_id
  local row_ids = input.row_ids or {}

  if #row_ids == 0 then return end

  -- Load the database
  local db_json = nous.database_get(notebook_id, database_id)
  local db = nous.json_decode(db_json)
  local properties = db.properties or {}
  local rows = db.rows or {}

  -- Find relevant properties
  local status_prop = find_property(properties, { "Status" })
  local completed_prop = find_property(properties, { "Completed Date", "Completed", "Done Date" })

  if not status_prop or not completed_prop then
    return -- No status/completed combo to automate
  end

  -- Build row lookup
  local row_map = {}
  for _, row in ipairs(rows) do
    if row.id then
      row_map[row.id] = row
    end
  end

  local updates = {}
  for _, row_id in ipairs(row_ids) do
    local row = row_map[row_id]
    if row and row.cells then
      local status_val = get_cell_value(row.cells, status_prop.id)

      if status_val == "Done" or status_val == "Completed" then
        -- Check if completed date is not already set
        local completed_val = get_cell_value(row.cells, completed_prop.id)
        if not completed_val or completed_val == "" then
          table.insert(updates, {
            row = row_id,
            cells = { [completed_prop.name] = nous.current_date().iso },
          })
        end
      end

      if status_val == "Blocked" then
        local title = get_cell_value(row.cells, find_property_id(properties, { "Title", "Name", "Task" }))
        nous.log_warn(string.format(
          "Task '%s' is now BLOCKED in '%s'",
          title or row_id, input.database_title or database_id
        ))
      end
    end
  end

  if #updates > 0 then
    nous.database_update_rows(notebook_id, database_id, nous.json_encode(updates))
    nous.log_info(string.format(
      "Database automation: auto-updated %d row(s) in '%s'",
      #updates, input.database_title or database_id
    ))
  end
end

-- ─── Helpers ────────────────────────────────────────────────────────────────

-- Find a property by matching against a list of possible names (case-insensitive)
function find_property(properties, names)
  for _, prop in ipairs(properties) do
    for _, name in ipairs(names) do
      if prop.name and prop.name:lower() == name:lower() then
        return prop
      end
    end
  end
  return nil
end

-- Find just the property id
function find_property_id(properties, names)
  local prop = find_property(properties, names)
  return prop and prop.id or nil
end

-- Get cell value by property id from a cells map
function get_cell_value(cells, prop_id)
  if not prop_id or not cells then return nil end
  local val = cells[prop_id]
  if type(val) == "table" then
    -- Select values might be stored as objects
    return val.value or val[1] or nil
  end
  return val
end
