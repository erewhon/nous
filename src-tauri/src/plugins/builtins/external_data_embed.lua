--[[ [manifest]
id = "nous.builtin.external-data-embed"
name = "External Data Embed"
version = "0.1.0"
description = "Embeds live external data in the editor. Default preset fetches weather from Open-Meteo API."
capabilities = ["block_render", "network"]
hooks = ["block_render:external_data"]
is_builtin = true
]]

-- Describe the block type for the slash menu
function describe_block(_input_json)
  return nous.json_encode({
    block_type = "external_data",
    label = "External Data",
    icon_svg = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 1-9 9m9-9a9 9 0 0 0-9-9m9 9H3m9 9a9 9 0 0 1-9-9m9 9c1.66 0 3-4.03 3-9s-1.34-9-3-9m0 18c-1.66 0-3-4.03-3-9s1.34-9 3-9m-9 9a9 9 0 0 1 9-9"/></svg>'
  })
end

-- Weather condition code to emoji
local function weather_emoji(code)
  if not code then return "?" end
  if code == 0 then return "Clear" end
  if code <= 3 then return "Cloudy" end
  if code <= 48 then return "Foggy" end
  if code <= 55 then return "Drizzle" end
  if code <= 57 then return "Freezing Drizzle" end
  if code <= 65 then return "Rain" end
  if code <= 67 then return "Freezing Rain" end
  if code <= 75 then return "Snow" end
  if code == 77 then return "Snow Grains" end
  if code <= 82 then return "Rain Showers" end
  if code <= 86 then return "Snow Showers" end
  if code == 95 then return "Thunderstorm" end
  if code <= 99 then return "Thunderstorm + Hail" end
  return "Unknown"
end

-- Geocode a city name using Open-Meteo geocoding API
local function geocode_city(city)
  local encoded = city:gsub(" ", "+")
  local url = "https://geocoding-api.open-meteo.com/v1/search?name=" .. encoded .. "&count=1&language=en&format=json"
  local resp_json = nous.http_get(url)
  local resp = nous.json_decode(resp_json)
  if resp.status ~= 200 or not resp.body then return nil end
  local data = nous.json_decode(resp.body)
  if not data.results or #data.results == 0 then return nil end
  local r = data.results[1]
  return { lat = r.latitude, lng = r.longitude, name = r.name, country = r.country or "" }
end

-- Fetch weather for lat/lng
local function fetch_weather(lat, lng)
  local url = string.format(
    "https://api.open-meteo.com/v1/forecast?latitude=%s&longitude=%s&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&temperature_unit=fahrenheit&wind_speed_unit=mph",
    lat, lng
  )
  local resp_json = nous.http_get(url)
  local resp = nous.json_decode(resp_json)
  if resp.status ~= 200 or not resp.body then return nil end
  return nous.json_decode(resp.body)
end

-- Fetch custom URL
local function fetch_custom(url)
  local resp_json = nous.http_get(url)
  local resp = nous.json_decode(resp_json)
  if resp.status ~= 200 or not resp.body then
    return nil, "HTTP " .. tostring(resp.status or "error")
  end
  -- Try to parse as JSON
  local ok, data = pcall(nous.json_decode, resp.body)
  if ok then return data, nil end
  -- Return raw text
  return resp.body, nil
end

-- Navigate a nested table by dot-separated key
local function deep_get(tbl, key)
  if type(tbl) ~= "table" or not key or key == "" then return tbl end
  local current = tbl
  for part in key:gmatch("[^%.]+") do
    if type(current) ~= "table" then return nil end
    -- Try numeric index
    local num = tonumber(part)
    if num then
      current = current[num]
    else
      current = current[part]
    end
    if current == nil then return nil end
  end
  return current
end

-- HTML-escape helper
local function esc(s)
  if not s then return "" end
  s = tostring(s)
  return s:gsub("&", "&amp;"):gsub("<", "&lt;"):gsub(">", "&gt;"):gsub('"', "&quot;")
end

-- Render the block
function render_block(input_json)
  local input = nous.json_decode(input_json)
  local data = input.data or {}
  local preset = data.preset or "weather"
  local city = data.city or "San Francisco"
  local custom_url = data.custom_url or ""
  local display_key = data.display_key or ""
  local error_msg = nil
  local content_html = ""

  if preset == "weather" then
    local geo = geocode_city(city)
    if not geo then
      error_msg = "Could not find city: " .. esc(city)
    else
      local weather = fetch_weather(geo.lat, geo.lng)
      if not weather or not weather.current then
        error_msg = "Could not fetch weather data"
      else
        local cur = weather.current
        local temp = cur.temperature_2m or "?"
        local humidity = cur.relative_humidity_2m or "?"
        local wind = cur.wind_speed_10m or "?"
        local code = cur.weather_code
        local condition = weather_emoji(code)

        content_html = string.format([[
<div style="display:flex;align-items:center;gap:16px;">
  <div style="font-size:36px;font-weight:700;color:#e0e0e0;">%s°F</div>
  <div style="font-size:14px;color:#aaa;line-height:1.6;">
    <div><b>%s</b>, %s</div>
    <div>%s</div>
    <div>Humidity: %s%% · Wind: %s mph</div>
  </div>
</div>
]], esc(tostring(temp)), esc(geo.name), esc(geo.country), esc(condition), esc(tostring(humidity)), esc(tostring(wind)))
      end
    end
  elseif preset == "custom" then
    if custom_url == "" then
      error_msg = "No URL configured. Open settings to enter a URL."
    else
      local result, err = fetch_custom(custom_url)
      if err then
        error_msg = "Fetch error: " .. esc(err)
      elseif type(result) == "table" then
        local value = deep_get(result, display_key)
        if value == nil then
          error_msg = "Key not found: " .. esc(display_key)
        else
          if type(value) == "table" then
            content_html = '<pre style="color:#e0e0e0;font-size:13px;margin:0;white-space:pre-wrap;">' .. esc(nous.json_encode(value)) .. '</pre>'
          else
            content_html = '<div style="font-size:20px;font-weight:600;color:#e0e0e0;">' .. esc(tostring(value)) .. '</div>'
            if display_key ~= "" then
              content_html = content_html .. '<div style="font-size:12px;color:#888;margin-top:4px;">' .. esc(display_key) .. '</div>'
            end
          end
        end
      else
        content_html = '<pre style="color:#e0e0e0;font-size:13px;margin:0;white-space:pre-wrap;">' .. esc(tostring(result)) .. '</pre>'
      end
    end
  end

  if error_msg then
    content_html = '<div style="color:#ef4444;font-size:13px;">' .. error_msg .. '</div>'
  end

  -- Settings form values (HTML-escaped for attributes)
  local city_val = esc(city)
  local url_val = esc(custom_url)
  local key_val = esc(display_key)
  local weather_sel = preset == "weather" and "selected" or ""
  local custom_sel = preset == "custom" and "selected" or ""

  local html = string.format([[
<div style="padding:16px;">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#666;">External Data</div>
    <button id="ed-refresh" style="padding:2px 10px;font-size:11px;background:#333;color:#ccc;border:1px solid #444;border-radius:4px;cursor:pointer;">Refresh</button>
  </div>
  <div id="ed-content">%s</div>
  <details style="margin-top:12px;">
    <summary style="cursor:pointer;font-size:12px;color:#888;user-select:none;">Settings</summary>
    <div style="margin-top:8px;display:flex;flex-direction:column;gap:8px;">
      <label style="font-size:12px;color:#aaa;">
        Preset:
        <select id="ed-preset" style="margin-left:6px;background:#1a1a2e;color:#e0e0e0;border:1px solid #333;border-radius:4px;padding:2px 6px;font-size:12px;">
          <option value="weather" %s>Weather</option>
          <option value="custom" %s>Custom URL</option>
        </select>
      </label>
      <div id="ed-weather-opts" style="display:%s;">
        <label style="font-size:12px;color:#aaa;">
          City:
          <input id="ed-city" type="text" value="%s"
            style="margin-left:6px;width:200px;background:#1a1a2e;color:#e0e0e0;border:1px solid #333;border-radius:4px;padding:3px 6px;font-size:12px;" />
        </label>
      </div>
      <div id="ed-custom-opts" style="display:%s;">
        <label style="font-size:12px;color:#aaa;display:block;margin-bottom:4px;">
          URL:
          <input id="ed-url" type="text" value="%s" placeholder="https://api.example.com/data"
            style="margin-left:6px;width:300px;background:#1a1a2e;color:#e0e0e0;border:1px solid #333;border-radius:4px;padding:3px 6px;font-size:12px;" />
        </label>
        <label style="font-size:12px;color:#aaa;">
          Display key (dot notation):
          <input id="ed-key" type="text" value="%s" placeholder="data.value"
            style="margin-left:6px;width:200px;background:#1a1a2e;color:#e0e0e0;border:1px solid #333;border-radius:4px;padding:3px 6px;font-size:12px;" />
        </label>
      </div>
      <button id="ed-save" style="align-self:flex-start;padding:4px 12px;font-size:12px;background:#3b82f6;color:white;border:none;border-radius:4px;cursor:pointer;margin-top:4px;">Save Settings</button>
    </div>
  </details>
</div>
<script>
(function() {
  var preset = '%s';

  document.getElementById('ed-preset').addEventListener('change', function() {
    var v = this.value;
    document.getElementById('ed-weather-opts').style.display = v === 'weather' ? 'block' : 'none';
    document.getElementById('ed-custom-opts').style.display = v === 'custom' ? 'block' : 'none';
  });

  document.getElementById('ed-save').addEventListener('click', function() {
    var p = document.getElementById('ed-preset').value;
    var d = { preset: p };
    if (p === 'weather') {
      d.city = document.getElementById('ed-city').value;
    } else {
      d.custom_url = document.getElementById('ed-url').value;
      d.display_key = document.getElementById('ed-key').value;
    }
    window.parent.postMessage({ type: 'plugin-block-update-data', dataJson: JSON.stringify(d) }, '*');
  });

  document.getElementById('ed-refresh').addEventListener('click', function() {
    var p = document.getElementById('ed-preset').value;
    var d = { preset: p, _ts: Date.now() };
    if (p === 'weather') {
      d.city = document.getElementById('ed-city').value;
    } else {
      d.custom_url = document.getElementById('ed-url').value;
      d.display_key = document.getElementById('ed-key').value;
    }
    window.parent.postMessage({ type: 'plugin-block-update-data', dataJson: JSON.stringify(d) }, '*');
  });
})();
</script>
]], content_html, weather_sel, custom_sel,
    preset == "weather" and "block" or "none", city_val,
    preset == "custom" and "block" or "none", url_val, key_val,
    preset)

  return nous.json_encode({
    html = html,
    styles = "",
    height = 280
  })
end

-- Handle block actions
function handle_block_action(input_json)
  local input = nous.json_decode(input_json)
  return nous.json_encode({ handled = true, action = input.type or "unknown" })
end
