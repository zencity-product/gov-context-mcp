/**
 * Issue Mapper — Cross-Reference Engine
 *
 * Given a community concern topic and a city, returns all relevant hard data
 * from our data sources. This is the bridge between "what residents are saying"
 * and "what the data shows."
 *
 * Usage:
 *   const result = await mapIssueData("Denver", "housing affordability");
 *   console.log(formatIssueData(result));
 */

import { queryCensus, type CensusResult } from "./census.js";
import { queryFred, resolveFredCity, type FredCityResult } from "./fred.js";
import { queryBls, resolveBlsCity, type BlsCityResult } from "./bls.js";
import { queryFbiCrime, resolveFbiCity, type FbiCrimeResult } from "./fbi.js";
import { queryAirQuality, type AirQualityResult } from "./airnow.js";
import { queryHud, type HudResult } from "./hud.js";
import { queryWater, type WaterResult } from "./usgs.js";
import { query311Trends, type Three11Result } from "./three11.js";
import { queryTransit, type TransitResult } from "./transit.js";
import { querySchools, type SchoolResult } from "./schools.js";
import { queryPermits, type PermitResult } from "./permits.js";
import { queryBudget, type BudgetResult } from "./budget.js";
import { queryTraffic, type TrafficResult } from "./traffic.js";

// ── Result interfaces ───────────────────────────────────────────────────────

export interface IssueDataResult {
  city: string;
  issue: string;
  issueLabel: string;
  findings: Array<{
    source: string;
    metric: string;
    value: string;
    context: string;
  }>;
  dataSources: {
    queried: string[];
    hadData: string[];
    noData: string[];
  };
}

// ── Issue configuration ─────────────────────────────────────────────────────

interface IssueConfig {
  label: string;
  description: string;
  sources: string[];
  censusFields?: string[];
  fredKeywords?: string[];
  budgetCategories?: string[];
  three11Categories?: string[];
}

const ISSUE_MAP: Record<string, IssueConfig> = {
  "housing affordability": {
    label: "Housing Affordability",
    description: "Housing costs, rent burden, fair market rents, home values, building permits",
    sources: ["census", "hud", "fred", "permits", "budget"],
    censusFields: ["medianHomeValue", "medianRent", "rentBurden"],
    fredKeywords: ["housing"],
    budgetCategories: ["housing", "community development"],
  },
  "public safety": {
    label: "Public Safety",
    description: "Crime rates, police budget, 311 safety complaints",
    sources: ["fbi", "budget", "311"],
    budgetCategories: ["police", "safety", "fire"],
    three11Categories: ["noise", "assault", "gun", "weapon"],
  },
  "traffic safety": {
    label: "Traffic Safety",
    description: "Traffic fatalities, pedestrian safety, drunk driving crashes, congestion",
    sources: ["traffic", "census", "budget"],
    censusFields: ["publicTransitRate", "driveAloneRate"],
    budgetCategories: ["transportation", "streets", "traffic", "highway"],
  },
  "pedestrian safety": {
    label: "Pedestrian & Cyclist Safety",
    description: "Pedestrian fatalities, cyclist deaths, Vision Zero, walkability",
    sources: ["traffic", "census", "budget", "311"],
    censusFields: ["publicTransitRate", "driveAloneRate"],
    budgetCategories: ["transportation", "streets"],
    three11Categories: ["pothole", "street", "traffic", "sidewalk", "crosswalk", "signal"],
  },
  "transportation": {
    label: "Transportation & Infrastructure",
    description: "Transit ridership, commuting patterns, road conditions, traffic safety",
    sources: ["traffic", "transit", "census", "budget", "311"],
    censusFields: ["publicTransitRate", "meanCommuteTime", "driveAloneRate"],
    budgetCategories: ["transportation", "streets", "transit", "highway"],
    three11Categories: ["pothole", "street", "traffic", "sidewalk"],
  },
  "education": {
    label: "Education & Schools",
    description: "School enrollment, spending, student-teacher ratios, education levels",
    sources: ["schools", "census", "budget"],
    censusFields: ["bachelorsDegreeRate"],
    budgetCategories: ["education"],
  },
  "economic development": {
    label: "Economic Development & Jobs",
    description: "Unemployment, job growth, business permits, income levels",
    sources: ["bls", "fred", "census", "permits"],
    censusFields: ["medianIncome", "povertyRate"],
    fredKeywords: ["unemployment", "employees", "income"],
  },
  "environment": {
    label: "Environment & Sustainability",
    description: "Air quality, water quality, parks, green space",
    sources: ["airnow", "usgs", "budget", "311"],
    budgetCategories: ["parks", "recreation", "natural resources", "environment"],
    three11Categories: ["tree", "park", "pollution", "rodent", "pest"],
  },
  "homelessness": {
    label: "Homelessness & Social Services",
    description: "Poverty rates, housing costs, social spending, related 311 reports",
    sources: ["census", "hud", "budget", "311"],
    censusFields: ["povertyRate", "medianRent"],
    budgetCategories: ["human services", "welfare", "homeless", "housing"],
    three11Categories: ["homeless", "encampment", "tent"],
  },
  "infrastructure": {
    label: "Infrastructure & Utilities",
    description: "Water systems, roads, building activity, utility spending",
    sources: ["usgs", "permits", "budget", "311"],
    budgetCategories: ["water", "sewer", "utilities", "public works", "sanitation"],
    three11Categories: ["water", "sewer", "pothole", "street light", "sidewalk"],
  },
  "health": {
    label: "Health & Wellness",
    description: "Air quality, health spending, poverty as health indicator",
    sources: ["airnow", "census", "budget"],
    censusFields: ["povertyRate", "medianIncome"],
    budgetCategories: ["health", "hospital", "mental"],
  },
};

// ── Free-text issue matching ────────────────────────────────────────────────

function matchIssue(input: string): { key: string; config: IssueConfig } | null {
  const normalized = input.toLowerCase().trim();

  // Exact match
  if (ISSUE_MAP[normalized]) {
    return { key: normalized, config: ISSUE_MAP[normalized] };
  }

  // Score each issue by keyword overlap
  let bestKey: string | null = null;
  let bestScore = 0;

  for (const [key, config] of Object.entries(ISSUE_MAP)) {
    let score = 0;
    const searchableText = `${key} ${config.description}`.toLowerCase();
    const inputWords = normalized.split(/\s+/);

    for (const word of inputWords) {
      if (word.length < 3) continue; // skip tiny words
      if (searchableText.includes(word)) {
        score += 1;
      }
      // Bonus for matching the key directly
      if (key.includes(word)) {
        score += 2;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestKey = key;
    }
  }

  if (bestKey && bestScore >= 1) {
    return { key: bestKey, config: ISSUE_MAP[bestKey] };
  }

  return null;
}

// ── Formatting helpers ──────────────────────────────────────────────────────

function fmtDollar(n: number | null): string {
  if (n === null) return "N/A";
  return `$${n.toLocaleString()}`;
}

function fmtPercent(n: number | null): string {
  if (n === null) return "N/A";
  return `${(n * 100).toFixed(1)}%`;
}

function fmtNumber(n: number | null): string {
  if (n === null) return "N/A";
  return n.toLocaleString();
}

// ── Source extraction functions ──────────────────────────────────────────────
// Each takes the raw result from a source + the issue config, and returns
// findings relevant to the issue.

function extractCensusFindings(
  result: CensusResult,
  config: IssueConfig
): IssueDataResult["findings"] {
  const findings: IssueDataResult["findings"] = [];
  const fields = config.censusFields || [];

  if (fields.includes("medianHomeValue") && result.housing.medianHomeValue !== null) {
    findings.push({
      source: "Census ACS",
      metric: "Median Home Value",
      value: fmtDollar(result.housing.medianHomeValue),
      context: "What a typical home costs — key indicator of housing cost pressure",
    });
  }
  if (fields.includes("medianRent") && result.housing.medianRent !== null) {
    findings.push({
      source: "Census ACS",
      metric: "Median Gross Rent",
      value: fmtDollar(result.housing.medianRent),
      context: "Typical monthly rent — compare to 30% of median income for affordability threshold",
    });
  }
  if (fields.includes("rentBurden") && result.housing.medianRent !== null && result.demographics.medianIncome !== null) {
    const monthlyIncome = result.demographics.medianIncome / 12;
    const rentBurden = result.housing.medianRent / monthlyIncome;
    findings.push({
      source: "Census ACS (calculated)",
      metric: "Rent-to-Income Ratio",
      value: `${(rentBurden * 100).toFixed(1)}%`,
      context: rentBurden > 0.3
        ? "Above 30% threshold — residents are cost-burdened"
        : "Below 30% threshold — rents are considered affordable relative to income",
    });
  }
  if (fields.includes("medianIncome") && result.demographics.medianIncome !== null) {
    findings.push({
      source: "Census ACS",
      metric: "Median Household Income",
      value: fmtDollar(result.demographics.medianIncome),
      context: "Baseline for understanding economic conditions and affordability",
    });
  }
  if (fields.includes("povertyRate") && result.demographics.povertyRate !== null) {
    const rate = result.demographics.povertyRate;
    findings.push({
      source: "Census ACS",
      metric: "Poverty Rate",
      value: fmtPercent(rate),
      context: rate > 0.15
        ? "Elevated poverty rate — signals economic distress"
        : "Moderate poverty rate — still affects service demand",
    });
  }
  if (fields.includes("bachelorsDegreeRate") && result.demographics.bachelorsDegreeRate !== null) {
    findings.push({
      source: "Census ACS",
      metric: "Bachelor's Degree Rate (25+)",
      value: fmtPercent(result.demographics.bachelorsDegreeRate),
      context: "Educational attainment — indicator of workforce skill level and school system output",
    });
  }
  if (fields.includes("publicTransitRate") && result.commuting.publicTransitRate !== null) {
    findings.push({
      source: "Census ACS",
      metric: "Public Transit Commute Rate",
      value: fmtPercent(result.commuting.publicTransitRate),
      context: "Share of workers using public transit — reflects transit availability and reliance",
    });
  }
  if (fields.includes("driveAloneRate") && result.commuting.driveAloneRate !== null) {
    findings.push({
      source: "Census ACS",
      metric: "Drive Alone Rate",
      value: fmtPercent(result.commuting.driveAloneRate),
      context: "Share of workers driving alone — higher rates indicate car dependency",
    });
  }

  return findings;
}

function extractFredFindings(
  result: FredCityResult,
  config: IssueConfig
): IssueDataResult["findings"] {
  const findings: IssueDataResult["findings"] = [];
  const keywords = config.fredKeywords || [];

  for (const series of result.series) {
    if (series.latestValue === null) continue;

    const label = series.label.toLowerCase();
    const isRelevant = keywords.some((kw) => label.includes(kw));
    if (!isRelevant) continue;

    let valueStr: string;
    if (series.unit === "$") {
      valueStr = fmtDollar(series.latestValue);
    } else if (series.unit === "%") {
      valueStr = `${series.latestValue.toFixed(1)}%`;
    } else if (series.unit === "thousands") {
      valueStr = `${series.latestValue.toLocaleString()}K`;
    } else {
      valueStr = series.latestValue.toFixed(1);
    }

    let context = `As of ${series.latestDate}`;
    if (series.change !== null) {
      const direction = series.change > 0 ? "up" : series.change < 0 ? "down" : "unchanged";
      const changeAbs = Math.abs(series.change);
      const changeStr = series.unit === "%" ? `${changeAbs.toFixed(1)}pp` : changeAbs.toLocaleString();
      context += ` — ${direction} ${changeStr} from prior period`;
    }

    findings.push({
      source: "FRED",
      metric: series.label,
      value: valueStr,
      context,
    });
  }

  return findings;
}

function extractBlsFindings(
  result: BlsCityResult,
  _config: IssueConfig
): IssueDataResult["findings"] {
  const findings: IssueDataResult["findings"] = [];

  if (result.unemployment.current !== null) {
    let context = `As of ${result.unemployment.currentDate}`;
    if (result.unemployment.change !== null) {
      const dir = result.unemployment.change > 0 ? "up" : result.unemployment.change < 0 ? "down" : "flat";
      context += ` — ${dir} ${Math.abs(result.unemployment.change)}pp year-over-year`;
    }
    findings.push({
      source: "BLS",
      metric: "Unemployment Rate",
      value: `${result.unemployment.current}%`,
      context,
    });
  }

  if (result.employment.current !== null) {
    let context = `As of ${result.employment.currentDate}`;
    if (result.employment.changePercent !== null) {
      const dir = result.employment.changePercent > 0 ? "grew" : "shrank";
      context += ` — ${dir} ${Math.abs(result.employment.changePercent)}% year-over-year`;
    }
    findings.push({
      source: "BLS",
      metric: "Total Employment",
      value: fmtNumber(result.employment.current),
      context,
    });
  }

  if (result.laborForce.current !== null) {
    findings.push({
      source: "BLS",
      metric: "Labor Force Size",
      value: fmtNumber(result.laborForce.current),
      context: `As of ${result.laborForce.currentDate}`,
    });
  }

  return findings;
}

function extractFbiFindings(
  result: FbiCrimeResult,
  _config: IssueConfig
): IssueDataResult["findings"] {
  const findings: IssueDataResult["findings"] = [];

  for (const offense of result.offenses) {
    if (offense.years.length === 0) continue;
    const latest = offense.years[offense.years.length - 1];
    const value = latest.rate !== undefined
      ? `${latest.rate.toLocaleString()} per 100K`
      : fmtNumber(latest.count);

    findings.push({
      source: `FBI UCR (${result.dataLevel}-level)`,
      metric: offense.label,
      value,
      context: `${latest.year} — ${result.note.slice(0, 80)}`,
    });
  }

  return findings;
}

function extractAirQualityFindings(
  result: AirQualityResult,
  _config: IssueConfig
): IssueDataResult["findings"] {
  const findings: IssueDataResult["findings"] = [];

  for (const reading of result.readings) {
    findings.push({
      source: "AirNow (EPA)",
      metric: `AQI — ${reading.parameter}`,
      value: `${reading.aqi} (${reading.category})`,
      context: "Current air quality — Good (0-50), Moderate (51-100), Unhealthy for Sensitive Groups (101-150)",
    });
  }

  if (result.forecast.length > 0) {
    const f = result.forecast[0];
    findings.push({
      source: "AirNow (EPA)",
      metric: `Forecast — ${f.parameter}`,
      value: `${f.aqi} (${f.category})`,
      context: f.discussion || `Forecast for ${f.date}`,
    });
  }

  return findings;
}

function extractHudFindings(
  result: HudResult,
  _config: IssueConfig
): IssueDataResult["findings"] {
  const findings: IssueDataResult["findings"] = [];

  const fmr = result.fairMarketRents;
  if (fmr.oneBr !== null) {
    findings.push({
      source: "HUD",
      metric: "Fair Market Rent (1BR)",
      value: fmtDollar(fmr.oneBr),
      context: "HUD-set rent threshold — used to determine housing voucher amounts",
    });
  }
  if (fmr.twoBr !== null) {
    findings.push({
      source: "HUD",
      metric: "Fair Market Rent (2BR)",
      value: fmtDollar(fmr.twoBr),
      context: "HUD-set rent threshold for 2-bedroom — common benchmark for family housing",
    });
  }
  if (result.areaMedianIncome !== null) {
    findings.push({
      source: "HUD",
      metric: "Area Median Income (AMI)",
      value: fmtDollar(result.areaMedianIncome),
      context: "Used to determine eligibility for housing programs (30%, 50%, 80% AMI thresholds)",
    });
  }

  return findings;
}

function extractWaterFindings(
  result: WaterResult,
  _config: IssueConfig
): IssueDataResult["findings"] {
  const findings: IssueDataResult["findings"] = [];

  if (result.sites && result.sites.length > 0) {
    const activeSites = result.sites.filter((s) => s.values && s.values.length > 0);
    findings.push({
      source: "USGS Water Services",
      metric: "Active Monitoring Sites",
      value: `${activeSites.length} sites`,
      context: "Real-time water monitoring stations — indicates infrastructure coverage",
    });

    // Summarize key measurements from first few sites
    for (const site of activeSites.slice(0, 3)) {
      for (const v of site.values) {
        findings.push({
          source: "USGS Water Services",
          metric: `${v.parameterName || v.parameter} at ${site.siteName}`,
          value: `${v.value} ${v.unit}`,
          context: `Real-time reading — ${v.dateTime || "recent"}`,
        });
      }
    }
  }

  return findings;
}

function extract311Findings(
  result: Three11Result,
  config: IssueConfig
): IssueDataResult["findings"] {
  const findings: IssueDataResult["findings"] = [];
  const filterCategories = config.three11Categories || [];

  // Total volume
  findings.push({
    source: "311 Service Requests",
    metric: "Total Requests (90 days)",
    value: fmtNumber(result.totalRequests),
    context: `${result.period.from} to ${result.period.to}`,
  });

  // Filter top categories by relevance to this issue
  if (filterCategories.length > 0) {
    const relevant = result.topCategories.filter((cat) =>
      filterCategories.some((kw) => cat.category.toLowerCase().includes(kw))
    );

    for (const cat of relevant.slice(0, 5)) {
      findings.push({
        source: "311 Service Requests",
        metric: cat.category,
        value: `${fmtNumber(cat.count)} requests (${cat.percentOfTotal}% of total)`,
        context: "Community-reported issue — higher counts indicate more resident concern",
      });
    }

    if (relevant.length === 0) {
      findings.push({
        source: "311 Service Requests",
        metric: "Issue-Related Complaints",
        value: "No matching categories found",
        context: `Searched for: ${filterCategories.join(", ")}`,
      });
    }
  } else {
    // Show top 3 categories for general context
    for (const cat of result.topCategories.slice(0, 3)) {
      findings.push({
        source: "311 Service Requests",
        metric: cat.category,
        value: `${fmtNumber(cat.count)} requests (${cat.percentOfTotal}% of total)`,
        context: "Top community complaint category",
      });
    }
  }

  return findings;
}

function extractTransitFindings(
  result: TransitResult,
  _config: IssueConfig
): IssueDataResult["findings"] {
  const findings: IssueDataResult["findings"] = [];

  if (result.totalRidership !== undefined) {
    findings.push({
      source: "NTD (Transit)",
      metric: "Total Annual Ridership",
      value: fmtNumber(result.totalRidership),
      context: "Total unlinked passenger trips — measures transit usage volume",
    });
  }

  for (const agency of result.agencies.slice(0, 3)) {
    for (const mode of agency.modes.slice(0, 2)) {
      findings.push({
        source: "NTD (Transit)",
        metric: `${agency.name} — ${mode.modeName}`,
        value: `${fmtNumber(mode.ridership)} riders`,
        context: mode.serviceHours
          ? `${fmtNumber(mode.serviceHours)} service hours`
          : "Annual ridership by mode",
      });
    }
  }

  return findings;
}

function extractSchoolFindings(
  result: SchoolResult,
  _config: IssueConfig
): IssueDataResult["findings"] {
  const findings: IssueDataResult["findings"] = [];

  findings.push({
    source: "Education Data (Urban Institute)",
    metric: "Total Enrollment",
    value: fmtNumber(result.totalEnrollment),
    context: "Students enrolled across all districts in the county",
  });

  findings.push({
    source: "Education Data (Urban Institute)",
    metric: "Total Schools",
    value: fmtNumber(result.totalSchools),
    context: "Number of schools in the county",
  });

  // Average student-teacher ratio across districts
  const ratios = result.districts
    .map((d) => d.studentTeacherRatio)
    .filter((r): r is number => r !== null);
  if (ratios.length > 0) {
    const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    findings.push({
      source: "Education Data (Urban Institute)",
      metric: "Avg Student-Teacher Ratio",
      value: `${avg.toFixed(1)}:1`,
      context: "Lower ratios generally indicate more individual attention — national avg ~16:1",
    });
  }

  if (result.finance && result.finance.totalRevenue !== null) {
    findings.push({
      source: "Education Data (Urban Institute)",
      metric: "Total District Revenue",
      value: fmtDollar(result.finance.totalRevenue),
      context: "Combined revenue from local, state, and federal sources",
    });
  }
  if (result.finance && result.finance.perPupilSpending !== null) {
    findings.push({
      source: "Education Data (Urban Institute)",
      metric: "Per-Pupil Spending",
      value: fmtDollar(result.finance.perPupilSpending),
      context: "Total current expenditures divided by enrollment",
    });
  }

  return findings;
}

function extractPermitFindings(
  result: PermitResult,
  _config: IssueConfig
): IssueDataResult["findings"] {
  const findings: IssueDataResult["findings"] = [];

  if (result.latestYear !== null) {
    if (result.latestPermits !== null) {
      findings.push({
        source: "Census Building Permits",
        metric: "Building Permits Issued",
        value: fmtNumber(result.latestPermits),
        context: `${result.latestYear} — number of permits issued in the county`,
      });
    }
    if (result.latestUnits !== null) {
      findings.push({
        source: "Census Building Permits",
        metric: "Total Units Permitted",
        value: fmtNumber(result.latestUnits),
        context: `${result.latestYear} — indicates pace of new housing/development`,
      });
    }
  }

  // Trend
  if (result.trend !== "unknown") {
    const trendLabel = result.trend === "growing" ? "Growing" : result.trend === "declining" ? "Declining" : "Stable";
    const changeStr = result.changePercent !== null ? `${result.changePercent > 0 ? "+" : ""}${result.changePercent.toFixed(1)}%` : "";
    findings.push({
      source: "Census Building Permits",
      metric: "5-Year Permit Trend",
      value: `${trendLabel}${changeStr ? ` (${changeStr})` : ""}`,
      context: "Trend in building permits 2020–2024 — positive = more building activity",
    });
  }

  return findings;
}

function extractBudgetFindings(
  result: BudgetResult,
  config: IssueConfig
): IssueDataResult["findings"] {
  const findings: IssueDataResult["findings"] = [];
  const targetCategories = config.budgetCategories || [];

  findings.push({
    source: "City Budget",
    metric: "Total Budget",
    value: fmtDollar(result.totalBudget),
    context: `${result.fiscalYear} — $${result.perCapita.toLocaleString()} per capita`,
  });

  // Find relevant budget categories
  for (const cat of result.categories) {
    const catNameLower = cat.name.toLowerCase();
    const isRelevant = targetCategories.some((kw) => catNameLower.includes(kw));
    if (isRelevant) {
      findings.push({
        source: "City Budget",
        metric: cat.name,
        value: `${fmtDollar(cat.amount)} (${cat.percent.toFixed(1)}% of total)`,
        context: `$${cat.perCapita.toLocaleString()} per capita — ${result.fiscalYear}`,
      });
    }
  }

  return findings;
}

function extractTrafficFindings(
  result: TrafficResult,
  _config: IssueConfig
): IssueDataResult["findings"] {
  const findings: IssueDataResult["findings"] = [];
  const primary = result.county?.years ?? result.state.years;
  const sorted = [...primary].sort((a, b) => b.year - a.year);

  if (sorted.length > 0) {
    const latest = sorted[0];
    findings.push({
      source: `NHTSA FARS (${result.dataLevel})`,
      metric: "Traffic Fatalities",
      value: `${latest.totalFatalities.toLocaleString()}${latest.fatalityRate != null ? ` (${latest.fatalityRate.toFixed(1)} per 100K)` : ""}`,
      context: `${latest.year} — fatal crashes in ${result.dataLevel === "county" ? result.county!.countyName + " County" : result.stateName}`,
    });

    if (latest.pedestrianFatalities > 0) {
      findings.push({
        source: `NHTSA FARS (${result.dataLevel})`,
        metric: "Pedestrian Fatalities",
        value: latest.pedestrianFatalities.toLocaleString(),
        context: `${latest.year} — crashes involving pedestrians`,
      });
    }

    if (latest.alcoholRelated > 0) {
      findings.push({
        source: `NHTSA FARS (${result.dataLevel})`,
        metric: "Alcohol-Related Crashes",
        value: latest.alcoholRelated.toLocaleString(),
        context: `${latest.year} — crashes where driver was intoxicated`,
      });
    }
  }

  if (result.congestion) {
    findings.push({
      source: "TTI Urban Mobility Report",
      metric: "Annual Commuter Delay",
      value: `${result.congestion.annualDelayHours} hours/commuter`,
      context: `${result.congestion.dataYear} — costs $${result.congestion.congestionCost.toLocaleString()}/commuter annually`,
    });
  }

  // Trend if multi-year
  if (sorted.length >= 2) {
    const oldest = sorted[sorted.length - 1];
    const latest = sorted[0];
    if (oldest.totalFatalities > 0) {
      const pctChange = ((latest.totalFatalities - oldest.totalFatalities) / oldest.totalFatalities) * 100;
      findings.push({
        source: `NHTSA FARS (${result.dataLevel})`,
        metric: "Fatality Trend",
        value: `${pctChange > 0 ? "+" : ""}${pctChange.toFixed(1)}% (${oldest.year}-${latest.year})`,
        context: pctChange > 5 ? "Increasing fatalities — concerning trend" : pctChange < -5 ? "Declining fatalities — positive trend" : "Relatively stable",
      });
    }
  }

  return findings;
}

// ── Main query function ─────────────────────────────────────────────────────

export async function mapIssueData(city: string, issue: string): Promise<IssueDataResult> {
  // Resolve the issue
  const matched = matchIssue(issue);
  if (!matched) {
    const available = Object.keys(ISSUE_MAP).join(", ");
    return {
      city,
      issue,
      issueLabel: "Unknown Issue",
      findings: [{
        source: "Issue Mapper",
        metric: "Error",
        value: "Could not match issue topic",
        context: `Available topics: ${available}`,
      }],
      dataSources: { queried: [], hadData: [], noData: [] },
    };
  }

  const { key: issueKey, config } = matched;
  const queried: string[] = [];
  const hadData: string[] = [];
  const noData: string[] = [];
  const findings: IssueDataResult["findings"] = [];

  // Build fetch tasks based on which sources this issue needs
  const tasks: Array<Promise<void>> = [];

  if (config.sources.includes("census")) {
    tasks.push((async () => {
      queried.push("census");
      try {
        const result = await queryCensus(city);
        const f = extractCensusFindings(result, config);
        if (f.length > 0) { findings.push(...f); hadData.push("census"); }
        else { noData.push("census"); }
      } catch (e) {
        console.error(`[issue-mapper] Census error: ${e}`);
        noData.push("census");
      }
    })());
  }

  if (config.sources.includes("fred")) {
    tasks.push((async () => {
      queried.push("fred");
      try {
        const resolved = resolveFredCity(city);
        if (!resolved) { noData.push("fred"); return; }
        const result = await queryFred(resolved.key);
        const f = extractFredFindings(result, config);
        if (f.length > 0) { findings.push(...f); hadData.push("fred"); }
        else { noData.push("fred"); }
      } catch (e) {
        console.error(`[issue-mapper] FRED error: ${e}`);
        noData.push("fred");
      }
    })());
  }

  if (config.sources.includes("bls")) {
    tasks.push((async () => {
      queried.push("bls");
      try {
        const resolved = resolveBlsCity(city);
        if (!resolved) { noData.push("bls"); return; }
        const result = await queryBls(resolved.key);
        const f = extractBlsFindings(result, config);
        if (f.length > 0) { findings.push(...f); hadData.push("bls"); }
        else { noData.push("bls"); }
      } catch (e) {
        console.error(`[issue-mapper] BLS error: ${e}`);
        noData.push("bls");
      }
    })());
  }

  if (config.sources.includes("fbi")) {
    tasks.push((async () => {
      queried.push("fbi");
      try {
        const resolved = resolveFbiCity(city);
        if (!resolved) { noData.push("fbi"); return; }
        const fbiConfig = resolved.config;
        const result = await queryFbiCrime(fbiConfig.state, resolved.key);
        const f = extractFbiFindings(result, config);
        if (f.length > 0) { findings.push(...f); hadData.push("fbi"); }
        else { noData.push("fbi"); }
      } catch (e) {
        console.error(`[issue-mapper] FBI error: ${e}`);
        noData.push("fbi");
      }
    })());
  }

  if (config.sources.includes("airnow")) {
    tasks.push((async () => {
      queried.push("airnow");
      try {
        const result = await queryAirQuality(city);
        const f = extractAirQualityFindings(result, config);
        if (f.length > 0) { findings.push(...f); hadData.push("airnow"); }
        else { noData.push("airnow"); }
      } catch (e) {
        console.error(`[issue-mapper] AirNow error: ${e}`);
        noData.push("airnow");
      }
    })());
  }

  if (config.sources.includes("hud")) {
    tasks.push((async () => {
      queried.push("hud");
      try {
        const result = await queryHud(city);
        const f = extractHudFindings(result, config);
        if (f.length > 0) { findings.push(...f); hadData.push("hud"); }
        else { noData.push("hud"); }
      } catch (e) {
        console.error(`[issue-mapper] HUD error: ${e}`);
        noData.push("hud");
      }
    })());
  }

  if (config.sources.includes("usgs")) {
    tasks.push((async () => {
      queried.push("usgs");
      try {
        const result = await queryWater(city);
        const f = extractWaterFindings(result, config);
        if (f.length > 0) { findings.push(...f); hadData.push("usgs"); }
        else { noData.push("usgs"); }
      } catch (e) {
        console.error(`[issue-mapper] USGS error: ${e}`);
        noData.push("usgs");
      }
    })());
  }

  if (config.sources.includes("311")) {
    tasks.push((async () => {
      queried.push("311");
      try {
        const result = await query311Trends(city);
        const f = extract311Findings(result, config);
        if (f.length > 0) { findings.push(...f); hadData.push("311"); }
        else { noData.push("311"); }
      } catch (e) {
        console.error(`[issue-mapper] 311 error: ${e}`);
        noData.push("311");
      }
    })());
  }

  if (config.sources.includes("transit")) {
    tasks.push((async () => {
      queried.push("transit");
      try {
        const result = await queryTransit(city);
        const f = extractTransitFindings(result, config);
        if (f.length > 0) { findings.push(...f); hadData.push("transit"); }
        else { noData.push("transit"); }
      } catch (e) {
        console.error(`[issue-mapper] Transit error: ${e}`);
        noData.push("transit");
      }
    })());
  }

  if (config.sources.includes("schools")) {
    tasks.push((async () => {
      queried.push("schools");
      try {
        const result = await querySchools(city);
        const f = extractSchoolFindings(result, config);
        if (f.length > 0) { findings.push(...f); hadData.push("schools"); }
        else { noData.push("schools"); }
      } catch (e) {
        console.error(`[issue-mapper] Schools error: ${e}`);
        noData.push("schools");
      }
    })());
  }

  if (config.sources.includes("permits")) {
    tasks.push((async () => {
      queried.push("permits");
      try {
        const result = await queryPermits(city);
        const f = extractPermitFindings(result, config);
        if (f.length > 0) { findings.push(...f); hadData.push("permits"); }
        else { noData.push("permits"); }
      } catch (e) {
        console.error(`[issue-mapper] Permits error: ${e}`);
        noData.push("permits");
      }
    })());
  }

  if (config.sources.includes("budget")) {
    tasks.push((async () => {
      queried.push("budget");
      try {
        const result = queryBudget(city);
        const f = extractBudgetFindings(result, config);
        if (f.length > 0) { findings.push(...f); hadData.push("budget"); }
        else { noData.push("budget"); }
      } catch (e) {
        console.error(`[issue-mapper] Budget error: ${e}`);
        noData.push("budget");
      }
    })());
  }

  if (config.sources.includes("traffic")) {
    tasks.push((async () => {
      queried.push("traffic");
      try {
        const result = await queryTraffic(city);
        const f = extractTrafficFindings(result, config);
        if (f.length > 0) { findings.push(...f); hadData.push("traffic"); }
        else { noData.push("traffic"); }
      } catch (e) {
        console.error(`[issue-mapper] Traffic error: ${e}`);
        noData.push("traffic");
      }
    })());
  }

  // Run all source queries in parallel
  await Promise.all(tasks);

  return {
    city,
    issue: issueKey,
    issueLabel: config.label,
    findings,
    dataSources: { queried, hadData, noData },
  };
}

// ── Formatting ──────────────────────────────────────────────────────────────

export function formatIssueData(result: IssueDataResult): string {
  const lines: string[] = [];

  lines.push(`## ${result.issueLabel} in ${result.city}\n`);

  if (result.findings.length === 0) {
    lines.push("No data found for this issue and city combination.");
    lines.push(`\nData sources attempted: ${result.dataSources.queried.join(", ") || "none"}`);
    return lines.join("\n");
  }

  // Group findings by source
  const bySource = new Map<string, typeof result.findings>();
  for (const f of result.findings) {
    const existing = bySource.get(f.source) || [];
    existing.push(f);
    bySource.set(f.source, existing);
  }

  for (const [source, sourceFindings] of bySource) {
    lines.push(`### ${source}\n`);
    for (const f of sourceFindings) {
      lines.push(`- **${f.metric}**: ${f.value}`);
      lines.push(`  _${f.context}_`);
    }
    lines.push("");
  }

  // Data source summary
  lines.push("---");
  lines.push(`**Data sources queried**: ${result.dataSources.queried.join(", ")}`);
  if (result.dataSources.hadData.length > 0) {
    lines.push(`**Had data**: ${result.dataSources.hadData.join(", ")}`);
  }
  if (result.dataSources.noData.length > 0) {
    lines.push(`**No data available**: ${result.dataSources.noData.join(", ")}`);
  }

  return lines.join("\n");
}

// ── Topic listing ───────────────────────────────────────────────────────────

export function listIssueTopics(): string[] {
  return Object.entries(ISSUE_MAP).map(
    ([key, config]) => `**${config.label}** (\`${key}\`) — ${config.description}`
  );
}
