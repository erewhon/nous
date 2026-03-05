--[[ [manifest]
id = "builtin-daily-note-carry-forward"
name = "Daily Note + Carry Forward"
version = "1.0.0"
is_builtin = true
]]

function describe_action(input_json)
  return nous.json_encode({
    id = "00000000-0000-0000-0001-000000000008",
    name = "Daily Note + Carry Forward",
    description = "Create today's daily note and carry forward incomplete checklist items from recent daily notes",
    icon = "calendar-arrow-right",
    category = "dailyRoutines",
    triggers = {
      { type = "manual" },
      { type = "aiChat", keywords = {
        "carry forward daily", "daily note carry",
        "yesterday daily note", "carry tasks from yesterday",
        "create daily note"
      }},
      { type = "scheduled", schedule = {
        type = "daily", time = "07:00", skipWeekends = false
      }},
    },
    steps = {
      {
        type = "carryForwardItems",
        sourceSelector = {
          notebook = { type = "current" },
          isDailyNote = true,
          dailyNoteDate = "recent:7",
        },
        destination = { type = "current" },
        titleTemplate = "{{dayOfWeek}}, {{date}}",
        templateId = "daily-journal",
        findExisting = {
          notebook = { type = "current" },
          isDailyNote = true,
          dailyNoteDate = "today",
        },
        insertAfterSection = "Today's Goals",
      },
    },
    enabled = true,
    isBuiltIn = true,
    variables = {
      {
        name = "date",
        description = "Today's date",
        variableType = { currentDateFormatted = { format = "%B %d, %Y" } },
      },
      {
        name = "dayOfWeek",
        description = "Day of the week",
        variableType = "dayOfWeek",
      },
    },
    createdAt = "2024-01-01T00:00:00Z",
    updatedAt = "2024-01-01T00:00:00Z",
  })
end
