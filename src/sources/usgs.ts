/**
 * USGS Water Services API Client
 *
 * Real-time water data from 1.5M+ monitoring sites across the US.
 * Provides streamflow, water levels, water temperature, and more.
 *
 * No API key needed. Data updates every 15 minutes for many sites.
 *
 * How it works:
 * 1. Search for monitoring sites near a city (by state + county or by bounding box)
 * 2. Fetch recent values for those sites
 *
 * Parameter codes:
 * - 00060 = Streamflow (discharge, cubic feet per second)
 * - 00065 = Gage height (feet)
 * - 00010 = Water temperature (°C)
 *
 * Docs: https://waterservices.usgs.gov/
 */

import { resolveCity as geoResolve } from "./geo-resolver.js";

const BASE_URL = "https://waterservices.usgs.gov/nwis/iv";

// State codes for city lookups
const CITY_STATES: Record<string, { stateCode: string; name: string; lat: number; lon: number }> = {
  "new york": { stateCode: "ny", name: "New York City", lat: 40.7128, lon: -74.0060 },
  "nyc": { stateCode: "ny", name: "New York City", lat: 40.7128, lon: -74.0060 },
  "los angeles": { stateCode: "ca", name: "Los Angeles", lat: 34.0522, lon: -118.2437 },
  "la": { stateCode: "ca", name: "Los Angeles", lat: 34.0522, lon: -118.2437 },
  "chicago": { stateCode: "il", name: "Chicago", lat: 41.8781, lon: -87.6298 },
  "houston": { stateCode: "tx", name: "Houston", lat: 29.7604, lon: -95.3698 },
  "phoenix": { stateCode: "az", name: "Phoenix", lat: 33.4484, lon: -112.0740 },
  "denver": { stateCode: "co", name: "Denver", lat: 39.7392, lon: -104.9903 },
  "seattle": { stateCode: "wa", name: "Seattle", lat: 47.6062, lon: -122.3321 },
  "portland": { stateCode: "or", name: "Portland", lat: 45.5152, lon: -122.6784 },
  "austin": { stateCode: "tx", name: "Austin", lat: 30.2672, lon: -97.7431 },
  "san francisco": { stateCode: "ca", name: "San Francisco", lat: 37.7749, lon: -122.4194 },
  "sf": { stateCode: "ca", name: "San Francisco", lat: 37.7749, lon: -122.4194 },
  "boston": { stateCode: "ma", name: "Boston", lat: 42.3601, lon: -71.0589 },
  "miami": { stateCode: "fl", name: "Miami", lat: 25.7617, lon: -80.1918 },
  "atlanta": { stateCode: "ga", name: "Atlanta", lat: 33.7490, lon: -84.3880 },
  "nashville": { stateCode: "tn", name: "Nashville", lat: 36.1627, lon: -86.7816 },
  "minneapolis": { stateCode: "mn", name: "Minneapolis", lat: 44.9778, lon: -93.2650 },
  "detroit": { stateCode: "mi", name: "Detroit", lat: 42.3314, lon: -83.0458 },
  "washington": { stateCode: "dc", name: "Washington, D.C.", lat: 38.9072, lon: -77.0369 },
  "dc": { stateCode: "dc", name: "Washington, D.C.", lat: 38.9072, lon: -77.0369 },
  "pittsburgh": { stateCode: "pa", name: "Pittsburgh", lat: 40.4406, lon: -79.9959 },
  "charlotte": { stateCode: "nc", name: "Charlotte", lat: 35.2271, lon: -80.8431 },
  "baltimore": { stateCode: "md", name: "Baltimore", lat: 39.2904, lon: -76.6122 },
  "boise": { stateCode: "id", name: "Boise", lat: 43.6150, lon: -116.2023 },
  "salt lake city": { stateCode: "ut", name: "Salt Lake City", lat: 40.7608, lon: -111.8910 },
  "las vegas": { stateCode: "nv", name: "Las Vegas", lat: 36.1699, lon: -115.1398 },
  "vegas": { stateCode: "nv", name: "Las Vegas", lat: 36.1699, lon: -115.1398 },
  "tampa": { stateCode: "fl", name: "Tampa", lat: 27.9506, lon: -82.4572 },
  "orlando": { stateCode: "fl", name: "Orlando", lat: 28.5383, lon: -81.3792 },
  "raleigh": { stateCode: "nc", name: "Raleigh", lat: 35.7796, lon: -78.6382 },
  "dallas": { stateCode: "tx", name: "Dallas", lat: 32.7767, lon: -96.7970 },
  "philadelphia": { stateCode: "pa", name: "Philadelphia", lat: 39.9526, lon: -75.1652 },
  "philly": { stateCode: "pa", name: "Philadelphia", lat: 39.9526, lon: -75.1652 },

  // Additional cities
  "san antonio": { stateCode: "tx", name: "San Antonio", lat: 29.4241, lon: -98.4936 },
  "san diego": { stateCode: "ca", name: "San Diego", lat: 32.7157, lon: -117.1611 },
  "san jose": { stateCode: "ca", name: "San Jose", lat: 37.3382, lon: -121.8863 },
  "jacksonville": { stateCode: "fl", name: "Jacksonville", lat: 30.3322, lon: -81.6557 },
  "jax": { stateCode: "fl", name: "Jacksonville", lat: 30.3322, lon: -81.6557 },
  "columbus": { stateCode: "oh", name: "Columbus", lat: 39.9612, lon: -82.9988 },
  "indianapolis": { stateCode: "in", name: "Indianapolis", lat: 39.7684, lon: -86.1581 },
  "indy": { stateCode: "in", name: "Indianapolis", lat: 39.7684, lon: -86.1581 },
  "fort worth": { stateCode: "tx", name: "Fort Worth", lat: 32.7555, lon: -97.3308 },
  "oklahoma city": { stateCode: "ok", name: "Oklahoma City", lat: 35.4676, lon: -97.5164 },
  "okc": { stateCode: "ok", name: "Oklahoma City", lat: 35.4676, lon: -97.5164 },
  "memphis": { stateCode: "tn", name: "Memphis", lat: 35.1495, lon: -90.0490 },
  "louisville": { stateCode: "ky", name: "Louisville", lat: 38.2527, lon: -85.7585 },
  "milwaukee": { stateCode: "wi", name: "Milwaukee", lat: 43.0389, lon: -87.9065 },
  "mke": { stateCode: "wi", name: "Milwaukee", lat: 43.0389, lon: -87.9065 },
  "albuquerque": { stateCode: "nm", name: "Albuquerque", lat: 35.0844, lon: -106.6504 },
  "tucson": { stateCode: "az", name: "Tucson", lat: 32.2226, lon: -110.9747 },
  "fresno": { stateCode: "ca", name: "Fresno", lat: 36.7378, lon: -119.7871 },
  "sacramento": { stateCode: "ca", name: "Sacramento", lat: 38.5816, lon: -121.4944 },
  "kansas city": { stateCode: "mo", name: "Kansas City", lat: 39.0997, lon: -94.5786 },
  "kc": { stateCode: "mo", name: "Kansas City", lat: 39.0997, lon: -94.5786 },
  "omaha": { stateCode: "ne", name: "Omaha", lat: 41.2565, lon: -95.9345 },
  "cleveland": { stateCode: "oh", name: "Cleveland", lat: 41.4993, lon: -81.6944 },
  "cle": { stateCode: "oh", name: "Cleveland", lat: 41.4993, lon: -81.6944 },
  "new orleans": { stateCode: "la", name: "New Orleans", lat: 29.9511, lon: -90.0715 },
  "nola": { stateCode: "la", name: "New Orleans", lat: 29.9511, lon: -90.0715 },
  "st. louis": { stateCode: "mo", name: "St. Louis", lat: 38.6270, lon: -90.1994 },
  "st louis": { stateCode: "mo", name: "St. Louis", lat: 38.6270, lon: -90.1994 },
  "stl": { stateCode: "mo", name: "St. Louis", lat: 38.6270, lon: -90.1994 },
  "cincinnati": { stateCode: "oh", name: "Cincinnati", lat: 39.1031, lon: -84.5120 },
  "cincy": { stateCode: "oh", name: "Cincinnati", lat: 39.1031, lon: -84.5120 },
  "richmond": { stateCode: "va", name: "Richmond", lat: 37.5407, lon: -77.4360 },
  "hartford": { stateCode: "ct", name: "Hartford", lat: 41.7658, lon: -72.6734 },
  "buffalo": { stateCode: "ny", name: "Buffalo", lat: 42.8864, lon: -78.8784 },
  "buf": { stateCode: "ny", name: "Buffalo", lat: 42.8864, lon: -78.8784 },
  "rochester": { stateCode: "ny", name: "Rochester", lat: 43.1566, lon: -77.6088 },
  "providence": { stateCode: "ri", name: "Providence", lat: 41.8240, lon: -71.4128 },
  "virginia beach": { stateCode: "va", name: "Virginia Beach", lat: 36.8529, lon: -75.9780 },
  "birmingham": { stateCode: "al", name: "Birmingham", lat: 33.5186, lon: -86.8104 },

  // Additional aliases for existing cities
  "slc": { stateCode: "ut", name: "Salt Lake City", lat: 40.7608, lon: -111.8910 },
  "pgh": { stateCode: "pa", name: "Pittsburgh", lat: 40.4406, lon: -79.9959 },
};

export interface WaterSite {
  siteId: string;
  siteName: string;
  latitude: number;
  longitude: number;
  values: Array<{
    parameter: string;
    parameterName: string;
    value: number;
    unit: string;
    dateTime: string;
  }>;
}

export interface WaterResult {
  city: string;
  sites: WaterSite[];
  queryTime: string;
}

function resolveCity(city: string): { stateCode: string; name: string; lat: number; lon: number } | null {
  const normalized = city.toLowerCase().trim();
  return CITY_STATES[normalized] || null;
}

export function listWaterCities(): string[] {
  return [...new Set(Object.values(CITY_STATES).map(v => v.name))].sort();
}

const PARAM_NAMES: Record<string, string> = {
  "00060": "Streamflow",
  "00065": "Gage Height",
  "00010": "Water Temperature",
  "00045": "Precipitation",
};

/**
 * Fetch real-time water data for sites near a city.
 * Uses a bounding box around the city coordinates.
 */
export async function queryWater(city: string): Promise<WaterResult> {
  let match = resolveCity(city);

  // Fallback: try geo-resolver for any US city
  if (!match) {
    try {
      const geo = await geoResolve(city);
      match = { stateCode: geo.stateAbbrev.toLowerCase(), name: geo.city, lat: geo.lat, lon: geo.lon };
    } catch {
      // geo-resolver also failed
    }
  }

  if (!match) {
    throw new Error(`City "${city}" not found. Try a more specific city name (e.g., "Springfield, IL" instead of "Springfield").`);
  }

  // Create a bounding box ~25 miles around the city
  const delta = 0.35; // roughly 25 miles in degrees
  const bbox = `${(match.lon - delta).toFixed(4)},${(match.lat - delta).toFixed(4)},${(match.lon + delta).toFixed(4)},${(match.lat + delta).toFixed(4)}`;

  const params = new URLSearchParams({
    format: "json",
    bBox: bbox,
    parameterCd: "00060,00065,00010",
    siteStatus: "active",
    period: "PT2H", // Last 2 hours
  });

  const url = `${BASE_URL}?${params}`;
  console.error(`[city-data-mcp] USGS: ${url}`);

  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`USGS API error (${response.status}): ${errorText.slice(0, 200)}`);
  }

  const data = await response.json() as any;
  const timeSeries = data?.value?.timeSeries || [];

  // Group by site
  const siteMap = new Map<string, WaterSite>();

  for (const ts of timeSeries) {
    const siteCode = ts.sourceInfo?.siteCode?.[0]?.value || "unknown";
    const siteName = ts.sourceInfo?.siteName || "Unknown Site";
    const lat = parseFloat(ts.sourceInfo?.geoLocation?.geogLocation?.latitude || "0");
    const lon = parseFloat(ts.sourceInfo?.geoLocation?.geogLocation?.longitude || "0");
    const paramCode = ts.variable?.variableCode?.[0]?.value || "";
    const unit = ts.variable?.unit?.unitCode || "";

    if (!siteMap.has(siteCode)) {
      siteMap.set(siteCode, { siteId: siteCode, siteName, latitude: lat, longitude: lon, values: [] });
    }

    const latestValue = ts.values?.[0]?.value?.[0];
    if (latestValue && latestValue.value !== "-999999") {
      siteMap.get(siteCode)!.values.push({
        parameter: paramCode,
        parameterName: PARAM_NAMES[paramCode] || paramCode,
        value: parseFloat(latestValue.value),
        unit,
        dateTime: latestValue.dateTime || "",
      });
    }
  }

  // Sort sites by number of readings (most data first), take top 8
  const sites = [...siteMap.values()]
    .filter(s => s.values.length > 0)
    .sort((a, b) => b.values.length - a.values.length)
    .slice(0, 8);

  return {
    city: match.name,
    sites,
    queryTime: new Date().toISOString(),
  };
}

export function formatWaterResults(result: WaterResult): string {
  const lines: string[] = [`**${result.city}** — Real-Time Water Data (USGS)\n`];

  if (result.sites.length === 0) {
    lines.push("No active monitoring sites found near this city.");
    return lines.join("\n");
  }

  lines.push(`*${result.sites.length} monitoring sites within ~25 miles*\n`);

  for (const site of result.sites) {
    lines.push(`**${site.siteName}** (${site.siteId})`);
    for (const v of site.values) {
      const time = v.dateTime ? new Date(v.dateTime).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : "";
      let formatted: string;
      if (v.parameter === "00060") {
        formatted = `${v.value.toLocaleString()} cfs`;
      } else if (v.parameter === "00065") {
        formatted = `${v.value.toFixed(2)} ft`;
      } else if (v.parameter === "00010") {
        formatted = `${v.value.toFixed(1)}°C (${(v.value * 9/5 + 32).toFixed(1)}°F)`;
      } else {
        formatted = `${v.value} ${v.unit}`;
      }
      lines.push(`  - ${v.parameterName}: ${formatted} (${time})`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
