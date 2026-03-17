/**
 * HUD (Department of Housing and Urban Development) API Client
 *
 * Provides Fair Market Rents (FMR) and income limits by geography.
 * Useful for understanding housing affordability and HUD program thresholds.
 *
 * Key data:
 * - Fair Market Rents by bedroom count (studio through 4BR)
 * - Area Median Income
 * - Income limits (extremely low, very low, low)
 *
 * The API works with county-level FIPS codes or state + county.
 * No API key required for basic queries.
 *
 * Docs: https://www.huduser.gov/portal/dataset/fmr-api.html
 */

import { resolveCity as geoResolve } from "./geo-resolver.js";

const FMR_BASE = "https://www.huduser.gov/hudapi/public/fmr/data";
const IL_BASE = "https://www.huduser.gov/hudapi/public/il/data";

// Map cities to their county FIPS (state + county)
const CITY_COUNTIES: Record<string, { fips: string; name: string; county: string }> = {
  "new york": { fips: "3600599999", name: "New York City", county: "New York County" },
  "nyc": { fips: "3600599999", name: "New York City", county: "New York County" },
  "los angeles": { fips: "0603799999", name: "Los Angeles", county: "Los Angeles County" },
  "la": { fips: "0603799999", name: "Los Angeles", county: "Los Angeles County" },
  "chicago": { fips: "1703199999", name: "Chicago", county: "Cook County" },
  "houston": { fips: "4820199999", name: "Houston", county: "Harris County" },
  "phoenix": { fips: "0401399999", name: "Phoenix", county: "Maricopa County" },
  "philadelphia": { fips: "4210199999", name: "Philadelphia", county: "Philadelphia County" },
  "philly": { fips: "4210199999", name: "Philadelphia", county: "Philadelphia County" },
  "san diego": { fips: "0607399999", name: "San Diego", county: "San Diego County" },
  "dallas": { fips: "4811399999", name: "Dallas", county: "Dallas County" },
  "austin": { fips: "4845399999", name: "Austin", county: "Travis County" },
  "san francisco": { fips: "0607599999", name: "San Francisco", county: "San Francisco County" },
  "sf": { fips: "0607599999", name: "San Francisco", county: "San Francisco County" },
  "seattle": { fips: "5303399999", name: "Seattle", county: "King County" },
  "denver": { fips: "0803199999", name: "Denver", county: "Denver County" },
  "boston": { fips: "2502599999", name: "Boston", county: "Suffolk County" },
  "nashville": { fips: "4703799999", name: "Nashville", county: "Davidson County" },
  "portland": { fips: "4105199999", name: "Portland", county: "Multnomah County" },
  "atlanta": { fips: "1312199999", name: "Atlanta", county: "Fulton County" },
  "miami": { fips: "1208699999", name: "Miami", county: "Miami-Dade County" },
  "washington": { fips: "1100199999", name: "Washington, D.C.", county: "District of Columbia" },
  "dc": { fips: "1100199999", name: "Washington, D.C.", county: "District of Columbia" },
  "minneapolis": { fips: "2705399999", name: "Minneapolis", county: "Hennepin County" },
  "detroit": { fips: "2616399999", name: "Detroit", county: "Wayne County" },
  "baltimore": { fips: "2400399999", name: "Baltimore", county: "Baltimore City" },
  "charlotte": { fips: "3711999999", name: "Charlotte", county: "Mecklenburg County" },
  "pittsburgh": { fips: "4200399999", name: "Pittsburgh", county: "Allegheny County" },
  "las vegas": { fips: "3200399999", name: "Las Vegas", county: "Clark County" },
  "vegas": { fips: "3200399999", name: "Las Vegas", county: "Clark County" },
  "raleigh": { fips: "3718399999", name: "Raleigh", county: "Wake County" },
  "boise": { fips: "1600199999", name: "Boise", county: "Ada County" },
  "salt lake city": { fips: "4903599999", name: "Salt Lake City", county: "Salt Lake County" },
  "tampa": { fips: "1205799999", name: "Tampa", county: "Hillsborough County" },
  "orlando": { fips: "1209599999", name: "Orlando", county: "Orange County" },

  // Additional cities
  "san jose": { fips: "0608599999", name: "San Jose", county: "Santa Clara County" },
  "jacksonville": { fips: "1203199999", name: "Jacksonville", county: "Duval County" },
  "jax": { fips: "1203199999", name: "Jacksonville", county: "Duval County" },
  "columbus": { fips: "3904999999", name: "Columbus", county: "Franklin County" },
  "indianapolis": { fips: "1809799999", name: "Indianapolis", county: "Marion County" },
  "indy": { fips: "1809799999", name: "Indianapolis", county: "Marion County" },
  "san antonio": { fips: "4802999999", name: "San Antonio", county: "Bexar County" },
  "oklahoma city": { fips: "4010999999", name: "Oklahoma City", county: "Oklahoma County" },
  "okc": { fips: "4010999999", name: "Oklahoma City", county: "Oklahoma County" },
  "memphis": { fips: "4715799999", name: "Memphis", county: "Shelby County" },
  "louisville": { fips: "2111199999", name: "Louisville", county: "Jefferson County" },
  "milwaukee": { fips: "5507999999", name: "Milwaukee", county: "Milwaukee County" },
  "albuquerque": { fips: "3500199999", name: "Albuquerque", county: "Bernalillo County" },
  "tucson": { fips: "0401999999", name: "Tucson", county: "Pima County" },
  "fresno": { fips: "0601999999", name: "Fresno", county: "Fresno County" },
  "sacramento": { fips: "0606799999", name: "Sacramento", county: "Sacramento County" },
  "kansas city": { fips: "2909599999", name: "Kansas City", county: "Jackson County" },
  "kc": { fips: "2909599999", name: "Kansas City", county: "Jackson County" },
  "omaha": { fips: "3105599999", name: "Omaha", county: "Douglas County" },
  "cleveland": { fips: "3903599999", name: "Cleveland", county: "Cuyahoga County" },
  "cle": { fips: "3903599999", name: "Cleveland", county: "Cuyahoga County" },
  "new orleans": { fips: "2207199999", name: "New Orleans", county: "Orleans Parish" },
  "nola": { fips: "2207199999", name: "New Orleans", county: "Orleans Parish" },
  "st. louis": { fips: "2951099999", name: "St. Louis", county: "St. Louis City" },
  "st louis": { fips: "2951099999", name: "St. Louis", county: "St. Louis City" },
  "stl": { fips: "2951099999", name: "St. Louis", county: "St. Louis City" },
  "cincinnati": { fips: "3906199999", name: "Cincinnati", county: "Hamilton County" },
  "cincy": { fips: "3906199999", name: "Cincinnati", county: "Hamilton County" },
  "richmond": { fips: "5176099999", name: "Richmond", county: "Richmond City" },
  "hartford": { fips: "0900399999", name: "Hartford", county: "Hartford County" },
  "buffalo": { fips: "3602999999", name: "Buffalo", county: "Erie County" },
  "rochester": { fips: "3605599999", name: "Rochester", county: "Monroe County" },
  "providence": { fips: "4400799999", name: "Providence", county: "Providence County" },
  "virginia beach": { fips: "5181099999", name: "Virginia Beach", county: "Virginia Beach City" },
  "birmingham": { fips: "0107399999", name: "Birmingham", county: "Jefferson County" },

  // Additional aliases
  "slc": { fips: "4903599999", name: "Salt Lake City", county: "Salt Lake County" },
  "pgh": { fips: "4200399999", name: "Pittsburgh", county: "Allegheny County" },
};

export interface HudResult {
  city: string;
  county: string;
  fairMarketRents: {
    studio: number | null;
    oneBr: number | null;
    twoBr: number | null;
    threeBr: number | null;
    fourBr: number | null;
  };
  areaMedianIncome: number | null;
  incomeLimits: {
    extremelyLow: number | null;  // 30% AMI
    veryLow: number | null;       // 50% AMI
    low: number | null;           // 80% AMI
  };
  year: string;
}

function resolveCounty(city: string): { fips: string; name: string; county: string } | null {
  const normalized = city.toLowerCase().trim();
  if (CITY_COUNTIES[normalized]) return CITY_COUNTIES[normalized];
  for (const [key, val] of Object.entries(CITY_COUNTIES)) {
    if (val.name.toLowerCase() === normalized) return val;
  }
  return null;
}

export function listHudCities(): string[] {
  return [...new Set(Object.values(CITY_COUNTIES).map(v => v.name))].sort();
}

export async function queryHud(city: string): Promise<HudResult> {
  let match = resolveCounty(city);
  if (!match) {
    try {
      const geo = await geoResolve(city);
      match = {
        fips: `${geo.stateFips}${geo.countyFips}99999`,
        name: geo.city,
        county: geo.countyName,
      };
    } catch {
      // geo-resolver failed
    }
  }
  if (!match) {
    throw new Error(`City "${city}" not found in HUD data and geo-resolver could not resolve it.`);
  }

  // Extract state+county FIPS for the API
  const stateFips = match.fips.slice(0, 2);
  const countyFips = match.fips.slice(2, 5);
  const entityId = `${stateFips}${countyFips}99999`; // HUD "metro" entity format

  // Try fetching FMR and Income Limits
  const [fmrData, ilData] = await Promise.all([
    fetchHud(`${FMR_BASE}/${entityId}`).catch(() => null),
    fetchHud(`${IL_BASE}/${entityId}`).catch(() => null),
  ]);

  // Parse FMR
  const basicdata = fmrData?.data?.basicdata;
  const fmr = basicdata
    ? {
        studio: parseNum(basicdata.fmr_0),
        oneBr: parseNum(basicdata.fmr_1),
        twoBr: parseNum(basicdata.fmr_2),
        threeBr: parseNum(basicdata.fmr_3),
        fourBr: parseNum(basicdata.fmr_4),
      }
    : { studio: null, oneBr: null, twoBr: null, threeBr: null, fourBr: null };

  // Parse Income Limits
  const ilBasic = ilData?.data?.basicdata;
  const areaMedianIncome = parseNum(ilBasic?.median_income);
  const incomeLimits = ilBasic
    ? {
        extremelyLow: parseNum(ilBasic.l30_p1), // 1-person extremely low
        veryLow: parseNum(ilBasic.l50_p1),
        low: parseNum(ilBasic.l80_p1),
      }
    : { extremelyLow: null, veryLow: null, low: null };

  return {
    city: match.name,
    county: match.county,
    fairMarketRents: fmr,
    areaMedianIncome,
    incomeLimits,
    year: basicdata?.year || fmrData?.data?.year || "2025",
  };
}

async function fetchHud(url: string): Promise<any> {
  console.error(`[city-data-mcp] HUD: ${url}`);
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    console.error(`[city-data-mcp] HUD ${response.status}`);
    return null;
  }
  return response.json();
}

function parseNum(val: any): number | null {
  if (val == null) return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

export function formatHudResults(result: HudResult): string {
  const fmt = (n: number | null): string => n !== null ? `$${n.toLocaleString()}` : "N/A";

  return `**${result.city}** (${result.county}) — HUD Housing Data (${result.year})

**Fair Market Rents (monthly):**
  - Studio: ${fmt(result.fairMarketRents.studio)}
  - 1 Bedroom: ${fmt(result.fairMarketRents.oneBr)}
  - 2 Bedroom: ${fmt(result.fairMarketRents.twoBr)}
  - 3 Bedroom: ${fmt(result.fairMarketRents.threeBr)}
  - 4 Bedroom: ${fmt(result.fairMarketRents.fourBr)}

**Area Median Income:** ${fmt(result.areaMedianIncome)}

**Income Limits (1-person household):**
  - Extremely Low (30% AMI): ${fmt(result.incomeLimits.extremelyLow)}
  - Very Low (50% AMI): ${fmt(result.incomeLimits.veryLow)}
  - Low (80% AMI): ${fmt(result.incomeLimits.low)}`;
}
