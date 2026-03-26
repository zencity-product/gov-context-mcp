/**
 * UK City Briefing — Composite Tool
 *
 * Pulls data from all available UK sources for a city and assembles
 * a structured executive briefing. The "give me everything" tool.
 *
 * US equivalent: create_city_briefing
 */

import { resolveUkCity } from "./geo-resolver.js";
import { queryUkCrime, formatUkCrimeResults } from "./crime.js";
import { queryUkFloodWater, formatUkFloodWaterResults } from "./flood-water.js";
import { queryUkDemographics, formatUkDemographicsResults } from "./ons-demographics.js";
import { queryUkEconomics, formatUkEconomicsResults } from "./economics.js";
import { queryUkHousing, formatUkHousingResults } from "./housing.js";
import { queryUkSchools, formatUkSchoolsResults } from "./schools.js";
import { queryUkPlanning, formatUkPlanningResults } from "./planning.js";
import { queryUkLocalGovFinance, formatUkLocalGovFinanceResults } from "./local-gov-finance.js";
import { queryUkAirQuality, formatUkAirQualityResults } from "./air-quality.js";

interface BriefingSection {
  title: string;
  content: string;
  available: boolean;
}

/**
 * Build a comprehensive UK city briefing by querying all available sources.
 * Sources that fail are noted but don't block the overall briefing.
 */
export async function buildUkCityBriefing(cityInput: string): Promise<string> {
  const geo = await resolveUkCity(cityInput);

  const sections: BriefingSection[] = [];

  // Run all queries in parallel, catching individual failures
  const [demographics, economics, housing, crime, airQuality, floodWater, schools, planning, finance] =
    await Promise.allSettled([
      queryUkDemographics(cityInput),
      queryUkEconomics(cityInput),
      queryUkHousing(cityInput),
      queryUkCrime(cityInput),
      queryUkAirQuality(cityInput),
      queryUkFloodWater(cityInput),
      queryUkSchools(cityInput),
      queryUkPlanning(cityInput),
      queryUkLocalGovFinance(cityInput),
    ]);

  // Assemble sections
  if (demographics.status === "fulfilled") {
    sections.push({
      title: "Demographics",
      content: formatUkDemographicsResults(demographics.value),
      available: true,
    });
  }

  if (economics.status === "fulfilled") {
    sections.push({
      title: "Economics",
      content: formatUkEconomicsResults(economics.value),
      available: true,
    });
  }

  if (housing.status === "fulfilled") {
    sections.push({
      title: "Housing",
      content: formatUkHousingResults(housing.value),
      available: true,
    });
  }

  if (crime.status === "fulfilled") {
    sections.push({
      title: "Crime",
      content: formatUkCrimeResults(crime.value),
      available: true,
    });
  }

  if (airQuality.status === "fulfilled") {
    sections.push({
      title: "Air Quality",
      content: formatUkAirQualityResults(airQuality.value),
      available: true,
    });
  }

  if (floodWater.status === "fulfilled") {
    sections.push({
      title: "Flood & Water Monitoring",
      content: formatUkFloodWaterResults(floodWater.value),
      available: true,
    });
  }

  if (schools.status === "fulfilled") {
    sections.push({
      title: "Education",
      content: formatUkSchoolsResults(schools.value),
      available: true,
    });
  }

  if (planning.status === "fulfilled") {
    sections.push({
      title: "Planning",
      content: formatUkPlanningResults(planning.value),
      available: true,
    });
  }

  if (finance.status === "fulfilled") {
    sections.push({
      title: "Local Government Finance",
      content: formatUkLocalGovFinanceResults(finance.value),
      available: true,
    });
  }

  // Build final briefing
  const lines: string[] = [
    `# UK City Briefing: ${geo.city}`,
    "",
    `**Region**: ${geo.region} | **Country**: ${geo.country} | **LAD**: ${geo.ladCode}`,
    "",
    `*Briefing compiled from ${sections.length} data sources.*`,
    "",
    "---",
    "",
  ];

  for (const section of sections) {
    // Strip the top-level header from each section (already has city name)
    const content = section.content.replace(/^# .+\n\n/, "");
    lines.push(content, "", "---", "");
  }

  // Note failed sources
  const allResults = [
    { name: "Demographics", result: demographics },
    { name: "Economics", result: economics },
    { name: "Housing", result: housing },
    { name: "Crime", result: crime },
    { name: "Air Quality", result: airQuality },
    { name: "Flood/Water", result: floodWater },
    { name: "Schools", result: schools },
    { name: "Planning", result: planning },
    { name: "Local Gov Finance", result: finance },
  ];

  const failed = allResults.filter(r => r.result.status === "rejected");
  if (failed.length > 0) {
    lines.push(
      "## Data Sources Unavailable",
      "",
      ...failed.map(f => `- ${f.name}: ${(f.result as PromiseRejectedResult).reason?.message || "Unknown error"}`),
      "",
    );
  }

  lines.push(
    "*Note: Weather and transport data require API keys (UK_MET_OFFICE_API_KEY, UK_TFL_API_KEY).*",
    "*Representatives data requires UK_TWFY_API_KEY.*",
  );

  return lines.join("\n");
}
