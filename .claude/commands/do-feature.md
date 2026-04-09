# Execute Feature Tasks

Execute all tasks for a project/feature in dependency order, committing after each.

**Usage:** `/do-feature <project> [feature]`

**Arguments:** $ARGUMENTS

## Instructions

Parse the arguments: the first word is the project name, and everything after is the optional feature name. If no feature is specified, execute all Ready tasks for the project.

### Step 1: Get the execution plan

Call the `get_feature_tasks` MCP tool to get tasks in dependency order:

```
get_feature_tasks(project="<project>", feature="<feature or null>")
```

### Step 2: Confirm with the user

Display the execution plan as a numbered list showing task name, status, priority, and dependencies. Ask the user to confirm before proceeding. The user may:
- Say "skip task N" to skip specific tasks
- Say "stop after task N" to limit execution
- Say "go" or "yes" to proceed with the full plan
- Say "--push" to push after each commit

If there are cycle errors, report them and stop.

### Step 3: Execute each task in order

For each task that isn't "Done":

1. **Get the spec**: Call `get_task_spec(task="<task name>")` to get full context
2. **Check blockers**: If the spec shows blocking dependencies, skip this task and report why
3. **Mark In Progress**: Call `update_task_status(task="<task name>", status="In Progress")`
4. **Do the work**: Read the spec carefully and implement what it asks for. Run tests. Fix issues.
5. **Commit**: Use `jj describe` (this project uses jj, not git) to commit with a message like:
   `feat: <brief description of what was built>`
   Include `Co-Authored-By: Claude <noreply@anthropic.com>` in the commit message.
6. **Mark Done**: Call `update_task_status(task="<task name>", status="Done", notes="<brief summary of what was implemented and any decisions made>")` 
7. **Report progress**: Print a brief status line: "Completed N/M: <task name>"

### Error handling

- If tests fail or the build breaks: stop execution, leave status as "In Progress", report what failed and why
- If all remaining tasks are blocked: report the blockers and stop
- If a task's spec says it's already "In Progress": warn the user and ask whether to proceed

### Step 4: Push (if requested)

If the user specified `--push`, run:
```
jj bookmark set main -r @ && jj git push
```

### Step 5: Summary

After all tasks are complete (or execution stops), print a summary:

```
## Feature Execution Summary

**Project:** <project>
**Feature:** <feature or "All tasks">
**Completed:** N/M tasks
**Commits:** N

### Tasks completed:
1. <task name> - <brief note>
2. <task name> - <brief note>

### Issues:
- <any tasks skipped, blocked, or failed>
```
