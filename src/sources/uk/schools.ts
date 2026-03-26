/**
 * UK Schools — GIAS + Explore Education Statistics
 *
 * GIAS: School details, Ofsted ratings, enrollment. No auth.
 * Explore Education Statistics: Attainment, absence, workforce. No auth.
 *
 * API docs: https://www.get-information-schools.service.gov.uk/
 * US equivalent: NCES
 */

import type { UkSchoolsResult } from "./types.js";
import { EDUCATION_STATS_BASE, fetchJson } from "./constants.js";
import { resolveUkCity } from "./geo-resolver.js";

/**
 * Query school data for a UK city/local authority.
 */
export async function queryUkSchools(cityInput: string): Promise<UkSchoolsResult> {
  const geo = await resolveUkCity(cityInput);

  const result: UkSchoolsResult = {
    city: geo.city,
    totalSchools: 0,
    byType: {},
    byOfsted: {},
    totalPupils: 0,
  };

  // GIAS data is available as CSV downloads. For the API approach,
  // we query the Explore Education Statistics API for LA-level school data.
  try {
    // Search for school-level datasets in Explore Education Statistics
    const url = `${EDUCATION_STATS_BASE}/data-sets?search=schools&geographic_level=local_authority`;
    const data = await fetchJson(url, { timeout: 10000 });

    // If the API returns datasets, we can query them
    // The API structure may vary — this is the expected pattern
    if (data?.results) {
      // Process results
      for (const ds of data.results.slice(0, 3)) {
        console.error(`[city-data-mcp] Found education dataset: ${ds.title}`);
      }
    }
  } catch (e) {
    console.error("[city-data-mcp] Education stats query failed:", e);
  }

  // GIAS provides downloadable data. For a basic count, we can use
  // the search endpoint (HTML scraping would be needed for full API).
  // For now, return the structure for manual population or future API integration.

  return result;
}

/** Format schools results as markdown */
export function formatUkSchoolsResults(result: UkSchoolsResult): string {
  const lines: string[] = [
    `# UK Schools Data: ${result.city}`,
    "",
  ];

  if (result.totalSchools > 0) {
    lines.push(
      `**Total Schools**: ${result.totalSchools}`,
      `**Total Pupils**: ${result.totalPupils.toLocaleString()}`,
      "",
    );

    if (Object.keys(result.byType).length > 0) {
      lines.push("## By School Type", "");
      for (const [type, count] of Object.entries(result.byType).sort(([, a], [, b]) => b - a)) {
        lines.push(`- **${type}**: ${count}`);
      }
      lines.push("");
    }

    if (Object.keys(result.byOfsted).length > 0) {
      lines.push("## By Ofsted Rating", "");
      const order = ["Outstanding", "Good", "Requires Improvement", "Inadequate"];
      for (const rating of order) {
        if (result.byOfsted[rating]) {
          lines.push(`- **${rating}**: ${result.byOfsted[rating]}`);
        }
      }
      lines.push("");
    }

    if (result.attainment) {
      lines.push("## Attainment", "");
      if (result.attainment.ks2) {
        lines.push(`- **KS2 Meeting Expected Standard**: ${result.attainment.ks2.meetingExpected}%`);
      }
      if (result.attainment.ks4) {
        lines.push(`- **KS4 Average Attainment 8**: ${result.attainment.ks4.averageAttainment8}`);
      }
    }
  } else {
    lines.push(
      "*School data for this area is available via GIAS (Get Information About Schools).*",
      "*Visit: https://www.get-information-schools.service.gov.uk/*",
      "*Explore Education Statistics: https://explore-education-statistics.service.gov.uk/*",
    );
  }

  lines.push(
    "",
    "---",
    "*Sources: GIAS + DfE Explore Education Statistics — covers England only.*"
  );

  return lines.join("\n");
}
