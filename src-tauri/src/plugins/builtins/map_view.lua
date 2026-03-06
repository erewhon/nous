--[[ [manifest]
id = "nous.builtin.map-view"
name = "Map View"
version = "0.1.0"
description = "Renders database rows with latitude/longitude columns on an interactive Leaflet map."
capabilities = ["database_read", "database_view"]
hooks = ["database_view:map"]
is_builtin = true
]]

-- Describe the view type for the frontend
function describe_view(_input_json)
  return nous.json_encode({
    view_type = "map",
    label = "Map",
    icon_svg = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>'
  })
end

-- Render the map view
function render_view(input_json)
  local input = nous.json_decode(input_json)
  local content = input.content
  local properties = content.properties or {}
  local rows = content.rows or {}

  -- Auto-detect lat/lng columns by name pattern
  local lat_prop_id = nil
  local lng_prop_id = nil
  local name_prop_id = nil

  local lat_patterns = { "latitude", "lat" }
  local lng_patterns = { "longitude", "lng", "lon", "long" }

  for _, prop in ipairs(properties) do
    local lower = string.lower(prop.name)

    if not lat_prop_id then
      for _, pat in ipairs(lat_patterns) do
        if lower == pat then
          lat_prop_id = prop.id
          break
        end
      end
    end

    if not lng_prop_id then
      for _, pat in ipairs(lng_patterns) do
        if lower == pat then
          lng_prop_id = prop.id
          break
        end
      end
    end

    -- Use first text column as label
    if not name_prop_id and (prop.type == "title" or prop.type == "text") then
      name_prop_id = prop.id
    end
  end

  if not lat_prop_id or not lng_prop_id then
    return nous.json_encode({
      html = '<div style="padding:20px;color:#999;text-align:center;">No latitude/longitude columns found. Add columns named "lat" and "lng" (or "latitude"/"longitude") to use the map view.</div>',
      styles = "",
      height = 80
    })
  end

  -- Collect markers
  local markers_js = {}
  local valid_count = 0

  for _, row in ipairs(rows) do
    local cells = row.cells or {}
    local lat_str = cells[lat_prop_id]
    local lng_str = cells[lng_prop_id]
    local lat = tonumber(lat_str)
    local lng = tonumber(lng_str)

    if lat and lng then
      valid_count = valid_count + 1
      local label = "Row"
      if name_prop_id and cells[name_prop_id] then
        label = tostring(cells[name_prop_id])
      end
      -- Escape for JS string
      label = label:gsub("\\", "\\\\"):gsub("'", "\\'"):gsub("\n", " ")
      table.insert(markers_js, string.format("{lat:%s,lng:%s,label:'%s'}", lat, lng, label))
    end
  end

  if valid_count == 0 then
    return nous.json_encode({
      html = '<div style="padding:20px;color:#999;text-align:center;">No rows with valid lat/lng values found.</div>',
      styles = "",
      height = 80
    })
  end

  local html = string.format([[
<div id="map-container" style="width:100%%;height:100%%;min-height:400px;">
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9/dist/leaflet.css" />
  <div id="map" style="width:100%%;height:400px;border-radius:6px;"></div>
</div>
<script src="https://unpkg.com/leaflet@1.9/dist/leaflet.js"></script>
<script>
(function() {
  var markers = [%s];
  var map = L.map('map', { zoomControl: true });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19
  }).addTo(map);

  var bounds = [];
  markers.forEach(function(m) {
    var marker = L.marker([m.lat, m.lng]).addTo(map);
    marker.bindPopup('<b>' + m.label + '</b><br>' + m.lat.toFixed(4) + ', ' + m.lng.toFixed(4));
    bounds.push([m.lat, m.lng]);
  });

  if (bounds.length === 1) {
    map.setView(bounds[0], 13);
  } else {
    map.fitBounds(bounds, { padding: [30, 30] });
  }
})();
</script>
]], table.concat(markers_js, ","))

  return nous.json_encode({
    html = html,
    styles = "",
    height = 440
  })
end

-- Handle map actions (marker click, etc.)
function handle_action(input_json)
  local input = nous.json_decode(input_json)
  return nous.json_encode({ handled = true, action = input.type or "unknown" })
end
