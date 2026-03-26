/**
 * UK City Geo-Resolver
 *
 * Resolves UK city names to geographic identifiers:
 * - LAD code (GSS code, e.g. "E09000001" for City of London)
 * - Lat/lon coordinates
 * - Region and country
 * - Representative postcode
 *
 * Uses a built-in registry of ~50 major UK cities with fallback
 * to the MapIt API for dynamic resolution.
 */

import type { UkCityConfig, UkCityRegistry, UkGeoResolution } from "./types.js";
import { MAPIT_BASE, fetchJson } from "./constants.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// In-memory cache
const cache = new Map<string, UkGeoResolution>();

// Lazy-loaded registry
let registry: UkCityRegistry | null = null;

function loadRegistry(): UkCityRegistry {
  if (registry) return registry;
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const path = join(__dirname, "../../../data/uk-city-registry.json");
  registry = JSON.parse(readFileSync(path, "utf-8")) as UkCityRegistry;
  return registry;
}

/** Common UK city aliases */
const UK_ALIASES: Record<string, string> = {
  "london": "london",
  "the city": "london",
  "brum": "birmingham",
  "manc": "manchester",
  "gla": "glasgow",
  "edi": "edinburgh",
  "bris": "bristol",
  "livpool": "liverpool",
  "pool": "liverpool",
  "sheff": "sheffield",
  "lee": "leeds",
  "ncl": "newcastle",
  "newcastle upon tyne": "newcastle",
  "newcastle-upon-tyne": "newcastle",
  "brighton and hove": "brighton",
  "brighton & hove": "brighton",
  "stoke-on-trent": "stoke",
  "stoke on trent": "stoke",
  "kingston upon hull": "hull",
  "kingston-upon-hull": "hull",
  "southend-on-sea": "southend",
  "southend on sea": "southend",
};

/**
 * Resolve a UK city name to geographic identifiers.
 * First checks the built-in registry, then falls back to MapIt API.
 */
export async function resolveUkCity(input: string): Promise<UkGeoResolution> {
  const normalized = input.toLowerCase().trim();
  const aliased = UK_ALIASES[normalized] || normalized;

  if (cache.has(aliased)) {
    return { ...cache.get(aliased)!, cached: true };
  }

  console.error(`[city-data-mcp] UK geo-resolving: "${input}"`);

  // Step 1: Try built-in registry
  const reg = loadRegistry();
  const regMatch = findInRegistry(reg, aliased);
  if (regMatch) {
    const result: UkGeoResolution = {
      input,
      city: regMatch.name,
      ladCode: regMatch.ladCode,
      ladName: regMatch.name,
      region: regMatch.region,
      country: regMatch.country,
      lat: regMatch.lat,
      lon: regMatch.lon,
      postcode: regMatch.postcode || null,
      cached: false,
    };
    cache.set(aliased, result);
    return result;
  }

  // Step 2: Try MapIt API with postcode or name
  const mapitResult = await tryMapit(aliased, input);
  if (mapitResult) {
    cache.set(aliased, mapitResult);
    return mapitResult;
  }

  throw new Error(
    `Could not resolve "${input}" to a UK location. Try a specific city name (e.g., "Manchester") or postcode (e.g., "SW1A 1AA").`
  );
}

function findInRegistry(reg: UkCityRegistry, key: string): UkCityConfig | null {
  // Direct key match
  if (reg[key]) return reg[key];

  // Search by alias or name
  for (const [k, config] of Object.entries(reg)) {
    if (config.name.toLowerCase() === key) return config;
    if (config.aliases.some(a => a.toLowerCase() === key)) return config;
  }
  return null;
}

/**
 * Try MapIt to resolve a postcode or place name.
 * MapIt handles UK postcodes natively and returns LAD info.
 */
async function tryMapit(normalized: string, originalInput: string): Promise<UkGeoResolution | null> {
  try {
    // Check if input looks like a UK postcode
    const postcodePattern = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
    if (postcodePattern.test(normalized.replace(/\s+/g, " ").trim())) {
      const postcode = normalized.replace(/\s+/g, "").toUpperCase();
      const url = `${MAPIT_BASE}/postcode/${encodeURIComponent(postcode)}`;
      const data = await fetchJson(url, { timeout: 5000 });

      if (data && data.wgs84_lat && data.wgs84_lon) {
        // Find the LAD area from the areas object
        const areas = data.areas || {};
        let ladCode = "";
        let ladName = "";
        let region = "";
        let country = "";

        for (const area of Object.values(areas) as any[]) {
          if (area.type === "DIS" || area.type === "UTA" || area.type === "LBO" || area.type === "MTD" || area.type === "COI") {
            ladCode = area.codes?.gss || "";
            ladName = area.name || "";
            country = area.country_name || "";
          }
          if (area.type === "EUR" || area.type === "GOR") {
            region = area.name || "";
          }
        }

        if (ladCode) {
          return {
            input: originalInput,
            city: ladName,
            ladCode,
            ladName,
            region,
            country,
            lat: parseFloat(data.wgs84_lat),
            lon: parseFloat(data.wgs84_lon),
            postcode: postcode,
            cached: false,
          };
        }
      }
    }
    return null;
  } catch (e) {
    console.error(`[city-data-mcp] MapIt lookup failed:`, e);
    return null;
  }
}

/** List all UK cities in the registry */
export function listUkCities(): Array<{ key: string; name: string; region: string; country: string }> {
  const reg = loadRegistry();
  return Object.entries(reg).map(([key, config]) => ({
    key,
    name: config.name,
    region: config.region,
    country: config.country,
  }));
}

/** Check if input is cached */
export function isUkCached(input: string): boolean {
  const normalized = input.toLowerCase().trim();
  const aliased = UK_ALIASES[normalized] || normalized;
  return cache.has(aliased);
}
