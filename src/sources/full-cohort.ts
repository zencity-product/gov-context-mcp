/**
 * Full Multi-Source City Cohort Builder
 *
 * Unlike the Census-only cohort, this pulls data from ALL sources:
 * - Census ACS (demographics, housing, commuting)
 * - FRED (economic indicators — unemployment, housing index, income)
 * - BLS (employment, labor force)
 * - FBI (crime rates)
 *
 * Limited to ~50 major metros where all sources overlap.
 * Slower (more API calls) but much richer comparison.
 */

import { queryCensus, type CensusResult } from "./census.js";
import { queryFred, resolveFredCity, type FredCityResult } from "./fred.js";
import { queryBls, resolveBlsCity, type BlsCityResult } from "./bls.js";
import { queryFbiCrime, resolveFbiCity, type FbiCrimeResult } from "./fbi.js";
import { queryTraffic, type TrafficResult } from "./traffic.js";

// Cities where we have overlap across Census + FRED + BLS + FBI
const FULL_POOL = [
  "New York", "Los Angeles", "Chicago", "Houston", "Phoenix",
  "Philadelphia", "San Antonio", "San Diego", "Dallas", "San Jose",
  "Austin", "Jacksonville", "Columbus", "Indianapolis",
  "Charlotte", "San Francisco", "Seattle", "Denver", "Nashville",
  "Oklahoma City", "Boston", "Portland", "Las Vegas", "Memphis",
  "Louisville", "Baltimore", "Milwaukee", "Albuquerque", "Tucson",
  "Fresno", "Sacramento", "Kansas City", "Atlanta", "Omaha",
  "Raleigh", "Virginia Beach", "Miami", "Minneapolis",
  "Tampa", "New Orleans", "Cleveland", "Pittsburgh",
  "St. Louis", "Cincinnati", "Orlando", "Salt Lake City",
  "Richmond", "Birmingham", "Buffalo", "Boise",
];

export type FullCohortCriteria =
  | "balanced"
  | "economics"
  | "livability"
  | "safety"
  | "growth"
  | "affordability";

interface FullCohortWeights {
  // Demographics (Census)
  population: number;
  medianIncome: number;
  povertyRate: number;
  educationRate: number;
  // Housing (Census + FRED)
  medianHomeValue: number;
  medianRent: number;
  housingIndex: number;
  // Economy (FRED + BLS)
  unemploymentRate: number;
  employmentGrowth: number;
  personalIncome: number;
  // Crime (FBI)
  crimeRate: number;
  // Traffic (NHTSA FARS)
  trafficFatalityRate: number;
  // Geography
  region: number;
}

const FULL_WEIGHT_PRESETS: Record<FullCohortCriteria, FullCohortWeights> = {
  balanced: {
    population: 0.10, medianIncome: 0.09, povertyRate: 0.06, educationRate: 0.05,
    medianHomeValue: 0.08, medianRent: 0.06, housingIndex: 0.05,
    unemploymentRate: 0.09, employmentGrowth: 0.07, personalIncome: 0.07,
    crimeRate: 0.09, trafficFatalityRate: 0.07, region: 0.12,
  },
  economics: {
    population: 0.05, medianIncome: 0.14, povertyRate: 0.09, educationRate: 0.05,
    medianHomeValue: 0.05, medianRent: 0.05, housingIndex: 0.05,
    unemploymentRate: 0.14, employmentGrowth: 0.14, personalIncome: 0.10,
    crimeRate: 0.05, trafficFatalityRate: 0.04, region: 0.05,
  },
  livability: {
    population: 0.05, medianIncome: 0.08, povertyRate: 0.09, educationRate: 0.09,
    medianHomeValue: 0.07, medianRent: 0.07, housingIndex: 0.04,
    unemploymentRate: 0.05, employmentGrowth: 0.05, personalIncome: 0.05,
    crimeRate: 0.18, trafficFatalityRate: 0.08, region: 0.10,
  },
  safety: {
    population: 0.05, medianIncome: 0.05, povertyRate: 0.08, educationRate: 0.04,
    medianHomeValue: 0.04, medianRent: 0.04, housingIndex: 0.00,
    unemploymentRate: 0.08, employmentGrowth: 0.04, personalIncome: 0.04,
    crimeRate: 0.30, trafficFatalityRate: 0.19, region: 0.05,
  },
  growth: {
    population: 0.10, medianIncome: 0.05, povertyRate: 0.05, educationRate: 0.05,
    medianHomeValue: 0.05, medianRent: 0.05, housingIndex: 0.10,
    unemploymentRate: 0.10, employmentGrowth: 0.19, personalIncome: 0.09,
    crimeRate: 0.04, trafficFatalityRate: 0.04, region: 0.09,
  },
  affordability: {
    population: 0.05, medianIncome: 0.10, povertyRate: 0.10, educationRate: 0.05,
    medianHomeValue: 0.20, medianRent: 0.20, housingIndex: 0.10,
    unemploymentRate: 0.05, employmentGrowth: 0.05, personalIncome: 0.05,
    crimeRate: 0.00, trafficFatalityRate: 0.00, region: 0.05,
  },
};

// Region mapping by state FIPS
const STATE_REGIONS: Record<string, string> = {
  "09": "northeast", "23": "northeast", "25": "northeast", "33": "northeast",
  "34": "northeast", "36": "northeast", "42": "northeast", "44": "northeast", "50": "northeast",
  "17": "midwest", "18": "midwest", "19": "midwest", "20": "midwest", "26": "midwest",
  "27": "midwest", "29": "midwest", "31": "midwest", "38": "midwest", "39": "midwest",
  "46": "midwest", "55": "midwest",
  "01": "south", "05": "south", "10": "south", "11": "south", "12": "south",
  "13": "south", "21": "south", "22": "south", "24": "south", "28": "south",
  "37": "south", "40": "south", "45": "south", "47": "south", "48": "south",
  "51": "south", "54": "south",
  "02": "west", "04": "west", "06": "west", "08": "west", "15": "west",
  "16": "west", "30": "west", "32": "west", "35": "west", "41": "west",
  "49": "west", "53": "west", "56": "west",
};

interface CityFullData {
  name: string;
  census: CensusResult | null;
  fred: FredCityResult | null;
  bls: BlsCityResult | null;
  fbi: FbiCrimeResult | null;
  traffic: TrafficResult | null;
}

interface FullCityScore {
  name: string;
  score: number;
  sameRegion: boolean;
  data: CityFullData;
  reasons: string[];
  dataSources: string[]; // which sources had data
}

/**
 * Fetch all available data for a single city.
 * Each source is independent — failures don't block others.
 */
async function fetchCityFullData(cityName: string): Promise<CityFullData> {
  const [census, fred, bls, fbi, traffic] = await Promise.allSettled([
    queryCensus(cityName),
    resolveFredCity(cityName) ? queryFred(cityName) : Promise.reject("no match"),
    resolveBlsCity(cityName) ? queryBls(cityName) : Promise.reject("no match"),
    resolveFbiCity(cityName)
      ? queryFbiCrime(resolveFbiCity(cityName)!.config.state, resolveFbiCity(cityName)!.key)
      : Promise.reject("no match"),
    queryTraffic(cityName),
  ]);

  return {
    name: cityName,
    census: census.status === "fulfilled" ? census.value : null,
    fred: fred.status === "fulfilled" ? fred.value : null,
    bls: bls.status === "fulfilled" ? bls.value : null,
    fbi: fbi.status === "fulfilled" ? fbi.value : null,
    traffic: traffic.status === "fulfilled" ? traffic.value : null,
  };
}

// Helper to extract a numeric value from FRED results by label keyword
function getFredValue(fred: FredCityResult | null, keyword: string): number | null {
  if (!fred) return null;
  const series = fred.series.find(s => s.label.toLowerCase().includes(keyword));
  return series?.latestValue ?? null;
}

// Helper to get latest violent crime rate from FBI data
function getCrimeRate(fbi: FbiCrimeResult | null): number | null {
  if (!fbi) return null;
  const violent = fbi.offenses.find(o => o.category === "violent-crime");
  if (!violent || violent.years.length === 0) return null;
  const latest = violent.years[violent.years.length - 1];
  return latest.rate ?? latest.count; // prefer rate, fallback to count
}

// Helper to get traffic fatality rate per 100K from NHTSA data
function getTrafficFatalityRate(traffic: TrafficResult | null): number | null {
  if (!traffic) return null;
  // Prefer county-level data, fall back to state
  const years = traffic.county?.years ?? traffic.state?.years;
  if (!years || years.length === 0) return null;
  const latest = years[years.length - 1];
  if (latest.fatalityRate != null) return latest.fatalityRate;
  // Compute from population if available
  if (traffic.population && latest.totalFatalities > 0) {
    return (latest.totalFatalities / traffic.population) * 100_000;
  }
  return latest.totalFatalities; // raw count as last resort
}

/**
 * Build a full multi-source cohort.
 */
export async function buildFullCohort(
  targetCityInput: string,
  criteria: FullCohortCriteria = "balanced",
  cohortSize: number = 5
): Promise<{ target: CityFullData; cohort: FullCityScore[]; criteria: FullCohortCriteria; poolSize: number }> {
  // Fetch target city from all sources
  const target = await fetchCityFullData(targetCityInput);

  if (!target.census) {
    throw new Error(`Could not find Census data for "${targetCityInput}". Census is required as the base.`);
  }

  // Fetch pool cities in parallel — batch to avoid overwhelming APIs
  const poolCities = FULL_POOL.filter(
    c => c.toLowerCase() !== target.name.toLowerCase() &&
         c.toLowerCase() !== (target.census?.city || "").toLowerCase().replace(/\s+(city|town)$/i, "")
  );

  // Fetch in batches of 10 to be respectful to APIs
  const allResults: CityFullData[] = [];
  for (let i = 0; i < poolCities.length; i += 10) {
    const batch = poolCities.slice(i, i + 10);
    const batchResults = await Promise.allSettled(
      batch.map(city => fetchCityFullData(city))
    );
    for (const r of batchResults) {
      if (r.status === "fulfilled" && r.value.census) {
        allResults.push(r.value);
      }
    }
  }

  // Score each city
  const weights = FULL_WEIGHT_PRESETS[criteria];
  const scored: FullCityScore[] = [];

  for (const candidate of allResults) {
    if (!candidate.census) continue;
    const score = computeFullSimilarity(target, candidate, weights);
    scored.push(score);
  }

  scored.sort((a, b) => a.score - b.score);

  return {
    target,
    cohort: scored.slice(0, cohortSize),
    criteria,
    poolSize: allResults.length,
  };
}

function computeFullSimilarity(
  target: CityFullData,
  candidate: CityFullData,
  weights: FullCohortWeights
): FullCityScore {
  const reasons: string[] = [];
  const dataSources: string[] = ["Census"];
  let totalScore = 0;

  const tc = target.census!;
  const cc = candidate.census!;

  // --- Census dimensions ---
  const popScore = normalizedDiff(
    Math.log10(tc.demographics.population || 1),
    Math.log10(cc.demographics.population || 1)
  );
  totalScore += popScore * weights.population;
  if (popScore < 0.12) reasons.push("similar size");

  const incScore = normalizedDiff(tc.demographics.medianIncome, cc.demographics.medianIncome);
  totalScore += incScore * weights.medianIncome;
  if (incScore < 0.12) reasons.push("similar income");

  const povScore = normalizedDiff(tc.demographics.povertyRate, cc.demographics.povertyRate);
  totalScore += povScore * weights.povertyRate;
  if (povScore < 0.12) reasons.push("similar poverty rate");

  const eduScore = normalizedDiff(tc.demographics.bachelorsDegreeRate, cc.demographics.bachelorsDegreeRate);
  totalScore += eduScore * weights.educationRate;
  if (eduScore < 0.12) reasons.push("similar education");

  const homeScore = normalizedDiff(tc.housing.medianHomeValue, cc.housing.medianHomeValue);
  totalScore += homeScore * weights.medianHomeValue;
  if (homeScore < 0.12) reasons.push("similar home values");

  const rentScore = normalizedDiff(tc.housing.medianRent, cc.housing.medianRent);
  totalScore += rentScore * weights.medianRent;
  if (rentScore < 0.12) reasons.push("similar rent");

  // --- FRED dimensions ---
  if (target.fred && candidate.fred) {
    dataSources.push("FRED");

    const tHousing = getFredValue(target.fred, "housing");
    const cHousing = getFredValue(candidate.fred, "housing");
    const hiScore = normalizedDiff(tHousing, cHousing);
    totalScore += hiScore * weights.housingIndex;
    if (hiScore < 0.12) reasons.push("similar housing trend");

    const tIncome = getFredValue(target.fred, "income");
    const cIncome = getFredValue(candidate.fred, "income");
    const piScore = normalizedDiff(tIncome, cIncome);
    totalScore += piScore * weights.personalIncome;
    if (piScore < 0.12) reasons.push("similar per-capita income");
  } else {
    // Neutral score for missing data
    totalScore += 0.5 * (weights.housingIndex + weights.personalIncome);
  }

  // --- BLS dimensions ---
  if (target.bls && candidate.bls) {
    dataSources.push("BLS");

    const uScore = normalizedDiff(
      target.bls.unemployment.current,
      candidate.bls.unemployment.current
    );
    totalScore += uScore * weights.unemploymentRate;
    if (uScore < 0.12) reasons.push("similar unemployment");

    const egScore = normalizedDiff(
      target.bls.employment.changePercent,
      candidate.bls.employment.changePercent
    );
    totalScore += egScore * weights.employmentGrowth;
    if (egScore < 0.12) reasons.push("similar job growth");
  } else {
    totalScore += 0.5 * (weights.unemploymentRate + weights.employmentGrowth);
  }

  // --- FBI dimensions ---
  if (target.fbi && candidate.fbi) {
    dataSources.push("FBI");

    const tCrime = getCrimeRate(target.fbi);
    const cCrime = getCrimeRate(candidate.fbi);
    const crimeScore = normalizedDiff(tCrime, cCrime);
    totalScore += crimeScore * weights.crimeRate;
    if (crimeScore < 0.12) reasons.push("similar crime rate");
  } else {
    totalScore += 0.5 * weights.crimeRate;
  }

  // --- Traffic dimensions (NHTSA FARS) ---
  if (target.traffic && candidate.traffic) {
    dataSources.push("NHTSA");

    const tFatality = getTrafficFatalityRate(target.traffic);
    const cFatality = getTrafficFatalityRate(candidate.traffic);
    const trafficScore = normalizedDiff(tFatality, cFatality);
    totalScore += trafficScore * weights.trafficFatalityRate;
    if (trafficScore < 0.12) reasons.push("similar traffic fatality rate");
  } else {
    totalScore += 0.5 * weights.trafficFatalityRate;
  }

  // --- Region ---
  const targetRegion = STATE_REGIONS[tc.stateFips] || "unknown";
  const candidateRegion = STATE_REGIONS[cc.stateFips] || "unknown";
  const sameRegion = targetRegion === candidateRegion;
  totalScore += (sameRegion ? 0 : 1) * weights.region;
  if (sameRegion) reasons.push("same region");

  return {
    name: candidate.census!.city,
    score: totalScore,
    sameRegion,
    data: candidate,
    reasons,
    dataSources,
  };
}

function normalizedDiff(a: number | null, b: number | null): number {
  if (a === null || b === null) return 0.5;
  if (a === 0 && b === 0) return 0;
  const max = Math.max(Math.abs(a), Math.abs(b));
  if (max === 0) return 0;
  return Math.abs(a - b) / max;
}

/**
 * Format full cohort results.
 */
export function formatFullCohortResults(
  result: { target: CityFullData; cohort: FullCityScore[]; criteria: FullCohortCriteria; poolSize: number }
): string {
  const { target, cohort, criteria, poolSize } = result;
  const tc = target.census!;

  const fmt = (n: number | null, type: "number" | "dollar" | "percent" | "rate"): string => {
    if (n === null) return "N/A";
    if (type === "dollar") return `$${n.toLocaleString()}`;
    if (type === "percent") return `${(n * 100).toFixed(1)}%`;
    if (type === "rate") return n.toFixed(1);
    return n.toLocaleString();
  };

  const lines: string[] = [
    `# Peer Cities for ${tc.city} — Full Analysis`,
    `*Criteria: ${criteria} | ${poolSize} cities compared across Census + FRED + BLS + FBI + NHTSA*\n`,
  ];

  // Target summary
  lines.push(`**${tc.city}** (target)`);
  lines.push(`Pop ${fmt(tc.demographics.population, "number")} · Income ${fmt(tc.demographics.medianIncome, "dollar")} · Home Value ${fmt(tc.housing.medianHomeValue, "dollar")}`);
  if (target.bls?.unemployment.current != null) {
    lines.push(`Unemployment ${fmt(target.bls.unemployment.current, "rate")}%`);
  }
  if (target.fbi) {
    const cr = getCrimeRate(target.fbi);
    if (cr != null) lines.push(`Violent Crime Rate: ${fmt(cr, "rate")} per 100K`);
  }
  if (target.traffic) {
    const tr = getTrafficFatalityRate(target.traffic);
    if (tr != null) lines.push(`Traffic Fatality Rate: ${fmt(tr, "rate")} per 100K`);
  }
  lines.push("");

  lines.push(`## Top ${cohort.length} Peer Cities\n`);

  for (let i = 0; i < cohort.length; i++) {
    const c = cohort[i];
    const similarity = Math.round((1 - c.score) * 100);
    const regionTag = c.sameRegion ? " · same region" : "";
    const sources = c.dataSources.join("+");

    lines.push(`### ${i + 1}. ${c.name} — ${similarity}% match${regionTag}`);
    lines.push(`*Data: ${sources}*`);

    if (c.data.census) {
      const d = c.data.census;
      lines.push(`Pop ${fmt(d.demographics.population, "number")} · Income ${fmt(d.demographics.medianIncome, "dollar")} · Home ${fmt(d.housing.medianHomeValue, "dollar")} · Rent ${fmt(d.housing.medianRent, "dollar")}`);
    }
    if (c.data.bls?.unemployment.current != null) {
      const bls = c.data.bls;
      lines.push(`Unemployment ${fmt(bls.unemployment.current, "rate")}% · Job Growth ${fmt(bls.employment.changePercent, "rate")}%`);
    }
    if (c.data.fbi) {
      const cr = getCrimeRate(c.data.fbi);
      if (cr != null) lines.push(`Violent Crime: ${fmt(cr, "rate")} per 100K`);
    }
    if (c.data.traffic) {
      const tr = getTrafficFatalityRate(c.data.traffic);
      if (tr != null) lines.push(`Traffic Fatalities: ${fmt(tr, "rate")} per 100K`);
    }

    if (c.reasons.length > 0) {
      lines.push(`*Match: ${c.reasons.join(", ")}*`);
    }
    lines.push("");
  }

  // Comparison table
  lines.push("## Comparison Table\n");
  const all = [
    { name: tc.city, data: target },
    ...cohort.map(c => ({ name: c.name, data: c.data })),
  ];

  lines.push(`| Metric | ${all.map(c => c.name).join(" | ")} |`);
  lines.push(`| --- | ${all.map(() => "---").join(" | ")} |`);
  lines.push(`| Population | ${all.map(c => fmt(c.data.census?.demographics.population ?? null, "number")).join(" | ")} |`);
  lines.push(`| Median Income | ${all.map(c => fmt(c.data.census?.demographics.medianIncome ?? null, "dollar")).join(" | ")} |`);
  lines.push(`| Poverty Rate | ${all.map(c => fmt(c.data.census?.demographics.povertyRate ?? null, "percent")).join(" | ")} |`);
  lines.push(`| Home Value | ${all.map(c => fmt(c.data.census?.housing.medianHomeValue ?? null, "dollar")).join(" | ")} |`);
  lines.push(`| Rent | ${all.map(c => fmt(c.data.census?.housing.medianRent ?? null, "dollar")).join(" | ")} |`);
  lines.push(`| Unemployment | ${all.map(c => c.data.bls?.unemployment.current != null ? `${c.data.bls.unemployment.current.toFixed(1)}%` : "N/A").join(" | ")} |`);
  lines.push(`| Violent Crime | ${all.map(c => { const r = getCrimeRate(c.data.fbi); return r != null ? fmt(r, "rate") : "N/A"; }).join(" | ")} |`);
  lines.push(`| Traffic Fatalities | ${all.map(c => { const r = getTrafficFatalityRate(c.data.traffic); return r != null ? fmt(r, "rate") : "N/A"; }).join(" | ")} |`);

  return lines.join("\n");
}
