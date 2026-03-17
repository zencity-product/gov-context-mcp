/**
 * City Change Tracker — "What's Moving"
 *
 * Pulls trend data from all sources that have temporal/change data and
 * surfaces what's getting better, worse, or staying flat. Produces a
 * scannable "city health check" with directional indicators.
 *
 * Sources with trend data:
 *   BLS  — unemployment rate (current vs year-ago), employment change
 *   FRED — housing price index, employment, personal income trends
 *   FBI  — crime trends over multiple years
 *   Permits — 5-year building permit trend
 *   311  — monthly request volume trend (limited cities)
 *
 * Snapshot-only sources (Census, HUD, weather, schools, budget) are
 * not included — they lack temporal change data.
 */

import { queryFred, resolveFredCity, type FredCityResult } from "./fred.js";
import { queryBls, resolveBlsCity, type BlsCityResult } from "./bls.js";
import { queryFbiCrime, resolveFbiCity, type FbiCrimeResult } from "./fbi.js";
import { queryPermits, type PermitResult } from "./permits.js";
import { query311Trends, type Three11Result } from "./three11.js";
import { queryTraffic, type TrafficResult } from "./traffic.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Direction = "improving" | "declining" | "stable" | "unknown";

export interface ChangeMetric {
  category: string;   // "Economy", "Housing", "Safety", etc.
  metric: string;     // "Unemployment Rate", "Housing Price Index", etc.
  current: string;    // "3.8%", "$425,000", etc.
  previous: string;   // "4.2% (Mar 2025)", "$398,000 (2023)", etc.
  change: string;     // "-0.4 pp", "+6.8%", etc.
  direction: Direction;
  source: string;     // "BLS", "FRED", etc.
}

export interface ChangeTrackerResult {
  city: string;
  trackedAt: string;
  metrics: ChangeMetric[];
  summary: {
    improving: number;
    declining: number;
    stable: number;
    unknown: number;
  };
  dataSources: string[];
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function trackCityChanges(city: string): Promise<ChangeTrackerResult> {
  const metrics: ChangeMetric[] = [];
  const dataSources: string[] = [];

  // Resolve city keys for each source (they differ)
  const fredResolved = resolveFredCity(city);
  const blsResolved = resolveBlsCity(city);
  const fbiResolved = resolveFbiCity(city);

  // Fire all fetches in parallel; each catches its own errors
  const [fredResult, blsResult, fbiResult, permitResult, three11Result, trafficResult] =
    await Promise.all([
      fredResolved
        ? queryFred(fredResolved.key).catch((e) => {
            console.error(`[change-tracker] FRED error: ${(e as Error).message}`);
            return null;
          })
        : Promise.resolve(null),
      blsResolved
        ? queryBls(blsResolved.key).catch((e) => {
            console.error(`[change-tracker] BLS error: ${(e as Error).message}`);
            return null;
          })
        : Promise.resolve(null),
      fbiResolved
        ? queryFbiCrime(fbiResolved.config.state, fbiResolved.key).catch((e) => {
            console.error(`[change-tracker] FBI error: ${(e as Error).message}`);
            return null;
          })
        : Promise.resolve(null),
      queryPermits(city).catch((e) => {
        console.error(`[change-tracker] Permits error: ${(e as Error).message}`);
        return null;
      }),
      query311Trends(city, 180).catch((e) => {
        console.error(`[change-tracker] 311 error: ${(e as Error).message}`);
        return null;
      }),
      queryTraffic(city).catch((e) => {
        console.error(`[change-tracker] Traffic error: ${(e as Error).message}`);
        return null;
      }),
    ]);

  // --- Extract metrics from each source ---

  if (blsResult) {
    dataSources.push("BLS");
    extractBlsMetrics(blsResult, metrics);
  }

  if (fredResult) {
    dataSources.push("FRED");
    extractFredMetrics(fredResult, metrics);
  }

  if (fbiResult) {
    dataSources.push("FBI");
    extractFbiMetrics(fbiResult, metrics);
  }

  if (permitResult) {
    dataSources.push("Census BPS");
    extractPermitMetrics(permitResult, metrics);
  }

  if (three11Result) {
    dataSources.push("311 / Socrata");
    extract311Metrics(three11Result, metrics);
  }

  if (trafficResult) {
    dataSources.push("NHTSA FARS");
    extractTrafficMetrics(trafficResult, metrics);
  }

  // --- Build summary ---

  const summary = { improving: 0, declining: 0, stable: 0, unknown: 0 };
  for (const m of metrics) {
    summary[m.direction]++;
  }

  // Determine display name
  const displayCity =
    blsResult?.city ||
    fredResult?.city ||
    fbiResult?.city ||
    permitResult?.city ||
    three11Result?.city ||
    city;

  return {
    city: displayCity,
    trackedAt: new Date().toISOString(),
    metrics,
    summary,
    dataSources,
  };
}

// ---------------------------------------------------------------------------
// BLS extraction
// ---------------------------------------------------------------------------

function extractBlsMetrics(bls: BlsCityResult, out: ChangeMetric[]): void {
  const u = bls.unemployment;
  if (u.current !== null) {
    const dir: Direction =
      u.change !== null
        ? u.change < -0.3
          ? "improving"
          : u.change > 0.3
            ? "declining"
            : "stable"
        : "unknown";

    out.push({
      category: "Economy",
      metric: "Unemployment Rate",
      current: `${u.current.toFixed(1)}%`,
      previous:
        u.yearAgo !== null
          ? `${u.yearAgo.toFixed(1)}% (${u.yearAgoDate})`
          : "N/A",
      change:
        u.change !== null
          ? `${u.change > 0 ? "+" : ""}${u.change.toFixed(1)} pp`
          : "N/A",
      direction: dir,
      source: "BLS",
    });
  }

  const e = bls.employment;
  if (e.current !== null && e.changePercent !== null) {
    const dir: Direction =
      e.changePercent > 0.5
        ? "improving"
        : e.changePercent < -0.5
          ? "declining"
          : "stable";

    out.push({
      category: "Economy",
      metric: "Total Employment",
      current: `${e.current.toLocaleString()} (${e.currentDate})`,
      previous:
        e.yearAgo !== null ? `${e.yearAgo.toLocaleString()} (year ago)` : "N/A",
      change: `${e.changePercent > 0 ? "+" : ""}${e.changePercent.toFixed(1)}% YoY`,
      direction: dir,
      source: "BLS",
    });
  }
}

// ---------------------------------------------------------------------------
// FRED extraction
// ---------------------------------------------------------------------------

function extractFredMetrics(fred: FredCityResult, out: ChangeMetric[]): void {
  for (const s of fred.series) {
    if (s.latestValue === null || s.previousValue === null || s.change === null) {
      continue;
    }

    // Skip the national unemployment series (BLS already covers unemployment)
    if (s.label === "National Unemployment Rate") continue;
    // Skip FRED unemployment — BLS version is more granular
    if (s.label === "Unemployment Rate") continue;

    const absChange = Math.abs(s.change);
    const pctChange =
      s.previousValue !== 0
        ? ((s.change / s.previousValue) * 100)
        : 0;

    let category: string;
    let direction: Direction;
    let currentStr: string;
    let previousStr: string;
    let changeStr: string;

    if (s.label === "Housing Price Index") {
      category = "Housing";
      // Housing price increase: growing market (not strictly good/bad)
      // Use a neutral-positive framing
      if (pctChange > 2) direction = "improving";
      else if (pctChange < -2) direction = "declining";
      else direction = "stable";

      currentStr = `${s.latestValue.toFixed(1)} (${s.latestDate})`;
      previousStr = `${s.previousValue.toFixed(1)} (${s.previousDate})`;
      changeStr = `${pctChange > 0 ? "+" : ""}${pctChange.toFixed(1)}%`;
    } else if (s.label === "Total Nonfarm Employment") {
      category = "Economy";
      if (s.change > 0) direction = "improving";
      else if (s.change < 0) direction = "declining";
      else direction = "stable";

      currentStr = `${s.latestValue.toLocaleString()}K (${s.latestDate})`;
      previousStr = `${s.previousValue.toLocaleString()}K (${s.previousDate})`;
      changeStr = `${s.change > 0 ? "+" : ""}${s.change.toFixed(1)}K`;
    } else if (s.label === "Per Capita Personal Income") {
      category = "Economy";
      if (pctChange > 1) direction = "improving";
      else if (pctChange < -1) direction = "declining";
      else direction = "stable";

      currentStr = `$${s.latestValue.toLocaleString()} (${s.latestDate})`;
      previousStr = `$${s.previousValue.toLocaleString()} (${s.previousDate})`;
      changeStr = `${pctChange > 0 ? "+" : ""}${pctChange.toFixed(1)}%`;
    } else {
      // Generic series
      category = "Economy";
      direction = s.change > 0 ? "improving" : s.change < 0 ? "declining" : "stable";
      currentStr = `${s.latestValue.toFixed(1)} (${s.latestDate})`;
      previousStr = `${s.previousValue.toFixed(1)} (${s.previousDate})`;
      changeStr = `${s.change > 0 ? "+" : ""}${absChange.toFixed(1)}`;
    }

    out.push({
      category,
      metric: s.label,
      current: currentStr,
      previous: previousStr,
      change: changeStr,
      direction,
      source: "FRED",
    });
  }
}

// ---------------------------------------------------------------------------
// FBI extraction
// ---------------------------------------------------------------------------

function extractFbiMetrics(fbi: FbiCrimeResult, out: ChangeMetric[]): void {
  // Focus on violent crime and property crime aggregates
  const targets = ["violent-crime", "property-crime"];

  for (const offense of fbi.offenses) {
    if (!targets.includes(offense.category)) continue;
    if (offense.years.length < 2) continue;

    const latest = offense.years[0]; // sorted newest first
    const oldest = offense.years[offense.years.length - 1];

    if (oldest.count === 0) continue;

    const pctChange = ((latest.count - oldest.count) / oldest.count) * 100;
    // Lower crime = improving
    let direction: Direction;
    if (pctChange < -5) direction = "improving";
    else if (pctChange > 5) direction = "declining";
    else direction = "stable";

    const useRate = latest.rate != null;
    const currentStr = useRate
      ? `${latest.rate}/100K (${latest.year})`
      : `${latest.count.toLocaleString()} incidents (${latest.year})`;
    const previousStr = useRate
      ? `${oldest.rate}/100K (${oldest.year})`
      : `${oldest.count.toLocaleString()} incidents (${oldest.year})`;

    out.push({
      category: "Safety",
      metric: offense.label,
      current: currentStr,
      previous: previousStr,
      change: `${pctChange > 0 ? "+" : ""}${pctChange.toFixed(1)}% since ${oldest.year}`,
      direction,
      source: `FBI (${fbi.dataLevel})`,
    });
  }
}

// ---------------------------------------------------------------------------
// Building Permits extraction
// ---------------------------------------------------------------------------

function extractPermitMetrics(permits: PermitResult, out: ChangeMetric[]): void {
  if (permits.latestPermits === null) return;

  // Find the earliest year with data for comparison
  const withData = permits.annualData.filter((d) => d.permits !== null);
  if (withData.length < 2) return;

  const earliest = withData[0];
  const latest = withData[withData.length - 1];

  // Higher permits = more development = improving
  let direction: Direction;
  if (permits.trend === "growing") direction = "improving";
  else if (permits.trend === "declining") direction = "declining";
  else if (permits.trend === "stable") direction = "stable";
  else direction = "unknown";

  out.push({
    category: "Development",
    metric: "Building Permits",
    current: `${latest.permits!.toLocaleString()} (${latest.year})`,
    previous: `${earliest.permits!.toLocaleString()} (${earliest.year})`,
    change:
      permits.changePercent !== null
        ? `${permits.changePercent > 0 ? "+" : ""}${permits.changePercent}% YoY`
        : "N/A",
    direction,
    source: "Census BPS",
  });
}

// ---------------------------------------------------------------------------
// 311 extraction
// ---------------------------------------------------------------------------

function extract311Metrics(data: Three11Result, out: ChangeMetric[]): void {
  if (data.monthlyTrend.length < 2) return;

  const first = data.monthlyTrend[0];
  const last = data.monthlyTrend[data.monthlyTrend.length - 1];

  if (first.count === 0) return;

  const pctChange = ((last.count - first.count) / first.count) * 100;

  // 311 volume is ambiguous — more requests could mean more civic engagement
  // or more problems. Report direction neutrally as "increasing" / "decreasing".
  // We still map to the Direction type but clarify in the metric name.
  let direction: Direction;
  if (Math.abs(pctChange) < 10) direction = "stable";
  else direction = "unknown"; // ambiguous — don't judge

  out.push({
    category: "Civic Engagement",
    metric: "311 Request Volume",
    current: `${last.count.toLocaleString()}/mo (${last.month})`,
    previous: `${first.count.toLocaleString()}/mo (${first.month})`,
    change: `${pctChange > 0 ? "+" : ""}${pctChange.toFixed(0)}% over period`,
    direction,
    source: "311 / Socrata",
  });
}

// ---------------------------------------------------------------------------
// Traffic extraction
// ---------------------------------------------------------------------------

function extractTrafficMetrics(traffic: TrafficResult, out: ChangeMetric[]): void {
  const primary = traffic.county?.years ?? traffic.state.years;
  if (primary.length < 2) return;

  const sorted = [...primary].sort((a, b) => a.year - b.year); // oldest first
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  if (first.totalFatalities === 0) return;

  const pctChange = ((last.totalFatalities - first.totalFatalities) / first.totalFatalities) * 100;

  // Fewer fatalities = improving (inverted, like crime)
  let direction: Direction;
  if (pctChange < -5) direction = "improving";
  else if (pctChange > 5) direction = "declining";
  else direction = "stable";

  const rateStr = (y: typeof first) =>
    y.fatalityRate != null
      ? `${y.fatalityRate.toFixed(1)}/100K`
      : `${y.totalFatalities.toLocaleString()} fatalities`;

  out.push({
    category: "Safety",
    metric: "Traffic Fatalities",
    current: `${rateStr(last)} (${last.year})`,
    previous: `${rateStr(first)} (${first.year})`,
    change: `${pctChange > 0 ? "+" : ""}${pctChange.toFixed(1)}% since ${first.year}`,
    direction,
    source: `NHTSA FARS (${traffic.dataLevel})`,
  });

  // Pedestrian trend if data available
  if (first.pedestrianFatalities > 0 || last.pedestrianFatalities > 0) {
    const pedFirst = first.pedestrianFatalities;
    const pedLast = last.pedestrianFatalities;
    if (pedFirst > 0) {
      const pedChange = ((pedLast - pedFirst) / pedFirst) * 100;
      let pedDir: Direction;
      if (pedChange < -5) pedDir = "improving";
      else if (pedChange > 5) pedDir = "declining";
      else pedDir = "stable";

      out.push({
        category: "Safety",
        metric: "Pedestrian Fatalities",
        current: `${pedLast.toLocaleString()} (${last.year})`,
        previous: `${pedFirst.toLocaleString()} (${first.year})`,
        change: `${pedChange > 0 ? "+" : ""}${pedChange.toFixed(1)}% since ${first.year}`,
        direction: pedDir,
        source: `NHTSA FARS (${traffic.dataLevel})`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

const DIRECTION_INDICATORS: Record<Direction, string> = {
  improving: "\u2191", // ↑
  declining: "\u2193", // ↓
  stable: "\u2192",    // →
  unknown: "?",
};

const DIRECTION_LABELS: Record<Direction, string> = {
  improving: "Improving",
  declining: "Declining",
  stable: "Stable",
  unknown: "Unknown",
};

export function formatChangeTracker(result: ChangeTrackerResult): string {
  const lines: string[] = [];
  const s = result.summary;

  // Header
  lines.push(`# ${result.city} — City Change Tracker`);
  lines.push("");

  // Summary bar
  const parts: string[] = [];
  if (s.improving > 0) parts.push(`${s.improving} improving`);
  if (s.declining > 0) parts.push(`${s.declining} declining`);
  if (s.stable > 0) parts.push(`${s.stable} stable`);
  if (s.unknown > 0) parts.push(`${s.unknown} unknown`);
  lines.push(`**Summary:** ${parts.join(", ")}`);
  lines.push(`**Sources:** ${result.dataSources.join(", ")}`);
  lines.push(`**As of:** ${result.trackedAt.split("T")[0]}`);
  lines.push("");

  // Group metrics by category
  const categories = new Map<string, ChangeMetric[]>();
  for (const m of result.metrics) {
    const existing = categories.get(m.category);
    if (existing) {
      existing.push(m);
    } else {
      categories.set(m.category, [m]);
    }
  }

  // Render each category
  for (const [category, metrics] of categories) {
    lines.push(`## ${category}`);
    lines.push("");

    for (const m of metrics) {
      const indicator = DIRECTION_INDICATORS[m.direction];
      const label = DIRECTION_LABELS[m.direction];
      lines.push(`${indicator} **${m.metric}** — ${label}`);
      lines.push(`  Current: ${m.current}`);
      lines.push(`  Previous: ${m.previous}`);
      lines.push(`  Change: ${m.change}`);
      lines.push(`  Source: ${m.source}`);
      lines.push("");
    }
  }

  // If no metrics at all
  if (result.metrics.length === 0) {
    lines.push("_No trend data available for this city. Temporal data requires BLS, FRED, FBI, Permits, or 311 coverage._");
  }

  return lines.join("\n");
}
