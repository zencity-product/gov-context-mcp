/**
 * Shared City Geo-Resolver
 *
 * Resolves ANY US city name into geographic identifiers needed by other tools:
 * - Lat/lon coordinates (for USGS, NWS)
 * - State FIPS + County FIPS (for HUD, Permits, Schools, FBI state fallback)
 * - ZIP code (for AirNow)
 * - County name (for Schools)
 * - State abbreviation (for FBI)
 *
 * Uses two Census APIs:
 * 1. Census Geocoder — city name → coordinates + address components
 * 2. FCC Area API — coordinates → county FIPS (backup)
 *
 * Results are cached in memory so repeated lookups are instant.
 */

const GEOCODER_BASE = "https://geocoding.geo.census.gov/geocoder";
const FCC_API = "https://geo.fcc.gov/api/census/area";

// State FIPS → abbreviation mapping
const STATE_FIPS_TO_ABBREV: Record<string, string> = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA",
  "08": "CO", "09": "CT", "10": "DE", "11": "DC", "12": "FL",
  "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN",
  "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME",
  "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS",
  "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH",
  "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND",
  "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI",
  "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT",
  "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI",
  "56": "WY",
};

// Common aliases
const ALIASES: Record<string, string> = {
  "nyc": "new york", "ny": "new york",
  "la": "los angeles", "l.a.": "los angeles",
  "sf": "san francisco",
  "dc": "washington", "d.c.": "washington", "washington dc": "washington",
  "philly": "philadelphia",
  "vegas": "las vegas", "lv": "las vegas",
  "nola": "new orleans",
  "slc": "salt lake city",
  "okc": "oklahoma city",
  "kc": "kansas city",
  "indy": "indianapolis",
  "jax": "jacksonville",
  "cle": "cleveland",
  "pgh": "pittsburgh",
  "stl": "st. louis", "st louis": "st. louis", "saint louis": "st. louis",
  "cincy": "cincinnati",
  "buf": "buffalo",
  "mke": "milwaukee",
  "abq": "albuquerque",
  "rva": "richmond",
  "atl": "atlanta",
  "pdx": "portland",
  "msp": "minneapolis",
  "dtw": "detroit",
  "sea": "seattle",
  "den": "denver",
  "bos": "boston",
  "clt": "charlotte",
  "sac": "sacramento",
};

export interface GeoResolution {
  /** Original input */
  input: string;
  /** Normalized city name */
  city: string;
  /** Latitude */
  lat: number;
  /** Longitude */
  lon: number;
  /** 2-digit state FIPS */
  stateFips: string;
  /** 3-digit county FIPS */
  countyFips: string;
  /** Full 5-digit county FIPS (state + county) */
  fullCountyFips: string;
  /** County name */
  countyName: string;
  /** State abbreviation (e.g., "CO") */
  stateAbbrev: string;
  /** ZIP code (5-digit, best effort) */
  zip: string | null;
  /** Whether this came from cache */
  cached: boolean;
}

// In-memory cache
const cache = new Map<string, GeoResolution>();

/**
 * Resolve a city name to geographic identifiers.
 * Works for ANY US city — uses Census geocoder + FCC API.
 */
export async function resolveCity(input: string): Promise<GeoResolution> {
  const normalized = input.toLowerCase().trim();
  const aliased = ALIASES[normalized] || normalized;

  if (cache.has(aliased)) {
    return { ...cache.get(aliased)!, cached: true };
  }

  console.error(`[city-data-mcp] Geo-resolving: "${input}"`);

  // Step 1: Try Census geocoder with geography return type
  // This gives us coordinates AND FIPS codes in one call
  let geoResult = await tryGeocodeWithGeography(aliased);

  // Step 2: If geography geocoder fails, try the simpler address geocoder + FCC
  if (!geoResult) {
    geoResult = await tryGeocodeWithFallback(aliased, input);
  }

  if (!geoResult) {
    throw new Error(
      `Could not resolve "${input}" to a US location. Try a more specific city name (e.g., "Springfield, IL" instead of "Springfield").`
    );
  }

  cache.set(aliased, geoResult);
  return { ...geoResult, cached: false };
}

/**
 * Census geocoder with geographies return type — returns coordinates + FIPS in one call.
 */
async function tryGeocodeWithGeography(city: string): Promise<GeoResolution | null> {
  try {
    const query = city.includes(",") ? city : `${city}, US`;
    const url = `${GEOCODER_BASE}/geographies/onelineaddress?address=${encodeURIComponent(query)}&benchmark=Public_AR_Current&vintage=Current_Current&format=json`;
    const data = await fetchWithTimeout(url, 8000);
    const match = data?.result?.addressMatches?.[0];
    if (!match) return null;

    const lat = parseFloat(match.coordinates.y);
    const lon = parseFloat(match.coordinates.x);
    const matchedAddress = match.matchedAddress || "";

    // Extract FIPS from geographies
    const geos = match.geographies;
    let stateFips = "";
    let countyFips = "";
    let countyName = "";

    // Try Census Tracts first (most specific)
    const tract = geos?.["Census Tracts"]?.[0];
    if (tract) {
      stateFips = tract.STATE || "";
      countyFips = tract.COUNTY || "";
    }

    // Try Counties
    const county = geos?.["Counties"]?.[0];
    if (county) {
      stateFips = stateFips || county.STATE || "";
      countyFips = countyFips || county.COUNTY || "";
      countyName = county.NAME || "";
    }

    // Try States
    const state = geos?.["States"]?.[0];
    if (state && !stateFips) {
      stateFips = state.STATE || "";
    }

    if (!stateFips || !countyFips) return null;

    const stateAbbrev = STATE_FIPS_TO_ABBREV[stateFips] || "";

    // Extract ZIP from matched address (last 5 digits usually)
    const zipMatch = matchedAddress.match(/\b(\d{5})\b/);
    const zip = zipMatch ? zipMatch[1] : null;

    // Derive city name from matched address
    const cityName = extractCityName(matchedAddress, city);

    return {
      input: city,
      city: cityName,
      lat,
      lon,
      stateFips,
      countyFips,
      fullCountyFips: `${stateFips}${countyFips}`,
      countyName: countyName || "Unknown County",
      stateAbbrev,
      zip,
      cached: false,
    };
  } catch (e) {
    console.error(`[city-data-mcp] Geography geocoder failed:`, e);
    return null;
  }
}

/**
 * Fallback: simpler geocoder for coordinates, then FCC API for FIPS.
 */
async function tryGeocodeWithFallback(city: string, originalInput: string): Promise<GeoResolution | null> {
  try {
    // Get coordinates from simple geocoder
    const query = city.includes(",") ? city : `${city}, US`;
    const url = `${GEOCODER_BASE}/locations/onelineaddress?address=${encodeURIComponent(query)}&benchmark=Public_AR_Current&format=json`;
    const data = await fetchWithTimeout(url, 8000);
    const match = data?.result?.addressMatches?.[0];
    if (!match) return null;

    const lat = parseFloat(match.coordinates.y);
    const lon = parseFloat(match.coordinates.x);
    const matchedAddress = match.matchedAddress || "";

    // Get FIPS from FCC Area API using coordinates
    const fccUrl = `${FCC_API}?lat=${lat}&lon=${lon}&format=json`;
    const fccData = await fetchWithTimeout(fccUrl, 5000);
    const fccResult = fccData?.results?.[0];

    if (!fccResult) return null;

    const stateFips = fccResult.state_fips || "";
    const countyFips = fccResult.county_fips?.slice(2) || ""; // FCC returns full 5-digit, we need last 3
    const countyName = fccResult.county_name || "Unknown County";
    const stateAbbrev = STATE_FIPS_TO_ABBREV[stateFips] || "";

    const zipMatch = matchedAddress.match(/\b(\d{5})\b/);
    const zip = zipMatch ? zipMatch[1] : null;

    const cityName = extractCityName(matchedAddress, city);

    return {
      input: city,
      city: cityName,
      lat,
      lon,
      stateFips,
      countyFips,
      fullCountyFips: `${stateFips}${countyFips}`,
      countyName,
      stateAbbrev,
      zip,
      cached: false,
    };
  } catch (e) {
    console.error(`[city-data-mcp] Fallback geocoder failed:`, e);
    return null;
  }
}

/**
 * Extract a clean city name from a matched address string.
 */
function extractCityName(matchedAddress: string, fallback: string): string {
  // Matched address is like "Denver, CO, 80202" or "123 Main St, Denver, CO"
  const parts = matchedAddress.split(",").map(p => p.trim());
  if (parts.length >= 2) {
    // Usually the city is the first or second part
    // If first part has numbers, it's a street address — use second part
    const candidate = /\d/.test(parts[0]) ? parts[1] : parts[0];
    if (candidate && candidate.length > 1) return candidate;
  }
  // Fallback: capitalize input
  return fallback.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Check if we can resolve a city (without actually doing it if cached).
 */
export function isCached(input: string): boolean {
  const normalized = input.toLowerCase().trim();
  const aliased = ALIASES[normalized] || normalized;
  return cache.has(aliased);
}

/**
 * Pre-warm the cache with known cities (call at startup if desired).
 */
export function prewarmCache(entries: Array<{ city: string; lat: number; lon: number; stateFips: string; countyFips: string; countyName: string; stateAbbrev: string; zip?: string }>) {
  for (const entry of entries) {
    const normalized = entry.city.toLowerCase().trim();
    cache.set(normalized, {
      input: entry.city,
      city: entry.city,
      lat: entry.lat,
      lon: entry.lon,
      stateFips: entry.stateFips,
      countyFips: entry.countyFips,
      fullCountyFips: `${entry.stateFips}${entry.countyFips}`,
      countyName: entry.countyName,
      stateAbbrev: entry.stateAbbrev,
      zip: entry.zip || null,
      cached: true,
    });
  }
}
