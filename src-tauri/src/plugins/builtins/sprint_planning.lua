--[[ [manifest]
id = "sprint_planning"
name = "Sprint Planning Template"
version = "1.0.0"
description = "Creates interconnected Project, Sprint, Task, and Team databases for agile sprint planning."
capabilities = ["database_read", "database_write", "command_palette"]
hooks = ["command_palette"]
]]

-- Command palette entry
function describe_commands()
  return nous.json_encode({
    {
      id = "create_sprint_workspace",
      title = "Create Sprint Planning Workspace",
      subtitle = "Set up Projects, Sprints, Tasks, and Team databases with relations",
      keywords = { "sprint", "planning", "agile", "scrum", "project", "tasks", "team", "kanban" },
    },
  })
end

function handle_command(input_json)
  local input = nous.json_decode(input_json)
  local cmd_id = input.command_id
  local notebook_id = input.notebook_id

  if cmd_id ~= "create_sprint_workspace" then
    return nous.json_encode({ success = false, error = "Unknown command" })
  end

  if not notebook_id then
    return nous.json_encode({ success = false, error = "No notebook selected" })
  end

  -- 1. Create Team Members database
  local team_result = nous.json_decode(nous.database_create(
    notebook_id,
    "Team Members",
    nous.json_encode({
      { name = "Name", type = "text" },
      { name = "Role", type = "select", options = {
        { label = "Developer", color = "#3b82f6" },
        { label = "Designer", color = "#8b5cf6" },
        { label = "Product", color = "#10b981" },
        { label = "QA", color = "#f59e0b" },
        { label = "Lead", color = "#ef4444" },
      }},
      { name = "Email", type = "url" },
      { name = "Capacity", type = "number" },
      { name = "Status", type = "select", options = {
        { label = "Active", color = "#10b981" },
        { label = "On Leave", color = "#6b7280" },
        { label = "Part-time", color = "#f59e0b" },
      }},
    })
  ))
  local team_id = team_result.id
  nous.log_info("Created Team Members database: " .. team_id)

  -- 2. Create Projects database
  local projects_result = nous.json_decode(nous.database_create(
    notebook_id,
    "Projects",
    nous.json_encode({
      { name = "Name", type = "text" },
      { name = "Status", type = "select", options = {
        { label = "Planning", color = "#6b7280" },
        { label = "Active", color = "#3b82f6" },
        { label = "On Hold", color = "#f59e0b" },
        { label = "Completed", color = "#10b981" },
        { label = "Cancelled", color = "#ef4444" },
      }},
      { name = "Priority", type = "select", options = {
        { label = "Critical", color = "#ef4444" },
        { label = "High", color = "#f59e0b" },
        { label = "Medium", color = "#3b82f6" },
        { label = "Low", color = "#6b7280" },
      }},
      { name = "Description", type = "text" },
      { name = "Start Date", type = "date" },
      { name = "Target Date", type = "date" },
    })
  ))
  local projects_id = projects_result.id
  nous.log_info("Created Projects database: " .. projects_id)

  -- 3. Create Sprints database
  local sprints_result = nous.json_decode(nous.database_create(
    notebook_id,
    "Sprints",
    nous.json_encode({
      { name = "Name", type = "text" },
      { name = "Status", type = "select", options = {
        { label = "Planning", color = "#6b7280" },
        { label = "Active", color = "#3b82f6" },
        { label = "Review", color = "#f59e0b" },
        { label = "Completed", color = "#10b981" },
      }},
      { name = "Start Date", type = "date" },
      { name = "End Date", type = "date" },
      { name = "Goal", type = "text" },
      { name = "Velocity", type = "number" },
    })
  ))
  local sprints_id = sprints_result.id
  nous.log_info("Created Sprints database: " .. sprints_id)

  -- 4. Create Tasks database
  local tasks_result = nous.json_decode(nous.database_create(
    notebook_id,
    "Tasks",
    nous.json_encode({
      { name = "Title", type = "text" },
      { name = "Status", type = "select", options = {
        { label = "Backlog", color = "#6b7280" },
        { label = "To Do", color = "#3b82f6" },
        { label = "In Progress", color = "#f59e0b" },
        { label = "In Review", color = "#8b5cf6" },
        { label = "Done", color = "#10b981" },
        { label = "Blocked", color = "#ef4444" },
      }},
      { name = "Priority", type = "select", options = {
        { label = "Critical", color = "#ef4444" },
        { label = "High", color = "#f59e0b" },
        { label = "Medium", color = "#3b82f6" },
        { label = "Low", color = "#6b7280" },
      }},
      { name = "Story Points", type = "number" },
      { name = "Type", type = "select", options = {
        { label = "Feature", color = "#3b82f6" },
        { label = "Bug", color = "#ef4444" },
        { label = "Chore", color = "#6b7280" },
        { label = "Spike", color = "#8b5cf6" },
      }},
      { name = "Due Date", type = "date" },
      { name = "Description", type = "text" },
    })
  ))
  local tasks_id = tasks_result.id
  nous.log_info("Created Tasks database: " .. tasks_id)

  -- 5. Wire up relations between databases
  -- Tasks -> Project (many-to-one)
  nous.database_update_properties(
    notebook_id,
    tasks_id,
    nous.json_encode({
      {
        name = "Project",
        type = "relation",
        relationConfig = {
          databasePageId = projects_id,
          displayProperty = "Name",
          direction = "forward",
        },
      },
    })
  )

  -- Tasks -> Sprint (many-to-one)
  nous.database_update_properties(
    notebook_id,
    tasks_id,
    nous.json_encode({
      {
        name = "Sprint",
        type = "relation",
        relationConfig = {
          databasePageId = sprints_id,
          displayProperty = "Name",
          direction = "forward",
        },
      },
    })
  )

  -- Tasks -> Assignee (many-to-one, links to Team Members)
  nous.database_update_properties(
    notebook_id,
    tasks_id,
    nous.json_encode({
      {
        name = "Assignee",
        type = "relation",
        relationConfig = {
          databasePageId = team_id,
          displayProperty = "Name",
          direction = "forward",
        },
      },
    })
  )

  -- Tasks -> Depends On (self-referencing for dependencies)
  nous.database_update_properties(
    notebook_id,
    tasks_id,
    nous.json_encode({
      {
        name = "Depends On",
        type = "relation",
        relationConfig = {
          databasePageId = tasks_id,
          displayProperty = "Title",
          direction = "forward",
        },
      },
    })
  )

  -- Sprints -> Project (many-to-one)
  nous.database_update_properties(
    notebook_id,
    sprints_id,
    nous.json_encode({
      {
        name = "Project",
        type = "relation",
        relationConfig = {
          databasePageId = projects_id,
          displayProperty = "Name",
          direction = "forward",
        },
      },
    })
  )

  -- Projects -> Lead (many-to-one, links to Team Members)
  nous.database_update_properties(
    notebook_id,
    projects_id,
    nous.json_encode({
      {
        name = "Lead",
        type = "relation",
        relationConfig = {
          databasePageId = team_id,
          displayProperty = "Name",
          direction = "forward",
        },
      },
    })
  )

  -- 6. Add sample data
  nous.database_add_rows(notebook_id, team_id, nous.json_encode({
    { Name = "Alice", Role = "Lead", Capacity = 40, Status = "Active" },
    { Name = "Bob", Role = "Developer", Capacity = 40, Status = "Active" },
    { Name = "Carol", Role = "Designer", Capacity = 32, Status = "Part-time" },
    { Name = "Dave", Role = "QA", Capacity = 40, Status = "Active" },
  }))

  nous.database_add_rows(notebook_id, projects_id, nous.json_encode({
    { Name = "Mobile App v2", Status = "Active", Priority = "High", Description = "Major mobile app redesign" },
    { Name = "API Migration", Status = "Planning", Priority = "Medium", Description = "Migrate REST API to GraphQL" },
  }))

  local today = nous.current_date()
  local sprint_start = today.iso
  local sprint_end = nous.date_offset(sprint_start, 14)

  nous.database_add_rows(notebook_id, sprints_id, nous.json_encode({
    { Name = "Sprint 1", Status = "Active", ["Start Date"] = sprint_start, ["End Date"] = sprint_end, Goal = "Core features and setup", Velocity = 21 },
  }))

  nous.database_add_rows(notebook_id, tasks_id, nous.json_encode({
    { Title = "Set up CI/CD pipeline", Status = "Done", Priority = "High", ["Story Points"] = 3, Type = "Chore" },
    { Title = "User authentication flow", Status = "In Progress", Priority = "Critical", ["Story Points"] = 8, Type = "Feature" },
    { Title = "Design system components", Status = "In Progress", Priority = "High", ["Story Points"] = 5, Type = "Feature" },
    { Title = "Write API integration tests", Status = "To Do", Priority = "Medium", ["Story Points"] = 5, Type = "Chore" },
    { Title = "Fix login redirect bug", Status = "To Do", Priority = "High", ["Story Points"] = 2, Type = "Bug" },
    { Title = "Research caching strategy", Status = "Backlog", Priority = "Low", ["Story Points"] = 3, Type = "Spike" },
  }))

  nous.log_info("Sprint Planning workspace created successfully")

  return nous.json_encode({
    success = true,
    message = "Sprint Planning workspace created with 4 databases: Projects, Sprints, Tasks, and Team Members. Relations are wired between them.",
  })
end
