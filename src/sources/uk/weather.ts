/**
 * Met Office DataPoint — UK Weather
 *
 * Current conditions, 5-day forecast, severe weather warnings.
 * Requires free API key from metoffice.gov.uk.
 *
 * API docs: https://www.metoffice.gov.uk/services/data/datapoint
 * US equivalent: NWS
 */

import type { UkWeatherResult } from "./types.js";
import { MET_OFFICE_BASE, MET_OFFICE_WEATHER_TYPES, fetchJson } from "./constants.js";
import { resolveUkCity } from "./geo-resolver.js";

const API_KEY = () => process.env.UK_MET_OFFICE_API_KEY || "";

/**
 * Query UK weather for a city via Met Office DataPoint.
 * Returns current observations and 5-day forecast.
 */
export async function queryUkWeather(cityInput: string): Promise<UkWeatherResult> {
  const key = API_KEY();
  if (!key) {
    throw new Error(
      "UK_MET_OFFICE_API_KEY environment variable is required. " +
      "Register free at https://www.metoffice.gov.uk/services/data/datapoint"
    );
  }

  const geo = await resolveUkCity(cityInput);

  const result: UkWeatherResult = {
    city: geo.city,
    forecast: [],
  };

  // Find nearest forecast site
  const siteListUrl = `${MET_OFFICE_BASE}/val/wxfcs/all/json/sitelist?key=${key}`;
  const siteData = await fetchJson(siteListUrl, { timeout: 8000 });
  const sites: any[] = siteData?.Locations?.Location || [];

  // Find closest site by distance
  const closest = findClosestSite(sites, geo.lat, geo.lon);
  if (!closest) {
    return result;
  }

  // Get 5-day forecast for the site
  try {
    const forecastUrl = `${MET_OFFICE_BASE}/val/wxfcs/all/json/${closest.id}?res=daily&key=${key}`;
    const forecastData = await fetchJson(forecastUrl, { timeout: 8000 });
    const periods: any[] = forecastData?.SiteRep?.DV?.Location?.Period || [];

    for (const period of periods.slice(0, 5)) {
      const reps: any[] = Array.isArray(period.Rep) ? period.Rep : [period.Rep];
      const dayRep = reps.find((r: any) => r.$ === "Day") || reps[0] || {};
      const nightRep = reps.find((r: any) => r.$ === "Night") || reps[1] || {};

      result.forecast.push({
        date: period.value || "",
        dayMaxTemp: parseFloat(dayRep.Dm || dayRep.FDm || "0"),
        nightMinTemp: parseFloat(nightRep.Nm || nightRep.FNm || "0"),
        weatherType: MET_OFFICE_WEATHER_TYPES[parseInt(dayRep.W || "7")] || "Cloudy",
        precipitation: parseFloat(dayRep.PPd || "0"),
        windSpeed: parseFloat(dayRep.S || "0"),
      });
    }
  } catch (e) {
    console.error("[city-data-mcp] Met Office forecast failed:", e);
  }

  // Get current observations
  try {
    const obsUrl = `${MET_OFFICE_BASE}/val/wxobs/all/json/${closest.id}?res=hourly&key=${key}`;
    const obsData = await fetchJson(obsUrl, { timeout: 8000 });
    const periods: any[] = obsData?.SiteRep?.DV?.Location?.Period || [];
    const lastPeriod = periods[periods.length - 1];
    const reps: any[] = Array.isArray(lastPeriod?.Rep) ? lastPeriod.Rep : [lastPeriod?.Rep].filter(Boolean);
    const latest = reps[reps.length - 1];

    if (latest) {
      result.current = {
        temperature: parseFloat(latest.T || "0"),
        weatherType: MET_OFFICE_WEATHER_TYPES[parseInt(latest.W || "7")] || "Cloudy",
        humidity: parseFloat(latest.H || "0"),
        windSpeed: parseFloat(latest.S || "0"),
        windDirection: latest.D || "N/A",
        visibility: latest.V || "N/A",
        pressure: parseFloat(latest.P || "0"),
      };
    }
  } catch (e) {
    console.error("[city-data-mcp] Met Office observations failed:", e);
  }

  return result;
}

function findClosestSite(sites: any[], lat: number, lon: number): { id: string; name: string } | null {
  let closest: any = null;
  let minDist = Infinity;

  for (const site of sites) {
    const sLat = parseFloat(site.latitude || "0");
    const sLon = parseFloat(site.longitude || "0");
    const dist = Math.sqrt(Math.pow(sLat - lat, 2) + Math.pow(sLon - lon, 2));
    if (dist < minDist) {
      minDist = dist;
      closest = site;
    }
  }

  return closest ? { id: closest.id, name: closest.name } : null;
}

/** Format weather results as markdown */
export function formatUkWeatherResults(result: UkWeatherResult): string {
  const lines: string[] = [
    `# UK Weather: ${result.city}`,
    "",
  ];

  if (result.current) {
    const c = result.current;
    lines.push(
      "## Current Conditions",
      "",
      `- **Temperature**: ${c.temperature}°C`,
      `- **Weather**: ${c.weatherType}`,
      `- **Humidity**: ${c.humidity}%`,
      `- **Wind**: ${c.windSpeed} mph ${c.windDirection}`,
      `- **Pressure**: ${c.pressure} hPa`,
      `- **Visibility**: ${c.visibility}`,
      "",
    );
  }

  if (result.forecast.length > 0) {
    lines.push("## 5-Day Forecast", "");
    for (const f of result.forecast) {
      lines.push(
        `### ${f.date}`,
        `- ${f.weatherType}, ${f.dayMaxTemp}°C / ${f.nightMinTemp}°C`,
        `- Precipitation: ${f.precipitation}%, Wind: ${f.windSpeed} mph`,
        "",
      );
    }
  }

  lines.push(
    "---",
    "*Source: Met Office DataPoint.*"
  );

  return lines.join("\n");
}
