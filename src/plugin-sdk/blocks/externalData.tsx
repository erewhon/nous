/**
 * External data block — live external data as a contributed block.
 *
 * Replaces the Lua external_data_embed plugin's iframe render. Two presets:
 * "weather" (Open-Meteo, CORS-enabled) and "custom" (any JSON endpoint with
 * an optional dot-notation display key). Fetches happen from the frontend,
 * so custom endpoints must allow cross-origin requests — the error message
 * says so when a fetch fails. Data lives in string props (Editor.js
 * `data.{preset,city,customUrl,displayKey}` on disk; the migration from the
 * old plugin block maps the Lua snake_case fields).
 *
 * Inline styles only (plugin-sdk convention — no Tailwind dependency).
 */
import { useCallback, useEffect, useState } from "react";
import type * as React from "react";
import type {
  CustomBlockContribution,
  CustomBlockRenderProps,
} from "../custom-block";

interface WeatherResult {
  place: string;
  temperature: string;
  condition: string;
  humidity: string;
  wind: string;
}

const WEATHER_CONDITIONS: Array<[number, string]> = [
  [0, "Clear"],
  [3, "Cloudy"],
  [48, "Foggy"],
  [55, "Drizzle"],
  [57, "Freezing Drizzle"],
  [65, "Rain"],
  [67, "Freezing Rain"],
  [75, "Snow"],
  [77, "Snow Grains"],
  [82, "Rain Showers"],
  [86, "Snow Showers"],
  [95, "Thunderstorm"],
  [99, "Thunderstorm + Hail"],
];

function weatherCondition(code: number | undefined): string {
  if (code == null) return "Unknown";
  for (const [max, label] of WEATHER_CONDITIONS) {
    if (code <= max) return label;
  }
  return "Unknown";
}

async function fetchWeather(city: string): Promise<WeatherResult> {
  const geoRes = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`,
  );
  if (!geoRes.ok) throw new Error(`Geocoding failed (HTTP ${geoRes.status})`);
  const geo = (await geoRes.json()) as {
    results?: Array<{ latitude: number; longitude: number; name: string; country?: string }>;
  };
  const hit = geo.results?.[0];
  if (!hit) throw new Error(`Could not find city: ${city}`);

  const wxRes = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${hit.latitude}&longitude=${hit.longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&temperature_unit=fahrenheit&wind_speed_unit=mph`,
  );
  if (!wxRes.ok) throw new Error(`Weather fetch failed (HTTP ${wxRes.status})`);
  const wx = (await wxRes.json()) as {
    current?: {
      temperature_2m?: number;
      relative_humidity_2m?: number;
      wind_speed_10m?: number;
      weather_code?: number;
    };
  };
  if (!wx.current) throw new Error("No weather data returned");
  return {
    place: `${hit.name}${hit.country ? `, ${hit.country}` : ""}`,
    temperature: `${wx.current.temperature_2m ?? "?"}°F`,
    condition: weatherCondition(wx.current.weather_code),
    humidity: `${wx.current.relative_humidity_2m ?? "?"}%`,
    wind: `${wx.current.wind_speed_10m ?? "?"} mph`,
  };
}

/** Navigate a nested value by dot-separated key ("data.items.0.name"). */
export function deepGet(value: unknown, key: string): unknown {
  if (!key) return value;
  let current: unknown = value;
  for (const part of key.split(".")) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

async function fetchCustom(url: string, displayKey: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text;
  }
  const value = displayKey ? deepGet(parsed, displayKey) : parsed;
  if (value === undefined) throw new Error(`Key not found: ${displayKey}`);
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

const mutedStyle: React.CSSProperties = {
  fontSize: "0.8em",
  color: "var(--color-text-muted, #888)",
};

function ExternalDataRender({ props, updateProps, readOnly }: CustomBlockRenderProps) {
  const preset = props.preset || "weather";
  const city = props.city || "San Francisco";
  const customUrl = props.customUrl || "";
  const displayKey = props.displayKey || "";

  const [weather, setWeather] = useState<WeatherResult | null>(null);
  const [customValue, setCustomValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // Bump to refetch on demand.
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setLoading(true);

    const run = async () => {
      if (preset === "weather") {
        const result = await fetchWeather(city);
        if (!cancelled) setWeather(result);
      } else {
        if (!customUrl) throw new Error("No URL configured — open Settings.");
        const value = await fetchCustom(customUrl, displayKey);
        if (!cancelled) setCustomValue(value);
      }
    };

    run()
      .catch((e: unknown) => {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : String(e);
          // Browser-side fetches need CORS; say so instead of a bare
          // "Failed to fetch".
          setError(
            msg === "Failed to fetch"
              ? "Fetch failed — the endpoint may not allow cross-origin requests"
              : msg,
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [preset, city, customUrl, displayKey, refreshTick]);

  const commitSettings = useCallback(
    (patch: Record<string, string>) => updateProps(patch),
    [updateProps],
  );

  return (
    <div
      contentEditable={false}
      style={{
        border: "1px solid var(--color-border, #8884)",
        borderRadius: "8px",
        padding: "12px 16px",
        width: "100%",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "8px",
        }}
      >
        <span style={{ ...mutedStyle, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          External Data
        </span>
        <span style={{ display: "flex", gap: "8px" }}>
          <button style={mutedStyle} onClick={() => setRefreshTick((t) => t + 1)}>
            {loading ? "Loading…" : "Refresh"}
          </button>
          {!readOnly && (
            <button style={mutedStyle} onClick={() => setShowSettings((s) => !s)}>
              Settings
            </button>
          )}
        </span>
      </div>

      {error ? (
        <div style={{ color: "#d9534f", fontSize: "0.85em" }}>{error}</div>
      ) : preset === "weather" && weather ? (
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div style={{ fontSize: "1.8em", fontWeight: 700 }}>{weather.temperature}</div>
          <div style={{ fontSize: "0.85em", lineHeight: 1.6 }}>
            <div style={{ fontWeight: 600 }}>{weather.place}</div>
            <div>{weather.condition}</div>
            <div style={mutedStyle}>
              Humidity: {weather.humidity} · Wind: {weather.wind}
            </div>
          </div>
        </div>
      ) : preset === "custom" && customValue != null ? (
        <pre
          style={{
            margin: 0,
            whiteSpace: "pre-wrap",
            fontSize: "0.85em",
            fontFamily: customValue.startsWith("{") ? "monospace" : "inherit",
          }}
        >
          {customValue}
        </pre>
      ) : (
        <div style={mutedStyle}>{loading ? "Loading…" : "No data"}</div>
      )}

      {showSettings && !readOnly && (
        <div
          style={{
            marginTop: "10px",
            paddingTop: "10px",
            borderTop: "1px solid var(--color-border, #8884)",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            fontSize: "0.85em",
          }}
        >
          <label>
            Preset{" "}
            <select
              value={preset}
              onChange={(e) => commitSettings({ preset: e.target.value })}
            >
              <option value="weather">Weather</option>
              <option value="custom">Custom URL</option>
            </select>
          </label>
          {preset === "weather" ? (
            <label>
              City{" "}
              <input
                type="text"
                defaultValue={city}
                onBlur={(e) => commitSettings({ city: e.target.value })}
              />
            </label>
          ) : (
            <>
              <label>
                URL{" "}
                <input
                  type="text"
                  size={40}
                  placeholder="https://api.example.com/data"
                  defaultValue={customUrl}
                  onBlur={(e) => commitSettings({ customUrl: e.target.value })}
                />
              </label>
              <label>
                Display key{" "}
                <input
                  type="text"
                  placeholder="data.value"
                  defaultValue={displayKey}
                  onBlur={(e) => commitSettings({ displayKey: e.target.value })}
                />
              </label>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export const externalDataBlock: CustomBlockContribution = {
  id: "externalData",
  title: "External Data",
  group: "Custom",
  keywords: ["external", "data", "weather", "api", "embed"],
  propSchema: {
    preset: { default: "weather" },
    city: { default: "San Francisco" },
    customUrl: { default: "" },
    displayKey: { default: "" },
  },
  content: "none",
  Render: ExternalDataRender,
};
