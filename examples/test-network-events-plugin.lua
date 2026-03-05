--[[ [manifest]
id = "test-network-events"
name = "Test Network & Events"
version = "0.1.0"
description = "Example plugin demonstrating network requests and event hooks"
capabilities = ["network"]
hooks = ["on_page_created"]
]]

-- Event handler: called when a new page is created
function on_page_created(input_json)
  local data = nous.json_decode(input_json)
  nous.log_info("Page created: " .. (data.title or "untitled") .. " (id: " .. (data.page_id or "?") .. ")")

  -- Example: make an HTTP GET request when a page is created
  local resp_json = nous.http_get("https://httpbin.org/get")
  local resp = nous.json_decode(resp_json)
  nous.log_info("HTTP GET status: " .. tostring(resp.status))

  return nous.json_encode({ ok = true })
end
