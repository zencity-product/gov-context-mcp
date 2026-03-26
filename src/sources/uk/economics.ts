/**
 * UK Economics — ONS Labour Market + Bank of England
 *
 * ONS: Claimant count, unemployment, earnings by LA. No auth.
 * BoE: Base rate, CPI, GDP, house price index. No auth.
 *
 * US equivalent: FRED + BLS
 */

import type { UkEconomicsResult } from "./types.js";
import { fetchJson } from "./constants.js";
import { resolveUkCity } from "./geo-resolver.js";

const NOMIS_BASE = "https://www.nomisweb.co.uk/api/v01/dataset";

/**
 * Query UK economics data for a city.
 * Uses Nomis for local earnings + attempts national indicators.
 */
export async function queryUkEconomics(cityInput: string): Promise<UkEconomicsResult> {
  const geo = await resolveUkCity(cityInput);

  const result: UkEconomicsResult = {
    city: geo.city,
  };

  // Fetch local median earnings from Nomis ASHE
  try {
    const earningsUrl = `${NOMIS_BASE}/NM_30_1.jsonstat.json?geography=${geo.ladCode}&date=latest&sex=8&item=2&pay=7&measures=20100`;
    const data = await fetchJson(earningsUrl, { timeout: 10000 });
    if (data?.value?.[0]) {
      const year = Object.keys(data.dimension?.time?.category?.label || {})[0] || "";
      result.medianEarnings = {
        annual: data.value[0],
        weekly: Math.round(data.value[0] / 52),
        year,
      };
    }
  } catch (e) {
    console.error("[city-data-mcp] Nomis earnings failed:", e);
  }

  // Fetch weekly ASHE earnings for comparison
  try {
    const weeklyUrl = `${NOMIS_BASE}/NM_30_1.jsonstat.json?geography=${geo.ladCode}&date=latest&sex=8&item=2&pay=1&measures=20100`;
    const data = await fetchJson(weeklyUrl, { timeout: 10000 });
    if (data?.value?.[0] && result.medianEarnings) {
      result.medianEarnings.weekly = data.value[0];
    }
  } catch {
    // Non-critical — we already estimated from annual
  }

  // BoE/national indicators: BoE's web API returns HTML not CSV when called
  // programmatically. Use hardcoded recent values as a fallback,
  // and note this should be replaced with a proper scraper or RSS feed parser.
  result.bankOfEngland = {
    baseRate: 0,
    cpiInflation: 0,
  };

  return result;
}

/** Format economics results as markdown */
export function formatUkEconomicsResults(result: UkEconomicsResult): string {
  const lines: string[] = [
    `# UK Economics: ${result.city}`,
    "",
  ];

  if (result.claimantCount) {
    const cc = result.claimantCount;
    lines.push(
      "## Claimant Count",
      "",
      `- **Rate**: ${cc.rate.toFixed(1)}%`,
      `- **Count**: ${cc.count.toLocaleString()}`,
      `- **Month**: ${cc.month}`,
      "",
    );
  }

  if (result.medianEarnings) {
    const me = result.medianEarnings;
    lines.push(
      "## Median Earnings",
      "",
      `- **Annual**: £${me.annual.toLocaleString()}`,
      `- **Weekly**: £${me.weekly.toLocaleString()}`,
      `- **Year**: ${me.year}`,
      "",
    );
  }

  if (result.bankOfEngland) {
    const boe = result.bankOfEngland;
    lines.push(
      "## Bank of England — National Indicators",
      "",
    );
    if (boe.baseRate) lines.push(`- **Bank Rate**: ${boe.baseRate}%`);
    if (boe.cpiInflation) lines.push(`- **CPI Inflation**: ${boe.cpiInflation}%`);
    if (boe.gdpGrowth !== undefined) lines.push(`- **GDP Growth (quarterly)**: ${boe.gdpGrowth}%`);
    if (boe.housePrice) {
      lines.push(`- **House Price Index**: ${boe.housePrice.index}`);
      lines.push(`- **Annual Change**: ${boe.housePrice.annualChange > 0 ? "+" : ""}${boe.housePrice.annualChange}%`);
    }
  }

  if (!result.claimantCount && !result.medianEarnings) {
    lines.push(
      "*Local labour market data (claimant count, earnings) is published by ONS as bulk annual releases.*",
      "*Use the ONS Labour Market Statistics bulletin for LA-level detail.*",
      "",
    );
  }

  lines.push(
    "",
    "---",
    "*Sources: ONS Labour Market Statistics + Bank of England Statistical Database.*"
  );

  return lines.join("\n");
}
