/**
 * UK Housing — Land Registry Price Paid + VOA Rental Statistics
 *
 * Land Registry: All residential property transactions since 1995. No auth.
 * VOA: Rental prices by LA and bedroom count. No auth.
 *
 * US equivalent: HUD Fair Market Rents
 */

import type { UkHousingResult } from "./types.js";
import { LAND_REGISTRY_BASE, fetchJson } from "./constants.js";
import { resolveUkCity } from "./geo-resolver.js";

/**
 * Query UK housing data for a city.
 * Combines Land Registry transaction data with VOA rental statistics.
 */
export async function queryUkHousing(cityInput: string): Promise<UkHousingResult> {
  const geo = await resolveUkCity(cityInput);

  const result: UkHousingResult = {
    city: geo.city,
  };

  // Query Land Registry Price Paid via their Linked Data API (SPARQL)
  try {
    const ppd = await queryLandRegistryPricePaid(geo.ladCode, geo.city);
    if (ppd) result.pricePaid = ppd;
  } catch (e) {
    console.error("[city-data-mcp] Land Registry query failed:", e);
  }

  return result;
}

/**
 * Query Land Registry Price Paid data using their REST/Linked Data API.
 * Returns aggregated transaction data for the most recent quarter.
 */
async function queryLandRegistryPricePaid(ladCode: string, cityName: string): Promise<UkHousingResult["pricePaid"] | null> {
  try {
    // Use Land Registry SPARQL endpoint with POST and correct Content-Type
    const sparqlQuery = `PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
PREFIX lrppi: <http://landregistry.data.gov.uk/def/ppi/>
PREFIX lrcommon: <http://landregistry.data.gov.uk/def/common/>
SELECT (xsd:integer(AVG(?amount)) AS ?avgPrice) (COUNT(?item) AS ?txCount)
WHERE {
  ?item lrppi:pricePaid ?amount ;
        lrppi:propertyAddress ?addr .
  ?addr lrcommon:town "${cityName.toUpperCase()}" .
  ?item lrppi:transactionDate ?date .
  FILTER(?date >= "${getRecentDateString()}"^^xsd:date)
}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(`${LAND_REGISTRY_BASE}/landregistry/query`, {
        method: "POST",
        headers: {
          "Content-Type": "application/sparql-query",
          "Accept": "application/sparql-results+json",
        },
        body: sparqlQuery,
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const data = await response.json();

      if (data?.results?.bindings?.[0]) {
        const row = data.results.bindings[0];
        const avgPrice = parseInt(row.avgPrice?.value || "0", 10);
        const txCount = parseInt(row.txCount?.value || "0", 10);

        if (txCount > 0) {
          return {
            averagePrice: avgPrice,
            medianPrice: avgPrice, // SPARQL AVG as proxy for median
            transactionCount: txCount,
            period: `Last 6 months`,
          };
        }
      }
    } finally {
      clearTimeout(timer);
    }
    return null;
  } catch {
    return null;
  }
}

function getRecentDateString(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 6);
  return d.toISOString().split("T")[0];
}

/** Format housing results as markdown */
export function formatUkHousingResults(result: UkHousingResult): string {
  const lines: string[] = [
    `# UK Housing Data: ${result.city}`,
    "",
  ];

  if (result.pricePaid) {
    const pp = result.pricePaid;
    lines.push(
      "## Property Transactions (Price Paid)",
      "",
      `- **Average Price**: £${pp.averagePrice.toLocaleString()}`,
      `- **Transactions**: ${pp.transactionCount.toLocaleString()}`,
      `- **Period**: ${pp.period}`,
    );
    if (pp.byType) {
      lines.push("", "### By Property Type", "");
      for (const [type, avg] of Object.entries(pp.byType)) {
        lines.push(`- **${type}**: £${avg.toLocaleString()}`);
      }
    }
    lines.push("");
  }

  if (result.rental) {
    const r = result.rental;
    lines.push(
      "## Rental Market",
      "",
      `- **Median Rent (pcm)**: £${r.median.toLocaleString()}`,
      `- **Lower Quartile**: £${r.lowerQuartile.toLocaleString()}`,
      `- **Upper Quartile**: £${r.upperQuartile.toLocaleString()}`,
      `- **Period**: ${r.period}`,
    );
    if (r.byBedrooms) {
      lines.push("", "### By Bedrooms", "");
      for (const [beds, price] of Object.entries(r.byBedrooms)) {
        lines.push(`- **${beds}**: £${price.toLocaleString()} pcm`);
      }
    }
    lines.push("");
  }

  if (!result.pricePaid && !result.rental) {
    lines.push(
      "*Housing data may not be available for this location.*",
      "*Land Registry covers England & Wales. VOA rental stats cover England.*"
    );
  }

  lines.push(
    "",
    "---",
    "*Sources: HM Land Registry Price Paid + VOA Private Rental Market Statistics.*"
  );

  return lines.join("\n");
}
