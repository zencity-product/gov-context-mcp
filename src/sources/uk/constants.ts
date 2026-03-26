/**
 * UK Data Source Constants
 *
 * API base URLs and shared configuration for all UK data sources.
 */

// --- API Base URLs ---

/** ONS Beta API */
export const ONS_API_BASE = "https://api.beta.ons.gov.uk/v1";

/** MHCLG Open Data Communities (SPARQL + REST) */
export const MHCLG_BASE = "https://opendatacommunities.org";

/** Met Office DataPoint */
export const MET_OFFICE_BASE = "https://datapoint.metoffice.gov.uk/public/data";

/** DEFRA UK-AIR (Air Quality) */
export const DEFRA_AIR_BASE = "https://uk-air.defra.gov.uk";

/** Environment Agency Flood Monitoring */
export const EA_FLOOD_BASE = "https://environment.data.gov.uk/flood-monitoring";

/** HM Land Registry Price Paid */
export const LAND_REGISTRY_BASE = "https://landregistry.data.gov.uk";

/** EPC Register */
export const EPC_BASE = "https://epc.opendatacommunities.org/api/v1";

/** Planning Data */
export const PLANNING_BASE = "https://www.planning.data.gov.uk/api/v1";

/** Get Information About Schools (GIAS) */
export const GIAS_BASE = "https://www.get-information-schools.service.gov.uk";

/** Explore Education Statistics */
export const EDUCATION_STATS_BASE = "https://explore-education-statistics.service.gov.uk/api/v1";

/** Police UK */
export const POLICE_UK_BASE = "https://data.police.uk/api";

/** Bank of England Statistical Interactive Database */
export const BOE_BASE = "https://www.bankofengland.co.uk/boeapps/database";

/** Transport for London */
export const TFL_BASE = "https://api.tfl.gov.uk";

/** Bus Open Data Service */
export const BODS_BASE = "https://data.bus-data.dft.gov.uk/api/v1";

/** TheyWorkForYou */
export const TWFY_BASE = "https://www.theyworkforyou.com/api";

/** MapIt (mySociety) */
export const MAPIT_BASE = "https://mapit.mysociety.org";

/** data.gov.uk CKAN */
export const DATA_GOV_UK_BASE = "https://data.gov.uk/api/action";

/** ONS Open Geography Portal (ArcGIS) */
export const ONS_GEO_BASE = "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services";

// --- Shared Fetch Helper ---

export async function fetchJson(url: string, options?: {
  timeout?: number;
  headers?: Record<string, string>;
}): Promise<any> {
  const timeout = options?.timeout ?? 10000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        ...options?.headers,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

// --- DAQI Bands ---

export function daqiBand(index: number): string {
  if (index <= 3) return "Low";
  if (index <= 6) return "Moderate";
  if (index <= 9) return "High";
  return "Very High";
}

// --- Met Office Weather Types ---

export const MET_OFFICE_WEATHER_TYPES: Record<number, string> = {
  0: "Clear night", 1: "Sunny day", 2: "Partly cloudy (night)", 3: "Partly cloudy (day)",
  5: "Mist", 6: "Fog", 7: "Cloudy", 8: "Overcast",
  9: "Light rain shower (night)", 10: "Light rain shower (day)",
  11: "Drizzle", 12: "Light rain",
  13: "Heavy rain shower (night)", 14: "Heavy rain shower (day)", 15: "Heavy rain",
  16: "Sleet shower (night)", 17: "Sleet shower (day)", 18: "Sleet",
  19: "Hail shower (night)", 20: "Hail shower (day)", 21: "Hail",
  22: "Light snow shower (night)", 23: "Light snow shower (day)", 24: "Light snow",
  25: "Heavy snow shower (night)", 26: "Heavy snow shower (day)", 27: "Heavy snow",
  28: "Thunder shower (night)", 29: "Thunder shower (day)", 30: "Thunder",
};
