/**
 * ONS API — Demographics (Census 2021) + MHCLG Deprivation
 *
 * No auth required. Covers ~30,000 geographies.
 * ONS Beta API for population, age, households.
 * MHCLG for Indices of Multiple Deprivation.
 *
 * API docs: https://developer.ons.gov.uk/
 * US equivalent: Census ACS
 */

import type { UkDemographicsResult } from "./types.js";
import { ONS_API_BASE, fetchJson } from "./constants.js";
import { resolveUkCity } from "./geo-resolver.js";

const NOMIS_BASE = "https://www.nomisweb.co.uk/api/v01/dataset";

// IMD decile data for major English LAs (2019 release, rank out of 317 LAs)
// Lower rank = more deprived. Decile 1 = most deprived 10%.
const IMD_DATA: Record<string, { rank: number; decile: number }> = {
  E08000025: { rank: 7, decile: 1 },    // Birmingham
  E08000003: { rank: 6, decile: 1 },    // Manchester
  E08000012: { rank: 3, decile: 1 },    // Liverpool
  E08000035: { rank: 28, decile: 1 },   // Leeds
  E08000019: { rank: 26, decile: 1 },   // Sheffield
  E08000021: { rank: 21, decile: 1 },   // Newcastle
  E06000018: { rank: 11, decile: 1 },   // Nottingham
  E06000010: { rank: 4, decile: 1 },    // Hull
  E08000032: { rank: 19, decile: 1 },   // Bradford
  E06000023: { rank: 52, decile: 2 },   // Bristol
  E06000015: { rank: 38, decile: 2 },   // Derby
  E08000026: { rank: 41, decile: 2 },   // Coventry
  E06000016: { rank: 32, decile: 2 },   // Leicester
  E06000045: { rank: 54, decile: 2 },   // Southampton
  E06000044: { rank: 59, decile: 2 },   // Portsmouth
  E06000031: { rank: 48, decile: 2 },   // Peterborough
  E06000021: { rank: 14, decile: 1 },   // Stoke-on-Trent
  E08000031: { rank: 17, decile: 1 },   // Wolverhampton
  E06000043: { rank: 92, decile: 3 },   // Brighton
  E07000178: { rank: 165, decile: 6 },  // Oxford
  E07000008: { rank: 187, decile: 6 },  // Cambridge
  E06000014: { rank: 136, decile: 5 },  // York
  E06000026: { rank: 30, decile: 1 },   // Plymouth
  E06000038: { rank: 126, decile: 4 },  // Reading
};

/**
 * Query UK demographics for a city using ONS API + local IMD data.
 */
export async function queryUkDemographics(cityInput: string): Promise<UkDemographicsResult> {
  const geo = await resolveUkCity(cityInput);

  const result: UkDemographicsResult = {
    city: geo.city,
    ladCode: geo.ladCode,
    population: 0,
  };

  // Use Nomis Census 2021 API for population (TS001 - usual residents)
  try {
    const popUrl = `${NOMIS_BASE}/NM_2021_1.jsonstat.json?geography=${geo.ladCode}&measures=20100`;
    const popData = await fetchJson(popUrl, { timeout: 10000 });
    // Values: [total, in households, in communal establishments]
    if (popData?.value?.[0]) {
      result.population = popData.value[0];
    }
  } catch {
    // Fallback: leave population at 0
  }

  // Use Nomis ASHE for median earnings (pay=7 = annual gross, sex=8 = full time, item=2 = median)
  try {
    const earningsUrl = `${NOMIS_BASE}/NM_30_1.jsonstat.json?geography=${geo.ladCode}&date=latest&sex=8&item=2&pay=7&measures=20100`;
    const earningsData = await fetchJson(earningsUrl, { timeout: 10000 });
    if (earningsData?.value?.[0]) {
      result.medianEarnings = earningsData.value[0];
    }
  } catch {
    // Non-critical
  }

  // Add IMD deprivation data if available (England only)
  const imd = IMD_DATA[geo.ladCode];
  if (imd) {
    result.deprivation = {
      imdRank: imd.rank,
      imdDecile: imd.decile,
    };
  }

  return result;
}

/** Query UK migration/internal movement data */
export async function queryUkMigration(cityInput: string): Promise<{
  city: string;
  ladCode: string;
  internalMigration?: { inflow: number; outflow: number; net: number; year: string };
}> {
  const geo = await resolveUkCity(cityInput);

  // ONS internal migration data is published as datasets, not real-time API
  // Return what we can resolve
  return {
    city: geo.city,
    ladCode: geo.ladCode,
    internalMigration: undefined, // Would need bulk dataset download
  };
}

/** Format demographics results as markdown */
export function formatUkDemographicsResults(result: UkDemographicsResult): string {
  const lines: string[] = [
    `# UK Demographics: ${result.city}`,
    "",
    `**LAD Code**: ${result.ladCode}`,
  ];

  if (result.population) {
    lines.push(`**Population**: ${result.population.toLocaleString()}`);
  }

  if (result.medianAge) {
    lines.push(`**Median Age**: ${result.medianAge}`);
  }

  if (result.medianEarnings) {
    lines.push(`**Median Annual Earnings (FT)**: £${result.medianEarnings.toLocaleString()}`);
  }

  if (result.households) {
    lines.push(`**Households**: ${result.households.toLocaleString()}`);
  }

  if (result.densityPerSqKm) {
    lines.push(`**Density**: ${result.densityPerSqKm.toLocaleString()} per km²`);
  }

  if (result.deprivation) {
    lines.push(
      "",
      "## Deprivation (IMD 2019)",
      "",
      `**IMD Rank**: ${result.deprivation.imdRank} of 317 English LAs`,
      `**IMD Decile**: ${result.deprivation.imdDecile} (1 = most deprived 10%)`,
    );
  }

  if (result.ethnicGroups && Object.keys(result.ethnicGroups).length > 0) {
    lines.push("", "## Ethnic Groups", "");
    for (const [group, pct] of Object.entries(result.ethnicGroups)) {
      lines.push(`- **${group}**: ${pct}%`);
    }
  }

  lines.push(
    "",
    "---",
    "*Source: ONS Census 2021 + MHCLG Indices of Multiple Deprivation 2019.*",
    "*Note: IMD covers England only. Scotland, Wales & NI use different indices.*"
  );

  return lines.join("\n");
}

/** Format migration results as markdown */
export function formatUkMigrationResults(result: {
  city: string;
  ladCode: string;
  internalMigration?: { inflow: number; outflow: number; net: number; year: string };
}): string {
  const lines: string[] = [
    `# UK Migration Data: ${result.city}`,
    "",
    `**LAD Code**: ${result.ladCode}`,
  ];

  if (result.internalMigration) {
    const m = result.internalMigration;
    lines.push(
      "",
      `## Internal Migration (${m.year})`,
      "",
      `- **Inflow**: ${m.inflow.toLocaleString()}`,
      `- **Outflow**: ${m.outflow.toLocaleString()}`,
      `- **Net**: ${m.net > 0 ? "+" : ""}${m.net.toLocaleString()}`,
    );
  } else {
    lines.push(
      "",
      "*Internal migration data is published as annual bulk releases by ONS.*",
      "*Real-time API access to migration flows is not yet available.*"
    );
  }

  lines.push(
    "",
    "---",
    "*Source: ONS Internal Migration estimates.*"
  );

  return lines.join("\n");
}
