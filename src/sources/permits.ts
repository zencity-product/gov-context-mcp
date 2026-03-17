/**
 * Census Bureau Building Permits Survey (BPS) Client
 *
 * Fetches annual building permit data at the county level using the
 * Census BPS timeseries API. Provides 5-year trend data (2020–2024)
 * for ~50 major US cities.
 *
 * API docs: https://www.census.gov/data/developers/data-sets/building-permits.html
 * API key: Same CENSUS_API_KEY used for demographics.
 */

import { resolveCity as geoResolve } from "./geo-resolver.js";

const BPS_BASE = "https://api.census.gov/data/timeseries/bps";
const TREND_YEARS = [2020, 2021, 2022, 2023, 2024];

// City → county FIPS mapping (BPS county-level data is more reliable than place-level)
interface CityFips {
  name: string;
  stateFips: string;
  countyFips: string;
}

const CITY_FIPS: Record<string, CityFips> = {
  "new york":       { name: "New York City",    stateFips: "36", countyFips: "061" },
  "los angeles":    { name: "Los Angeles",      stateFips: "06", countyFips: "037" },
  "chicago":        { name: "Chicago",          stateFips: "17", countyFips: "031" },
  "houston":        { name: "Houston",          stateFips: "48", countyFips: "201" },
  "phoenix":        { name: "Phoenix",          stateFips: "04", countyFips: "013" },
  "philadelphia":   { name: "Philadelphia",     stateFips: "42", countyFips: "101" },
  "san antonio":    { name: "San Antonio",      stateFips: "48", countyFips: "029" },
  "san diego":      { name: "San Diego",        stateFips: "06", countyFips: "073" },
  "dallas":         { name: "Dallas",           stateFips: "48", countyFips: "113" },
  "austin":         { name: "Austin",           stateFips: "48", countyFips: "453" },
  "san jose":       { name: "San Jose",         stateFips: "06", countyFips: "085" },
  "jacksonville":   { name: "Jacksonville",     stateFips: "12", countyFips: "031" },
  "columbus":       { name: "Columbus",         stateFips: "39", countyFips: "049" },
  "indianapolis":   { name: "Indianapolis",     stateFips: "18", countyFips: "097" },
  "san francisco":  { name: "San Francisco",    stateFips: "06", countyFips: "075" },
  "seattle":        { name: "Seattle",          stateFips: "53", countyFips: "033" },
  "denver":         { name: "Denver",           stateFips: "08", countyFips: "031" },
  "nashville":      { name: "Nashville",        stateFips: "47", countyFips: "037" },
  "portland":       { name: "Portland",         stateFips: "41", countyFips: "051" },
  "las vegas":      { name: "Las Vegas",        stateFips: "32", countyFips: "003" },
  "memphis":        { name: "Memphis",          stateFips: "47", countyFips: "157" },
  "louisville":     { name: "Louisville",       stateFips: "21", countyFips: "111" },
  "baltimore":      { name: "Baltimore",        stateFips: "24", countyFips: "510" },
  "milwaukee":      { name: "Milwaukee",        stateFips: "55", countyFips: "079" },
  "albuquerque":    { name: "Albuquerque",      stateFips: "35", countyFips: "001" },
  "tucson":         { name: "Tucson",           stateFips: "04", countyFips: "019" },
  "fresno":         { name: "Fresno",           stateFips: "06", countyFips: "019" },
  "sacramento":     { name: "Sacramento",       stateFips: "06", countyFips: "067" },
  "kansas city":    { name: "Kansas City",      stateFips: "29", countyFips: "095" },
  "atlanta":        { name: "Atlanta",          stateFips: "13", countyFips: "121" },
  "omaha":          { name: "Omaha",            stateFips: "31", countyFips: "055" },
  "raleigh":        { name: "Raleigh",          stateFips: "37", countyFips: "183" },
  "miami":          { name: "Miami",            stateFips: "12", countyFips: "086" },
  "minneapolis":    { name: "Minneapolis",      stateFips: "27", countyFips: "053" },
  "tampa":          { name: "Tampa",            stateFips: "12", countyFips: "057" },
  "new orleans":    { name: "New Orleans",      stateFips: "22", countyFips: "071" },
  "cleveland":      { name: "Cleveland",        stateFips: "39", countyFips: "035" },
  "pittsburgh":     { name: "Pittsburgh",       stateFips: "42", countyFips: "003" },
  "st. louis":      { name: "St. Louis",        stateFips: "29", countyFips: "510" },
  "cincinnati":     { name: "Cincinnati",       stateFips: "39", countyFips: "061" },
  "orlando":        { name: "Orlando",          stateFips: "12", countyFips: "095" },
  "salt lake city": { name: "Salt Lake City",   stateFips: "49", countyFips: "035" },
  "richmond":       { name: "Richmond",         stateFips: "51", countyFips: "760" },
  "birmingham":     { name: "Birmingham",       stateFips: "01", countyFips: "073" },
  "buffalo":        { name: "Buffalo",          stateFips: "36", countyFips: "029" },
  "charlotte":      { name: "Charlotte",        stateFips: "37", countyFips: "119" },
  "boise":          { name: "Boise",            stateFips: "16", countyFips: "001" },
  "oklahoma city":  { name: "Oklahoma City",    stateFips: "40", countyFips: "109" },
  "boston":          { name: "Boston",           stateFips: "25", countyFips: "025" },
  "washington":     { name: "Washington, D.C.", stateFips: "11", countyFips: "001" },
  "detroit":        { name: "Detroit",          stateFips: "26", countyFips: "163" },
  "virginia beach": { name: "Virginia Beach",   stateFips: "51", countyFips: "810" },
};

// Common aliases
const ALIASES: Record<string, string> = {
  "nyc":            "new york",
  "new york city":  "new york",
  "manhattan":      "new york",
  "la":             "los angeles",
  "l.a.":           "los angeles",
  "sf":             "san francisco",
  "san fran":       "san francisco",
  "dc":             "washington",
  "washington dc":  "washington",
  "washington d.c.":"washington",
  "d.c.":           "washington",
  "philly":         "philadelphia",
  "vegas":          "las vegas",
  "nola":           "new orleans",
  "slc":            "salt lake city",
  "okc":            "oklahoma city",
  "indy":           "indianapolis",
  "jax":            "jacksonville",
  "stl":            "st. louis",
  "saint louis":    "st. louis",
  "st louis":       "st. louis",
  "kc":             "kansas city",
  "mpls":           "minneapolis",
  "abq":            "albuquerque",
  "va beach":       "virginia beach",
};

export interface PermitResult {
  city: string;
  county: string;
  annualData: Array<{
    year: number;
    permits: number | null;
    units: number | null;
  }>;
  latestYear: number | null;
  latestPermits: number | null;
  latestUnits: number | null;
  trend: "growing" | "declining" | "stable" | "unknown";
  changePercent: number | null;
}

/**
 * Resolve a city name (or alias) to its FIPS entry.
 * Falls back to the shared geo-resolver for cities not in the hardcoded map.
 */
async function resolveCity(input: string): Promise<{ key: string; fips: CityFips } | null> {
  const normalized = input.toLowerCase().trim();
  const key = ALIASES[normalized] ?? normalized;
  const fips = CITY_FIPS[key];
  if (fips) return { key, fips };

  // Fallback: try the shared geo-resolver
  try {
    const geo = await geoResolve(input);
    return {
      key: geo.city.toLowerCase().replace(/\s+/g, "_"),
      fips: {
        name: geo.city,
        stateFips: geo.stateFips,
        countyFips: geo.countyFips,
      },
    };
  } catch {
    // geo-resolver failed
    return null;
  }
}

/**
 * Fetch building permit data for a single year from the BPS timeseries API.
 * Returns null if the request fails or returns no data (the API may not have
 * data for every county/year combination).
 */
async function fetchYearData(
  stateFips: string,
  countyFips: string,
  year: number,
  apiKey: string,
): Promise<{ permits: number | null; units: number | null } | null> {
  const url =
    `${BPS_BASE}?get=PERMITS,UNITS&for=county:${countyFips}&in=state:${stateFips}&time=${year}&key=${apiKey}`;

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      console.error(`[city-data-mcp] BPS API ${response.status} for state=${stateFips} county=${countyFips} year=${year}`);
      return null;
    }

    const data = (await response.json()) as string[][];
    if (!data || data.length < 2) return null;

    const headers = data[0];
    const values = data[1];

    const permitsIdx = headers.indexOf("PERMITS");
    const unitsIdx = headers.indexOf("UNITS");

    const permits = permitsIdx >= 0 ? parseIntSafe(values[permitsIdx]) : null;
    const units = unitsIdx >= 0 ? parseIntSafe(values[unitsIdx]) : null;

    return { permits, units };
  } catch (err) {
    console.error(`[city-data-mcp] BPS fetch error for year=${year}:`, (err as Error).message);
    return null;
  }
}

/**
 * Query building permits for a city (county-level data from Census BPS).
 * Fetches 5-year trend data (2020–2024).
 */
export async function queryPermits(city: string): Promise<PermitResult> {
  const apiKey = process.env.CENSUS_API_KEY;
  if (!apiKey) {
    throw new Error("CENSUS_API_KEY not set.");
  }

  const resolved = await resolveCity(city);
  if (!resolved) {
    const available = Object.values(CITY_FIPS)
      .map((f) => f.name)
      .sort()
      .join(", ");
    throw new Error(
      `City "${city}" not found in building permits data. Available cities: ${available}`,
    );
  }

  const { fips } = resolved;

  console.error(`[city-data-mcp] BPS query: ${fips.name} (state=${fips.stateFips}, county=${fips.countyFips})`);

  // Fetch all years in parallel
  const yearResults = await Promise.all(
    TREND_YEARS.map(async (year) => {
      const result = await fetchYearData(fips.stateFips, fips.countyFips, year, apiKey);
      return {
        year,
        permits: result?.permits ?? null,
        units: result?.units ?? null,
      };
    }),
  );

  // Determine latest year with data
  const withData = yearResults.filter((r) => r.permits !== null);
  const latest = withData.length > 0 ? withData[withData.length - 1] : null;

  // Calculate trend from the two most recent years with data
  let trend: PermitResult["trend"] = "unknown";
  let changePercent: number | null = null;

  if (withData.length >= 2) {
    const recent = withData[withData.length - 1];
    const previous = withData[withData.length - 2];
    if (recent.permits !== null && previous.permits !== null && previous.permits > 0) {
      changePercent = ((recent.permits - previous.permits) / previous.permits) * 100;
      if (changePercent > 5) {
        trend = "growing";
      } else if (changePercent < -5) {
        trend = "declining";
      } else {
        trend = "stable";
      }
    }
  }

  return {
    city: fips.name,
    county: `${fips.stateFips}-${fips.countyFips}`,
    annualData: yearResults,
    latestYear: latest?.year ?? null,
    latestPermits: latest?.permits ?? null,
    latestUnits: latest?.units ?? null,
    trend,
    changePercent: changePercent !== null ? Math.round(changePercent * 10) / 10 : null,
  };
}

/**
 * Format permit results into readable text.
 */
export function formatPermitResults(result: PermitResult): string {
  const trendEmoji =
    result.trend === "growing" ? "📈" :
    result.trend === "declining" ? "📉" :
    result.trend === "stable" ? "➡️" : "❓";

  const trendLabel =
    result.changePercent !== null
      ? `${result.trend} (${result.changePercent > 0 ? "+" : ""}${result.changePercent}% YoY)`
      : result.trend;

  const latestLine =
    result.latestYear !== null
      ? `  - Latest (${result.latestYear}): ${fmt(result.latestPermits)} permits, ${fmt(result.latestUnits)} housing units authorized`
      : "  - No recent data available";

  const yearLines = result.annualData
    .map((d) => {
      if (d.permits === null && d.units === null) {
        return `  - ${d.year}: No data`;
      }
      return `  - ${d.year}: ${fmt(d.permits)} permits, ${fmt(d.units)} units`;
    })
    .join("\n");

  return `**${result.city}** — Building Permits (Census BPS, County-Level)

**Summary**
${latestLine}
  - Trend: ${trendEmoji} ${trendLabel}

**Annual Data (${TREND_YEARS[0]}–${TREND_YEARS[TREND_YEARS.length - 1]})**
${yearLines}

_Note: Data is at the county level and may include areas beyond city limits._`;
}

/**
 * List all supported cities for building permit queries.
 */
export function listPermitCities(): Array<{ key: string; name: string }> {
  return Object.entries(CITY_FIPS)
    .map(([key, fips]) => ({ key, name: fips.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// --- Helpers ---

function parseIntSafe(value: string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = parseInt(value, 10);
  return isNaN(n) || n < 0 ? null : n;
}

function fmt(n: number | null): string {
  if (n === null) return "N/A";
  return n.toLocaleString();
}
