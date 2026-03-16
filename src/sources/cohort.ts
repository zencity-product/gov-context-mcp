/**
 * City Cohort Builder
 *
 * Finds peer cities based on demographic and economic similarity.
 * Uses Census data to compute a similarity score across multiple dimensions:
 * - Population size
 * - Median income
 * - Poverty rate
 * - Education level
 * - Housing costs
 * - Commuting patterns
 *
 * The user can bias the weighting toward specific dimensions
 * (e.g., "find cities with similar economics" or "similar size and region").
 */

import { queryCensus, listCensusCities, resolveCensusFips, type CensusResult } from "./census.js";

// Region mapping for geographic similarity
const CITY_REGIONS: Record<string, string> = {
  nyc: "northeast", boston: "northeast", philadelphia: "northeast", pittsburgh: "northeast",
  dc: "south", atlanta: "south", miami: "south", charlotte: "south", nashville: "south",
  raleigh: "south", jacksonville: "south", memphis: "south", baltimore: "south",
  houston: "south", dallas: "south", austin: "south", san_antonio: "south",
  chicago: "midwest", detroit: "midwest", minneapolis: "midwest", columbus: "midwest",
  indianapolis: "midwest", milwaukee: "midwest",
  denver: "west", phoenix: "west", seattle: "west", sf: "west", la: "west",
  san_diego: "west", portland: "west",
};

export type CohortCriteria = "balanced" | "size" | "economics" | "housing" | "education" | "commuting" | "region";

interface CohortWeights {
  population: number;
  medianIncome: number;
  povertyRate: number;
  bachelorsDegreeRate: number;
  medianHomeValue: number;
  medianRent: number;
  publicTransitRate: number;
  workFromHomeRate: number;
  region: number;
}

const WEIGHT_PRESETS: Record<CohortCriteria, CohortWeights> = {
  balanced: {
    population: 0.20, medianIncome: 0.15, povertyRate: 0.10,
    bachelorsDegreeRate: 0.10, medianHomeValue: 0.15, medianRent: 0.10,
    publicTransitRate: 0.05, workFromHomeRate: 0.05, region: 0.10,
  },
  size: {
    population: 0.60, medianIncome: 0.05, povertyRate: 0.05,
    bachelorsDegreeRate: 0.05, medianHomeValue: 0.05, medianRent: 0.05,
    publicTransitRate: 0.05, workFromHomeRate: 0.05, region: 0.05,
  },
  economics: {
    population: 0.05, medianIncome: 0.30, povertyRate: 0.25,
    bachelorsDegreeRate: 0.10, medianHomeValue: 0.10, medianRent: 0.10,
    publicTransitRate: 0.00, workFromHomeRate: 0.00, region: 0.10,
  },
  housing: {
    population: 0.05, medianIncome: 0.10, povertyRate: 0.05,
    bachelorsDegreeRate: 0.05, medianHomeValue: 0.30, medianRent: 0.30,
    publicTransitRate: 0.00, workFromHomeRate: 0.05, region: 0.10,
  },
  education: {
    population: 0.10, medianIncome: 0.15, povertyRate: 0.10,
    bachelorsDegreeRate: 0.40, medianHomeValue: 0.05, medianRent: 0.05,
    publicTransitRate: 0.00, workFromHomeRate: 0.05, region: 0.10,
  },
  commuting: {
    population: 0.10, medianIncome: 0.05, povertyRate: 0.00,
    bachelorsDegreeRate: 0.00, medianHomeValue: 0.05, medianRent: 0.05,
    publicTransitRate: 0.35, workFromHomeRate: 0.30, region: 0.10,
  },
  region: {
    population: 0.15, medianIncome: 0.10, povertyRate: 0.05,
    bachelorsDegreeRate: 0.05, medianHomeValue: 0.10, medianRent: 0.05,
    publicTransitRate: 0.05, workFromHomeRate: 0.05, region: 0.40,
  },
};

interface CityScore {
  key: string;
  name: string;
  score: number;       // 0-1, lower = more similar
  sameRegion: boolean;
  data: CensusResult;
  reasons: string[];   // Why this city matched
}

/**
 * Build a cohort of similar cities for a given target city.
 */
export async function buildCohort(
  targetCityInput: string,
  criteria: CohortCriteria = "balanced",
  cohortSize: number = 5
): Promise<{ target: CensusResult; cohort: CityScore[]; criteria: CohortCriteria }> {
  // Resolve the target city
  const targetMatch = resolveCensusFips(targetCityInput);
  if (!targetMatch) {
    throw new Error(`City "${targetCityInput}" not found in Census data.`);
  }

  // Fetch target city data
  const targetData = await queryCensus(targetMatch.key);

  // Fetch all other cities in parallel
  const allCities = listCensusCities().filter((c) => c.key !== targetMatch.key);

  const cityResults = await Promise.allSettled(
    allCities.map(async (c) => {
      const data = await queryCensus(c.key);
      return { key: c.key, data };
    })
  );

  const successfulCities = cityResults
    .filter((r): r is PromiseFulfilledResult<{ key: string; data: CensusResult }> => r.status === "fulfilled")
    .map((r) => r.value);

  // Score each city against the target
  const weights = WEIGHT_PRESETS[criteria];
  const scored: CityScore[] = [];

  for (const { key, data } of successfulCities) {
    const score = computeSimilarity(targetMatch.key, targetData, key, data, weights);
    scored.push(score);
  }

  // Sort by similarity score (lowest = most similar)
  scored.sort((a, b) => a.score - b.score);

  return {
    target: targetData,
    cohort: scored.slice(0, cohortSize),
    criteria,
  };
}

/**
 * Compute a similarity score between two cities.
 * Lower score = more similar.
 */
function computeSimilarity(
  targetKey: string,
  target: CensusResult,
  candidateKey: string,
  candidate: CensusResult,
  weights: CohortWeights
): CityScore {
  const reasons: string[] = [];
  let totalScore = 0;

  // Population — use log scale since city sizes span orders of magnitude
  const popScore = normalizedDiff(
    Math.log10(target.demographics.population || 1),
    Math.log10(candidate.demographics.population || 1)
  );
  totalScore += popScore * weights.population;
  if (popScore < 0.15) reasons.push("similar population size");

  // Median income
  const incomeScore = normalizedDiff(
    target.demographics.medianIncome,
    candidate.demographics.medianIncome
  );
  totalScore += incomeScore * weights.medianIncome;
  if (incomeScore < 0.15) reasons.push("similar income levels");

  // Poverty rate
  const povertyScore = normalizedDiff(
    target.demographics.povertyRate,
    candidate.demographics.povertyRate
  );
  totalScore += povertyScore * weights.povertyRate;
  if (povertyScore < 0.15) reasons.push("similar poverty rate");

  // Education
  const eduScore = normalizedDiff(
    target.demographics.bachelorsDegreeRate,
    candidate.demographics.bachelorsDegreeRate
  );
  totalScore += eduScore * weights.bachelorsDegreeRate;
  if (eduScore < 0.15) reasons.push("similar education levels");

  // Home value
  const homeScore = normalizedDiff(
    target.housing.medianHomeValue,
    candidate.housing.medianHomeValue
  );
  totalScore += homeScore * weights.medianHomeValue;
  if (homeScore < 0.15) reasons.push("similar home values");

  // Rent
  const rentScore = normalizedDiff(
    target.housing.medianRent,
    candidate.housing.medianRent
  );
  totalScore += rentScore * weights.medianRent;
  if (rentScore < 0.15) reasons.push("similar rent");

  // Public transit
  const transitScore = normalizedDiff(
    target.commuting.publicTransitRate,
    candidate.commuting.publicTransitRate
  );
  totalScore += transitScore * weights.publicTransitRate;
  if (transitScore < 0.15) reasons.push("similar transit usage");

  // Work from home
  const wfhScore = normalizedDiff(
    target.commuting.workFromHomeRate,
    candidate.commuting.workFromHomeRate
  );
  totalScore += wfhScore * weights.workFromHomeRate;
  if (wfhScore < 0.15) reasons.push("similar WFH rates");

  // Region
  const targetRegion = CITY_REGIONS[targetKey] || "unknown";
  const candidateRegion = CITY_REGIONS[candidateKey] || "unknown";
  const sameRegion = targetRegion === candidateRegion;
  const regionScore = sameRegion ? 0 : 1;
  totalScore += regionScore * weights.region;
  if (sameRegion) reasons.push("same region");

  return {
    key: candidateKey,
    name: candidate.city,
    score: totalScore,
    sameRegion,
    data: candidate,
    reasons,
  };
}

/**
 * Normalized absolute difference between two values.
 * Returns 0-1 where 0 = identical, 1 = very different.
 */
function normalizedDiff(a: number | null, b: number | null): number {
  if (a === null || b === null) return 0.5; // neutral if data missing
  if (a === 0 && b === 0) return 0;
  const max = Math.max(Math.abs(a), Math.abs(b));
  if (max === 0) return 0;
  return Math.abs(a - b) / max;
}

/**
 * Format cohort results into readable text for Claude.
 */
export function formatCohortResults(
  result: { target: CensusResult; cohort: CityScore[]; criteria: CohortCriteria }
): string {
  const { target, cohort, criteria } = result;
  const fmt = (n: number | null, type: "number" | "dollar" | "percent"): string => {
    if (n === null) return "N/A";
    if (type === "dollar") return `$${n.toLocaleString()}`;
    if (type === "percent") return `${(n * 100).toFixed(1)}%`;
    return n.toLocaleString();
  };

  const lines: string[] = [
    `# Peer Cities for ${target.city}`,
    `*Criteria: ${criteria} | Based on Census ACS demographic data*\n`,
    `**${target.city}** (target): Pop ${fmt(target.demographics.population, "number")}, Income ${fmt(target.demographics.medianIncome, "dollar")}, Home Value ${fmt(target.housing.medianHomeValue, "dollar")}\n`,
    `## Top ${cohort.length} Peer Cities\n`,
  ];

  for (let i = 0; i < cohort.length; i++) {
    const c = cohort[i];
    const similarity = Math.round((1 - c.score) * 100);
    const regionTag = c.sameRegion ? " 📍 same region" : "";

    lines.push(`### ${i + 1}. ${c.name} (${similarity}% similar${regionTag})`);
    lines.push(`Pop ${fmt(c.data.demographics.population, "number")} | Income ${fmt(c.data.demographics.medianIncome, "dollar")} | Home Value ${fmt(c.data.housing.medianHomeValue, "dollar")} | Poverty ${fmt(c.data.demographics.povertyRate, "percent")} | Transit ${fmt(c.data.commuting.publicTransitRate, "percent")}`);

    if (c.reasons.length > 0) {
      lines.push(`*Why:* ${c.reasons.join(", ")}`);
    }
    lines.push("");
  }

  // Comparison table
  lines.push("## Quick Comparison\n");
  const allCities = [{ name: target.city, data: target }, ...cohort.map((c) => ({ name: c.name, data: c.data }))];
  lines.push(`| Metric | ${allCities.map((c) => c.name).join(" | ")} |`);
  lines.push(`| --- | ${allCities.map(() => "---").join(" | ")} |`);
  lines.push(`| Population | ${allCities.map((c) => fmt(c.data.demographics.population, "number")).join(" | ")} |`);
  lines.push(`| Median Income | ${allCities.map((c) => fmt(c.data.demographics.medianIncome, "dollar")).join(" | ")} |`);
  lines.push(`| Poverty Rate | ${allCities.map((c) => fmt(c.data.demographics.povertyRate, "percent")).join(" | ")} |`);
  lines.push(`| Bachelor's % | ${allCities.map((c) => fmt(c.data.demographics.bachelorsDegreeRate, "percent")).join(" | ")} |`);
  lines.push(`| Home Value | ${allCities.map((c) => fmt(c.data.housing.medianHomeValue, "dollar")).join(" | ")} |`);
  lines.push(`| Median Rent | ${allCities.map((c) => fmt(c.data.housing.medianRent, "dollar")).join(" | ")} |`);
  lines.push(`| Transit % | ${allCities.map((c) => fmt(c.data.commuting.publicTransitRate, "percent")).join(" | ")} |`);
  lines.push(`| WFH % | ${allCities.map((c) => fmt(c.data.commuting.workFromHomeRate, "percent")).join(" | ")} |`);

  return lines.join("\n");
}
