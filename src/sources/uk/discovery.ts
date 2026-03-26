/**
 * data.gov.uk CKAN API — Dataset Discovery
 *
 * Search the UK government's open data catalogue.
 * Standard CKAN API. No auth required.
 *
 * API docs: https://data.gov.uk/
 * US equivalent: list_available_data (discovery)
 */

import { DATA_GOV_UK_BASE, fetchJson } from "./constants.js";

export interface UkDatasetSearchResult {
  query: string;
  totalResults: number;
  datasets: Array<{
    title: string;
    description: string;
    publisher: string;
    format: string[];
    license: string;
    lastUpdated: string;
    url: string;
  }>;
}

/**
 * Search for datasets on data.gov.uk.
 */
export async function searchUkDatasets(query: string, limit: number = 20): Promise<UkDatasetSearchResult> {
  const url = `${DATA_GOV_UK_BASE}/package_search?q=${encodeURIComponent(query)}&rows=${limit}`;
  const data = await fetchJson(url, { timeout: 10000 });

  const results = data?.result?.results || [];
  const total = data?.result?.count || 0;

  const datasets = results.map((pkg: any) => ({
    title: pkg.title || "Untitled",
    description: (pkg.notes || "").slice(0, 200),
    publisher: pkg.organization?.title || "Unknown",
    format: (pkg.resources || []).map((r: any) => r.format).filter(Boolean),
    license: pkg.license_title || "Unknown",
    lastUpdated: pkg.metadata_modified || "",
    url: `https://data.gov.uk/dataset/${pkg.name}`,
  }));

  return {
    query,
    totalResults: total,
    datasets,
  };
}

/** Format dataset search results as markdown */
export function formatUkDatasetResults(result: UkDatasetSearchResult): string {
  const lines: string[] = [
    `# UK Open Data Search: "${result.query}"`,
    "",
    `**Total Results**: ${result.totalResults.toLocaleString()}`,
    `**Showing**: ${result.datasets.length}`,
    "",
  ];

  for (const ds of result.datasets) {
    const formats = [...new Set(ds.format)].join(", ") || "N/A";
    lines.push(
      `## ${ds.title}`,
      "",
      ds.description ? `${ds.description}...` : "",
      "",
      `- **Publisher**: ${ds.publisher}`,
      `- **Formats**: ${formats}`,
      `- **License**: ${ds.license}`,
      `- **URL**: ${ds.url}`,
      "",
    );
  }

  lines.push(
    "---",
    "*Source: data.gov.uk CKAN API — UK government open data catalogue.*"
  );

  return lines.join("\n");
}
