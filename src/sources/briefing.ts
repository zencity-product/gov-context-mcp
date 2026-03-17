/**
 * City Briefing — Comprehensive executive-quality brief from ALL data sources.
 *
 * Pulls from every available source in parallel:
 * Census ACS, FRED, BLS, FBI, NWS, AirNow, HUD, USGS,
 * Google Civic, 311, Transit (NTD), Schools (NCES), Building Permits, Budget.
 *
 * Each source is fetched independently. If a source fails or isn't
 * available for the city, it's skipped gracefully — never crashes.
 */

import { queryCensus, type CensusResult } from "./census.js";
import { queryFred, resolveFredCity, type FredCityResult } from "./fred.js";
import { queryBls, resolveBlsCity, type BlsCityResult } from "./bls.js";
import { queryFbiCrime, resolveFbiCity, type FbiCrimeResult } from "./fbi.js";
import { queryWeather, type WeatherResult } from "./nws.js";
import { queryAirQuality, type AirQualityResult } from "./airnow.js";
import { queryHud, type HudResult } from "./hud.js";
import { queryWater, type WaterResult } from "./usgs.js";
import { queryCivic, type CivicResult } from "./civic.js";
import { query311Trends, type Three11Result } from "./three11.js";
import { queryTransit, type TransitResult } from "./transit.js";
import { querySchools, type SchoolResult } from "./schools.js";
import { queryPermits, type PermitResult } from "./permits.js";
import { queryBudget, type BudgetResult } from "./budget.js";
import { queryTraffic, type TrafficResult } from "./traffic.js";

// ── Interfaces ─────────────────────────────────────────────────────────────

export interface CityBriefing {
  city: string;
  generatedAt: string;
  sections: Array<{
    title: string;
    content: string;
    source: string;
  }>;
  dataSources: {
    available: string[];
    unavailable: string[];
  };
}

interface SourceResults {
  census: CensusResult | null;
  fred: FredCityResult | null;
  bls: BlsCityResult | null;
  fbi: FbiCrimeResult | null;
  weather: WeatherResult | null;
  airQuality: AirQualityResult | null;
  hud: HudResult | null;
  water: WaterResult | null;
  civic: CivicResult | null;
  three11: Three11Result | null;
  transit: TransitResult | null;
  schools: SchoolResult | null;
  permits: PermitResult | null;
  budget: BudgetResult | null;
  traffic: TrafficResult | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined, type: "number" | "dollar" | "percent" | "rate"): string {
  if (n == null) return "N/A";
  if (type === "dollar") return `$${n.toLocaleString()}`;
  if (type === "percent") return `${(n * 100).toFixed(1)}%`;
  if (type === "rate") return n.toFixed(1);
  return n.toLocaleString();
}

/** Safely resolve and call a source, returning null on any failure. */
async function safeQuery<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

// ── Main builder ───────────────────────────────────────────────────────────

/**
 * Build a comprehensive city briefing by fetching ALL data sources in parallel.
 */
export async function buildCityBriefing(city: string): Promise<CityBriefing> {
  // Resolve city keys for sources that need them
  const fredMatch = resolveFredCity(city);
  const blsMatch = resolveBlsCity(city);
  const fbiMatch = resolveFbiCity(city);

  // Fire all sources in parallel
  const [
    census, fred, bls, fbi,
    weather, airQuality, hud, water,
    civic, three11, transit, schools,
    permits, budget, traffic,
  ] = await Promise.all([
    // Demographics
    safeQuery(() => queryCensus(city)),
    // Economics
    fredMatch ? safeQuery(() => queryFred(fredMatch.key)) : Promise.resolve(null),
    // Employment
    blsMatch ? safeQuery(() => queryBls(blsMatch.key)) : Promise.resolve(null),
    // Crime
    fbiMatch
      ? safeQuery(() => queryFbiCrime(fbiMatch.config.state, fbiMatch.key))
      : Promise.resolve(null),
    // Weather
    safeQuery(() => queryWeather(city)),
    // Air quality
    safeQuery(() => queryAirQuality(city)),
    // Housing (HUD)
    safeQuery(() => queryHud(city)),
    // Water
    safeQuery(() => queryWater(city)),
    // Representatives
    safeQuery(() => queryCivic(city)),
    // 311
    safeQuery(() => query311Trends(city, 90)),
    // Transit
    safeQuery(() => queryTransit(city)),
    // Schools
    safeQuery(() => querySchools(city)),
    // Permits
    safeQuery(() => queryPermits(city)),
    // Budget
    safeQuery(() => Promise.resolve(queryBudget(city))),
    // Traffic
    safeQuery(() => queryTraffic(city)),
  ]);

  const sources: SourceResults = {
    census, fred, bls, fbi,
    weather, airQuality, hud, water,
    civic, three11, transit, schools,
    permits, budget, traffic,
  };

  // Track which sources succeeded
  const available: string[] = [];
  const unavailable: string[] = [];

  const check = (name: string, value: unknown) => {
    if (value != null) {
      available.push(name);
    } else {
      unavailable.push(name);
    }
  };

  check("Census ACS (demographics)", sources.census);
  check("FRED (economics)", sources.fred);
  check("BLS (employment)", sources.bls);
  check("FBI UCR (crime)", sources.fbi);
  check("NWS (weather)", sources.weather);
  check("EPA AirNow (air quality)", sources.airQuality);
  check("HUD (housing)", sources.hud);
  check("USGS (water)", sources.water);
  check("Google Civic (representatives)", sources.civic);
  check("311 (service requests)", sources.three11);
  check("NTD (transit)", sources.transit);
  check("NCES (schools)", sources.schools);
  check("Census BPS (permits)", sources.permits);
  check("Municipal Budget", sources.budget);
  check("NHTSA FARS (traffic)", sources.traffic);

  // Determine city display name
  const cityName = sources.census?.city ?? city;

  // Build sections
  const sections: CityBriefing["sections"] = [];

  sections.push(buildOverview(cityName, sources));
  sections.push(buildDemographics(sources));
  sections.push(buildEconomy(sources));
  sections.push(buildHousing(sources));
  sections.push(buildSafety(sources));
  sections.push(buildQualityOfLife(sources));
  sections.push(buildGovernment(sources));
  sections.push(buildCommunityVoice(sources));
  sections.push(buildDataSourcesSection(available, unavailable));

  // Filter out empty sections (content is just a "no data" stub)
  const nonEmpty = sections.filter(s => s.content.trim().length > 0);

  return {
    city: cityName,
    generatedAt: new Date().toISOString(),
    sections: nonEmpty,
    dataSources: { available, unavailable },
  };
}

// ── Section builders ───────────────────────────────────────────────────────

function buildOverview(cityName: string, s: SourceResults): CityBriefing["sections"][0] {
  const lines: string[] = [];

  lines.push(`**${cityName}**`);

  if (s.census) {
    const pop = s.census.demographics.population;
    const state = s.census.state;
    if (pop) lines.push(`- **Population:** ${fmt(pop, "number")}`);
    if (state) lines.push(`- **State:** ${state}`);
  }

  if (s.weather) {
    const w = s.weather.current;
    const parts: string[] = [];
    if (w.temperature) parts.push(w.temperature);
    if (w.shortForecast) parts.push(w.shortForecast);
    if (w.windSpeed) parts.push(`Wind ${w.windSpeed} ${w.windDirection || ""}`);
    if (parts.length > 0) {
      lines.push(`- **Current Weather:** ${parts.join(" · ")}`);
    }
    if (s.weather.alerts.length > 0) {
      for (const alert of s.weather.alerts) {
        lines.push(`- **⚠ Alert:** ${alert.event} — ${alert.headline}`);
      }
    }
  }

  if (s.airQuality && s.airQuality.readings.length > 0) {
    const worst = s.airQuality.readings.reduce((a, b) => (b.aqi > a.aqi ? b : a));
    lines.push(`- **Air Quality:** AQI ${worst.aqi} (${worst.category})`);
  }

  return {
    title: "Overview",
    content: lines.join("\n"),
    source: [s.census ? "Census" : null, s.weather ? "NWS" : null, s.airQuality ? "AirNow" : null]
      .filter(Boolean).join(", ") || "N/A",
  };
}

function buildDemographics(s: SourceResults): CityBriefing["sections"][0] {
  const lines: string[] = [];

  if (s.census) {
    const d = s.census.demographics;
    lines.push(`- **Population:** ${fmt(d.population, "number")}`);
    lines.push(`- **Median Age:** ${fmt(d.medianAge, "number")}`);
    lines.push(`- **Median Household Income:** ${fmt(d.medianIncome, "dollar")}`);
    lines.push(`- **Per Capita Income:** ${fmt(d.perCapitaIncome, "dollar")}`);
    lines.push(`- **Poverty Rate:** ${fmt(d.povertyRate, "percent")}`);
    lines.push(`- **Bachelor's Degree or Higher:** ${fmt(d.bachelorsDegreeRate, "percent")}`);

    const c = s.census.commuting;
    lines.push("");
    lines.push("**Commuting:**");
    lines.push(`- Drive Alone: ${fmt(c.driveAloneRate, "percent")} · Transit: ${fmt(c.publicTransitRate, "percent")} · WFH: ${fmt(c.workFromHomeRate, "percent")}`);
  }

  return {
    title: "Demographics",
    content: lines.join("\n"),
    source: s.census ? "US Census ACS 5-Year Estimates" : "N/A",
  };
}

function buildEconomy(s: SourceResults): CityBriefing["sections"][0] {
  const lines: string[] = [];

  if (s.bls) {
    lines.push("**Employment (BLS):**");
    lines.push(`- **Unemployment Rate:** ${fmt(s.bls.unemployment.current, "rate")}%${s.bls.unemployment.currentDate ? ` (${s.bls.unemployment.currentDate})` : ""}`);
    if (s.bls.unemployment.yearAgo != null) {
      const change = (s.bls.unemployment.current ?? 0) - s.bls.unemployment.yearAgo;
      const dir = change > 0 ? "up" : change < 0 ? "down" : "flat";
      lines.push(`- Year-over-year: ${dir} ${Math.abs(change).toFixed(1)} pts (from ${s.bls.unemployment.yearAgo.toFixed(1)}%)`);
    }
    if (s.bls.employment.current != null) {
      lines.push(`- **Total Employment:** ${fmt(s.bls.employment.current, "number")}`);
      if (s.bls.employment.changePercent != null) {
        lines.push(`- Job Growth: ${s.bls.employment.changePercent > 0 ? "+" : ""}${s.bls.employment.changePercent.toFixed(1)}% YoY`);
      }
    }
    if (s.bls.laborForce.current != null) {
      lines.push(`- **Labor Force:** ${fmt(s.bls.laborForce.current, "number")}`);
    }
  }

  if (s.fred) {
    if (lines.length > 0) lines.push("");
    lines.push("**Economic Indicators (FRED):**");
    for (const series of s.fred.series) {
      if (series.latestValue != null) {
        const label = series.label;
        // Format based on what the series represents
        const isPercent = label.toLowerCase().includes("rate") || label.toLowerCase().includes("unemployment");
        const isDollar = label.toLowerCase().includes("income") || label.toLowerCase().includes("dollar");
        const isIndex = label.toLowerCase().includes("index");
        let value: string;
        if (isPercent) value = `${series.latestValue.toFixed(1)}%`;
        else if (isDollar) value = fmt(series.latestValue, "dollar");
        else if (isIndex) value = series.latestValue.toFixed(1);
        else value = fmt(series.latestValue, "number");

        let trend = "";
        if (series.change != null) {
          const sign = series.change > 0 ? "+" : "";
          // Show change relative to previous value as a percentage if possible
          if (series.previousValue != null && series.previousValue !== 0) {
            const pctChange = (series.change / Math.abs(series.previousValue)) * 100;
            trend = ` (${sign}${pctChange.toFixed(1)}% from prior)`;
          } else {
            trend = ` (${sign}${series.change.toFixed(1)} change)`;
          }
        }
        lines.push(`- ${label}: **${value}**${trend}`);
      }
    }
  }

  return {
    title: "Economy",
    content: lines.join("\n"),
    source: [s.bls ? "BLS" : null, s.fred ? "FRED" : null].filter(Boolean).join(", ") || "N/A",
  };
}

function buildHousing(s: SourceResults): CityBriefing["sections"][0] {
  const lines: string[] = [];

  if (s.census) {
    const h = s.census.housing;
    lines.push("**Housing Market (Census):**");
    lines.push(`- **Median Home Value:** ${fmt(h.medianHomeValue, "dollar")}`);
    lines.push(`- **Median Rent:** ${fmt(h.medianRent, "dollar")}`);
    lines.push(`- **Total Housing Units:** ${fmt(h.totalUnits, "number")}`);
    lines.push(`- **Vacancy Rate:** ${fmt(h.vacancyRate, "percent")}`);
  }

  if (s.hud) {
    if (lines.length > 0) lines.push("");
    lines.push("**Fair Market Rents (HUD):**");
    const fmr = s.hud.fairMarketRents;
    lines.push(`- Studio: ${fmt(fmr.studio, "dollar")} · 1BR: ${fmt(fmr.oneBr, "dollar")} · 2BR: ${fmt(fmr.twoBr, "dollar")} · 3BR: ${fmt(fmr.threeBr, "dollar")}`);
    if (s.hud.areaMedianIncome != null) {
      lines.push(`- **Area Median Income:** ${fmt(s.hud.areaMedianIncome, "dollar")}`);
    }
    if (s.hud.incomeLimits) {
      const il = s.hud.incomeLimits;
      lines.push(`- Income Limits: Extremely Low (30% AMI) ${fmt(il.extremelyLow, "dollar")} · Very Low (50%) ${fmt(il.veryLow, "dollar")} · Low (80%) ${fmt(il.low, "dollar")}`);
    }
  }

  if (s.permits) {
    if (lines.length > 0) lines.push("");
    lines.push("**Building Permits (Census BPS):**");
    if (s.permits.latestYear != null) {
      lines.push(`- **${s.permits.latestYear}:** ${fmt(s.permits.latestPermits, "number")} permits · ${fmt(s.permits.latestUnits, "number")} units authorized`);
    }
    lines.push(`- **5-Year Trend:** ${s.permits.trend}${s.permits.changePercent != null ? ` (${s.permits.changePercent > 0 ? "+" : ""}${s.permits.changePercent.toFixed(0)}%)` : ""}`);
    if (s.permits.annualData.length > 0) {
      const summary = s.permits.annualData
        .filter(d => d.permits != null)
        .map(d => `${d.year}: ${fmt(d.permits, "number")}`)
        .join(" → ");
      if (summary) lines.push(`- History: ${summary}`);
    }
  }

  // FRED housing price index
  if (s.fred) {
    const housingIdx = s.fred.series.find(ser =>
      ser.label.toLowerCase().includes("housing") || ser.label.toLowerCase().includes("home price")
    );
    if (housingIdx?.latestValue != null) {
      if (lines.length > 0) lines.push("");
      lines.push("**Housing Price Index (FRED):**");
      let trend = "";
      if (housingIdx.change != null && housingIdx.previousValue != null && housingIdx.previousValue !== 0) {
        const pctChange = (housingIdx.change / Math.abs(housingIdx.previousValue)) * 100;
        trend = ` · ${pctChange > 0 ? "+" : ""}${pctChange.toFixed(1)}% change`;
      }
      lines.push(`- Index: ${housingIdx.latestValue.toFixed(1)}${trend}`);
    }
  }

  return {
    title: "Housing",
    content: lines.join("\n"),
    source: [s.census ? "Census" : null, s.hud ? "HUD" : null, s.permits ? "Census BPS" : null, s.fred ? "FRED" : null]
      .filter(Boolean).join(", ") || "N/A",
  };
}

function buildSafety(s: SourceResults): CityBriefing["sections"][0] {
  const lines: string[] = [];

  if (s.fbi) {
    lines.push(`*${s.fbi.dataLevel === "agency" ? "Agency-level" : "State-level"} data for ${s.fbi.stateName}*`);
    lines.push("");

    for (const offense of s.fbi.offenses) {
      if (offense.years.length === 0) continue;
      const latest = offense.years[offense.years.length - 1];
      const ratePart = latest.rate != null ? ` (${latest.rate.toFixed(1)} per 100K)` : "";
      lines.push(`- **${offense.label}:** ${fmt(latest.count, "number")}${ratePart} (${latest.year})`);

      // Show trend if multi-year data
      if (offense.years.length >= 2) {
        const first = offense.years[0];
        const pctChange = first.count > 0
          ? ((latest.count - first.count) / first.count * 100)
          : null;
        if (pctChange != null) {
          lines.push(`  ${first.year}→${latest.year}: ${pctChange > 0 ? "+" : ""}${pctChange.toFixed(0)}%`);
        }
      }
    }

    if (s.fbi.note) {
      lines.push("");
      lines.push(`*${s.fbi.note}*`);
    }
  }

  // Traffic safety
  if (s.traffic) {
    if (lines.length > 0) lines.push("");
    lines.push("**Traffic Safety (NHTSA FARS):**");
    const primary = s.traffic.county?.years ?? s.traffic.state.years;
    const sorted = [...primary].sort((a, b) => b.year - a.year);
    if (sorted.length > 0) {
      const latest = sorted[0];
      lines.push(`- **Fatal Crashes:** ${latest.totalCrashes.toLocaleString()} (${latest.year})`);
      lines.push(`- **Fatalities:** ${latest.totalFatalities.toLocaleString()}${latest.fatalityRate != null ? ` (${latest.fatalityRate.toFixed(1)} per 100K)` : ""}`);
      lines.push(`- Pedestrian: ${latest.pedestrianFatalities.toLocaleString()} · Cyclist: ${latest.cyclistFatalities.toLocaleString()} · Alcohol-Related: ${latest.alcoholRelated.toLocaleString()}`);

      // Trend if multi-year
      if (sorted.length >= 2) {
        const oldest = sorted[sorted.length - 1];
        if (oldest.totalFatalities > 0) {
          const pctChange = ((latest.totalFatalities - oldest.totalFatalities) / oldest.totalFatalities) * 100;
          const arrow = pctChange < -1 ? "↓" : pctChange > 1 ? "↑" : "→";
          lines.push(`- Trend: ${arrow} ${pctChange > 0 ? "+" : ""}${pctChange.toFixed(1)}% (${oldest.year}→${latest.year})`);
        }
      }
    }
    if (s.traffic.congestion) {
      lines.push(`- **Congestion:** ${s.traffic.congestion.annualDelayHours} hrs/commuter · $${s.traffic.congestion.congestionCost.toLocaleString()}/commuter (TTI ${s.traffic.congestion.dataYear})`);
    }
    lines.push(`*${s.traffic.dataLevel === "county" ? "County" : "State"}-level data*`);
  }

  return {
    title: "Safety",
    content: lines.join("\n"),
    source: [s.fbi ? "FBI UCR" : null, s.traffic ? "NHTSA FARS" : null].filter(Boolean).join(", ") || "N/A",
  };
}

function buildQualityOfLife(s: SourceResults): CityBriefing["sections"][0] {
  const lines: string[] = [];

  // Air quality
  if (s.airQuality && s.airQuality.readings.length > 0) {
    lines.push("**Air Quality (EPA AirNow):**");
    for (const reading of s.airQuality.readings) {
      lines.push(`- ${reading.parameter}: AQI **${reading.aqi}** — ${reading.category}`);
    }
    if (s.airQuality.forecast.length > 0) {
      const next = s.airQuality.forecast[0];
      lines.push(`- Forecast (${next.date}): ${next.parameter} AQI ${next.aqi} — ${next.category}`);
    }
  }

  // Schools
  if (s.schools) {
    if (lines.length > 0) lines.push("");
    lines.push("**Schools (NCES):**");
    lines.push(`- **Total Enrollment:** ${fmt(s.schools.totalEnrollment, "number")} across ${fmt(s.schools.totalSchools, "number")} schools`);

    if (s.schools.districts.length > 0) {
      const top = s.schools.districts.slice(0, 3);
      for (const d of top) {
        const ratio = d.studentTeacherRatio != null ? ` · ${d.studentTeacherRatio.toFixed(1)}:1 student-teacher` : "";
        lines.push(`- ${d.name}: ${fmt(d.enrollment, "number")} students${ratio}`);
      }
    }

    if (s.schools.finance) {
      const f = s.schools.finance;
      lines.push(`- **Per-Pupil Spending:** ${fmt(f.perPupilSpending, "dollar")}`);
      if (f.totalRevenue != null) {
        const localPct = f.localRevenue != null && f.totalRevenue > 0
          ? ((f.localRevenue / f.totalRevenue) * 100).toFixed(0)
          : null;
        const statePct = f.stateRevenue != null && f.totalRevenue > 0
          ? ((f.stateRevenue / f.totalRevenue) * 100).toFixed(0)
          : null;
        const fedPct = f.federalRevenue != null && f.totalRevenue > 0
          ? ((f.federalRevenue / f.totalRevenue) * 100).toFixed(0)
          : null;
        const parts = [
          localPct ? `Local ${localPct}%` : null,
          statePct ? `State ${statePct}%` : null,
          fedPct ? `Federal ${fedPct}%` : null,
        ].filter(Boolean);
        if (parts.length > 0) lines.push(`- Revenue Mix: ${parts.join(" · ")}`);
      }
    }
  }

  // Transit
  if (s.transit) {
    if (lines.length > 0) lines.push("");
    lines.push("**Public Transit (NTD):**");
    lines.push(`- **Total Annual Ridership:** ${fmt(s.transit.totalRidership, "number")} (${s.transit.year})`);
    for (const agency of s.transit.agencies) {
      lines.push(`- **${agency.name}:** ${fmt(agency.totalRidership, "number")} riders`);
      const modes = agency.modes.slice(0, 3).map(m => `${m.modeName}: ${fmt(m.ridership, "number")}`);
      if (modes.length > 0) lines.push(`  ${modes.join(" · ")}`);
    }
  }

  // Water
  if (s.water && s.water.sites.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("**Water Conditions (USGS):**");
    for (const site of s.water.sites.slice(0, 2)) {
      lines.push(`- **${site.siteName}**`);
      for (const v of site.values) {
        lines.push(`  ${v.parameterName}: ${v.value} ${v.unit}`);
      }
    }
  }

  return {
    title: "Quality of Life",
    content: lines.join("\n"),
    source: [
      s.airQuality ? "AirNow" : null,
      s.schools ? "NCES" : null,
      s.transit ? "NTD" : null,
      s.water ? "USGS" : null,
    ].filter(Boolean).join(", ") || "N/A",
  };
}

function buildGovernment(s: SourceResults): CityBriefing["sections"][0] {
  const lines: string[] = [];

  if (s.budget) {
    lines.push("**City Budget:**");
    lines.push(`- **Total Budget:** ${fmt(s.budget.totalBudget, "dollar")} (${s.budget.fiscalYear})`);
    lines.push(`- **Per Capita:** ${fmt(s.budget.perCapita, "dollar")}`);
    lines.push("");
    lines.push("**Spending by Category:**");
    for (const cat of s.budget.categories) {
      lines.push(`- ${cat.name}: ${fmt(cat.amount, "dollar")} (${cat.percent.toFixed(1)}%) — ${fmt(cat.perCapita, "dollar")}/person`);
    }
  }

  if (s.civic && s.civic.officials.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("**Elected Representatives:**");
    for (const official of s.civic.officials) {
      const party = official.party ? ` (${official.party})` : "";
      lines.push(`- **${official.office}:** ${official.name}${party}`);
    }
  }

  return {
    title: "Government",
    content: lines.join("\n"),
    source: [s.budget ? "Municipal Budget" : null, s.civic ? "Google Civic" : null]
      .filter(Boolean).join(", ") || "N/A",
  };
}

function buildCommunityVoice(s: SourceResults): CityBriefing["sections"][0] {
  const lines: string[] = [];

  if (s.three11) {
    lines.push(`**311 Service Requests** (last ${s.three11.period.days} days)`);
    lines.push(`- **Total Requests:** ${fmt(s.three11.totalRequests, "number")}`);
    lines.push("");
    lines.push("**Top Complaint Categories:**");
    for (const cat of s.three11.topCategories.slice(0, 10)) {
      lines.push(`- ${cat.category}: ${fmt(cat.count, "number")} (${cat.percentOfTotal.toFixed(1)}%)`);
    }
    if (s.three11.monthlyTrend.length > 0) {
      lines.push("");
      lines.push("**Monthly Trend:**");
      const trend = s.three11.monthlyTrend.map(m => `${m.month}: ${fmt(m.count, "number")}`).join(" → ");
      lines.push(trend);
    }
  }

  return {
    title: "Community Voice",
    content: lines.join("\n"),
    source: s.three11 ? "311 / Socrata" : "N/A",
  };
}

function buildDataSourcesSection(
  available: string[],
  unavailable: string[]
): CityBriefing["sections"][0] {
  const lines: string[] = [];

  lines.push(`**${available.length} of ${available.length + unavailable.length} sources returned data.**`);
  lines.push("");

  if (available.length > 0) {
    lines.push("**Available:**");
    for (const src of available) {
      lines.push(`- ✓ ${src}`);
    }
  }

  if (unavailable.length > 0) {
    lines.push("");
    lines.push("**Not Available:**");
    for (const src of unavailable) {
      lines.push(`- ✗ ${src}`);
    }
  }

  return {
    title: "Data Sources",
    content: lines.join("\n"),
    source: "meta",
  };
}

// ── Formatter ──────────────────────────────────────────────────────────────

/**
 * Format the briefing as a clean, scannable markdown document.
 */
export function formatBriefing(briefing: CityBriefing): string {
  const lines: string[] = [];

  lines.push(`# ${briefing.city} — City Briefing`);
  lines.push(`*Generated ${new Date(briefing.generatedAt).toLocaleString()} · ${briefing.dataSources.available.length} data sources*`);
  lines.push("");

  for (const section of briefing.sections) {
    lines.push(`## ${section.title}`);
    if (section.source !== "meta" && section.source !== "N/A") {
      lines.push(`*Source: ${section.source}*`);
    }
    lines.push("");
    lines.push(section.content);
    lines.push("");
  }

  return lines.join("\n");
}
