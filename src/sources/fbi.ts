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
 * Limitations:
 * - Data lags 1-2 years (most recent is usually 2 years ago)
 * - City-level requires knowing the ORI (agency identifier)
 * - Not all agencies report consistently
 *
 * API key: Free, register at https://api.data.gov/signup/
 * Same key works for all api.data.gov endpoints (FBI, Census, etc.)
 * Set as FBI_API_KEY environment variable — OR reuses CENSUS_API_KEY if
 * registered through api.data.gov.
 *
 * Docs: https://crime-data-explorer.fr.cloud.gov/pages/docApi
 */

const BASE_URL = "https://api.usa.gov/crime/fbi/sapi";

// State FIPS codes (used in API paths)
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

// Map cities to their state abbreviations for state-level crime data
const CITY_TO_STATE: Record<string, { state: string; name: string }> = {
  nyc:           { state: "NY", name: "New York City" },
  chicago:       { state: "IL", name: "Chicago" },
  sf:            { state: "CA", name: "San Francisco" },
  la:            { state: "CA", name: "Los Angeles" },
  seattle:       { state: "WA", name: "Seattle" },
  houston:       { state: "TX", name: "Houston" },
  phoenix:       { state: "AZ", name: "Phoenix" },
  philadelphia:  { state: "PA", name: "Philadelphia" },
  denver:        { state: "CO", name: "Denver" },
  boston:         { state: "MA", name: "Boston" },
  austin:        { state: "TX", name: "Austin" },
  dallas:        { state: "TX", name: "Dallas" },
  dc:            { state: "DC", name: "Washington, D.C." },
  atlanta:       { state: "GA", name: "Atlanta" },
  miami:         { state: "FL", name: "Miami" },
  portland:      { state: "OR", name: "Portland" },
  detroit:       { state: "MI", name: "Detroit" },
  minneapolis:   { state: "MN", name: "Minneapolis" },
  nashville:     { state: "TN", name: "Nashville" },
  charlotte:     { state: "NC", name: "Charlotte" },
  baltimore:     { state: "MD", name: "Baltimore" },
  memphis:       { state: "TN", name: "Memphis" },
  milwaukee:     { state: "WI", name: "Milwaukee" },
  pittsburgh:    { state: "PA", name: "Pittsburgh" },
  raleigh:       { state: "NC", name: "Raleigh" },
};

const CITY_ALIASES: Record<string, string> = {
  "new york": "nyc", "new york city": "nyc", "manhattan": "nyc",
  "san francisco": "sf", "san fran": "sf",
  "los angeles": "la", "l.a.": "la",
  "washington": "dc", "washington dc": "dc", "d.c.": "dc",
  "philly": "philadelphia",
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

export interface FbiStateResult {
  city: string;
  state: string;
  stateName: string;
  offenses: Array<{
    category: string;
    label: string;
    years: Array<{ year: number; count: number; rate: number }>;
  }>;
  note: string;
}

/**
 * Resolve a city name to its state for FBI data lookup.
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
 * List cities/states available for FBI crime data.
 */
export function listFbiCities(): Array<{ key: string; name: string; state: string }> {
  return Object.entries(CITY_TO_STATE).map(([key, config]) => ({
    key,
    name: config.name,
    state: config.state,
  }));
}

/**
 * Fetch state-level crime estimates from the FBI API.
 * Returns the most recent years of data for key offense categories.
 */
export async function queryFbiCrime(stateAbbrev: string): Promise<FbiStateResult> {
  // FBI API uses the same api.data.gov key system
  const apiKey = process.env.FBI_API_KEY || process.env.CENSUS_API_KEY;
  if (!apiKey) {
    throw new Error(
      "FBI_API_KEY (or CENSUS_API_KEY) not set. Get a free key at https://api.data.gov/signup/"
    );
  }

  const stateName = STATE_ABBREVS[stateAbbrev] || stateAbbrev;
  const offenseCategories = ["violent-crime", "homicide", "robbery", "aggravated-assault", "property-crime", "burglary", "motor-vehicle-theft"];

  const results: FbiStateResult["offenses"] = [];

  // Fetch each offense category (the FBI API requires separate calls per offense)
  for (const offense of offenseCategories) {
    try {
      const url = `${BASE_URL}/api/estimates/states/${stateAbbrev}/${offense}?API_KEY=${apiKey}`;
      console.error(`[city-data-mcp] FBI: ${url.replace(apiKey, "***")}`);

      const response = await fetch(url, {
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        console.error(`[city-data-mcp] FBI API ${response.status} for ${offense}`);
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
        // Get most recent 5 years
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
      console.error(`[city-data-mcp] FBI error for ${offense}:`, error);
    }
  }

  return {
    city: "",
    state: stateAbbrev,
    stateName,
    offenses: results,
    note: `Data is at the STATE level (${stateName}). FBI UCR data lags 1-2 years. Rates are per 100,000 population.`,
  };
}

/**
 * Format FBI crime results into readable text for Claude.
 */
export function formatFbiResults(result: FbiStateResult, cityName?: string): string {
  const lines: string[] = [];

  if (cityName) {
    lines.push(`**${cityName}** — FBI Crime Data (State: ${result.stateName})\n`);
  } else {
    lines.push(`**${result.stateName}** — FBI Crime Data\n`);
  }

  lines.push(`*${result.note}*\n`);

  for (const offense of result.offenses) {
    if (offense.years.length === 0) continue;

    const latest = offense.years[0];
    const oldest = offense.years[offense.years.length - 1];

    let trend = "";
    if (offense.years.length > 1) {
      const change = latest.rate - oldest.rate;
      const pctChange = ((change / oldest.rate) * 100).toFixed(1);
      const arrow = change > 0 ? "↑" : change < 0 ? "↓" : "→";
      trend = ` | ${arrow} ${Math.abs(Number(pctChange))}% since ${oldest.year}`;
    }

    lines.push(`**${offense.label}**: ${latest.count.toLocaleString()} incidents, ${latest.rate}/100K (${latest.year})${trend}`);
  }

  // Add year-by-year table for violent crime if available
  const violent = result.offenses.find((o) => o.category === "violent-crime");
  if (violent && violent.years.length > 1) {
    lines.push("\n**Violent Crime Trend:**");
    for (const yr of violent.years) {
      const bar = "█".repeat(Math.round(yr.rate / 50));
      lines.push(`  ${yr.year}: ${yr.rate}/100K ${bar} (${yr.count.toLocaleString()})`);
    }
  }

  return lines.join("\n");
}
