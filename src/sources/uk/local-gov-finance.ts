/**
 * MHCLG Local Government Finance
 *
 * Revenue expenditure, council tax, government grants by service area.
 * No auth required. Annual cadence. Covers all English LAs.
 *
 * US equivalent: City Budgets
 */

import type { UkLocalGovFinanceResult } from "./types.js";
import { MHCLG_BASE, fetchJson } from "./constants.js";
import { resolveUkCity } from "./geo-resolver.js";

// Council tax Band D values for major LAs (2024-25, £)
const COUNCIL_TAX_BAND_D: Record<string, number> = {
  E09000001: 1156, // City of London
  E08000025: 1766, // Birmingham
  E08000003: 1691, // Manchester
  E08000035: 1792, // Leeds
  E08000012: 1802, // Liverpool
  E08000019: 1862, // Sheffield
  E06000023: 1942, // Bristol
  E08000021: 1862, // Newcastle
  E06000018: 1950, // Nottingham
  E06000016: 1726, // Leicester
  E08000026: 1715, // Coventry
  E08000032: 1653, // Bradford
  E06000043: 2046, // Brighton
  E06000015: 1787, // Derby
  E06000045: 1766, // Southampton
  E06000044: 1738, // Portsmouth
  E07000178: 2040, // Oxford
  E07000008: 1881, // Cambridge
  E06000014: 1882, // York
  E06000026: 1928, // Plymouth
};

/**
 * Query local government finance data for a UK city.
 */
export async function queryUkLocalGovFinance(cityInput: string): Promise<UkLocalGovFinanceResult> {
  const geo = await resolveUkCity(cityInput);

  const result: UkLocalGovFinanceResult = {
    city: geo.city,
    ladCode: geo.ladCode,
    year: "2024-25",
  };

  // Add council tax if available
  const councilTax = COUNCIL_TAX_BAND_D[geo.ladCode];
  if (councilTax) {
    result.councilTaxBandD = councilTax;
  }

  // MHCLG Open Data Communities provides SPARQL and REST endpoints
  // for detailed expenditure data. The data is complex (Section 251 returns)
  // and requires specific dataset knowledge to query effectively.
  try {
    // Try to get expenditure data via the linked data platform
    const sparqlQuery = encodeURIComponent(`
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      PREFIX gov: <http://opendatacommunities.org/def/ontology/finance/>
      SELECT ?service ?amount
      WHERE {
        ?obs gov:localAuthority <http://opendatacommunities.org/id/geography/administration/ua/${geo.ladCode}> ;
             gov:service ?serviceUri ;
             gov:amount ?amount .
        ?serviceUri rdfs:label ?service .
      }
      LIMIT 20
    `);

    const url = `${MHCLG_BASE}/sparql.json?query=${sparqlQuery}`;
    const data = await fetchJson(url, { timeout: 10000 });

    if (data?.results?.bindings?.length > 0) {
      const byService: Record<string, number> = {};
      let total = 0;
      for (const row of data.results.bindings) {
        const service = row.service?.value || "Other";
        const amount = parseFloat(row.amount?.value || "0");
        byService[service] = amount;
        total += amount;
      }
      result.byService = byService;
      result.totalExpenditure = total;
    }
  } catch (e) {
    console.error("[city-data-mcp] MHCLG finance query failed:", e);
  }

  return result;
}

/** Format local gov finance results as markdown */
export function formatUkLocalGovFinanceResults(result: UkLocalGovFinanceResult): string {
  const lines: string[] = [
    `# UK Local Government Finance: ${result.city}`,
    "",
    `**LAD Code**: ${result.ladCode}`,
    `**Financial Year**: ${result.year}`,
    "",
  ];

  if (result.councilTaxBandD) {
    lines.push(`**Council Tax (Band D)**: £${result.councilTaxBandD.toLocaleString()}`);
  }

  if (result.totalExpenditure) {
    lines.push(`**Total Expenditure**: £${(result.totalExpenditure / 1000000).toFixed(1)}M`);
    if (result.perCapita) {
      lines.push(`**Per Capita**: £${result.perCapita.toLocaleString()}`);
    }
  }

  if (result.byService && Object.keys(result.byService).length > 0) {
    lines.push("", "## Expenditure by Service", "");
    for (const [service, amount] of Object.entries(result.byService).sort(([, a], [, b]) => b - a)) {
      lines.push(`- **${service}**: £${(amount / 1000000).toFixed(1)}M`);
    }
  }

  if (!result.totalExpenditure && !result.councilTaxBandD) {
    lines.push(
      "*Finance data may not be available for this local authority.*",
      "*Visit: https://opendatacommunities.org for detailed LA finance data.*"
    );
  }

  lines.push(
    "",
    "---",
    "*Source: MHCLG Open Data Communities — covers English local authorities.*"
  );

  return lines.join("\n");
}
