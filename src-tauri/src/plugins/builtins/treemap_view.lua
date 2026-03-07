--[[ [manifest]
id = "nous.builtin.treemap-view"
name = "Treemap View"
version = "0.1.0"
description = "Renders a treemap visualization from a category column and a number column using D3.js."
capabilities = ["database_read", "database_view"]
hooks = ["database_view:treemap"]
is_builtin = true
]]

-- Describe the view type for the frontend
function describe_view(_input_json)
  return nous.json_encode({
    view_type = "treemap",
    label = "Treemap",
    icon_svg = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>'
  })
end

-- Default color palette for categories (dark-theme friendly)
local PALETTE = {
  "#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6",
  "#ec4899", "#06b6d4", "#f97316", "#14b8a6", "#a855f7",
  "#6366f1", "#84cc16", "#e11d48", "#0ea5e9", "#d946ef",
}

-- Render the treemap view
function render_view(input_json)
  local input = nous.json_decode(input_json)
  local content = input.content
  local properties = content.properties or {}
  local rows = content.rows or {}

  -- Auto-detect: first select/text → category, first number → value
  local cat_prop_id = nil
  local val_prop_id = nil
  local cat_prop_name = "Category"
  local val_prop_name = "Value"
  local label_prop_id = nil -- title/text column for row labels

  for _, prop in ipairs(properties) do
    if not cat_prop_id and (prop.type == "select" or prop.type == "multi_select") then
      cat_prop_id = prop.id
      cat_prop_name = prop.name
    end
    if not val_prop_id and prop.type == "number" then
      val_prop_id = prop.id
      val_prop_name = prop.name
    end
    if not label_prop_id and (prop.type == "title" or prop.type == "text") then
      label_prop_id = prop.id
    end
  end

  -- Fall back: if no select column, use first text column as category
  if not cat_prop_id then
    for _, prop in ipairs(properties) do
      if prop.type == "text" or prop.type == "title" then
        cat_prop_id = prop.id
        cat_prop_name = prop.name
        break
      end
    end
  end

  if not cat_prop_id or not val_prop_id then
    local missing = {}
    if not cat_prop_id then table.insert(missing, "category (select or text)") end
    if not val_prop_id then table.insert(missing, "number") end
    return nous.json_encode({
      html = '<div style="padding:20px;color:#999;text-align:center;">Treemap needs a '
        .. table.concat(missing, " and a ")
        .. ' column. Add the missing properties to use this view.</div>',
      styles = "",
      height = 80
    })
  end

  -- Build select option → color map from property config
  local option_colors = {}
  for _, prop in ipairs(properties) do
    if prop.id == cat_prop_id and prop.options then
      for _, opt in ipairs(prop.options) do
        if opt.color and opt.color ~= "" then
          option_colors[opt.value or opt.name] = opt.color
        end
      end
    end
  end

  -- Aggregate rows: group by category, sum values, collect individual items
  local categories = {}     -- ordered list of category names
  local cat_set = {}        -- name → true
  local cat_totals = {}     -- name → total value
  local cat_items = {}      -- name → list of {label, value}
  local grand_total = 0

  for _, row in ipairs(rows) do
    local cells = row.cells or {}
    local cat = cells[cat_prop_id]
    if cat == nil or cat == "" then cat = "(empty)" end
    cat = tostring(cat)

    local val = tonumber(cells[val_prop_id]) or 0
    if val <= 0 then val = 0 end

    if not cat_set[cat] then
      cat_set[cat] = true
      table.insert(categories, cat)
      cat_totals[cat] = 0
      cat_items[cat] = {}
    end

    cat_totals[cat] = cat_totals[cat] + val
    grand_total = grand_total + val

    local item_label = cat
    if label_prop_id and cells[label_prop_id] and cells[label_prop_id] ~= "" then
      item_label = tostring(cells[label_prop_id])
    end
    table.insert(cat_items[cat], { label = item_label, value = val })
  end

  if grand_total == 0 then
    return nous.json_encode({
      html = '<div style="padding:20px;color:#999;text-align:center;">All values are zero or empty. Add numeric data to see the treemap.</div>',
      styles = "",
      height = 80
    })
  end

  -- Assign colors: use select option colors if available, else palette
  local cat_colors = {}
  local palette_idx = 0
  for _, cat in ipairs(categories) do
    if option_colors[cat] then
      cat_colors[cat] = option_colors[cat]
    else
      palette_idx = palette_idx + 1
      cat_colors[cat] = PALETTE[((palette_idx - 1) % #PALETTE) + 1]
    end
  end

  -- Build D3 data as JSON children array
  -- Each child = { name, value, category, color }
  -- If a category has multiple items, create a group with children
  local children_parts = {}
  for _, cat in ipairs(categories) do
    local items = cat_items[cat]
    local color = cat_colors[cat]
    -- Escape strings for JSON
    local esc_cat = cat:gsub('\\', '\\\\'):gsub('"', '\\"'):gsub('\n', ' ')
    if #items == 1 then
      local esc_label = items[1].label:gsub('\\', '\\\\'):gsub('"', '\\"'):gsub('\n', ' ')
      table.insert(children_parts, string.format(
        '{"name":"%s","value":%s,"category":"%s","color":"%s"}',
        esc_label, items[1].value, esc_cat, color
      ))
    else
      -- Group with sub-children
      local sub_parts = {}
      for _, item in ipairs(items) do
        local esc_label = item.label:gsub('\\', '\\\\'):gsub('"', '\\"'):gsub('\n', ' ')
        table.insert(sub_parts, string.format(
          '{"name":"%s","value":%s,"category":"%s","color":"%s"}',
          esc_label, item.value, esc_cat, color
        ))
      end
      table.insert(children_parts, string.format(
        '{"name":"%s","children":[%s],"category":"%s","color":"%s"}',
        esc_cat, table.concat(sub_parts, ","), esc_cat, color
      ))
    end
  end

  local data_json = '{"name":"root","children":[' .. table.concat(children_parts, ",") .. ']}'

  -- Build legend HTML
  local legend_parts = {}
  for _, cat in ipairs(categories) do
    local esc_cat = cat:gsub('&', '&amp;'):gsub('<', '&lt;'):gsub('>', '&gt;')
    local pct = cat_totals[cat] / grand_total * 100
    table.insert(legend_parts, string.format(
      '<span style="display:inline-flex;align-items:center;gap:4px;margin-right:12px;">'
      .. '<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:%s;flex-shrink:0;"></span>'
      .. '<span style="font-size:11px;color:#ccc;">%s</span>'
      .. '<span style="font-size:11px;color:#666;">%.0f%%</span>'
      .. '</span>',
      cat_colors[cat], esc_cat, pct
    ))
  end
  local legend_html = '<div style="display:flex;flex-wrap:wrap;gap:4px 0;padding:8px 0;">'
    .. table.concat(legend_parts) .. '</div>'

  local html = string.format([[
<div style="padding:16px;">
  <div id="treemap" style="width:100%%;height:400px;position:relative;"></div>
  %s
</div>
<script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"></script>
<script>
(function() {
  var data = %s;
  var container = document.getElementById('treemap');
  var width = container.clientWidth || 600;
  var height = 400;

  var root = d3.hierarchy(data)
    .sum(function(d) { return d.value || 0; })
    .sort(function(a, b) { return b.value - a.value; });

  d3.treemap()
    .size([width, height])
    .padding(2)
    .round(true)(root);

  var svg = d3.select('#treemap')
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .style('display', 'block');

  var grandTotal = root.value || 1;

  var leaves = root.leaves();

  var cells = svg.selectAll('g')
    .data(leaves)
    .join('g')
    .attr('transform', function(d) { return 'translate(' + d.x0 + ',' + d.y0 + ')'; });

  cells.append('rect')
    .attr('width', function(d) { return d.x1 - d.x0; })
    .attr('height', function(d) { return d.y1 - d.y0; })
    .attr('rx', 3)
    .attr('fill', function(d) { return d.data.color || '#3b82f6'; })
    .attr('fill-opacity', 0.85)
    .style('cursor', 'pointer')
    .on('mouseover', function() { d3.select(this).attr('fill-opacity', 1); })
    .on('mouseout', function() { d3.select(this).attr('fill-opacity', 0.85); })
    .on('click', function(event, d) {
      window.parent.postMessage({
        type: 'plugin-block-action',
        payload: { type: 'cell_click', category: d.data.category, name: d.data.name, value: d.data.value }
      }, '*');
    });

  // Clip text inside each cell
  cells.each(function(d) {
    var w = d.x1 - d.x0;
    var h = d.y1 - d.y0;
    var g = d3.select(this);
    var clipId = 'clip-' + Math.random().toString(36).substr(2, 9);
    g.append('clipPath').attr('id', clipId)
      .append('rect').attr('width', w).attr('height', h);

    var textG = g.append('g').attr('clip-path', 'url(#' + clipId + ')');

    if (w > 30 && h > 20) {
      textG.append('text')
        .attr('x', 4).attr('y', 14)
        .attr('font-size', '11px')
        .attr('font-weight', '600')
        .attr('fill', '#fff')
        .attr('font-family', '-apple-system, BlinkMacSystemFont, sans-serif')
        .text(d.data.name);
    }

    if (w > 30 && h > 34) {
      var pct = ((d.value / grandTotal) * 100).toFixed(1);
      textG.append('text')
        .attr('x', 4).attr('y', 28)
        .attr('font-size', '10px')
        .attr('fill', 'rgba(255,255,255,0.7)')
        .attr('font-family', '-apple-system, BlinkMacSystemFont, sans-serif')
        .text(d.value.toLocaleString() + ' (' + pct + '%%' + ')');
    }
  });

  // Tooltip
  var tooltip = d3.select('#treemap').append('div')
    .style('position', 'absolute')
    .style('pointer-events', 'none')
    .style('background', 'rgba(0,0,0,0.85)')
    .style('color', '#fff')
    .style('padding', '6px 10px')
    .style('border-radius', '4px')
    .style('font-size', '12px')
    .style('font-family', '-apple-system, BlinkMacSystemFont, sans-serif')
    .style('display', 'none')
    .style('z-index', '10');

  cells.selectAll('rect')
    .on('mouseover', function(event, d) {
      d3.select(this).attr('fill-opacity', 1);
      var pct = ((d.value / grandTotal) * 100).toFixed(1);
      tooltip.html('<b>' + d.data.name + '</b><br>'
        + d.data.category + ': ' + d.value.toLocaleString()
        + ' (' + pct + '%%' + ')')
        .style('display', 'block');
    })
    .on('mousemove', function(event) {
      var rect = container.getBoundingClientRect();
      tooltip
        .style('left', (event.clientX - rect.left + 12) + 'px')
        .style('top', (event.clientY - rect.top - 10) + 'px');
    })
    .on('mouseout', function() {
      d3.select(this).attr('fill-opacity', 0.85);
      tooltip.style('display', 'none');
    });

  // Resize observer
  var ro = new ResizeObserver(function(entries) {
    window.parent.postMessage({
      type: 'plugin-block-resize',
      height: container.scrollHeight + 16
    }, '*');
  });
  ro.observe(container);
})();
</script>
]], legend_html, data_json)

  return nous.json_encode({
    html = html,
    styles = "",
    height = 480
  })
end

-- Handle treemap cell click
function handle_action(input_json)
  local input = nous.json_decode(input_json)
  return nous.json_encode({
    handled = true,
    category = input.category,
    name = input.name,
    value = input.value
  })
end
