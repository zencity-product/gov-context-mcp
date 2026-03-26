/**
 * UK Representatives — TheyWorkForYou API + MapIt
 *
 * MPs, Lords, councillors by postcode. Voting record, party, contact.
 * Requires free API key (non-commercial).
 *
 * API docs: https://www.theyworkforyou.com/api/
 * US equivalent: Google Civic (elected representatives)
 */

import type { UkRepresentativesResult } from "./types.js";
import { TWFY_BASE, MAPIT_BASE, fetchJson } from "./constants.js";
import { resolveUkCity } from "./geo-resolver.js";

const TWFY_KEY = () => process.env.UK_TWFY_API_KEY || "";

/**
 * Query UK elected representatives for a city/postcode.
 */
export async function queryUkRepresentatives(cityInput: string): Promise<UkRepresentativesResult> {
  const key = TWFY_KEY();
  if (!key) {
    throw new Error(
      "UK_TWFY_API_KEY environment variable is required. " +
      "Register free at https://www.theyworkforyou.com/api/key"
    );
  }

  const geo = await resolveUkCity(cityInput);

  const result: UkRepresentativesResult = {
    city: geo.city,
  };

  // Use postcode if available, otherwise use lat/lon
  const postcode = geo.postcode;

  if (postcode) {
    // Get MP for this postcode
    try {
      const mpUrl = `${TWFY_BASE}/getMP?postcode=${encodeURIComponent(postcode)}&key=${key}&output=js`;
      const mpData = await fetchJson(mpUrl, { timeout: 8000 });

      if (mpData && !mpData.error) {
        result.mp = {
          name: mpData.full_name || `${mpData.given_name} ${mpData.family_name}`,
          party: mpData.party || "Unknown",
          constituency: mpData.constituency || "Unknown",
          enteredHouse: mpData.entered_house || "",
        };
      }
    } catch (e) {
      console.error("[city-data-mcp] TWFY MP lookup failed:", e);
    }
  }

  return result;
}

/** Format representatives results as markdown */
export function formatUkRepresentativesResults(result: UkRepresentativesResult): string {
  const lines: string[] = [
    `# UK Elected Representatives: ${result.city}`,
    "",
  ];

  if (result.mp) {
    const mp = result.mp;
    lines.push(
      "## Member of Parliament",
      "",
      `- **Name**: ${mp.name}`,
      `- **Party**: ${mp.party}`,
      `- **Constituency**: ${mp.constituency}`,
    );
    if (mp.enteredHouse) {
      lines.push(`- **Entered House**: ${mp.enteredHouse}`);
    }
    lines.push("");
  } else {
    lines.push(
      "*MP data requires a valid postcode. Provide a more specific location or postcode.*",
      "",
    );
  }

  if (result.councillors && result.councillors.length > 0) {
    lines.push("## Local Councillors", "");
    for (const c of result.councillors) {
      lines.push(`- **${c.name}** (${c.party}) — ${c.ward}`);
    }
    lines.push("");
  }

  lines.push(
    "---",
    "*Source: TheyWorkForYou API (mySociety) — covers UK Parliament + devolved assemblies.*"
  );

  return lines.join("\n");
}
