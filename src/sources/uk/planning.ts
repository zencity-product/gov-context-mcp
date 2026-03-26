/**
 * Planning Data API — Planning Applications & Decisions
 *
 * No auth required. Covers England, updated daily.
 * Returns planning applications, decisions, listed buildings, conservation areas.
 *
 * API docs: https://www.planning.data.gov.uk
 * US equivalent: Census Building Permits Survey
 */

import type { UkPlanningResult } from "./types.js";
import { PLANNING_BASE, fetchJson } from "./constants.js";
import { resolveUkCity } from "./geo-resolver.js";

/**
 * Query planning data for a UK city/local authority.
 */
export async function queryUkPlanning(cityInput: string): Promise<UkPlanningResult> {
  const geo = await resolveUkCity(cityInput);

  // Query planning applications for this local authority
  // The Planning Data API indexes by organisation (LA)
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const dateStr = sixMonthsAgo.toISOString().split("T")[0];

  let recentApplications = 0;
  const byDecision: Record<string, number> = {};
  const byType: Record<string, number> = {};

  try {
    // Query the planning applications dataset
    const url = `${PLANNING_BASE}/entity.json?dataset=planning-application&organisation_entity=${encodeURIComponent(geo.ladCode)}&limit=100`;
    const data = await fetchJson(url, { timeout: 15000 });
    const entities: any[] = data?.entities || [];

    recentApplications = entities.length;

    for (const entity of entities) {
      const decision = entity["planning-decision"] || entity.decision || "Pending";
      byDecision[decision] = (byDecision[decision] || 0) + 1;

      const appType = entity["application-type"] || entity.type || "Other";
      byType[appType] = (byType[appType] || 0) + 1;
    }
  } catch (e) {
    console.error("[city-data-mcp] Planning data query failed:", e);
  }

  return {
    city: geo.city,
    recentApplications,
    byDecision,
    byType,
    period: `Last 6 months`,
  };
}

/** Format planning results as markdown */
export function formatUkPlanningResults(result: UkPlanningResult): string {
  const lines: string[] = [
    `# UK Planning Data: ${result.city}`,
    "",
    `**Period**: ${result.period}`,
    `**Total Applications**: ${result.recentApplications}`,
    "",
  ];

  if (Object.keys(result.byDecision).length > 0) {
    lines.push("## By Decision", "");
    for (const [decision, count] of Object.entries(result.byDecision).sort(([, a], [, b]) => b - a)) {
      lines.push(`- **${decision}**: ${count}`);
    }
    lines.push("");
  }

  if (Object.keys(result.byType).length > 0) {
    lines.push("## By Application Type", "");
    for (const [type, count] of Object.entries(result.byType).sort(([, a], [, b]) => b - a)) {
      lines.push(`- **${type}**: ${count}`);
    }
    lines.push("");
  }

  lines.push(
    "---",
    "*Source: Planning Data API (planning.data.gov.uk) — covers England only.*",
    "*Scottish/Welsh planning data is held separately by devolved governments.*"
  );

  return lines.join("\n");
}
