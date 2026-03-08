--[[ [manifest]
id = "database_templates"
name = "Database Templates"
version = "1.0.0"
description = "Pre-built database schemas: CRM, Project Tracker, Reading List, Habit Tracker, and Inventory."
capabilities = ["database_read", "database_write", "command_palette"]
hooks = ["command_palette"]
]]

-- Command palette entries for each template
function describe_commands()
  return nous.json_encode({
    {
      id = "template_crm",
      title = "Create CRM Workspace",
      subtitle = "Contacts, Companies, Deals, and Activities databases with relations",
      keywords = { "crm", "contacts", "sales", "deals", "pipeline", "companies", "template" },
    },
    {
      id = "template_project_tracker",
      title = "Create Project Tracker",
      subtitle = "Projects, Milestones, and Tasks databases for personal or small team use",
      keywords = { "project", "tracker", "tasks", "milestones", "todo", "template" },
    },
    {
      id = "template_reading_list",
      title = "Create Reading List",
      subtitle = "Track books with status, rating, genre, and reading dates",
      keywords = { "reading", "books", "library", "bookshelf", "template" },
    },
    {
      id = "template_habit_tracker",
      title = "Create Habit Tracker",
      subtitle = "Habits and daily log databases with streak tracking",
      keywords = { "habit", "tracker", "routine", "streak", "daily", "template" },
    },
    {
      id = "template_inventory",
      title = "Create Inventory Tracker",
      subtitle = "Items, Categories, and Locations databases for stock management",
      keywords = { "inventory", "stock", "items", "warehouse", "template" },
    },
    {
      id = "template_food_log",
      title = "Create Food & Nutrition Log",
      subtitle = "Track meals, calories, macros, and daily nutrition with goals",
      keywords = { "food", "nutrition", "calories", "diet", "meals", "macros", "template" },
    },
    {
      id = "template_time_tracking",
      title = "Create Time Tracking Workspace",
      subtitle = "Time entries, projects, and clients for tracking billable hours",
      keywords = { "time", "tracking", "hours", "billable", "timesheet", "clients", "template" },
    },
  })
end

function handle_command(input_json)
  local input = nous.json_decode(input_json)
  local cmd_id = input.command_id
  local notebook_id = input.notebook_id

  if not notebook_id then
    return nous.json_encode({ success = false, error = "No notebook selected" })
  end

  if cmd_id == "template_crm" then
    return create_crm(notebook_id)
  elseif cmd_id == "template_project_tracker" then
    return create_project_tracker(notebook_id)
  elseif cmd_id == "template_reading_list" then
    return create_reading_list(notebook_id)
  elseif cmd_id == "template_habit_tracker" then
    return create_habit_tracker(notebook_id)
  elseif cmd_id == "template_inventory" then
    return create_inventory(notebook_id)
  elseif cmd_id == "template_food_log" then
    return create_food_log(notebook_id)
  elseif cmd_id == "template_time_tracking" then
    return create_time_tracking(notebook_id)
  end

  return nous.json_encode({ success = false, error = "Unknown command" })
end

-- =============================================================================
-- CRM
-- =============================================================================

function create_crm(notebook_id)
  -- 1. Companies
  local companies = nous.json_decode(nous.database_create(
    notebook_id, "Companies",
    nous.json_encode({
      { name = "Name", type = "text" },
      { name = "Industry", type = "select", options = {
        { label = "Technology", color = "#3b82f6" },
        { label = "Finance", color = "#10b981" },
        { label = "Healthcare", color = "#ef4444" },
        { label = "Education", color = "#8b5cf6" },
        { label = "Retail", color = "#f59e0b" },
        { label = "Manufacturing", color = "#6b7280" },
        { label = "Other", color = "#64748b" },
      }},
      { name = "Size", type = "select", options = {
        { label = "1-10", color = "#6b7280" },
        { label = "11-50", color = "#3b82f6" },
        { label = "51-200", color = "#f59e0b" },
        { label = "201-1000", color = "#8b5cf6" },
        { label = "1000+", color = "#ef4444" },
      }},
      { name = "Website", type = "url" },
      { name = "Notes", type = "text" },
    })
  ))

  -- 2. Contacts
  local contacts = nous.json_decode(nous.database_create(
    notebook_id, "Contacts",
    nous.json_encode({
      { name = "Name", type = "text" },
      { name = "Email", type = "url" },
      { name = "Phone", type = "text" },
      { name = "Role", type = "text" },
      { name = "Status", type = "select", options = {
        { label = "Active", color = "#10b981" },
        { label = "Lead", color = "#3b82f6" },
        { label = "Prospect", color = "#f59e0b" },
        { label = "Inactive", color = "#6b7280" },
      }},
      { name = "Last Contact", type = "date" },
      { name = "Notes", type = "text" },
    })
  ))

  -- 3. Deals
  local deals = nous.json_decode(nous.database_create(
    notebook_id, "Deals",
    nous.json_encode({
      { name = "Name", type = "text" },
      { name = "Value", type = "number" },
      { name = "Stage", type = "select", options = {
        { label = "Prospecting", color = "#6b7280" },
        { label = "Qualification", color = "#3b82f6" },
        { label = "Proposal", color = "#f59e0b" },
        { label = "Negotiation", color = "#8b5cf6" },
        { label = "Closed Won", color = "#10b981" },
        { label = "Closed Lost", color = "#ef4444" },
      }},
      { name = "Close Date", type = "date" },
      { name = "Probability", type = "number" },
      { name = "Notes", type = "text" },
    })
  ))

  -- 4. Activities
  local activities = nous.json_decode(nous.database_create(
    notebook_id, "Activities",
    nous.json_encode({
      { name = "Title", type = "text" },
      { name = "Type", type = "select", options = {
        { label = "Call", color = "#3b82f6" },
        { label = "Email", color = "#10b981" },
        { label = "Meeting", color = "#8b5cf6" },
        { label = "Note", color = "#f59e0b" },
        { label = "Follow-up", color = "#ef4444" },
      }},
      { name = "Date", type = "date" },
      { name = "Notes", type = "text" },
    })
  ))

  -- Relations
  -- Contacts -> Company
  nous.database_update_properties(notebook_id, contacts.id, nous.json_encode({
    { name = "Company", type = "relation", relationConfig = {
      databasePageId = companies.id, displayProperty = "Name", direction = "forward",
    }},
  }))

  -- Deals -> Company
  nous.database_update_properties(notebook_id, deals.id, nous.json_encode({
    { name = "Company", type = "relation", relationConfig = {
      databasePageId = companies.id, displayProperty = "Name", direction = "forward",
    }},
  }))

  -- Deals -> Contact
  nous.database_update_properties(notebook_id, deals.id, nous.json_encode({
    { name = "Contact", type = "relation", relationConfig = {
      databasePageId = contacts.id, displayProperty = "Name", direction = "forward",
    }},
  }))

  -- Activities -> Contact
  nous.database_update_properties(notebook_id, activities.id, nous.json_encode({
    { name = "Contact", type = "relation", relationConfig = {
      databasePageId = contacts.id, displayProperty = "Name", direction = "forward",
    }},
  }))

  -- Activities -> Deal
  nous.database_update_properties(notebook_id, activities.id, nous.json_encode({
    { name = "Deal", type = "relation", relationConfig = {
      databasePageId = deals.id, displayProperty = "Name", direction = "forward",
    }},
  }))

  -- Sample data
  nous.database_add_rows(notebook_id, companies.id, nous.json_encode({
    { Name = "Acme Corp", Industry = "Technology", Size = "51-200", Website = "https://acme.example.com" },
    { Name = "Globex Inc", Industry = "Manufacturing", Size = "201-1000" },
    { Name = "Initech", Industry = "Technology", Size = "11-50" },
  }))

  local today = nous.current_date().iso
  nous.database_add_rows(notebook_id, contacts.id, nous.json_encode({
    { Name = "Jane Smith", Email = "jane@acme.example.com", Role = "VP Engineering", Status = "Active", ["Last Contact"] = today },
    { Name = "Bob Johnson", Email = "bob@globex.example.com", Role = "Procurement", Status = "Lead" },
    { Name = "Alice Chen", Email = "alice@initech.example.com", Role = "CTO", Status = "Prospect" },
  }))

  nous.database_add_rows(notebook_id, deals.id, nous.json_encode({
    { Name = "Acme Enterprise License", Value = 50000, Stage = "Proposal", ["Close Date"] = nous.date_offset(today, 30), Probability = 60 },
    { Name = "Globex Consulting", Value = 15000, Stage = "Qualification", Probability = 30 },
  }))

  nous.database_add_rows(notebook_id, activities.id, nous.json_encode({
    { Title = "Intro call with Jane", Type = "Call", Date = today, Notes = "Discussed requirements" },
    { Title = "Send proposal to Acme", Type = "Follow-up", Date = nous.date_offset(today, 2) },
  }))

  nous.log_info("CRM workspace created")
  return nous.json_encode({
    success = true,
    message = "CRM workspace created with 4 databases: Companies, Contacts, Deals, and Activities.",
  })
end

-- =============================================================================
-- Project Tracker
-- =============================================================================

function create_project_tracker(notebook_id)
  -- 1. Projects
  local projects = nous.json_decode(nous.database_create(
    notebook_id, "Projects",
    nous.json_encode({
      { name = "Name", type = "text" },
      { name = "Status", type = "select", options = {
        { label = "Not Started", color = "#6b7280" },
        { label = "In Progress", color = "#3b82f6" },
        { label = "On Hold", color = "#f59e0b" },
        { label = "Completed", color = "#10b981" },
        { label = "Cancelled", color = "#ef4444" },
      }},
      { name = "Priority", type = "select", options = {
        { label = "High", color = "#ef4444" },
        { label = "Medium", color = "#f59e0b" },
        { label = "Low", color = "#6b7280" },
      }},
      { name = "Start Date", type = "date" },
      { name = "Due Date", type = "date" },
      { name = "Progress", type = "number" },
      { name = "Description", type = "text" },
    })
  ))

  -- 2. Milestones
  local milestones = nous.json_decode(nous.database_create(
    notebook_id, "Milestones",
    nous.json_encode({
      { name = "Name", type = "text" },
      { name = "Due Date", type = "date" },
      { name = "Status", type = "select", options = {
        { label = "Upcoming", color = "#6b7280" },
        { label = "In Progress", color = "#3b82f6" },
        { label = "Completed", color = "#10b981" },
        { label = "Missed", color = "#ef4444" },
      }},
      { name = "Description", type = "text" },
    })
  ))

  -- 3. Tasks
  local tasks = nous.json_decode(nous.database_create(
    notebook_id, "Tasks",
    nous.json_encode({
      { name = "Title", type = "text" },
      { name = "Status", type = "select", options = {
        { label = "To Do", color = "#6b7280" },
        { label = "In Progress", color = "#3b82f6" },
        { label = "Done", color = "#10b981" },
        { label = "Blocked", color = "#ef4444" },
      }},
      { name = "Priority", type = "select", options = {
        { label = "High", color = "#ef4444" },
        { label = "Medium", color = "#f59e0b" },
        { label = "Low", color = "#6b7280" },
      }},
      { name = "Due Date", type = "date" },
      { name = "Assignee", type = "text" },
      { name = "Notes", type = "text" },
    })
  ))

  -- Relations
  -- Milestones -> Project
  nous.database_update_properties(notebook_id, milestones.id, nous.json_encode({
    { name = "Project", type = "relation", relationConfig = {
      databasePageId = projects.id, displayProperty = "Name", direction = "forward",
    }},
  }))

  -- Tasks -> Project
  nous.database_update_properties(notebook_id, tasks.id, nous.json_encode({
    { name = "Project", type = "relation", relationConfig = {
      databasePageId = projects.id, displayProperty = "Name", direction = "forward",
    }},
  }))

  -- Tasks -> Milestone
  nous.database_update_properties(notebook_id, tasks.id, nous.json_encode({
    { name = "Milestone", type = "relation", relationConfig = {
      databasePageId = milestones.id, displayProperty = "Name", direction = "forward",
    }},
  }))

  -- Sample data
  local today = nous.current_date().iso
  nous.database_add_rows(notebook_id, projects.id, nous.json_encode({
    { Name = "Website Redesign", Status = "In Progress", Priority = "High", ["Start Date"] = today, ["Due Date"] = nous.date_offset(today, 60), Progress = 35, Description = "Complete overhaul of the marketing website" },
    { Name = "Documentation Update", Status = "Not Started", Priority = "Medium", ["Due Date"] = nous.date_offset(today, 30), Progress = 0 },
  }))

  nous.database_add_rows(notebook_id, milestones.id, nous.json_encode({
    { Name = "Design Mockups Complete", ["Due Date"] = nous.date_offset(today, 14), Status = "In Progress" },
    { Name = "Beta Launch", ["Due Date"] = nous.date_offset(today, 45), Status = "Upcoming" },
    { Name = "Go Live", ["Due Date"] = nous.date_offset(today, 60), Status = "Upcoming" },
  }))

  nous.database_add_rows(notebook_id, tasks.id, nous.json_encode({
    { Title = "Create wireframes", Status = "Done", Priority = "High", ["Due Date"] = nous.date_offset(today, -3) },
    { Title = "Design homepage mockup", Status = "In Progress", Priority = "High", ["Due Date"] = nous.date_offset(today, 7) },
    { Title = "Build component library", Status = "To Do", Priority = "Medium", ["Due Date"] = nous.date_offset(today, 21) },
    { Title = "Write API documentation", Status = "To Do", Priority = "Medium", ["Due Date"] = nous.date_offset(today, 25) },
    { Title = "Set up staging environment", Status = "To Do", Priority = "High", ["Due Date"] = nous.date_offset(today, 14) },
  }))

  nous.log_info("Project Tracker created")
  return nous.json_encode({
    success = true,
    message = "Project Tracker created with 3 databases: Projects, Milestones, and Tasks.",
  })
end

-- =============================================================================
-- Reading List
-- =============================================================================

function create_reading_list(notebook_id)
  local books = nous.json_decode(nous.database_create(
    notebook_id, "Reading List",
    nous.json_encode({
      { name = "Title", type = "text" },
      { name = "Author", type = "text" },
      { name = "Status", type = "select", options = {
        { label = "Want to Read", color = "#6b7280" },
        { label = "Reading", color = "#3b82f6" },
        { label = "Finished", color = "#10b981" },
        { label = "Abandoned", color = "#ef4444" },
        { label = "Re-reading", color = "#8b5cf6" },
      }},
      { name = "Rating", type = "select", options = {
        { label = "5 - Amazing", color = "#10b981" },
        { label = "4 - Great", color = "#3b82f6" },
        { label = "3 - Good", color = "#f59e0b" },
        { label = "2 - Okay", color = "#f97316" },
        { label = "1 - Poor", color = "#ef4444" },
      }},
      { name = "Genre", type = "select", options = {
        { label = "Fiction", color = "#8b5cf6" },
        { label = "Non-Fiction", color = "#3b82f6" },
        { label = "Science Fiction", color = "#06b6d4" },
        { label = "Fantasy", color = "#d946ef" },
        { label = "Mystery", color = "#f59e0b" },
        { label = "Biography", color = "#10b981" },
        { label = "Self-Help", color = "#f97316" },
        { label = "Technical", color = "#6b7280" },
        { label = "History", color = "#78716c" },
        { label = "Philosophy", color = "#a855f7" },
      }},
      { name = "Format", type = "select", options = {
        { label = "Physical", color = "#f59e0b" },
        { label = "Kindle", color = "#3b82f6" },
        { label = "Audiobook", color = "#8b5cf6" },
        { label = "PDF", color = "#ef4444" },
      }},
      { name = "Pages", type = "number" },
      { name = "Started", type = "date" },
      { name = "Finished", type = "date" },
      { name = "Notes", type = "text" },
      { name = "Link", type = "url" },
    })
  ))

  -- Sample data
  local today = nous.current_date().iso
  nous.database_add_rows(notebook_id, books.id, nous.json_encode({
    { Title = "Thinking, Fast and Slow", Author = "Daniel Kahneman", Status = "Finished", Rating = "5 - Amazing", Genre = "Non-Fiction", Format = "Kindle", Pages = 499, Finished = nous.date_offset(today, -14), Notes = "Brilliant exploration of cognitive biases" },
    { Title = "Dune", Author = "Frank Herbert", Status = "Reading", Genre = "Science Fiction", Format = "Physical", Pages = 688, Started = nous.date_offset(today, -7) },
    { Title = "The Pragmatic Programmer", Author = "David Thomas & Andrew Hunt", Status = "Want to Read", Genre = "Technical", Format = "PDF", Pages = 352 },
    { Title = "Project Hail Mary", Author = "Andy Weir", Status = "Want to Read", Genre = "Science Fiction", Format = "Audiobook", Pages = 476 },
    { Title = "Meditations", Author = "Marcus Aurelius", Status = "Finished", Rating = "4 - Great", Genre = "Philosophy", Format = "Physical", Pages = 256, Finished = nous.date_offset(today, -60) },
  }))

  nous.log_info("Reading List created")
  return nous.json_encode({
    success = true,
    message = "Reading List created with sample books. Track your reading with status, ratings, and notes.",
  })
end

-- =============================================================================
-- Habit Tracker
-- =============================================================================

function create_habit_tracker(notebook_id)
  -- 1. Habits
  local habits = nous.json_decode(nous.database_create(
    notebook_id, "Habits",
    nous.json_encode({
      { name = "Name", type = "text" },
      { name = "Category", type = "select", options = {
        { label = "Health", color = "#10b981" },
        { label = "Fitness", color = "#3b82f6" },
        { label = "Learning", color = "#8b5cf6" },
        { label = "Mindfulness", color = "#06b6d4" },
        { label = "Productivity", color = "#f59e0b" },
        { label = "Social", color = "#f97316" },
        { label = "Creative", color = "#d946ef" },
      }},
      { name = "Frequency", type = "select", options = {
        { label = "Daily", color = "#10b981" },
        { label = "Weekdays", color = "#3b82f6" },
        { label = "3x/week", color = "#f59e0b" },
        { label = "Weekly", color = "#8b5cf6" },
      }},
      { name = "Target", type = "text" },
      { name = "Current Streak", type = "number" },
      { name = "Best Streak", type = "number" },
      { name = "Active", type = "checkbox" },
      { name = "Notes", type = "text" },
    })
  ))

  -- 2. Habit Log
  local log = nous.json_decode(nous.database_create(
    notebook_id, "Habit Log",
    nous.json_encode({
      { name = "Date", type = "date" },
      { name = "Completed", type = "checkbox" },
      { name = "Duration", type = "number" },
      { name = "Notes", type = "text" },
    })
  ))

  -- Habit Log -> Habit
  nous.database_update_properties(notebook_id, log.id, nous.json_encode({
    { name = "Habit", type = "relation", relationConfig = {
      databasePageId = habits.id, displayProperty = "Name", direction = "forward",
    }},
  }))

  -- Sample data
  nous.database_add_rows(notebook_id, habits.id, nous.json_encode({
    { Name = "Morning meditation", Category = "Mindfulness", Frequency = "Daily", Target = "10 minutes", ["Current Streak"] = 5, ["Best Streak"] = 21, Active = true },
    { Name = "Exercise", Category = "Fitness", Frequency = "3x/week", Target = "30 minutes", ["Current Streak"] = 2, ["Best Streak"] = 12, Active = true },
    { Name = "Read", Category = "Learning", Frequency = "Daily", Target = "20 pages", ["Current Streak"] = 8, ["Best Streak"] = 30, Active = true },
    { Name = "Journal", Category = "Mindfulness", Frequency = "Daily", Target = "1 entry", ["Current Streak"] = 3, ["Best Streak"] = 14, Active = true },
    { Name = "Practice guitar", Category = "Creative", Frequency = "Weekdays", Target = "15 minutes", ["Current Streak"] = 0, ["Best Streak"] = 7, Active = true },
  }))

  local today = nous.current_date().iso
  nous.database_add_rows(notebook_id, log.id, nous.json_encode({
    { Date = today, Completed = true, Duration = 10, Notes = "Felt calm and focused" },
    { Date = today, Completed = true, Duration = 45, Notes = "Ran 5k" },
    { Date = today, Completed = true, Duration = 25, Notes = "Read 22 pages of Dune" },
    { Date = nous.date_offset(today, -1), Completed = true, Duration = 10 },
    { Date = nous.date_offset(today, -1), Completed = true, Duration = 30 },
    { Date = nous.date_offset(today, -1), Completed = false, Notes = "Skipped - too tired" },
  }))

  nous.log_info("Habit Tracker created")
  return nous.json_encode({
    success = true,
    message = "Habit Tracker created with 2 databases: Habits and Habit Log. Track daily completions and streaks.",
  })
end

-- =============================================================================
-- Inventory
-- =============================================================================

function create_inventory(notebook_id)
  -- 1. Categories
  local categories = nous.json_decode(nous.database_create(
    notebook_id, "Categories",
    nous.json_encode({
      { name = "Name", type = "text" },
      { name = "Description", type = "text" },
      { name = "Color", type = "select", options = {
        { label = "Red", color = "#ef4444" },
        { label = "Blue", color = "#3b82f6" },
        { label = "Green", color = "#10b981" },
        { label = "Yellow", color = "#f59e0b" },
        { label = "Purple", color = "#8b5cf6" },
        { label = "Gray", color = "#6b7280" },
      }},
    })
  ))

  -- 2. Locations
  local locations = nous.json_decode(nous.database_create(
    notebook_id, "Locations",
    nous.json_encode({
      { name = "Name", type = "text" },
      { name = "Type", type = "select", options = {
        { label = "Warehouse", color = "#3b82f6" },
        { label = "Office", color = "#10b981" },
        { label = "Store", color = "#f59e0b" },
        { label = "Home", color = "#8b5cf6" },
        { label = "Storage Unit", color = "#6b7280" },
      }},
      { name = "Address", type = "text" },
      { name = "Notes", type = "text" },
    })
  ))

  -- 3. Items
  local items = nous.json_decode(nous.database_create(
    notebook_id, "Inventory Items",
    nous.json_encode({
      { name = "Name", type = "text" },
      { name = "SKU", type = "text" },
      { name = "Quantity", type = "number" },
      { name = "Min Stock", type = "number" },
      { name = "Unit Cost", type = "number" },
      { name = "Status", type = "select", options = {
        { label = "In Stock", color = "#10b981" },
        { label = "Low Stock", color = "#f59e0b" },
        { label = "Out of Stock", color = "#ef4444" },
        { label = "Discontinued", color = "#6b7280" },
      }},
      { name = "Condition", type = "select", options = {
        { label = "New", color = "#10b981" },
        { label = "Good", color = "#3b82f6" },
        { label = "Fair", color = "#f59e0b" },
        { label = "Poor", color = "#ef4444" },
      }},
      { name = "Last Restocked", type = "date" },
      { name = "Notes", type = "text" },
    })
  ))

  -- Relations
  -- Items -> Category
  nous.database_update_properties(notebook_id, items.id, nous.json_encode({
    { name = "Category", type = "relation", relationConfig = {
      databasePageId = categories.id, displayProperty = "Name", direction = "forward",
    }},
  }))

  -- Items -> Location
  nous.database_update_properties(notebook_id, items.id, nous.json_encode({
    { name = "Location", type = "relation", relationConfig = {
      databasePageId = locations.id, displayProperty = "Name", direction = "forward",
    }},
  }))

  -- Sample data
  nous.database_add_rows(notebook_id, categories.id, nous.json_encode({
    { Name = "Electronics", Description = "Cables, adapters, devices", Color = "Blue" },
    { Name = "Office Supplies", Description = "Paper, pens, folders", Color = "Green" },
    { Name = "Furniture", Description = "Desks, chairs, shelves", Color = "Yellow" },
  }))

  nous.database_add_rows(notebook_id, locations.id, nous.json_encode({
    { Name = "Main Office", Type = "Office", Address = "123 Main St" },
    { Name = "Storage Room A", Type = "Storage Unit" },
    { Name = "Home Office", Type = "Home" },
  }))

  local today = nous.current_date().iso
  nous.database_add_rows(notebook_id, items.id, nous.json_encode({
    { Name = "USB-C Cables", SKU = "ELEC-001", Quantity = 25, ["Min Stock"] = 10, ["Unit Cost"] = 8.99, Status = "In Stock", Condition = "New", ["Last Restocked"] = today },
    { Name = "Notebooks (A5)", SKU = "OFF-001", Quantity = 50, ["Min Stock"] = 20, ["Unit Cost"] = 3.50, Status = "In Stock", Condition = "New" },
    { Name = "Monitor Arms", SKU = "FURN-001", Quantity = 3, ["Min Stock"] = 5, ["Unit Cost"] = 45.00, Status = "Low Stock", Condition = "New" },
    { Name = "Wireless Mouse", SKU = "ELEC-002", Quantity = 0, ["Min Stock"] = 5, ["Unit Cost"] = 25.00, Status = "Out of Stock", Condition = "New" },
    { Name = "Standing Desk Mat", SKU = "FURN-002", Quantity = 8, ["Min Stock"] = 3, ["Unit Cost"] = 35.00, Status = "In Stock", Condition = "New" },
  }))

  nous.log_info("Inventory Tracker created")
  return nous.json_encode({
    success = true,
    message = "Inventory Tracker created with 3 databases: Categories, Locations, and Inventory Items.",
  })
end

-- =============================================================================
-- Food & Nutrition Log
-- =============================================================================

function create_food_log(notebook_id)
  -- 1. Nutrition Goals
  local goals = nous.json_decode(nous.database_create(
    notebook_id, "Nutrition Goals",
    nous.json_encode({
      { name = "Name", type = "text" },
      { name = "Daily Calories", type = "number" },
      { name = "Daily Protein", type = "number" },
      { name = "Daily Carbs", type = "number" },
      { name = "Daily Fat", type = "number" },
      { name = "Daily Fiber", type = "number" },
      { name = "Active", type = "checkbox" },
      { name = "Notes", type = "text" },
    })
  ))

  -- 2. Food Log
  local food_log = nous.json_decode(nous.database_create(
    notebook_id, "Food Log",
    nous.json_encode({
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
      { name = "Date", type = "date" },
      { name = "Notes", type = "text" },
    })
  ))

  -- 3. Recipes (optional companion)
  local recipes = nous.json_decode(nous.database_create(
    notebook_id, "Recipes",
    nous.json_encode({
      { name = "Name", type = "text" },
      { name = "Category", type = "select", options = {
        { label = "Breakfast", color = "#f59e0b" },
        { label = "Lunch", color = "#10b981" },
        { label = "Dinner", color = "#3b82f6" },
        { label = "Snack", color = "#8b5cf6" },
        { label = "Dessert", color = "#ec4899" },
        { label = "Drink", color = "#06b6d4" },
      }},
      { name = "Prep Time", type = "number" },
      { name = "Calories Per Serving", type = "number" },
      { name = "Servings", type = "number" },
      { name = "Ingredients", type = "text" },
      { name = "Instructions", type = "text" },
      { name = "Source", type = "url" },
    })
  ))

  -- Sample goals
  nous.database_add_rows(notebook_id, goals.id, nous.json_encode({
    { Name = "Maintenance", ["Daily Calories"] = 2000, ["Daily Protein"] = 120, ["Daily Carbs"] = 250, ["Daily Fat"] = 65, ["Daily Fiber"] = 30, Active = true },
    { Name = "Cut", ["Daily Calories"] = 1600, ["Daily Protein"] = 150, ["Daily Carbs"] = 150, ["Daily Fat"] = 50, ["Daily Fiber"] = 35, Active = false, Notes = "Higher protein for muscle retention" },
  }))

  -- Sample food entries
  local today = nous.current_date().iso
  nous.database_add_rows(notebook_id, food_log.id, nous.json_encode({
    { ["Food Name"] = "Oatmeal with berries", Meal = "Breakfast", Calories = 350, Protein = 12, Carbs = 55, Fat = 8, Fiber = 6, Serving = "1 bowl", Date = today },
    { ["Food Name"] = "Grilled chicken salad", Meal = "Lunch", Calories = 450, Protein = 38, Carbs = 20, Fat = 22, Fiber = 5, Serving = "1 plate", Date = today },
    { ["Food Name"] = "Greek yogurt", Meal = "Snack", Calories = 150, Protein = 15, Carbs = 12, Fat = 5, Fiber = 0, Serving = "200g", Date = today },
    { ["Food Name"] = "Salmon with rice", Meal = "Dinner", Calories = 620, Protein = 40, Carbs = 55, Fat = 22, Fiber = 3, Serving = "1 plate", Date = today },
  }))

  -- Sample recipes
  nous.database_add_rows(notebook_id, recipes.id, nous.json_encode({
    { Name = "Overnight Oats", Category = "Breakfast", ["Prep Time"] = 5, ["Calories Per Serving"] = 350, Servings = 1, Ingredients = "1/2 cup oats, 1/2 cup milk, 1 tbsp chia seeds, berries" },
    { Name = "Chicken Caesar Salad", Category = "Lunch", ["Prep Time"] = 15, ["Calories Per Serving"] = 420, Servings = 2, Ingredients = "Romaine, grilled chicken, parmesan, croutons, Caesar dressing" },
  }))

  nous.log_info("Food & Nutrition Log created")
  return nous.json_encode({
    success = true,
    message = "Food & Nutrition Log created with 3 databases: Food Log, Nutrition Goals, and Recipes.",
  })
end

-- =============================================================================
-- Time Tracking
-- =============================================================================

function create_time_tracking(notebook_id)
  -- 1. Clients
  local clients = nous.json_decode(nous.database_create(
    notebook_id, "Clients",
    nous.json_encode({
      { name = "Name", type = "text" },
      { name = "Contact", type = "text" },
      { name = "Email", type = "url" },
      { name = "Rate", type = "number" },
      { name = "Status", type = "select", options = {
        { label = "Active", color = "#10b981" },
        { label = "Inactive", color = "#6b7280" },
        { label = "Prospect", color = "#f59e0b" },
      }},
      { name = "Notes", type = "text" },
    })
  ))

  -- 2. Projects
  local projects = nous.json_decode(nous.database_create(
    notebook_id, "Projects",
    nous.json_encode({
      { name = "Name", type = "text" },
      { name = "Status", type = "select", options = {
        { label = "Active", color = "#10b981" },
        { label = "On Hold", color = "#f59e0b" },
        { label = "Completed", color = "#3b82f6" },
        { label = "Archived", color = "#6b7280" },
      }},
      { name = "Budget Hours", type = "number" },
      { name = "Rate Override", type = "number" },
      { name = "Start Date", type = "date" },
      { name = "Due Date", type = "date" },
      { name = "Description", type = "text" },
    })
  ))

  -- 3. Time Entries
  local entries = nous.json_decode(nous.database_create(
    notebook_id, "Time Entries",
    nous.json_encode({
      { name = "Description", type = "text" },
      { name = "Date", type = "date" },
      { name = "Hours", type = "number" },
      { name = "Billable", type = "checkbox" },
      { name = "Category", type = "select", options = {
        { label = "Development", color = "#3b82f6" },
        { label = "Design", color = "#8b5cf6" },
        { label = "Meeting", color = "#f59e0b" },
        { label = "Research", color = "#06b6d4" },
        { label = "Admin", color = "#6b7280" },
        { label = "Testing", color = "#10b981" },
        { label = "Support", color = "#ef4444" },
      }},
      { name = "Notes", type = "text" },
    })
  ))

  -- Relations
  -- Projects -> Client
  nous.database_update_properties(notebook_id, projects.id, nous.json_encode({
    { name = "Client", type = "relation", relationConfig = {
      databasePageId = clients.id, displayProperty = "Name", direction = "forward",
    }},
  }))

  -- Time Entries -> Project
  nous.database_update_properties(notebook_id, entries.id, nous.json_encode({
    { name = "Project", type = "relation", relationConfig = {
      databasePageId = projects.id, displayProperty = "Name", direction = "forward",
    }},
  }))

  -- Time Entries -> Client
  nous.database_update_properties(notebook_id, entries.id, nous.json_encode({
    { name = "Client", type = "relation", relationConfig = {
      databasePageId = clients.id, displayProperty = "Name", direction = "forward",
    }},
  }))

  -- Sample data
  local today = nous.current_date().iso
  nous.database_add_rows(notebook_id, clients.id, nous.json_encode({
    { Name = "Acme Corp", Contact = "Jane Smith", Email = "jane@acme.example.com", Rate = 150, Status = "Active" },
    { Name = "Personal", Status = "Active", Notes = "Internal / non-billable work" },
  }))

  nous.database_add_rows(notebook_id, projects.id, nous.json_encode({
    { Name = "Website Redesign", Status = "Active", ["Budget Hours"] = 80, ["Start Date"] = today, Description = "Full site overhaul" },
    { Name = "API Integration", Status = "Active", ["Budget Hours"] = 40, Description = "Third-party API integration" },
    { Name = "Internal Tools", Status = "Active", Notes = "Non-billable internal work" },
  }))

  nous.database_add_rows(notebook_id, entries.id, nous.json_encode({
    { Description = "Homepage design mockup", Date = today, Hours = 3.5, Billable = true, Category = "Design" },
    { Description = "API endpoint implementation", Date = today, Hours = 2.0, Billable = true, Category = "Development" },
    { Description = "Client kickoff meeting", Date = today, Hours = 1.0, Billable = true, Category = "Meeting" },
    { Description = "Sprint planning", Date = nous.date_offset(today, -1), Hours = 0.5, Billable = false, Category = "Admin" },
    { Description = "Auth flow research", Date = nous.date_offset(today, -1), Hours = 2.5, Billable = true, Category = "Research" },
    { Description = "Component library setup", Date = nous.date_offset(today, -1), Hours = 4.0, Billable = true, Category = "Development" },
    { Description = "QA review", Date = nous.date_offset(today, -2), Hours = 1.5, Billable = true, Category = "Testing" },
    { Description = "Bug fixes", Date = nous.date_offset(today, -2), Hours = 3.0, Billable = true, Category = "Development" },
  }))

  nous.log_info("Time Tracking workspace created")
  return nous.json_encode({
    success = true,
    message = "Time Tracking workspace created with 3 databases: Clients, Projects, and Time Entries. Use rollup columns to see total hours per project.",
  })
end
