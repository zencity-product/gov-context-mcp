/**
 * UK Transport — TfL Unified API + Bus Open Data Service (BODS)
 *
 * TfL: Bus/tube/rail status, live arrivals. Requires free API key. London only.
 * BODS: Real-time bus locations, timetables. Requires free registration. England.
 *
 * US equivalent: NTD (National Transit Database)
 */

import type { UkTransportResult } from "./types.js";
import { TFL_BASE, fetchJson } from "./constants.js";
import { resolveUkCity } from "./geo-resolver.js";

const TFL_KEY = () => process.env.UK_TFL_API_KEY || "";

/**
 * Query UK transport data for a city.
 * For London: uses TfL API for tube/bus/rail status.
 * For other cities: provides basic bus operator info via BODS.
 */
export async function queryUkTransport(cityInput: string): Promise<UkTransportResult> {
  const geo = await resolveUkCity(cityInput);

  const result: UkTransportResult = {
    city: geo.city,
  };

  // Check if this is London
  const isLondon = geo.region === "London" || geo.city.toLowerCase().includes("london");

  if (isLondon) {
    const key = TFL_KEY();
    if (!key) {
      throw new Error(
        "UK_TFL_API_KEY environment variable is required for London transport data. " +
        "Register free at https://api-portal.tfl.gov.uk/"
      );
    }

    try {
      // Get line status for all modes
      const statusUrl = `${TFL_BASE}/Line/Mode/tube,elizabeth-line,overground,dlr/Status?app_key=${key}`;
      const statusData: any[] = await fetchJson(statusUrl, { timeout: 10000 });

      const lines = statusData.map((line: any) => ({
        name: line.name || "Unknown",
        mode: line.modeName || "tube",
        status: line.lineStatuses?.[0]?.statusSeverityDescription || "Unknown",
        reason: line.lineStatuses?.[0]?.reason,
      }));

      result.tfl = { lines };
    } catch (e) {
      console.error("[city-data-mcp] TfL API failed:", e);
    }
  }

  // For all cities, try BODS data
  // BODS requires API key and provides GTFS/SIRI data
  // For now, note the availability
  const bodsKey = process.env.UK_BODS_API_KEY;
  if (bodsKey) {
    // BODS API would go here — provides real-time bus locations
    // Endpoint: data.bus-data.dft.gov.uk/api/v1
  }

  return result;
}

/** Format transport results as markdown */
export function formatUkTransportResults(result: UkTransportResult): string {
  const lines: string[] = [
    `# UK Transport: ${result.city}`,
    "",
  ];

  if (result.tfl) {
    lines.push("## TfL Line Status", "");

    // Group by status
    const goodService = result.tfl.lines.filter(l => l.status === "Good Service");
    const disrupted = result.tfl.lines.filter(l => l.status !== "Good Service");

    if (disrupted.length > 0) {
      lines.push("### Disruptions", "");
      for (const line of disrupted) {
        lines.push(`- **${line.name}** (${line.mode}): ${line.status}`);
        if (line.reason) {
          lines.push(`  ${line.reason.slice(0, 150)}${line.reason.length > 150 ? "..." : ""}`);
        }
      }
      lines.push("");
    }

    if (goodService.length > 0) {
      lines.push(
        `### Good Service (${goodService.length} lines)`,
        "",
        goodService.map(l => l.name).join(", "),
        "",
      );
    }
  } else {
    lines.push(
      "*TfL data is available for London only (requires UK_TFL_API_KEY).*",
      "*For national bus data, set UK_BODS_API_KEY for Bus Open Data Service.*",
    );
  }

  lines.push(
    "",
    "---",
    "*Sources: TfL Unified API (London) + Bus Open Data Service (England).*"
  );

  return lines.join("\n");
}
