/**
 * Environment Agency Flood Monitoring API
 *
 * Real-time river levels, flow rates, flood warnings.
 * No auth required. Covers England (~3,000+ monitoring stations).
 *
 * API docs: https://environment.data.gov.uk/flood-monitoring/doc/reference
 * US equivalent: USGS Water
 */

import type { UkFloodWaterResult } from "./types.js";
import { EA_FLOOD_BASE, fetchJson } from "./constants.js";
import { resolveUkCity } from "./geo-resolver.js";

/**
 * Query flood monitoring data near a UK city.
 * Finds stations within ~10km and returns latest readings + any active warnings.
 */
export async function queryUkFloodWater(cityInput: string): Promise<UkFloodWaterResult> {
  const geo = await resolveUkCity(cityInput);

  // Find monitoring stations near city centre (within ~10km)
  const stationsUrl = `${EA_FLOOD_BASE}/id/stations?lat=${geo.lat}&long=${geo.lon}&dist=10&_limit=20`;
  const stationsData = await fetchJson(stationsUrl, { timeout: 10000 });
  const stationItems: any[] = stationsData?.items || [];

  // Get latest readings for each station
  const stations: UkFloodWaterResult["stations"] = [];
  for (const station of stationItems.slice(0, 8)) {
    try {
      const readingUrl = `${station["@id"]}/readings?_sorted&_limit=1`;
      const readingData = await fetchJson(readingUrl, { timeout: 5000 });
      const reading = readingData?.items?.[0];

      if (reading) {
        const measure = station.measures?.[0] || {};
        stations.push({
          name: station.label || "Unknown",
          river: station.riverName || "Unknown",
          parameter: measure.parameterName || measure.parameter || "Level",
          value: reading.value,
          unit: measure.unitName || "m",
          dateTime: reading.dateTime || "",
          typicalHigh: station.stageScale?.typicalRangeHigh,
          typicalLow: station.stageScale?.typicalRangeLow,
        });
      }
    } catch {
      // Skip stations with failed readings
    }
  }

  // Get flood warnings for the area
  const warningsUrl = `${EA_FLOOD_BASE}/id/floods?lat=${geo.lat}&long=${geo.lon}&dist=20`;
  const warningsData = await fetchJson(warningsUrl, { timeout: 8000 });
  const warningItems: any[] = warningsData?.items || [];

  const floodWarnings = warningItems.map((w: any) => ({
    severity: w.severityLevel?.toString() || "Unknown",
    description: w.description || "",
    area: w.floodArea?.label || w.eaAreaName || "",
    timeRaised: w.timeRaised || "",
  }));

  return {
    city: geo.city,
    stations,
    floodWarnings,
  };
}

/** Format flood/water results as markdown */
export function formatUkFloodWaterResults(result: UkFloodWaterResult): string {
  const lines: string[] = [
    `# UK Flood & Water Monitoring: ${result.city}`,
    "",
  ];

  if (result.floodWarnings.length > 0) {
    lines.push("## Active Flood Warnings", "");
    for (const w of result.floodWarnings) {
      lines.push(`- **${w.severity}**: ${w.area}`);
      if (w.description) lines.push(`  ${w.description}`);
      if (w.timeRaised) lines.push(`  Raised: ${new Date(w.timeRaised).toLocaleString("en-GB")}`);
    }
    lines.push("");
  } else {
    lines.push("*No active flood warnings in this area.*", "");
  }

  if (result.stations.length > 0) {
    lines.push("## Monitoring Stations (nearest)", "");
    for (const s of result.stations) {
      const range = s.typicalHigh && s.typicalLow
        ? ` (typical range: ${s.typicalLow}–${s.typicalHigh} ${s.unit})`
        : "";
      const time = s.dateTime ? ` at ${new Date(s.dateTime).toLocaleString("en-GB")}` : "";
      lines.push(`- **${s.name}** (${s.river}): ${s.value} ${s.unit}${range}${time}`);
    }
  } else {
    lines.push("*No monitoring stations found within 10km.*");
  }

  lines.push(
    "",
    "---",
    "*Source: Environment Agency Flood Monitoring API — covers England only.*"
  );

  return lines.join("\n");
}
