--[[ [manifest]
id = "nous.builtin.mermaid-block"
name = "Mermaid Diagram Block"
version = "0.1.0"
description = "Renders Mermaid diagrams as editor blocks. Type /Mermaid in the editor to insert."
capabilities = ["block_render"]
hooks = ["block_render:mermaid"]
is_builtin = true
]]

-- Describe the block type for the slash menu
function describe_block(_input_json)
  return nous.json_encode({
    block_type = "mermaid",
    label = "Mermaid Diagram",
    icon_svg = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>'
  })
end

-- Render the mermaid block
function render_block(input_json)
  local input = nous.json_decode(input_json)
  local data = input.data or {}
  local code = data.code or "graph TD\n    A[Start] -->|Step 1| B{Decision}\n    B -->|Yes| C[OK]\n    B -->|No| D[Cancel]"

  -- Escape for embedding in a JS string (backslashes, quotes, newlines)
  local js_escaped = code:gsub("\\", "\\\\"):gsub("'", "\\'"):gsub("\n", "\\n"):gsub("\r", "")
  -- Escape for textarea HTML content
  local html_escaped = code:gsub("&", "&amp;"):gsub("<", "&lt;"):gsub(">", "&gt;"):gsub('"', "&quot;")

  local html = string.format([[
<div id="mermaid-container" style="padding:16px;">
  <div id="mermaid-output" style="display:flex;justify-content:center;min-height:60px;color:#888;">Loading diagram...</div>
  <details style="margin-top:12px;">
    <summary style="cursor:pointer;font-size:12px;color:#888;user-select:none;">Edit diagram source</summary>
    <textarea id="mermaid-source"
      style="width:100%%;min-height:80px;margin-top:8px;padding:8px;font-family:monospace;font-size:13px;background:#1a1a2e;color:#e0e0e0;border:1px solid #333;border-radius:4px;resize:vertical;"
    >%s</textarea>
    <button id="mermaid-update"
      style="margin-top:6px;padding:4px 12px;font-size:12px;background:#3b82f6;color:white;border:none;border-radius:4px;cursor:pointer;"
      data-action='{"type":"update_code"}'
    >Update</button>
  </details>
</div>
<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
  mermaid.initialize({ startOnLoad: false, theme: 'dark' });
  var code = '%s';
  try {
    var { svg } = await mermaid.render('mermaid-diagram', code);
    document.getElementById('mermaid-output').innerHTML = svg;
  } catch (e) {
    document.getElementById('mermaid-output').innerHTML =
      '<div style="color:#ef4444;font-size:13px;">Diagram error: ' + e.message + '</div>';
  }

  document.getElementById('mermaid-update').addEventListener('click', function() {
    var newCode = document.getElementById('mermaid-source').value;
    window.parent.postMessage({
      type: 'plugin-block-update-data',
      dataJson: JSON.stringify({ code: newCode })
    }, '*');
  });
</script>
]], html_escaped, js_escaped)

  return nous.json_encode({
    html = html,
    styles = "",
    height = 300
  })
end

-- Handle code edit action from iframe
function handle_block_action(input_json)
  local input = nous.json_decode(input_json)
  return nous.json_encode({ handled = true, action = input.type or "unknown" })
end
