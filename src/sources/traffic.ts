/**
 * Traffic Safety & Congestion Data
 *
 * Combines two data sources:
 * 1. NHTSA FARS (Fatality Analysis Reporting System) — federal crash data
 *    - Fatal crash counts, fatalities, pedestrian/cyclist deaths, DUI crashes
 *    - County-level (primary) + state-level (context/fallback)
 *    - Free, no API key needed
 *    - Years: 2019-2022
 *
 * 2. TTI Urban Mobility Report — congestion metrics (hardcoded)
 *    - Annual delay hours per commuter
 *    - Congestion cost per commuter
 *    - ~30 major metros
 *
 * Data resolution:
 * - County-level crash data is the primary view (via GetCrashesByLocation)
 * - State-level crash data always included for context (via GetFARSData)
 * - If county data is unavailable, falls back to state-only
 *
 * Limitations:
 * - FARS data lags 1-2 years (most recent is usually 2022)
 * - County data may not include cyclist breakdown (PEDS field only)
 * - State-level GetFARSData has richer analytical fields
 * - Per-capita rates depend on budget.ts population data (~28 cities)
 */

import { resolveCity as geoResolve } from "./geo-resolver.js";

const FARS_BASE = "https://crashviewer.nhtsa.dot.gov/CrashAPI";
const FARS_YEARS = [2019, 2020, 2021, 2022];

// ── Interfaces ──────────────────────────────────────────────────────────

export interface TrafficYearData {
  year: number;
  totalCrashes: number;
  totalFatalities: number;
  pedestrianFatalities: number;
  cyclistFatalities: number;
  alcoholRelated: number;
  fatalityRate?: number; // per 100K population
}

export interface CongestionData {
  city: string;
  annualDelayHours: number;
  congestionCost: number;
  rankAmongMetros: number | null;
  dataYear: number;
}

export interface TrafficResult {
  city: string;
  stateAbbrev: string;
  stateName: string;
  county: {
    countyName: string;
    countyFips: string;
    years: TrafficYearData[];
  } | null;
  state: {
    years: TrafficYearData[];
  };
  congestion: CongestionData | null;
  population: number | null;
  dataLevel: "county" | "state-only";
  note: string;
}

// ── State abbreviation lookup ───────────────────────────────────────────

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

// ── TTI Congestion Data (hardcoded from Urban Mobility Report) ──────────

interface TtiCityData {
  name: string;
  annualDelayHours: number;
  congestionCost: number;
  rank: number | null;
  dataYear: number;
}

const TTI_CONGESTION: Record<string, TtiCityData> = {
  "new york":      { name: "New York",          annualDelayHours: 117, congestionCost: 2270, rank: 1,    dataYear: 2022 },
  "los angeles":   { name: "Los Angeles",       annualDelayHours: 103, congestionCost: 2030, rank: 2,    dataYear: 2022 },
  "san francisco": { name: "San Francisco",     annualDelayHours: 97,  congestionCost: 1910, rank: 3,    dataYear: 2022 },
  "chicago":       { name: "Chicago",           annualDelayHours: 86,  congestionCost: 1690, rank: 4,    dataYear: 2022 },
  "boston":         { name: "Boston",            annualDelayHours: 78,  congestionCost: 1530, rank: 5,    dataYear: 2022 },
  "houston":       { name: "Houston",           annualDelayHours: 76,  congestionCost: 1490, rank: 6,    dataYear: 2022 },
  "seattle":       { name: "Seattle",           annualDelayHours: 74,  congestionCost: 1450, rank: 7,    dataYear: 2022 },
  "miami":         { name: "Miami",             annualDelayHours: 67,  congestionCost: 1310, rank: 8,    dataYear: 2022 },
  "atlanta":       { name: "Atlanta",           annualDelayHours: 64,  congestionCost: 1260, rank: 9,    dataYear: 2022 },
  "dallas":        { name: "Dallas",            annualDelayHours: 62,  congestionCost: 1210, rank: 10,   dataYear: 2022 },
  "philadelphia":  { name: "Philadelphia",      annualDelayHours: 59,  congestionCost: 1160, rank: 11,   dataYear: 2022 },
  "denver":        { name: "Denver",            annualDelayHours: 57,  congestionCost: 1120, rank: 12,   dataYear: 2022 },
  "nashville":     { name: "Nashville",         annualDelayHours: 56,  congestionCost: 1100, rank: 13,   dataYear: 2022 },
  "san diego":     { name: "San Diego",         annualDelayHours: 55,  congestionCost: 1080, rank: 14,   dataYear: 2022 },
  "phoenix":       { name: "Phoenix",           annualDelayHours: 52,  congestionCost: 1020, rank: 15,   dataYear: 2022 },
  "portland":      { name: "Portland",          annualDelayHours: 51,  congestionCost: 1000, rank: 16,   dataYear: 2022 },
  "austin":        { name: "Austin",            annualDelayHours: 50,  congestionCost: 980,  rank: 17,   dataYear: 2022 },
  "tampa":         { name: "Tampa",             annualDelayHours: 48,  congestionCost: 940,  rank: 18,   dataYear: 2022 },
  "minneapolis":   { name: "Minneapolis",       annualDelayHours: 47,  congestionCost: 920,  rank: 19,   dataYear: 2022 },
  "charlotte":     { name: "Charlotte",         annualDelayHours: 46,  congestionCost: 900,  rank: 20,   dataYear: 2022 },
  "detroit":       { name: "Detroit",           annualDelayHours: 45,  congestionCost: 880,  rank: 21,   dataYear: 2022 },
  "san antonio":   { name: "San Antonio",       annualDelayHours: 44,  congestionCost: 860,  rank: 22,   dataYear: 2022 },
  "baltimore":     { name: "Baltimore",         annualDelayHours: 43,  congestionCost: 850,  rank: 23,   dataYear: 2022 },
  "pittsburgh":    { name: "Pittsburgh",        annualDelayHours: 42,  congestionCost: 820,  rank: 24,   dataYear: 2022 },
  "washington":    { name: "Washington, D.C.",   annualDelayHours: 84,  congestionCost: 1650, rank: null, dataYear: 2022 },
  "orlando":       { name: "Orlando",           annualDelayHours: 49,  congestionCost: 960,  rank: null, dataYear: 2022 },
  "las vegas":     { name: "Las Vegas",         annualDelayHours: 41,  congestionCost: 800,  rank: null, dataYear: 2022 },
  "indianapolis":  { name: "Indianapolis",      annualDelayHours: 38,  congestionCost: 740,  rank: null, dataYear: 2022 },
  "columbus":      { name: "Columbus",          annualDelayHours: 37,  congestionCost: 720,  rank: null, dataYear: 2022 },
  "jacksonville":  { name: "Jacksonville",      annualDelayHours: 36,  congestionCost: 700,  rank: null, dataYear: 2022 },
  "raleigh":       { name: "Raleigh",           annualDelayHours: 35,  congestionCost: 680,  rank: null, dataYear: 2022 },
  "memphis":       { name: "Memphis",           annualDelayHours: 34,  congestionCost: 660,  rank: null, dataYear: 2022 },
  "milwaukee":     { name: "Milwaukee",         annualDelayHours: 33,  congestionCost: 640,  rank: null, dataYear: 2022 },
};

const TTI_ALIASES: Record<string, string> = {
  "nyc": "new york", "new york city": "new york", "manhattan": "new york",
  "sf": "san francisco", "san fran": "san francisco",
  "la": "los angeles", "l.a.": "los angeles",
  "dc": "washington", "d.c.": "washington", "washington dc": "washington", "washington d.c.": "washington",
  "philly": "philadelphia",
  "atl": "atlanta",
  "pdx": "portland",
  "mpls": "minneapolis", "msp": "minneapolis",
  "sea": "seattle",
  "den": "denver",
  "bos": "boston",
  "clt": "charlotte",
  "dtw": "detroit", "motor city": "detroit",
  "bmore": "baltimore",
  "mke": "milwaukee",
  "vegas": "las vegas", "lv": "las vegas",
  "indy": "indianapolis",
  "jax": "jacksonville",
  "cbus": "columbus",
  "mem": "memphis",
  "satx": "san antonio", "sa": "san antonio",
  "dfw": "dallas",
};

// ── Population lookup (from budget.ts hardcoded data) ───────────────────

const CITY_POPULATIONS: Record<string, number> = {
  "new york": 8336817, "chicago": 2665039, "los angeles": 3898747,
  "houston": 2304580, "phoenix": 1608139, "philadelphia": 1603797,
  "san francisco": 808437, "seattle": 749256, "denver": 713252,
  "boston": 675647, "atlanta": 499127, "nashville": 683622,
  "miami": 442241, "portland": 635067, "minneapolis": 429954,
  "washington": 678972, "dallas": 1304379, "austin": 979882,
  "san diego": 1386932, "san antonio": 1472909, "jacksonville": 954614,
  "columbus": 906528, "indianapolis": 887642, "charlotte": 879709,
  "detroit": 639111, "baltimore": 585708, "memphis": 633104,
  "milwaukee": 577222, "las vegas": 660929, "raleigh": 474069,
};

const POP_ALIASES: Record<string, string> = {
  ...TTI_ALIASES,
};

function getPopulation(city: string): number | null {
  const normalized = city.toLowerCase().trim();
  const key = POP_ALIASES[normalized] || normalized;
  return CITY_POPULATIONS[key] ?? null;
}

// ── FARS API Helpers ────────────────────────────────────────────────────

interface FarsRecord {
  FATALS?: number;
  PEDS?: number;
  DRUNK_DR?: number;
  COUNTY?: number;
  COUNTYNAME?: string;
  STATE?: number;
  STATENAME?: string;
  ST_CASE?: number;
  // Analytical fields (state-level GetFARSData may include these)
  a_ped_f?: number;
  a_pedal_f?: number;
  a_spcra?: number;
  a_posbac?: number;
  [key: string]: unknown;
}

/**
 * Aggregate an array of FARS crash records into yearly summary stats.
 */
function aggregateRecords(records: FarsRecord[], year: number): TrafficYearData {
  let totalCrashes = records.length;
  let totalFatalities = 0;
  let pedestrianFatalities = 0;
  let cyclistFatalities = 0;
  let alcoholRelated = 0;

  for (const r of records) {
    const fatals = typeof r.FATALS === "number" ? r.FATALS : (parseInt(String(r.FATALS), 10) || 0);
    totalFatalities += fatals;

    // Pedestrian: use analytical flag if available, otherwise PEDS field
    const peds = typeof r.PEDS === "number" ? r.PEDS : (parseInt(String(r.PEDS), 10) || 0);
    const pedFlag = typeof r.a_ped_f === "number" ? r.a_ped_f : (parseInt(String(r.a_ped_f), 10) || 0);
    if (pedFlag > 0 || peds > 0) {
      pedestrianFatalities++;
    }

    // Cyclist: analytical field only (not in all endpoints)
    const cyclistFlag = typeof r.a_pedal_f === "number" ? r.a_pedal_f : (parseInt(String(r.a_pedal_f), 10) || 0);
    if (cyclistFlag > 0) {
      cyclistFatalities++;
    }

    // Alcohol-related
    const drunk = typeof r.DRUNK_DR === "number" ? r.DRUNK_DR : (parseInt(String(r.DRUNK_DR), 10) || 0);
    if (drunk > 0) {
      alcoholRelated++;
    }
  }

  return {
    year,
    totalCrashes,
    totalFatalities,
    pedestrianFatalities,
    cyclistFatalities,
    alcoholRelated,
  };
}

/**
 * Parse FARS API JSON response — handles nested Results array.
 */
function parseFarsResponse(data: unknown): FarsRecord[] {
  if (!data || typeof data !== "object") return [];

  // FARS wraps results in a Results array, sometimes nested
  const d = data as Record<string, unknown>;

  // Try Results[0] (array of records nested in first element)
  if (Array.isArray(d.Results)) {
    const first = d.Results[0];
    if (Array.isArray(first)) return first as FarsRecord[];
    // Results itself might be the array of records
    if (d.Results.length > 0 && typeof d.Results[0] === "object" && !Array.isArray(d.Results[0])) {
      return d.Results as FarsRecord[];
    }
  }

  // Try direct array
  if (Array.isArray(data)) return data as FarsRecord[];

  return [];
}

/**
 * Fetch county-level FARS data using GetCrashesByLocation.
 * Queries year by year to stay under the 5000 record limit.
 */
async function fetchCountyFars(
  stateFips: number,
  countyFips: number,
  years: number[]
): Promise<TrafficYearData[]> {
  const results: TrafficYearData[] = [];

  for (const year of years) {
    try {
      const url = `${FARS_BASE}/crashes/GetCrashesByLocation?fromCaseYear=${year}&toCaseYear=${year}&state=${stateFips}&county=${countyFips}&format=json`;
      console.error(`[city-data-mcp] FARS county: state=${stateFips} county=${countyFips} year=${year}`);

      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "city-data-mcp/0.2.0",
        },
      });

      if (!response.ok) {
        console.error(`[city-data-mcp] FARS county API ${response.status} for year ${year}`);
        continue;
      }

      const data = await response.json();
      const records = parseFarsResponse(data);
      results.push(aggregateRecords(records, year));
    } catch (error) {
      console.error(`[city-data-mcp] FARS county error year=${year}:`, error);
    }
  }

  return results;
}

/**
 * Fetch state-level FARS data using GetFARSData (Accident dataset).
 * Richer analytical fields (pedestrian/cyclist flags).
 * Queries year by year for large states.
 */
async function fetchStateFars(
  stateFips: number,
  years: number[]
): Promise<TrafficYearData[]> {
  const results: TrafficYearData[] = [];

  for (const year of years) {
    try {
      const url = `${FARS_BASE}/FARSData/GetFARSData?dataset=Accident&FromYear=${year}&ToYear=${year}&State=${stateFips}&format=json`;
      console.error(`[city-data-mcp] FARS state: state=${stateFips} year=${year}`);

      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "city-data-mcp/0.2.0",
        },
      });

      if (!response.ok) {
        console.error(`[city-data-mcp] FARS state API ${response.status} for year ${year}`);
        continue;
      }

      const data = await response.json();
      const records = parseFarsResponse(data);
      results.push(aggregateRecords(records, year));
    } catch (error) {
      console.error(`[city-data-mcp] FARS state error year=${year}:`, error);
    }
  }

  return results;
}

// ── TTI Congestion Lookup ───────────────────────────────────────────────

function resolveTtiCity(input: string): CongestionData | null {
  const normalized = input.toLowerCase().trim();
  const key = TTI_ALIASES[normalized] || normalized;
  const data = TTI_CONGESTION[key];
  if (!data) return null;
  return {
    city: data.name,
    annualDelayHours: data.annualDelayHours,
    congestionCost: data.congestionCost,
    rankAmongMetros: data.rank,
    dataYear: data.dataYear,
  };
}

// ── Main Query Function ─────────────────────────────────────────────────

/**
 * Query traffic safety and congestion data for a US city.
 *
 * Returns county-level FARS data (primary) + state-level (context),
 * plus TTI congestion metrics if available for the city.
 */
export async function queryTraffic(city: string): Promise<TrafficResult> {
  const geo = await geoResolve(city);
  const stateFipsNum = parseInt(geo.stateFips, 10);
  const countyFipsNum = parseInt(geo.countyFips, 10);

  // Fire county + state fetches in parallel
  const [countyData, stateData] = await Promise.all([
    countyFipsNum
      ? fetchCountyFars(stateFipsNum, countyFipsNum, FARS_YEARS).catch((e) => {
          console.error(`[city-data-mcp] County FARS failed:`, e);
          return null;
        })
      : Promise.resolve(null),
    fetchStateFars(stateFipsNum, FARS_YEARS),
  ]);

  const population = getPopulation(city);
  const congestion = resolveTtiCity(city);

  // Compute per-capita fatality rates if population is known
  if (population) {
    const addRates = (years: TrafficYearData[]) => {
      for (const y of years) {
        y.fatalityRate = Math.round((y.totalFatalities / population) * 100000 * 10) / 10;
      }
    };
    if (countyData) addRates(countyData);
    addRates(stateData);
  }

  const hasCounty = countyData != null && countyData.length > 0 && countyData.some((y) => y.totalCrashes > 0);

  return {
    city: geo.city,
    stateAbbrev: geo.stateAbbrev,
    stateName: STATE_ABBREVS[geo.stateAbbrev] || geo.stateAbbrev,
    county: hasCounty
      ? {
          countyName: geo.countyName,
          countyFips: geo.fullCountyFips,
          years: countyData!,
        }
      : null,
    state: { years: stateData },
    congestion,
    population,
    dataLevel: hasCounty ? "county" : "state-only",
    note: hasCounty
      ? `County-level crash data for ${geo.countyName} with ${geo.stateAbbrev} statewide context. NHTSA FARS data, ${FARS_YEARS[0]}-${FARS_YEARS[FARS_YEARS.length - 1]}.`
      : `State-level crash data for ${STATE_ABBREVS[geo.stateAbbrev] || geo.stateAbbrev}. County data unavailable. NHTSA FARS, ${FARS_YEARS[0]}-${FARS_YEARS[FARS_YEARS.length - 1]}.`,
  };
}

// ── Formatter ───────────────────────────────────────────────────────────

function formatYearTable(years: TrafficYearData[]): string[] {
  const lines: string[] = [];

  if (years.length === 0) {
    lines.push("  _No data available_");
    return lines;
  }

  const sorted = [...years].sort((a, b) => a.year - b.year);

  lines.push("| Year | Crashes | Fatalities | Pedestrian | Cyclist | Alcohol | Rate/100K |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");

  for (const y of sorted) {
    const rate = y.fatalityRate != null ? y.fatalityRate.toFixed(1) : "N/A";
    lines.push(
      `| ${y.year} | ${y.totalCrashes.toLocaleString()} | ${y.totalFatalities.toLocaleString()} | ${y.pedestrianFatalities.toLocaleString()} | ${y.cyclistFatalities.toLocaleString()} | ${y.alcoholRelated.toLocaleString()} | ${rate} |`
    );
  }

  // Trend summary
  if (sorted.length >= 2) {
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    if (first.totalFatalities > 0) {
      const pctChange = ((last.totalFatalities - first.totalFatalities) / first.totalFatalities) * 100;
      const arrow = pctChange < -1 ? "↓" : pctChange > 1 ? "↑" : "→";
      lines.push(`\n${arrow} Fatalities ${pctChange > 0 ? "+" : ""}${pctChange.toFixed(1)}% from ${first.year} to ${last.year}`);
    }
  }

  return lines;
}

/**
 * Format traffic results into readable markdown for Claude.
 */
export function formatTrafficResults(result: TrafficResult): string {
  const lines: string[] = [];

  // County data (primary)
  if (result.county) {
    lines.push(`**${result.county.countyName} County** (NHTSA FARS)\n`);
    lines.push(...formatYearTable(result.county.years));
  }

  // State data (context)
  lines.push(`\n**${result.stateName} — Statewide** (NHTSA FARS)\n`);
  lines.push(...formatYearTable(result.state.years));

  // Congestion
  if (result.congestion) {
    lines.push(`\n**Congestion** (TTI Urban Mobility Report ${result.congestion.dataYear})`);
    lines.push(`- Annual Delay per Commuter: **${result.congestion.annualDelayHours} hours**`);
    lines.push(`- Cost per Commuter: **$${result.congestion.congestionCost.toLocaleString()}/yr**`);
    if (result.congestion.rankAmongMetros) {
      lines.push(`- Metro Congestion Rank: **#${result.congestion.rankAmongMetros}**`);
    }
  }

  lines.push(`\n*${result.note}*`);

  return lines.join("\n");
}

// ── List Function ───────────────────────────────────────────────────────

/**
 * List cities with TTI congestion data available.
 */
export function listTrafficCities(): Array<{ key: string; name: string }> {
  return Object.entries(TTI_CONGESTION)
    .map(([key, data]) => ({ key, name: data.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
