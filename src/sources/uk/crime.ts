/**
 * Police UK API — Street-Level Crime Data
 *
 * No auth required. Covers England, Wales & Northern Ireland (43 forces).
 * Query by lat/lng radius. Monthly updates, ~2 month lag.
 *
 * API docs: https://data.police.uk/docs/
 * US equivalent: FBI UCR
 */

import type { UkCrimeResult } from "./types.js";
import { POLICE_UK_BASE, fetchJson } from "./constants.js";
import { resolveUkCity } from "./geo-resolver.js";

/**
 * Query street-level crime data for a UK city.
 * Uses a 1-mile radius around the city centre coordinates.
 */
export async function queryUkCrime(cityInput: string): Promise<UkCrimeResult> {
  const geo = await resolveUkCity(cityInput);

  // Get available months — use 3rd most recent for complete data
  // (newest months often have incomplete/sparse data due to processing lag)
  const availableUrl = `${POLICE_UK_BASE}/crimes-street-dates`;
  const dates = await fetchJson(availableUrl);
  const latestMonth = dates?.[2]?.date || dates?.[0]?.date || "";

  // Query street-level crimes within 1 mile of city centre
  const crimesUrl = `${POLICE_UK_BASE}/crimes-street/all-crime?lat=${geo.lat}&lng=${geo.lon}&date=${latestMonth}`;
  const crimes: any[] = await fetchJson(crimesUrl, { timeout: 15000 });

  // Aggregate by category
  const categories: Record<string, number> = {};
  for (const crime of crimes) {
    const cat = crime.category || "other";
    categories[cat] = (categories[cat] || 0) + 1;
  }

  // Sort categories by count
  const sortedCategories = Object.fromEntries(
    Object.entries(categories).sort(([, a], [, b]) => b - a)
  );

  // Sample recent crimes (top 10)
  const recentCrimes = crimes.slice(0, 10).map((c: any) => ({
    category: formatCategory(c.category),
    location: c.location?.street?.name || "Unknown",
    month: c.month || latestMonth,
    outcome: c.outcome_status?.category,
  }));

  return {
    city: geo.city,
    lat: geo.lat,
    lon: geo.lon,
    totalCrimes: crimes.length,
    month: latestMonth,
    categories: sortedCategories,
    recentCrimes,
  };
}

/** Format crime results as markdown */
export function formatUkCrimeResults(result: UkCrimeResult): string {
  const lines: string[] = [
    `# UK Crime Data: ${result.city}`,
    "",
    `**Month**: ${result.month}`,
    `**Total crimes** (city centre area): ${result.totalCrimes.toLocaleString()}`,
    `**Coordinates**: ${result.lat.toFixed(4)}, ${result.lon.toFixed(4)}`,
    "",
    "## Crime Categories",
    "",
  ];

  for (const [cat, count] of Object.entries(result.categories)) {
    const pct = ((count / result.totalCrimes) * 100).toFixed(1);
    lines.push(`- **${formatCategory(cat)}**: ${count} (${pct}%)`);
  }

  if (result.recentCrimes.length > 0) {
    lines.push("", "## Sample Incidents", "");
    for (const crime of result.recentCrimes) {
      const outcome = crime.outcome ? ` → ${crime.outcome}` : "";
      lines.push(`- ${crime.category} at ${crime.location}${outcome}`);
    }
  }

  lines.push(
    "",
    "---",
    "*Source: data.police.uk — covers England, Wales & Northern Ireland. Scotland uses separate reporting.*",
    "*Note: Police Scotland does not use this API — Scottish data requires separate access.*"
  );

  return lines.join("\n");
}

/** Convert hyphenated category to title case */
function formatCategory(cat: string): string {
  return cat
    .split("-")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
