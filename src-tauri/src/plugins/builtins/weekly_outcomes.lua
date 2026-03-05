--[[ [manifest]
id = "builtin-weekly-outcomes"
name = "Weekly Outcomes"
version = "1.0.0"
is_builtin = true
]]

function describe_action(input_json)
  return nous.json_encode({
    id = "00000000-0000-0000-0001-000000000002",
    name = "Weekly Outcomes",
    description = "Create a page outlining the three key outcomes for this week",
    icon = "calendar",
    category = "agileResults",
    triggers = {
      { type = "manual" },
      { type = "aiChat", keywords = {
        "weekly goals", "weekly outcomes", "week planning", "this week"
      }},
      { type = "scheduled", schedule = {
        type = "weekly", days = { "monday" }, time = "08:00"
      }},
    },
    steps = {
      {
        type = "createPageFromTemplate",
        templateId = "agile-results-weekly",
        notebookTarget = { type = "current" },
        titleTemplate = "Week {{weekNumber}} - Weekly Outcomes",
        tags = { "weekly-outcomes", "agile-results" },
      },
    },
    enabled = true,
    isBuiltIn = true,
    variables = {
      {
        name = "weekNumber",
        description = "ISO week number",
        variableType = "weekNumber",
      },
    },
    createdAt = "2024-01-01T00:00:00Z",
    updatedAt = "2024-01-01T00:00:00Z",
  })
end
