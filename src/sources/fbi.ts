/**
 * FBI Crime Data API Client (UCR — Uniform Crime Reporting)
 *
 * The FBI Crime Data Explorer provides national, state, and agency-level
 * crime statistics. Data comes from the UCR Program, which collects data
 * from ~18,000 law enforcement agencies.
 *
 * What's available:
 * - Offense counts by state (violent crime, property crime, subcategories)
 * - Offense counts by agency (ORI code — police departments)
 * - Arrest data
 * - Historical trends (back to 1979 for some series)
 *
 * Data resolution:
 * - For ~50 major US cities, we query AGENCY-level data using ORI codes
 *   (the agency's Originating Agency Identifier). This gives actual city
 *   police department data, not state-wide averages.
 * - If agency-level data is unavailable (ORI not found, API error, or no
 *   data returned), we fall back to state-level estimates.
 * - Cities without a known ORI always use state-level data.
 *
 * Limitations:
 * - Data lags 1-2 years (most recent is usually 2 years ago)
 * - Not all agencies report consistently
 * - Some ORI codes may be incorrect — fallback handles this gracefully
 *
 * API key: Free, register at https://api.data.gov/signup/
 * Same key works for all api.data.gov endpoints (FBI, Census, etc.)
 * Set as FBI_API_KEY environment variable — OR reuses CENSUS_API_KEY if
 * registered through api.data.gov.
 *
 * Docs: https://crime-data-explorer.fr.cloud.gov/pages/docApi
 */

import { resolveCity as geoResolve } from "./geo-resolver.js";

const STATE_BASE_URL = "https://api.usa.gov/crime/fbi/sapi";
const AGENCY_BASE_URL = "https://api.usa.gov/crime/fbi/cde";

// State abbreviations (used in API paths and display)
const STATE_ABBREVS: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

// ORI codes for major US police departments (agency-level crime data)
const CITY_ORI: Record<string, string> = {
  nyc:           "NY03030",   // NYPD
  chicago:       "IL03113",   // Chicago PD
  la:            "CA01942",   // LAPD
  houston:       "TX10200",   // Houston PD
  phoenix:       "AZ00723",   // Phoenix PD
  philadelphia:  "PA02301",   // Philadelphia PD
  "san antonio": "TX02000",   // San Antonio PD
  "san diego":   "CA03711",   // San Diego PD
  dallas:        "TX05701",   // Dallas PD
  austin:        "TX22701",   // Austin PD
  "san jose":    "CA04311",   // San Jose PD
  jacksonville:  "FL01200",   // Jacksonville SO
  columbus:      "OH02505",   // Columbus PD
  indianapolis:  "INIPD00",   // Indianapolis MPD
  sf:            "CA03801",   // SFPD
  seattle:       "WA03301",   // Seattle PD
  denver:        "CO01101",   // Denver PD
  nashville:     "TN01901",   // Nashville Metro PD
  portland:      "OR02600",   // Portland PB
  detroit:       "MI08201",   // Detroit PD
  memphis:       "TN07901",   // Memphis PD
  milwaukee:     "WI04000",   // Milwaukee PD
  baltimore:     "MDBAL0000", // Baltimore PD
  atlanta:       "GA02501",   // Atlanta PD
  miami:         "FL01300",   // Miami PD
  minneapolis:   "MN02711",   // Minneapolis PD
  "oklahoma city": "OK05502", // Oklahoma City PD
  boston:         "MA01301",   // Boston PD
  "las vegas":   "NV00201",   // Las Vegas Metro PD
  cleveland:     "OH01801",   // Cleveland PD
  "new orleans": "LA03601",   // New Orleans PD
  tampa:         "FL02900",   // Tampa PD
  pittsburgh:    "PA00200",   // Pittsburgh PB
  "st. louis":   "MO09500",   // St. Louis MPD
  cincinnati:    "OH03100",   // Cincinnati PD
  orlando:       "FL04800",   // Orlando PD
  charlotte:     "NC01100",   // Charlotte-Mecklenburg PD
  raleigh:       "NC09200",   // Raleigh PD
  "salt lake city": "UT01802", // Salt Lake City PD
  richmond:      "VA07600",   // Richmond PD
  birmingham:    "AL06300",   // Birmingham PD
  buffalo:       "NY01500",   // Buffalo PD
  tucson:        "AZ01005",   // Tucson PD
  boise:         "ID00104",   // Boise PD
  omaha:         "NE02800",   // Omaha PD
  louisville:    "KY05600",   // Louisville Metro PD
  "kansas city":  "MO04900",  // Kansas City PD
  sacramento:    "CA03400",   // Sacramento PD
  dc:            "DCIBI0000", // DC Metro PD
};

// Map cities to their state abbreviations (for state-level fallback)
const CITY_TO_STATE: Record<string, { state: string; name: string }> = {
  nyc:              { state: "NY", name: "New York City" },
  chicago:          { state: "IL", name: "Chicago" },
  sf:               { state: "CA", name: "San Francisco" },
  la:               { state: "CA", name: "Los Angeles" },
  seattle:          { state: "WA", name: "Seattle" },
  houston:          { state: "TX", name: "Houston" },
  phoenix:          { state: "AZ", name: "Phoenix" },
  philadelphia:     { state: "PA", name: "Philadelphia" },
  denver:           { state: "CO", name: "Denver" },
  boston:            { state: "MA", name: "Boston" },
  austin:           { state: "TX", name: "Austin" },
  dallas:           { state: "TX", name: "Dallas" },
  dc:               { state: "DC", name: "Washington, D.C." },
  atlanta:          { state: "GA", name: "Atlanta" },
  miami:            { state: "FL", name: "Miami" },
  portland:         { state: "OR", name: "Portland" },
  detroit:          { state: "MI", name: "Detroit" },
  minneapolis:      { state: "MN", name: "Minneapolis" },
  nashville:        { state: "TN", name: "Nashville" },
  charlotte:        { state: "NC", name: "Charlotte" },
  baltimore:        { state: "MD", name: "Baltimore" },
  memphis:          { state: "TN", name: "Memphis" },
  milwaukee:        { state: "WI", name: "Milwaukee" },
  pittsburgh:       { state: "PA", name: "Pittsburgh" },
  raleigh:          { state: "NC", name: "Raleigh" },
  "san antonio":    { state: "TX", name: "San Antonio" },
  "san diego":      { state: "CA", name: "San Diego" },
  "san jose":       { state: "CA", name: "San Jose" },
  jacksonville:     { state: "FL", name: "Jacksonville" },
  columbus:         { state: "OH", name: "Columbus" },
  indianapolis:     { state: "IN", name: "Indianapolis" },
  "oklahoma city":  { state: "OK", name: "Oklahoma City" },
  "las vegas":      { state: "NV", name: "Las Vegas" },
  cleveland:        { state: "OH", name: "Cleveland" },
  "new orleans":    { state: "LA", name: "New Orleans" },
  tampa:            { state: "FL", name: "Tampa" },
  "st. louis":      { state: "MO", name: "St. Louis" },
  cincinnati:       { state: "OH", name: "Cincinnati" },
  orlando:          { state: "FL", name: "Orlando" },
  "salt lake city": { state: "UT", name: "Salt Lake City" },
  richmond:         { state: "VA", name: "Richmond" },
  birmingham:       { state: "AL", name: "Birmingham" },
  buffalo:          { state: "NY", name: "Buffalo" },
  tucson:           { state: "AZ", name: "Tucson" },
  boise:            { state: "ID", name: "Boise" },
  omaha:            { state: "NE", name: "Omaha" },
  louisville:       { state: "KY", name: "Louisville" },
  "kansas city":    { state: "MO", name: "Kansas City" },
  sacramento:       { state: "CA", name: "Sacramento" },
};

const CITY_ALIASES: Record<string, string> = {
  "new york": "nyc", "new york city": "nyc", "manhattan": "nyc",
  "san francisco": "sf", "san fran": "sf",
  "los angeles": "la", "l.a.": "la",
  "washington": "dc", "washington dc": "dc", "d.c.": "dc",
  "philly": "philadelphia",
  "nola": "new orleans",
  "stl": "st. louis", "saint louis": "st. louis",
  "slc": "salt lake city",
  "okc": "oklahoma city",
  "kc": "kansas city",
  "indy": "indianapolis",
  "jax": "jacksonville",
  "lv": "las vegas", "vegas": "las vegas",
};

// Crime categories in the FBI API
const OFFENSE_LABELS: Record<string, string> = {
  "violent-crime": "Violent Crime",
  "homicide": "Homicide",
  "rape-legacy": "Rape",
  "robbery": "Robbery",
  "aggravated-assault": "Aggravated Assault",
  "property-crime": "Property Crime",
  "burglary": "Burglary",
  "larceny": "Larceny-Theft",
  "motor-vehicle-theft": "Motor Vehicle Theft",
  "arson": "Arson",
};

// Offense categories to query (shared between agency and state paths)
const OFFENSE_CATEGORIES = [
  "violent-crime", "homicide", "robbery", "aggravated-assault",
  "property-crime", "burglary", "motor-vehicle-theft",
];

export interface FbiCrimeResult {
  city: string;
  state: string;
  stateName: string;
  dataLevel: "agency" | "state";
  agencyOri?: string;
  offenses: Array<{
    category: string;
    label: string;
    years: Array<{ year: number; count: number; rate?: number }>;
  }>;
  note: string;
}

// Keep the old interface name as an alias for backwards compatibility
export type FbiStateResult = FbiCrimeResult;

/**
 * Resolve a city name to its config for FBI data lookup.
 */
export function resolveFbiCity(input: string): { key: string; config: typeof CITY_TO_STATE[string] } | null {
  const normalized = input.toLowerCase().trim();

  if (CITY_TO_STATE[normalized]) {
    return { key: normalized, config: CITY_TO_STATE[normalized] };
  }

  const aliasKey = CITY_ALIASES[normalized];
  if (aliasKey && CITY_TO_STATE[aliasKey]) {
    return { key: aliasKey, config: CITY_TO_STATE[aliasKey] };
  }

  for (const [key, config] of Object.entries(CITY_TO_STATE)) {
    if (config.name.toLowerCase() === normalized) {
      return { key, config };
    }
  }

  // Also accept state abbreviations directly
  const upper = input.toUpperCase().trim();
  if (STATE_ABBREVS[upper]) {
    return { key: upper.toLowerCase(), config: { state: upper, name: STATE_ABBREVS[upper] } };
  }

  return null;
}

/**
 * Async version of resolveFbiCity that falls back to the geo-resolver.
 * If the city isn't in the hardcoded list, geo-resolve it to get the state,
 * then return a config suitable for state-level FBI data.
 */
export async function resolveFbiCityAsync(
  input: string
): Promise<{ key: string; config: { name: string; state: string } } | null> {
  // Try hardcoded first (instant, no network)
  const hardcoded = resolveFbiCity(input);
  if (hardcoded) return hardcoded;

  // Fallback: use geo-resolver to determine the state
  try {
    const geo = await geoResolve(input);
    if (!geo.stateAbbrev) return null;
    return {
      key: geo.city.toLowerCase().replace(/\s+/g, "_"),
      config: { name: geo.city, state: geo.stateAbbrev },
    };
  } catch {
    return null;
  }
}

/**
 * List cities/states available for FBI crime data.
 * Indicates which cities have agency-level (ORI) data available.
 */
export function listFbiCities(): Array<{ key: string; name: string; state: string; hasAgencyData: boolean }> {
  return Object.entries(CITY_TO_STATE).map(([key, config]) => ({
    key,
    name: config.name,
    state: config.state,
    hasAgencyData: key in CITY_ORI,
  }));
}

/**
 * Fetch agency-level crime data using ORI code.
 * Returns null if the ORI doesn't work or returns no data.
 */
async function queryAgencyCrime(
  ori: string,
  apiKey: string
): Promise<FbiCrimeResult["offenses"] | null> {
  const results: FbiCrimeResult["offenses"] = [];
  let anySuccess = false;

  for (const offense of OFFENSE_CATEGORIES) {
    try {
      const url = `${AGENCY_BASE_URL}/summarized/agency/${ori}/${offense}?from=2019&to=2023&API_KEY=${apiKey}`;
      console.error(`[city-data-mcp] FBI agency: ${url.replace(apiKey, "***")}`);

      const response = await fetch(url, {
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        console.error(`[city-data-mcp] FBI agency API ${response.status} for ${offense} (ORI: ${ori})`);
        continue;
      }

      const raw = await response.json();

      // The CDE agency endpoint can return different shapes — handle flexibly
      const records = Array.isArray(raw) ? raw : raw?.results ?? raw?.data ?? [];

      if (!Array.isArray(records) || records.length === 0) {
        continue;
      }

      // Extract year/count data from response records
      const yearData: Array<{ year: number; count: number }> = [];

      for (const record of records) {
        const year = record.data_year ?? record.year;
        // Try multiple possible field names for the count
        const count =
          record.actual ?? record.offense_count ?? record.count ?? record.value ?? record.total;

        if (year != null && count != null && typeof count === "number") {
          yearData.push({ year, count });
        }
      }

      if (yearData.length > 0) {
        anySuccess = true;
        const sorted = yearData.sort((a, b) => b.year - a.year).slice(0, 5);
        results.push({
          category: offense,
          label: OFFENSE_LABELS[offense] || offense,
          years: sorted.map((r) => ({ year: r.year, count: r.count })),
        });
      }
    } catch (error) {
      console.error(`[city-data-mcp] FBI agency error for ${offense} (ORI: ${ori}):`, error);
    }
  }

  // Only return results if we got at least some data
  return anySuccess ? results : null;
}

/**
 * Fetch state-level crime estimates from the FBI API.
 */
async function queryStateCrime(
  stateAbbrev: string,
  apiKey: string
): Promise<FbiCrimeResult["offenses"]> {
  const results: FbiCrimeResult["offenses"] = [];

  for (const offense of OFFENSE_CATEGORIES) {
    try {
      const url = `${STATE_BASE_URL}/api/estimates/states/${stateAbbrev}/${offense}?API_KEY=${apiKey}`;
      console.error(`[city-data-mcp] FBI state: ${url.replace(apiKey, "***")}`);

      const response = await fetch(url, {
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        console.error(`[city-data-mcp] FBI state API ${response.status} for ${offense}`);
        continue;
      }

      const data = (await response.json()) as {
        results: Array<{
          year: number;
          state_abbr: string;
          count: number;
          rate: number;
        }>;
      };

      if (data.results && data.results.length > 0) {
        const sorted = data.results
          .filter((r) => r.count != null && r.rate != null)
          .sort((a, b) => b.year - a.year)
          .slice(0, 5);

        results.push({
          category: offense,
          label: OFFENSE_LABELS[offense] || offense,
          years: sorted.map((r) => ({
            year: r.year,
            count: r.count,
            rate: Math.round(r.rate * 10) / 10,
          })),
        });
      }
    } catch (error) {
      console.error(`[city-data-mcp] FBI state error for ${offense}:`, error);
    }
  }

  return results;
}

/**
 * Fetch crime data for a city or state.
 *
 * Strategy:
 * 1. If the city has a known ORI code, try agency-level data first.
 * 2. If agency-level fails or returns nothing, fall back to state-level.
 * 3. Cities without ORI codes go straight to state-level.
 */
export async function queryFbiCrime(
  stateAbbrev: string,
  cityKey?: string
): Promise<FbiCrimeResult> {
  const apiKey = process.env.FBI_API_KEY || process.env.CENSUS_API_KEY;
  if (!apiKey) {
    throw new Error(
      "FBI_API_KEY (or CENSUS_API_KEY) not set. Get a free key at https://api.data.gov/signup/"
    );
  }

  const stateName = STATE_ABBREVS[stateAbbrev] || stateAbbrev;
  const ori = cityKey ? CITY_ORI[cityKey] : undefined;

  // Try agency-level first if we have an ORI
  if (ori) {
    console.error(`[city-data-mcp] Trying agency-level data for ORI ${ori}`);
    const agencyData = await queryAgencyCrime(ori, apiKey);

    if (agencyData && agencyData.length > 0) {
      const cityName = CITY_TO_STATE[cityKey!]?.name || cityKey || "";
      return {
        city: cityName,
        state: stateAbbrev,
        stateName,
        dataLevel: "agency",
        agencyOri: ori,
        offenses: agencyData,
        note: `Agency-level data from ${cityName} police department (ORI: ${ori}). FBI UCR data lags 1-2 years. Counts are reported offenses (not rates — agency data does not include per-capita rates).`,
      };
    }

    console.error(`[city-data-mcp] Agency data unavailable for ORI ${ori}, falling back to state-level`);
  }

  // Fall back to state-level
  const stateData = await queryStateCrime(stateAbbrev, apiKey);

  return {
    city: "",
    state: stateAbbrev,
    stateName,
    dataLevel: "state",
    offenses: stateData,
    note: `Data is at the STATE level (${stateName})${ori ? " — agency-level data was unavailable for this city's ORI" : ""}. FBI UCR data lags 1-2 years. Rates are per 100,000 population.`,
  };
}

/**
 * Format FBI crime results into readable text for Claude.
 */
export function formatFbiResults(result: FbiCrimeResult, cityName?: string): string {
  const lines: string[] = [];
  const displayName = cityName || result.city;

  if (result.dataLevel === "agency" && displayName) {
    lines.push(`**${displayName}** — FBI Crime Data (Agency-Level: ${result.agencyOri})\n`);
  } else if (displayName) {
    lines.push(`**${displayName}** — FBI Crime Data (State: ${result.stateName})\n`);
  } else {
    lines.push(`**${result.stateName}** — FBI Crime Data\n`);
  }

  lines.push(`*${result.note}*\n`);

  for (const offense of result.offenses) {
    if (offense.years.length === 0) continue;

    const latest = offense.years[0];
    const oldest = offense.years[offense.years.length - 1];

    // Build the count/rate display
    let statLine = `${latest.count.toLocaleString()} incidents`;
    if (latest.rate != null) {
      statLine += `, ${latest.rate}/100K`;
    }
    statLine += ` (${latest.year})`;

    // Add trend if we have multiple years
    let trend = "";
    if (offense.years.length > 1 && oldest.count > 0) {
      const change = latest.count - oldest.count;
      const pctChange = ((change / oldest.count) * 100).toFixed(1);
      const arrow = change > 0 ? "↑" : change < 0 ? "↓" : "→";
      trend = ` | ${arrow} ${Math.abs(Number(pctChange))}% since ${oldest.year}`;
    }

    lines.push(`**${offense.label}**: ${statLine}${trend}`);
  }

  // Add year-by-year table for violent crime if available
  const violent = result.offenses.find((o) => o.category === "violent-crime");
  if (violent && violent.years.length > 1) {
    lines.push("\n**Violent Crime Trend:**");
    // Use rate if available, otherwise use count for the bar
    const useRate = violent.years[0].rate != null;
    const maxVal = Math.max(...violent.years.map((yr) => useRate ? (yr.rate ?? 0) : yr.count));
    const scale = maxVal > 0 ? 30 / maxVal : 1; // normalize bars to ~30 chars

    for (const yr of violent.years) {
      const val = useRate ? (yr.rate ?? 0) : yr.count;
      const bar = "█".repeat(Math.max(1, Math.round(val * scale)));
      const display = useRate ? `${yr.rate}/100K` : `${yr.count.toLocaleString()}`;
      lines.push(`  ${yr.year}: ${display} ${bar}`);
    }
  }

  return lines.join("\n");
}
