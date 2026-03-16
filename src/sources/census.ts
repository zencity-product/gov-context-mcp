/**
 * US Census Bureau API Client
 *
 * The Census API provides demographic, economic, and housing data for every
 * geography in the US — from national down to block groups.
 *
 * We use the American Community Survey (ACS) 5-Year Estimates, which is the
 * most comprehensive dataset. It covers:
 * - Population, age, race/ethnicity
 * - Household income, poverty rate
 * - Education levels
 * - Housing (median home value, rent, vacancy)
 * - Commuting patterns
 *
 * How it works:
 * 1. You request specific variables (e.g., B01003_001E = total population)
 * 2. For a specific geography (e.g., place:5128000 = Los Angeles city)
 * 3. The API returns an array of arrays: [[header row], [data row], ...]
 *
 * API key: Free, register at https://api.census.gov/data/key_signup.html
 * Set as CENSUS_API_KEY environment variable.
 *
 * Docs: https://api.census.gov/data.html
 */

// Census variable codes → human-readable names
// These are from the ACS 5-Year Estimates Detailed Tables
const VARIABLES: Record<string, { code: string; label: string; format: "number" | "dollar" | "percent" }> = {
  totalPopulation:    { code: "B01003_001E", label: "Total Population", format: "number" },
  medianAge:          { code: "B01002_001E", label: "Median Age", format: "number" },
  medianIncome:       { code: "B19013_001E", label: "Median Household Income", format: "dollar" },
  perCapitaIncome:    { code: "B19301_001E", label: "Per Capita Income", format: "dollar" },
  povertyCount:       { code: "B17001_002E", label: "Population Below Poverty Line", format: "number" },
  totalForPoverty:    { code: "B17001_001E", label: "Population for Poverty Calculation", format: "number" },
  bachelorsDegree:    { code: "B15003_022E", label: "Bachelor's Degree Holders", format: "number" },
  totalOver25:        { code: "B15003_001E", label: "Population 25+", format: "number" },
  medianHomeValue:    { code: "B25077_001E", label: "Median Home Value", format: "dollar" },
  medianRent:         { code: "B25064_001E", label: "Median Gross Rent", format: "dollar" },
  totalHousingUnits:  { code: "B25001_001E", label: "Total Housing Units", format: "number" },
  vacantUnits:        { code: "B25002_003E", label: "Vacant Housing Units", format: "number" },
  totalWorkers:       { code: "B08301_001E", label: "Total Workers (Commuting)", format: "number" },
  driveAlone:         { code: "B08301_003E", label: "Drive Alone to Work", format: "number" },
  publicTransit:      { code: "B08301_010E", label: "Public Transit Commuters", format: "number" },
  workFromHome:       { code: "B08301_021E", label: "Work From Home", format: "number" },
};

// FIPS place codes for major cities
// These map city names to their Census geography identifiers
// Format: state FIPS (2 digits) + place FIPS (5 digits)
const CITY_FIPS: Record<string, { state: string; place: string; name: string }> = {
  nyc:           { state: "36", place: "51000", name: "New York City" },
  chicago:       { state: "17", place: "14000", name: "Chicago" },
  sf:            { state: "06", place: "67000", name: "San Francisco" },
  la:            { state: "06", place: "44000", name: "Los Angeles" },
  seattle:       { state: "53", place: "63000", name: "Seattle" },
  houston:       { state: "48", place: "35000", name: "Houston" },
  phoenix:       { state: "04", place: "55000", name: "Phoenix" },
  philadelphia:  { state: "42", place: "60000", name: "Philadelphia" },
  san_antonio:   { state: "48", place: "65000", name: "San Antonio" },
  san_diego:     { state: "06", place: "66000", name: "San Diego" },
  dallas:        { state: "48", place: "19000", name: "Dallas" },
  austin:        { state: "48", place: "05000", name: "Austin" },
  denver:        { state: "08", place: "20000", name: "Denver" },
  boston:         { state: "25", place: "07000", name: "Boston" },
  nashville:     { state: "47", place: "52006", name: "Nashville" },
  portland:      { state: "41", place: "59000", name: "Portland" },
  baltimore:     { state: "24", place: "04000", name: "Baltimore" },
  atlanta:       { state: "13", place: "04000", name: "Atlanta" },
  miami:         { state: "12", place: "45000", name: "Miami" },
  dc:            { state: "11", place: "50000", name: "Washington, D.C." },
  minneapolis:   { state: "27", place: "43000", name: "Minneapolis" },
  detroit:       { state: "26", place: "22000", name: "Detroit" },
  pittsburgh:    { state: "42", place: "61000", name: "Pittsburgh" },
  charlotte:     { state: "37", place: "12000", name: "Charlotte" },
  columbus:      { state: "39", place: "18000", name: "Columbus" },
  indianapolis:  { state: "18", place: "36003", name: "Indianapolis" },
  memphis:       { state: "47", place: "48000", name: "Memphis" },
  milwaukee:     { state: "55", place: "53000", name: "Milwaukee" },
  jacksonville:  { state: "12", place: "35000", name: "Jacksonville" },
  raleigh:       { state: "37", place: "55000", name: "Raleigh" },
};

// Aliases for fuzzy matching
const CITY_ALIASES: Record<string, string> = {
  "new york": "nyc", "new york city": "nyc", "manhattan": "nyc",
  "san francisco": "sf", "san fran": "sf",
  "los angeles": "la", "l.a.": "la",
  "washington": "dc", "washington dc": "dc", "d.c.": "dc",
  "philly": "philadelphia", "phila": "philadelphia",
  "san_antonio": "san_antonio", "san antonio": "san_antonio",
  "san_diego": "san_diego", "san diego": "san_diego",
};

const BASE_URL = "https://api.census.gov/data";
const ACS_YEAR = "2023"; // Most recent ACS 5-year
const ACS_DATASET = "acs/acs5";

export interface CensusResult {
  city: string;
  state: string;
  demographics: {
    population: number | null;
    medianAge: number | null;
    medianIncome: number | null;
    perCapitaIncome: number | null;
    povertyRate: number | null;
    bachelorsDegreeRate: number | null;
  };
  housing: {
    medianHomeValue: number | null;
    medianRent: number | null;
    totalUnits: number | null;
    vacancyRate: number | null;
  };
  commuting: {
    driveAloneRate: number | null;
    publicTransitRate: number | null;
    workFromHomeRate: number | null;
  };
}

/**
 * Resolve a city name to its FIPS codes.
 */
export function resolveCensusFips(input: string): { key: string; fips: typeof CITY_FIPS[string] } | null {
  const normalized = input.toLowerCase().trim();

  // Direct key match
  if (CITY_FIPS[normalized]) {
    return { key: normalized, fips: CITY_FIPS[normalized] };
  }

  // Alias match
  const aliasKey = CITY_ALIASES[normalized];
  if (aliasKey && CITY_FIPS[aliasKey]) {
    return { key: aliasKey, fips: CITY_FIPS[aliasKey] };
  }

  // Name match
  for (const [key, fips] of Object.entries(CITY_FIPS)) {
    if (fips.name.toLowerCase() === normalized) {
      return { key, fips };
    }
  }

  return null;
}

/**
 * List all cities with Census data available.
 */
export function listCensusCities(): Array<{ key: string; name: string; state: string }> {
  return Object.entries(CITY_FIPS).map(([key, fips]) => ({
    key,
    name: fips.name,
    state: fips.state,
  }));
}

/**
 * Fetch demographic data from the Census API for a city.
 */
export async function queryCensus(cityKey: string): Promise<CensusResult> {
  const fips = CITY_FIPS[cityKey];
  if (!fips) {
    throw new Error(`Unknown city key: ${cityKey}`);
  }

  const apiKey = process.env.CENSUS_API_KEY;
  if (!apiKey) {
    throw new Error(
      "CENSUS_API_KEY not set. Get a free key at https://api.census.gov/data/key_signup.html and set it as an environment variable."
    );
  }

  // Request all variables in one call
  const variableCodes = Object.values(VARIABLES).map((v) => v.code);
  const getParam = `NAME,${variableCodes.join(",")}`;

  const url = `${BASE_URL}/${ACS_YEAR}/${ACS_DATASET}?get=${getParam}&for=place:${fips.place}&in=state:${fips.state}&key=${apiKey}`;

  console.error(`[city-data-mcp] Census API: ${url.replace(apiKey, "***")}`);

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Census API error (${response.status}): ${errorText.slice(0, 200)}`);
  }

  // Census returns [[headers], [values]]
  const data = (await response.json()) as string[][];
  if (data.length < 2) {
    throw new Error(`No Census data found for ${fips.name}`);
  }

  const headers = data[0];
  const values = data[1];

  // Build a lookup: variable code → value
  const lookup: Record<string, number | null> = {};
  for (const [varName, varDef] of Object.entries(VARIABLES)) {
    const idx = headers.indexOf(varDef.code);
    if (idx >= 0 && values[idx] !== null && values[idx] !== undefined) {
      const num = Number(values[idx]);
      lookup[varName] = isNaN(num) || num < 0 ? null : num;
    } else {
      lookup[varName] = null;
    }
  }

  // Compute derived rates
  const povertyRate = safeRate(lookup.povertyCount, lookup.totalForPoverty);
  const bachelorsDegreeRate = safeRate(lookup.bachelorsDegree, lookup.totalOver25);
  const vacancyRate = safeRate(lookup.vacantUnits, lookup.totalHousingUnits);
  const driveAloneRate = safeRate(lookup.driveAlone, lookup.totalWorkers);
  const publicTransitRate = safeRate(lookup.publicTransit, lookup.totalWorkers);
  const workFromHomeRate = safeRate(lookup.workFromHome, lookup.totalWorkers);

  return {
    city: fips.name,
    state: fips.state,
    demographics: {
      population: lookup.totalPopulation,
      medianAge: lookup.medianAge,
      medianIncome: lookup.medianIncome,
      perCapitaIncome: lookup.perCapitaIncome,
      povertyRate,
      bachelorsDegreeRate,
    },
    housing: {
      medianHomeValue: lookup.medianHomeValue,
      medianRent: lookup.medianRent,
      totalUnits: lookup.totalHousingUnits,
      vacancyRate,
    },
    commuting: {
      driveAloneRate,
      publicTransitRate,
      workFromHomeRate,
    },
  };
}

/**
 * Format Census results into readable text for Claude.
 */
export function formatCensusResults(result: CensusResult): string {
  const fmt = (n: number | null, type: "number" | "dollar" | "percent"): string => {
    if (n === null) return "N/A";
    if (type === "dollar") return `$${n.toLocaleString()}`;
    if (type === "percent") return `${(n * 100).toFixed(1)}%`;
    return n.toLocaleString();
  };

  return `**${result.city}** — Census Demographics (ACS ${ACS_YEAR} 5-Year Estimates)

**Population & Demographics**
  - Population: ${fmt(result.demographics.population, "number")}
  - Median Age: ${fmt(result.demographics.medianAge, "number")}
  - Median Household Income: ${fmt(result.demographics.medianIncome, "dollar")}
  - Per Capita Income: ${fmt(result.demographics.perCapitaIncome, "dollar")}
  - Poverty Rate: ${fmt(result.demographics.povertyRate, "percent")}
  - Bachelor's Degree Rate (25+): ${fmt(result.demographics.bachelorsDegreeRate, "percent")}

**Housing**
  - Median Home Value: ${fmt(result.housing.medianHomeValue, "dollar")}
  - Median Gross Rent: ${fmt(result.housing.medianRent, "dollar")}
  - Total Housing Units: ${fmt(result.housing.totalUnits, "number")}
  - Vacancy Rate: ${fmt(result.housing.vacancyRate, "percent")}

**Commuting**
  - Drive Alone: ${fmt(result.commuting.driveAloneRate, "percent")}
  - Public Transit: ${fmt(result.commuting.publicTransitRate, "percent")}
  - Work From Home: ${fmt(result.commuting.workFromHomeRate, "percent")}`;
}

// Helper: safely compute a rate (numerator / denominator), returns null if either is null/zero
function safeRate(numerator: number | null | undefined, denominator: number | null | undefined): number | null {
  if (numerator == null || denominator == null || denominator === 0) return null;
  return numerator / denominator;
}
