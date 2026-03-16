/**
 * FRED (Federal Reserve Economic Data) API Client
 *
 * FRED is maintained by the St. Louis Fed and contains 800,000+ economic
 * time series. We use it for metro-area economic indicators:
 * - Unemployment rate
 * - Consumer Price Index (CPI)
 * - Housing Price Index
 * - Personal income
 * - GDP (state-level)
 *
 * How it works:
 * 1. Each data series has an ID (e.g., "NYUR" = New York unemployment rate)
 * 2. You request observations for a series over a time range
 * 3. The API returns JSON with date-value pairs
 *
 * Series ID naming conventions:
 * - Metro unemployment: {MSA_CODE}UR (e.g., "NEWY636URN" for NYC)
 * - State unemployment: {STATE}UR (e.g., "NYUR" for New York state)
 * - National: UNRATE, CPIAUCSL, etc.
 *
 * API key: Free, register at https://fred.stlouisfed.org/docs/api/api_key.html
 * Set as FRED_API_KEY environment variable.
 */

const BASE_URL = "https://api.stlouisfed.org/fred";

// Metro area series IDs for major cities
// These map to specific MSA (Metropolitan Statistical Area) FRED series
const METRO_SERIES: Record<string, MetroConfig> = {
  nyc: {
    name: "New York City",
    unemployment: "NEWY636URN",        // NYC metro unemployment rate
    allEmployees: "NEWY636NA",          // All employees, nonfarm
    housingIndex: "ATNHPIUS35620Q",     // Housing Price Index (NYC metro)
    personalIncome: "PCPI36061",        // Per capita personal income (New York County)
  },
  chicago: {
    name: "Chicago",
    unemployment: "CHIC917URN",
    allEmployees: "CHIC917NA",
    housingIndex: "ATNHPIUS16980Q",
    personalIncome: "PCPI17031",        // Cook County
  },
  sf: {
    name: "San Francisco",
    unemployment: "SANF906URN",
    allEmployees: "SANF906NA",
    housingIndex: "ATNHPIUS41860Q",
    personalIncome: "PCPI06075",        // San Francisco County
  },
  la: {
    name: "Los Angeles",
    unemployment: "LOSA906URN",
    allEmployees: "LOSA906NA",
    housingIndex: "ATNHPIUS31080Q",
    personalIncome: "PCPI06037",        // LA County
  },
  seattle: {
    name: "Seattle",
    unemployment: "SEAT653URN",
    allEmployees: "SEAT653NA",
    housingIndex: "ATNHPIUS42660Q",
    personalIncome: "PCPI53033",        // King County
  },
  houston: {
    name: "Houston",
    unemployment: "HOUS448URN",
    allEmployees: "HOUS448NA",
    housingIndex: "ATNHPIUS26420Q",
    personalIncome: "PCPI48201",        // Harris County
  },
  phoenix: {
    name: "Phoenix",
    unemployment: "PHOE429URN",
    allEmployees: "PHOE429NA",
    housingIndex: "ATNHPIUS38060Q",
    personalIncome: "PCPI04013",        // Maricopa County
  },
  denver: {
    name: "Denver",
    unemployment: "DENV808URN",
    allEmployees: "DENV808NA",
    housingIndex: "ATNHPIUS19740Q",
    personalIncome: "PCPI08031",        // Denver County
  },
  boston: {
    name: "Boston",
    unemployment: "BOST625URN",
    allEmployees: "BOST625NA",
    housingIndex: "ATNHPIUS14460Q",
    personalIncome: "PCPI25025",        // Suffolk County
  },
  austin: {
    name: "Austin",
    unemployment: "AUST448URN",
    allEmployees: "AUST448NA",
    housingIndex: "ATNHPIUS12420Q",
    personalIncome: "PCPI48453",        // Travis County
  },
  dallas: {
    name: "Dallas",
    unemployment: "DALL448URN",
    allEmployees: "DALL448NA",
    housingIndex: "ATNHPIUS19100Q",
    personalIncome: "PCPI48113",        // Dallas County
  },
  dc: {
    name: "Washington, D.C.",
    unemployment: "WASH911URN",
    allEmployees: "WASH911NA",
    housingIndex: "ATNHPIUS47900Q",
    personalIncome: "PCPI11001",        // DC
  },
  atlanta: {
    name: "Atlanta",
    unemployment: "ATLA913URN",
    allEmployees: "ATLA913NA",
    housingIndex: "ATNHPIUS12060Q",
    personalIncome: "PCPI13121",        // Fulton County
  },
  miami: {
    name: "Miami",
    unemployment: "MIAM912URN",
    allEmployees: "MIAM912NA",
    housingIndex: "ATNHPIUS33100Q",
    personalIncome: "PCPI12086",        // Miami-Dade County
  },
  portland: {
    name: "Portland",
    unemployment: "PORT941URN",
    allEmployees: "PORT941NA",
    housingIndex: "ATNHPIUS38900Q",
    personalIncome: "PCPI41051",        // Multnomah County
  },
  detroit: {
    name: "Detroit",
    unemployment: "DETR926URN",
    allEmployees: "DETR926NA",
    housingIndex: "ATNHPIUS19820Q",
    personalIncome: "PCPI26163",        // Wayne County
  },
  minneapolis: {
    name: "Minneapolis",
    unemployment: "MINN927URN",
    allEmployees: "MINN927NA",
    housingIndex: "ATNHPIUS33460Q",
    personalIncome: "PCPI27053",        // Hennepin County
  },
  philadelphia: {
    name: "Philadelphia",
    unemployment: "PHIL942URN",
    allEmployees: "PHIL942NA",
    housingIndex: "ATNHPIUS37980Q",
    personalIncome: "PCPI42101",        // Philadelphia County
  },
  nashville: {
    name: "Nashville",
    unemployment: "NASH947URN",
    allEmployees: "NASH947NA",
    housingIndex: "ATNHPIUS34980Q",
    personalIncome: "PCPI47037",        // Davidson County
  },
  charlotte: {
    name: "Charlotte",
    unemployment: "CHAR937URN",
    allEmployees: "CHAR937NA",
    housingIndex: "ATNHPIUS16740Q",
    personalIncome: "PCPI37119",        // Mecklenburg County
  },
};

// National benchmark series
const NATIONAL_SERIES = {
  unemployment: "UNRATE",
  cpi: "CPIAUCSL",
  fedFundsRate: "FEDFUNDS",
  sp500: "SP500",
  housingStarts: "HOUST",
  gdp: "GDP",
};

// Aliases for city matching
const CITY_ALIASES: Record<string, string> = {
  "new york": "nyc", "new york city": "nyc", "manhattan": "nyc",
  "san francisco": "sf", "san fran": "sf",
  "los angeles": "la", "l.a.": "la",
  "washington": "dc", "washington dc": "dc", "d.c.": "dc",
  "philly": "philadelphia", "phila": "philadelphia",
};

interface MetroConfig {
  name: string;
  unemployment: string;
  allEmployees: string;
  housingIndex: string;
  personalIncome: string;
}

interface FredObservation {
  date: string;
  value: string;
}

interface FredSeriesResult {
  label: string;
  seriesId: string;
  latestValue: number | null;
  latestDate: string | null;
  previousValue: number | null;
  previousDate: string | null;
  change: number | null;
  unit: string;
}

export interface FredCityResult {
  city: string;
  series: FredSeriesResult[];
  fetchedAt: string;
}

/**
 * Resolve a city name to its FRED metro config.
 */
export function resolveFredCity(input: string): { key: string; config: MetroConfig } | null {
  const normalized = input.toLowerCase().trim();

  if (METRO_SERIES[normalized]) {
    return { key: normalized, config: METRO_SERIES[normalized] };
  }

  const aliasKey = CITY_ALIASES[normalized];
  if (aliasKey && METRO_SERIES[aliasKey]) {
    return { key: aliasKey, config: METRO_SERIES[aliasKey] };
  }

  for (const [key, config] of Object.entries(METRO_SERIES)) {
    if (config.name.toLowerCase() === normalized) {
      return { key, config };
    }
  }

  return null;
}

/**
 * List all cities with FRED data available.
 */
export function listFredCities(): Array<{ key: string; name: string }> {
  return Object.entries(METRO_SERIES).map(([key, config]) => ({
    key,
    name: config.name,
  }));
}

/**
 * Fetch a single FRED series — most recent observations.
 */
async function fetchSeries(
  seriesId: string,
  apiKey: string,
  limit: number = 12
): Promise<FredObservation[]> {
  const url = `${BASE_URL}/series/observations?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=${limit}`;

  console.error(`[city-data-mcp] FRED: ${url.replace(apiKey, "***")}`);

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`FRED API error for ${seriesId} (${response.status}): ${errorText.slice(0, 200)}`);
  }

  const data = (await response.json()) as { observations: FredObservation[] };
  return data.observations || [];
}

/**
 * Process a series into a summary with latest value and trend.
 */
function processSeries(
  observations: FredObservation[],
  label: string,
  seriesId: string,
  unit: string
): FredSeriesResult {
  // Filter out missing values (".")
  const valid = observations.filter((o) => o.value !== ".");

  if (valid.length === 0) {
    return { label, seriesId, latestValue: null, latestDate: null, previousValue: null, previousDate: null, change: null, unit };
  }

  const latest = valid[0];
  const previous = valid.length > 1 ? valid[1] : null;

  const latestVal = parseFloat(latest.value);
  const prevVal = previous ? parseFloat(previous.value) : null;
  const change = prevVal !== null ? latestVal - prevVal : null;

  return {
    label,
    seriesId,
    latestValue: latestVal,
    latestDate: latest.date,
    previousValue: prevVal,
    previousDate: previous?.date || null,
    change,
    unit,
  };
}

/**
 * Fetch economic data for a city from FRED.
 */
export async function queryFred(cityKey: string): Promise<FredCityResult> {
  const config = METRO_SERIES[cityKey];
  if (!config) {
    throw new Error(`Unknown city key: ${cityKey}`);
  }

  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) {
    throw new Error(
      "FRED_API_KEY not set. Get a free key at https://fred.stlouisfed.org/docs/api/api_key.html and set it as an environment variable."
    );
  }

  // Fetch all series in parallel
  const [unemployment, allEmployees, housingIndex, personalIncome, nationalUnemployment] = await Promise.all([
    fetchSeries(config.unemployment, apiKey).catch(() => []),
    fetchSeries(config.allEmployees, apiKey).catch(() => []),
    fetchSeries(config.housingIndex, apiKey, 8).catch(() => []),
    fetchSeries(config.personalIncome, apiKey, 4).catch(() => []),
    fetchSeries(NATIONAL_SERIES.unemployment, apiKey).catch(() => []),
  ]);

  const series: FredSeriesResult[] = [
    processSeries(unemployment, "Unemployment Rate", config.unemployment, "%"),
    processSeries(nationalUnemployment, "National Unemployment Rate", NATIONAL_SERIES.unemployment, "%"),
    processSeries(allEmployees, "Total Nonfarm Employment", config.allEmployees, "thousands"),
    processSeries(housingIndex, "Housing Price Index", config.housingIndex, "index"),
    processSeries(personalIncome, "Per Capita Personal Income", config.personalIncome, "$"),
  ];

  return {
    city: config.name,
    series,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Format FRED results into readable text for Claude.
 */
export function formatFredResults(result: FredCityResult): string {
  const lines: string[] = [
    `**${result.city}** — Economic Indicators (FRED)\n`,
  ];

  for (const s of result.series) {
    if (s.latestValue === null) {
      lines.push(`**${s.label}**: No data available`);
      continue;
    }

    let valueStr: string;
    if (s.unit === "$") {
      valueStr = `$${s.latestValue.toLocaleString()}`;
    } else if (s.unit === "%") {
      valueStr = `${s.latestValue.toFixed(1)}%`;
    } else if (s.unit === "thousands") {
      valueStr = `${s.latestValue.toLocaleString()}K`;
    } else {
      valueStr = s.latestValue.toFixed(1);
    }

    let trend = "";
    if (s.change !== null) {
      const arrow = s.change > 0 ? "↑" : s.change < 0 ? "↓" : "→";
      const changeStr = s.unit === "%" ? `${Math.abs(s.change).toFixed(1)}pp` : Math.abs(s.change).toLocaleString();
      trend = ` (${arrow} ${changeStr} from ${s.previousDate})`;
    }

    lines.push(`**${s.label}**: ${valueStr} (${s.latestDate})${trend}`);
  }

  return lines.join("\n");
}
