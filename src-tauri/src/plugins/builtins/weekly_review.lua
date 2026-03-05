--[[ [manifest]
id = "builtin-weekly-review"
name = "Weekly Review"
version = "1.0.0"
is_builtin = true
]]

function describe_action(input_json)
  return nous.json_encode({
    id = "00000000-0000-0000-0001-000000000005",
    name = "Weekly Review",
    description = "Create a Friday Review page for weekly retrospective",
    icon = "calendar",
    category = "weeklyReviews",
    triggers = {
      { type = "manual" },
      { type = "aiChat", keywords = {
        "weekly review", "friday review", "week retrospective", "review the week"
      }},
      { type = "scheduled", schedule = {
        type = "weekly", days = { "friday" }, time = "16:00"
      }},
    },
    steps = {
      {
        type = "createPageFromTemplate",
        templateId = "weekly-review",
        notebookTarget = { type = "current" },
        titleTemplate = "Week {{weekNumber}} - Friday Review",
        tags = { "weekly-review", "agile-results" },
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
