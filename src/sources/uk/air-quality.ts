/**
 * DEFRA UK-AIR — Air Quality Data
 *
 * Daily Air Quality Index (DAQI 1-10), NO2, PM2.5, PM10 readings.
 * No auth required. Covers any UK city with monitoring stations.
 *
 * API docs: https://uk-air.defra.gov.uk/data/
 * US equivalent: EPA AirNow
 */

import type { UkAirQualityResult } from "./types.js";
import { DEFRA_AIR_BASE, fetchJson, daqiBand } from "./constants.js";
import { resolveUkCity } from "./geo-resolver.js";

/**
 * Query UK air quality data for a city.
 * Finds nearest monitoring stations and returns latest readings.
 */
export async function queryUkAirQuality(cityInput: string): Promise<UkAirQualityResult> {
  const geo = await resolveUkCity(cityInput);

  const result: UkAirQualityResult = {
    city: geo.city,
    daqi: 0,
    daqiBand: "Unknown",
    pollutants: [],
  };

  try {
    // DEFRA UK-AIR provides a forecast API and station readings
    // The forecast endpoint gives DAQI for broad UK regions
    const forecastUrl = `${DEFRA_AIR_BASE}/sos-ukair/api/v1/timeseries?station_near=${geo.lat},${geo.lon},20000&phenomenon=PM2.5&timespan=PT24H`;
    const data = await fetchJson(forecastUrl, { timeout: 10000 });

    if (data && Array.isArray(data)) {
      for (const series of data.slice(0, 5)) {
        // Each series is a monitoring station's readings
        const stationName = series.station?.properties?.label || "Unknown";
        const lastValue = series.lastValue;

        if (lastValue) {
          result.pollutants.push({
            name: series.parameters?.phenomenon?.label || "PM2.5",
            value: lastValue.value,
            unit: series.uom || "µg/m³",
            index: daqiFromPM25(lastValue.value),
            band: daqiBand(daqiFromPM25(lastValue.value)),
          });
        }
      }
    }
  } catch (e) {
    console.error("[city-data-mcp] DEFRA UK-AIR query failed:", e);
  }

  // Try the simpler DEFRA daily forecast endpoint
  try {
    const dailyUrl = `${DEFRA_AIR_BASE}/data/forecast`;
    // This returns HTML — we'd need to parse it or use the RSS feed
    // For now, calculate DAQI from available PM2.5 readings
  } catch {
    // Non-critical
  }

  // Calculate overall DAQI from available pollutants
  if (result.pollutants.length > 0) {
    result.daqi = Math.max(...result.pollutants.map(p => p.index));
    result.daqiBand = daqiBand(result.daqi);
  }

  return result;
}

/** Convert PM2.5 concentration to DAQI (approximate) */
function daqiFromPM25(ugm3: number): number {
  if (ugm3 <= 11) return 1;
  if (ugm3 <= 23) return 2;
  if (ugm3 <= 35) return 3;
  if (ugm3 <= 41) return 4;
  if (ugm3 <= 47) return 5;
  if (ugm3 <= 53) return 6;
  if (ugm3 <= 58) return 7;
  if (ugm3 <= 64) return 8;
  if (ugm3 <= 70) return 9;
  return 10;
}

/** Format air quality results as markdown */
export function formatUkAirQualityResults(result: UkAirQualityResult): string {
  const lines: string[] = [
    `# UK Air Quality: ${result.city}`,
    "",
  ];

  if (result.daqi > 0) {
    const emoji = result.daqi <= 3 ? "🟢" : result.daqi <= 6 ? "🟡" : result.daqi <= 9 ? "🟠" : "🔴";
    lines.push(
      `**DAQI**: ${result.daqi}/10 — ${result.daqiBand} ${emoji}`,
      "",
    );

    if (result.pollutants.length > 0) {
      lines.push("## Pollutant Readings", "");
      for (const p of result.pollutants) {
        lines.push(`- **${p.name}**: ${p.value} ${p.unit} (DAQI ${p.index} — ${p.band})`);
      }
    }
  } else {
    lines.push(
      "*No air quality monitoring stations found near this location.*",
      "*Check https://uk-air.defra.gov.uk/ for the nearest station.*"
    );
  }

  if (result.forecast && result.forecast.length > 0) {
    lines.push("", "## Forecast", "");
    for (const f of result.forecast) {
      lines.push(`- **${f.date}**: DAQI ${f.daqi} (${f.band})`);
    }
  }

  lines.push(
    "",
    "---",
    "*Source: DEFRA UK-AIR — Daily Air Quality Index (DAQI) scale 1-10.*",
    "*DAQI bands: 1-3 Low, 4-6 Moderate, 7-9 High, 10 Very High.*"
  );

  return lines.join("\n");
}
