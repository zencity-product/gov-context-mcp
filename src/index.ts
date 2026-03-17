#!/usr/bin/env node
/**
 * city-data-mcp — Multi-City Public Data MCP Server
 *
 * This is the entry point. When Claude Code starts this server, three things happen:
 * 1. We create an MCP server and declare its capabilities
 * 2. We register tools — each tool is a function Claude can call
 * 3. We connect via stdio — the server listens for requests from Claude
 *
 * The MCP protocol flow:
 * Claude discovers tools → User asks a question → Claude calls a tool →
 * This server fetches data from Socrata → Returns formatted results → Claude answers
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "node:http";
import { z } from "zod";
import { resolveCity, listCities } from "./cities.js";
import { querySocrata, formatSocrataResults } from "./sources/socrata.js";
import { queryCensus, formatCensusResults } from "./sources/census.js";
import { resolveFredCity, listFredCities, queryFred, formatFredResults } from "./sources/fred.js";
import { resolveFbiCity, resolveFbiCityAsync, listFbiCities, queryFbiCrime, formatFbiResults } from "./sources/fbi.js";
import { resolveBlsCity, listBlsCities, queryBls, formatBlsResults } from "./sources/bls.js";
import { buildCohort, formatCohortResults, type CohortCriteria } from "./sources/cohort.js";
import { buildFullCohort, formatFullCohortResults, type FullCohortCriteria } from "./sources/full-cohort.js";
import { queryWeather, formatWeatherResults } from "./sources/nws.js";
import { queryAirQuality, formatAirQualityResults } from "./sources/airnow.js";
import { queryHud, formatHudResults } from "./sources/hud.js";
import { queryWater, formatWaterResults } from "./sources/usgs.js";
import { queryCivic, formatCivicResults } from "./sources/civic.js";
import { query311Trends, format311Results, list311Cities } from "./sources/three11.js";
import { queryTransit, formatTransitResults, listTransitCities } from "./sources/transit.js";
import { querySchools, formatSchoolResults, listSchoolCities } from "./sources/schools.js";
import { queryPermits, formatPermitResults, listPermitCities } from "./sources/permits.js";
import { queryBudget, formatBudgetResults, listBudgetCities } from "./sources/budget.js";
import { buildCityBriefing, formatBriefing } from "./sources/briefing.js";
import { queryTraffic, formatTrafficResults, listTrafficCities } from "./sources/traffic.js";
import { mapIssueData, formatIssueData, listIssueTopics } from "./sources/issue-mapper.js";
import { trackCityChanges, formatChangeTracker } from "./sources/change-tracker.js";

async function createMcpServer() {
  const server = new McpServer(
    {
      name: "city-data-mcp",
      version: "0.2.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Step 2: Register tools
  // Each tool has: a name, description (helps Claude decide when to use it),
  // an input schema (what arguments it accepts), and a handler (what it does).

  // --- Tool 1: query_city_data ---
  // The core tool. Query any supported city's data by category.
  server.registerTool(
    "query_city_data",
    {
      title: "Query City Public Data",
      description: `Query publicly available data for a US city by category.

Supported cities: NYC, Chicago, San Francisco, Los Angeles, Seattle
Supported categories: crime, 311

Returns recent data with category breakdown and sample records.
Use this to explore what's happening in a specific city.`,
      inputSchema: z.object({
        city: z
          .string()
          .describe(
            "City name or abbreviation (e.g., 'NYC', 'Chicago', 'SF', 'LA', 'Seattle')"
          ),
        category: z
          .enum(["crime", "311"])
          .describe("Data category to query"),
        limit: z
          .number()
          .default(50)
          .describe("Maximum number of records to fetch (default 50)"),
        daysBack: z
          .number()
          .default(30)
          .describe("How many days of recent data to include (default 30)"),
      }),
    },
    async (args) => {
      // Resolve the city name to a config
      const match = resolveCity(args.city);
      if (!match) {
        const available = listCities()
          .map((c) => `${c.name} (${c.key})`)
          .join(", ");
        return {
          content: [
            {
              type: "text" as const,
              text: `City "${args.city}" not found. Available cities: ${available}`,
            },
          ],
        };
      }

      // Check if this city has the requested category
      const dataset = match.config.datasets[args.category];
      if (!dataset) {
        const available = Object.keys(match.config.datasets).join(", ");
        return {
          content: [
            {
              type: "text" as const,
              text: `${match.config.name} doesn't have ${args.category} data. Available categories: ${available}`,
            },
          ],
        };
      }

      // Fetch data from Socrata
      try {
        const rows = await querySocrata({
          domain: match.config.domain,
          dataset,
          limit: args.limit,
          daysBack: args.daysBack,
        });

        const formatted = formatSocrataResults(rows, dataset);

        return {
          content: [
            {
              type: "text" as const,
              text: `# ${match.config.name} — ${args.category} data\n\n${formatted}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error fetching ${args.category} data for ${match.config.name}: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // --- Tool 2: list_available_data ---
  // Discovery tool. Helps Claude know what to ask for.
  server.registerTool(
    "list_available_data",
    {
      title: "List Available City Data",
      description:
        "List all supported cities and the data categories available for each. Use this to discover what data you can query.",
      inputSchema: z.object({}),
    },
    async () => {
      const cities = listCities();
      const cityList = cities
        .map(
          (c) =>
            `- **${c.name}** (${c.key}): ${c.categories.join(", ")}`
        )
        .join("\n");

      const censusList = "Any US city, town, or CDP (~30,000 places)";

      const fredCities = listFredCities();
      const fredList = fredCities.map((c) => c.name).join(", ");

      const fbiCities = listFbiCities();
      const blsCities = listBlsCities();

      return {
        content: [
          {
            type: "text" as const,
            text: `# Civic Data Hub — Available Data\n\n## Crime & 311 (Socrata)\n${cityList}\n\n## Demographics (US Census ACS)\n${censusList}\n\n## Economic Indicators (FRED)\n${fredCities.length} metros: ${fredList}\n\n## Employment (BLS)\n${blsCities.length} metros: ${blsCities.map((c) => c.name).join(", ")}\n\n## FBI Crime Statistics (UCR)\n${fbiCities.length} cities (state-level)\n\n## Weather (NWS)\nAny US location — current conditions, forecast, active alerts. No API key needed.\n\n## Air Quality (EPA AirNow)\n~45 major cities + any 5-digit ZIP code. Requires AIRNOW_API_KEY.\n\n## Housing (HUD)\n~35 major cities — Fair Market Rents, Area Median Income, income limits.\n\n## Water Data (USGS)\n~30 major cities — real-time streamflow, gage height, water temperature.\n\n## Representatives (Google Civic)\nAny US address — elected officials at federal, state, and local levels. Requires GOOGLE_CIVIC_API_KEY.\n\n## Traffic Safety (NHTSA FARS)\nAny US city — fatal crash data, pedestrian/cyclist breakdowns, alcohol-related stats. County-level primary with state context. TTI congestion data for ${listTrafficCities().length} metros. No API key needed.\n\n## Tools\n- \`query_city_data\` — crime/311 data\n- \`query_demographics\` — Census data for ANY US city\n- \`compare_demographics\` — side-by-side Census comparison\n- \`query_economics\` — FRED economic indicators\n- \`query_employment\` — BLS employment & unemployment\n- \`query_national_crime\` — FBI UCR crime statistics\n- \`create_census_cohort\` — fast peer cities (demographics only, ~75 cities)\n- \`create_full_cohort\` — rich peer cities (Census+FRED+BLS+FBI, ~50 cities)\n- \`query_weather\` — NWS weather + alerts\n- \`query_air_quality\` — EPA AQI readings + forecast\n- \`query_housing\` — HUD fair market rents + income limits\n- \`query_water\` — USGS real-time water monitoring\n- \`query_representatives\` — elected officials lookup\n- \`query_311_trends\` — 311 complaint trends and top categories\n- \`query_transit\` — public transit ridership and performance (NTD)\n- \`query_schools\` — school district enrollment, finance, student-teacher ratios\n- \`query_permits\` — building permit trends (Census BPS, 5-year)\n- \`query_budget\` — city government budget breakdown\n- \`query_traffic\` — traffic safety (NHTSA FARS) + congestion (TTI)\n- \`create_city_briefing\` — comprehensive city profile from ALL sources\n- \`map_issue_data\` — cross-reference community issues with hard data\n- \`track_city_changes\` — directional dashboard of what's improving/declining`,
          },
        ],
      };
    }
  );

  // --- Tool 3: query_demographics ---
  // Census demographic data for any major US city.
  server.registerTool(
    "query_demographics",
    {
      title: "Query City Demographics",
      description: `Query US Census demographic data for ANY US city, town, or CDP (~30,000 places). Returns population, income, poverty rate, education, housing costs, and commuting patterns.

Data from American Community Survey (ACS) 5-Year Estimates. Not limited to major cities — works for Boise, Chapel Hill, Juneau, or any incorporated place.`,
      inputSchema: z.object({
        city: z
          .string()
          .describe(
            "City name (e.g., 'Denver', 'NYC', 'San Francisco', 'DC')"
          ),
      }),
    },
    async (args) => {
      try {
        const result = await queryCensus(args.city);
        const formatted = formatCensusResults(result);
        return {
          content: [
            {
              type: "text" as const,
              text: `# ${result.city} — Demographics\n\n${formatted}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error fetching Census data: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // --- Tool 4: compare_demographics ---
  // Side-by-side Census comparison for multiple cities.
  server.registerTool(
    "compare_demographics",
    {
      title: "Compare City Demographics",
      description: `Compare demographic data across multiple US cities side by side. Works for ANY US city (~30,000 places). Returns population, income, poverty, education, housing, and commuting.`,
      inputSchema: z.object({
        cities: z
          .array(z.string())
          .min(2)
          .max(6)
          .describe(
            "List of 2-6 city names to compare (e.g., ['Denver', 'Austin', 'Portland'])"
          ),
      }),
    },
    async (args) => {
      const results: Array<{ city: string; error?: string; data?: Awaited<ReturnType<typeof queryCensus>> }> = [];

      for (const cityInput of args.cities) {
        try {
          const data = await queryCensus(cityInput);
          results.push({ city: data.city, data });
        } catch (error) {
          results.push({
            city: cityInput,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Build comparison table
      const successful = results.filter((r) => r.data);
      const failed = results.filter((r) => r.error);

      if (successful.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Could not fetch data for any of the requested cities. Errors:\n${failed.map((r) => `- ${r.city}: ${r.error}`).join("\n")}`,
            },
          ],
        };
      }

      const fmt = (n: number | null, type: "number" | "dollar" | "percent"): string => {
        if (n === null) return "N/A";
        if (type === "dollar") return `$${n.toLocaleString()}`;
        if (type === "percent") return `${(n * 100).toFixed(1)}%`;
        return n.toLocaleString();
      };

      // Build a comparison summary
      const lines: string[] = ["# City Demographics Comparison\n"];

      // Header row
      const cityNames = successful.map((r) => r.data!.city);
      lines.push(`| Metric | ${cityNames.join(" | ")} |`);
      lines.push(`| --- | ${cityNames.map(() => "---").join(" | ")} |`);

      // Data rows
      const metrics: Array<{ label: string; getValue: (d: NonNullable<typeof results[0]["data"]>) => string }> = [
        { label: "Population", getValue: (d) => fmt(d.demographics.population, "number") },
        { label: "Median Age", getValue: (d) => fmt(d.demographics.medianAge, "number") },
        { label: "Median Income", getValue: (d) => fmt(d.demographics.medianIncome, "dollar") },
        { label: "Per Capita Income", getValue: (d) => fmt(d.demographics.perCapitaIncome, "dollar") },
        { label: "Poverty Rate", getValue: (d) => fmt(d.demographics.povertyRate, "percent") },
        { label: "Bachelor's Degree %", getValue: (d) => fmt(d.demographics.bachelorsDegreeRate, "percent") },
        { label: "Median Home Value", getValue: (d) => fmt(d.housing.medianHomeValue, "dollar") },
        { label: "Median Rent", getValue: (d) => fmt(d.housing.medianRent, "dollar") },
        { label: "Vacancy Rate", getValue: (d) => fmt(d.housing.vacancyRate, "percent") },
        { label: "Drive Alone %", getValue: (d) => fmt(d.commuting.driveAloneRate, "percent") },
        { label: "Public Transit %", getValue: (d) => fmt(d.commuting.publicTransitRate, "percent") },
        { label: "Work From Home %", getValue: (d) => fmt(d.commuting.workFromHomeRate, "percent") },
      ];

      for (const metric of metrics) {
        const values = successful.map((r) => metric.getValue(r.data!));
        lines.push(`| ${metric.label} | ${values.join(" | ")} |`);
      }

      if (failed.length > 0) {
        lines.push(`\n*Could not fetch: ${failed.map((r) => `${r.city} (${r.error})`).join(", ")}*`);
      }

      return {
        content: [
          {
            type: "text" as const,
            text: lines.join("\n"),
          },
        ],
      };
    }
  );

  // --- Tool 5: query_economics ---
  // FRED economic data for metro areas.
  server.registerTool(
    "query_economics",
    {
      title: "Query City Economic Data",
      description: `Query economic indicators for a US metro area from FRED (Federal Reserve Economic Data).

Returns unemployment rate (local + national for comparison), total employment, housing price index, and per capita personal income — with trends.

Covers 20 major US metros. Data freshness varies: unemployment is monthly, housing quarterly, income annual.`,
      inputSchema: z.object({
        city: z
          .string()
          .describe("City name (e.g., 'Denver', 'NYC', 'Austin')"),
      }),
    },
    async (args) => {
      const match = resolveFredCity(args.city);
      if (!match) {
        const available = listFredCities().map((c) => c.name).join(", ");
        return {
          content: [
            {
              type: "text" as const,
              text: `City "${args.city}" not found in FRED data. Available cities: ${available}`,
            },
          ],
        };
      }

      try {
        const result = await queryFred(match.key);
        const formatted = formatFredResults(result);
        return {
          content: [
            {
              type: "text" as const,
              text: `# ${result.city} — Economic Indicators\n\n${formatted}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error fetching FRED data for ${match.config.name}: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // --- Tool 6: query_national_crime ---
  // FBI UCR state-level crime data.
  server.registerTool(
    "query_national_crime",
    {
      title: "Query FBI Crime Statistics",
      description: `Query FBI Uniform Crime Report (UCR) data for a US state. Returns violent crime, property crime, homicide, robbery, assault, burglary, and motor vehicle theft — with counts, rates per 100K, and multi-year trends.

Note: This is STATE-level data (not city-level). Data lags 1-2 years. Use for understanding broad crime trends and comparing states.

No additional API key needed — reuses the Census API key.`,
      inputSchema: z.object({
        city: z
          .string()
          .describe("City name or state abbreviation (e.g., 'Denver', 'NYC', 'CA', 'TX'). City names resolve to their state."),
      }),
    },
    async (args) => {
      const match = await resolveFbiCityAsync(args.city);
      if (!match) {
        const available = listFbiCities().map((c) => `${c.name} (${c.state})`).join(", ");
        return {
          content: [
            {
              type: "text" as const,
              text: `City/state "${args.city}" not found. Could not geo-resolve to a US state. Try a more specific name (e.g., "Springfield, IL") or a state abbreviation (e.g., "TX").`,
            },
          ],
        };
      }

      try {
        const result = await queryFbiCrime(match.config.state, match.key);
        const formatted = formatFbiResults(result, match.config.name);
        return {
          content: [
            {
              type: "text" as const,
              text: `# ${match.config.name} — FBI Crime Data\n\n${formatted}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error fetching FBI data: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // --- Tool 7: query_employment ---
  // BLS metro employment data.
  server.registerTool(
    "query_employment",
    {
      title: "Query City Employment Data",
      description: `Query employment statistics for a US metro area from the Bureau of Labor Statistics (BLS).

Returns metro-level unemployment rate (with 6-month trend), total employment, labor force size, and year-over-year changes.

Covers 20 major US metros. Data is monthly, typically 1-2 months lag.

No additional API key needed (uses BLS public API). Rate-limited to 25 queries/day without key.`,
      inputSchema: z.object({
        city: z
          .string()
          .describe("City name (e.g., 'Denver', 'NYC', 'Austin')"),
      }),
    },
    async (args) => {
      const match = resolveBlsCity(args.city);
      if (!match) {
        const available = listBlsCities().map((c) => c.name).join(", ");
        return {
          content: [
            {
              type: "text" as const,
              text: `City "${args.city}" not found in BLS data. Available cities: ${available}`,
            },
          ],
        };
      }

      try {
        const result = await queryBls(match.key);
        const formatted = formatBlsResults(result);
        return {
          content: [
            {
              type: "text" as const,
              text: `# ${result.city} — Employment Data\n\n${formatted}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error fetching BLS data for ${match.config.name}: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // --- Tool 8: create_census_cohort ---
  // Fast demographic-only cohort using Census data (~75 cities pool).
  server.registerTool(
    "create_census_cohort",
    {
      title: "Create Census Peer Cohort (Fast)",
      description: `Find peer cities based on Census demographic data. Fast — uses only Census ACS data across ~75 cities.

Compares: population, income, poverty, education, housing costs, commuting patterns, region.

Criteria: "balanced", "size", "economics", "housing", "education", "commuting", "region".

Use this for quick demographic peer matching. For richer multi-source comparison (economics, crime, employment), use create_full_cohort instead.`,
      inputSchema: z.object({
        city: z
          .string()
          .describe("Target city to find peers for (e.g., 'Denver', 'Austin')"),
        criteria: z
          .enum(["balanced", "size", "economics", "housing", "education", "commuting", "region"])
          .default("balanced")
          .describe("What dimensions to weight most in finding peers"),
        cohortSize: z
          .number()
          .min(3)
          .max(10)
          .default(5)
          .describe("How many peer cities to return (default 5)"),
      }),
    },
    async (args) => {
      try {
        const result = await buildCohort(args.city, args.criteria as CohortCriteria, args.cohortSize as number);
        const formatted = formatCohortResults(result);
        return {
          content: [
            {
              type: "text" as const,
              text: formatted,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error building cohort for "${args.city}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // --- Tool 9: create_full_cohort ---
  // Rich multi-source cohort using Census + FRED + BLS + FBI (~50 cities).
  server.registerTool(
    "create_full_cohort",
    {
      title: "Create Full Peer Cohort (Rich)",
      description: `Find peer cities using ALL data sources: Census demographics, FRED economics, BLS employment, and FBI crime data. Richer but slower than create_census_cohort (~50 cities pool).

Compares across 12 dimensions: population, income, poverty, education, home values, rent, housing price trend, unemployment, job growth, per-capita income, violent crime rate, and geographic region.

Criteria options:
- "balanced" (default) — even weight across all dimensions
- "economics" — prioritize unemployment, job growth, income
- "livability" — prioritize crime, education, poverty
- "safety" — heavily weight crime rates
- "growth" — prioritize job growth, housing trends, employment
- "affordability" — prioritize home values, rent, housing costs

Use this for comprehensive benchmarking. Takes longer due to multi-source API calls.`,
      inputSchema: z.object({
        city: z
          .string()
          .describe("Target city to find peers for (e.g., 'Denver', 'Austin')"),
        criteria: z
          .enum(["balanced", "economics", "livability", "safety", "growth", "affordability"])
          .default("balanced")
          .describe("What dimensions to weight most"),
        cohortSize: z
          .number()
          .min(3)
          .max(10)
          .default(5)
          .describe("How many peer cities to return (default 5)"),
      }),
    },
    async (args) => {
      try {
        const result = await buildFullCohort(args.city, args.criteria as FullCohortCriteria, args.cohortSize as number);
        const formatted = formatFullCohortResults(result);
        return {
          content: [{ type: "text" as const, text: formatted }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error building full cohort for "${args.city}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // --- Tool 10: query_weather ---
  server.registerTool(
    "query_weather",
    {
      title: "Query City Weather",
      description: `Get current weather conditions, 3-day forecast, and active alerts for any US city. Real-time data from the National Weather Service. No API key needed.`,
      inputSchema: z.object({
        city: z.string().describe("City name (e.g., 'Denver', 'Boise', 'NYC')"),
      }),
    },
    async (args) => {
      try {
        const result = await queryWeather(args.city);
        return { content: [{ type: "text" as const, text: `# ${args.city} — Weather\n\n${formatWeatherResults(result)}` }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }] };
      }
    }
  );

  // --- Tool 10: query_air_quality ---
  server.registerTool(
    "query_air_quality",
    {
      title: "Query Air Quality",
      description: `Get current Air Quality Index (AQI) and forecast for a US city. Shows readings for O3, PM2.5, PM10 with color-coded categories. Data from EPA AirNow. Requires AIRNOW_API_KEY.`,
      inputSchema: z.object({
        city: z.string().describe("City name or 5-digit ZIP code"),
      }),
    },
    async (args) => {
      try {
        const result = await queryAirQuality(args.city);
        return { content: [{ type: "text" as const, text: `# ${result.city} — Air Quality\n\n${formatAirQualityResults(result)}` }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }] };
      }
    }
  );

  // --- Tool 11: query_housing ---
  server.registerTool(
    "query_housing",
    {
      title: "Query HUD Housing Data",
      description: `Get HUD Fair Market Rents and income limits for a US city. Shows rent by bedroom count, area median income, and income thresholds for housing programs. No API key needed.`,
      inputSchema: z.object({
        city: z.string().describe("City name (e.g., 'Denver', 'NYC', 'Boise')"),
      }),
    },
    async (args) => {
      try {
        const result = await queryHud(args.city);
        return { content: [{ type: "text" as const, text: `# ${result.city} — Housing\n\n${formatHudResults(result)}` }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }] };
      }
    }
  );

  // --- Tool 12: query_water ---
  server.registerTool(
    "query_water",
    {
      title: "Query Water Conditions",
      description: `Get real-time water data from USGS monitoring sites near a US city. Shows streamflow, gage height, and water temperature from nearby rivers and streams. Data updates every 15 minutes. No API key needed.`,
      inputSchema: z.object({
        city: z.string().describe("City name (e.g., 'Denver', 'Portland', 'Austin')"),
      }),
    },
    async (args) => {
      try {
        const result = await queryWater(args.city);
        return { content: [{ type: "text" as const, text: `# ${args.city} — Water Conditions\n\n${formatWaterResults(result)}` }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }] };
      }
    }
  );

  // --- Tool 13: query_representatives ---
  server.registerTool(
    "query_representatives",
    {
      title: "Query Elected Representatives",
      description: `Look up elected officials at all levels (federal, state, local) for any US address or city. Shows name, party, office, and contact info. Requires GOOGLE_CIVIC_API_KEY.`,
      inputSchema: z.object({
        address: z.string().describe("City name or full address (e.g., 'Denver', '1600 Pennsylvania Ave, Washington DC')"),
      }),
    },
    async (args) => {
      try {
        const result = await queryCivic(args.address);
        return { content: [{ type: "text" as const, text: `# Representatives\n\n${formatCivicResults(result)}` }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }] };
      }
    }
  );

  // --- Tool 14: query_311_trends ---
  server.registerTool(
    "query_311_trends",
    {
      title: "Query 311 Service Request Trends",
      description: `Analyze 311 service request trends for a city. Returns top complaint categories, request volumes, and monthly trends. Uses server-side SoQL aggregation — fast and token-light.

Available cities: ${list311Cities().join(", ")}.

Great for understanding what residents are actually reporting: potholes, noise, graffiti, homeless encampments, etc.`,
      inputSchema: z.object({
        city: z.string().describe("City name (e.g., 'NYC', 'Chicago', 'SF')"),
        days: z.number().min(7).max(365).default(90).describe("Lookback period in days (default 90)"),
      }),
    },
    async (args) => {
      try {
        const result = await query311Trends(args.city, args.days as number);
        return { content: [{ type: "text" as const, text: `# ${result.city} — 311 Trends\n\n${format311Results(result)}` }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }] };
      }
    }
  );

  // --- Tool 15: query_transit ---
  server.registerTool(
    "query_transit",
    {
      title: "Query Public Transit Performance",
      description: `Public transit ridership and service data from the National Transit Database (NTD). Shows ridership by agency and mode (bus, subway, light rail, commuter rail), service hours, and efficiency.

${listTransitCities().length} cities available. No API key needed.`,
      inputSchema: z.object({
        city: z.string().describe("City name (e.g., 'NYC', 'Chicago', 'Denver')"),
      }),
    },
    async (args) => {
      try {
        const result = await queryTransit(args.city);
        return { content: [{ type: "text" as const, text: `# ${result.city} — Transit\n\n${formatTransitResults(result)}` }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }] };
      }
    }
  );

  // --- Tool 16: query_schools ---
  server.registerTool(
    "query_schools",
    {
      title: "Query School District Data",
      description: `School district data from the National Center for Education Statistics (NCES). Returns enrollment, number of schools, student-teacher ratios, and finance data (revenue breakdown, per-pupil spending).

${listSchoolCities().length} cities available. No API key needed. Data is county-level from the CCD (Common Core of Data).`,
      inputSchema: z.object({
        city: z.string().describe("City name (e.g., 'Denver', 'Austin', 'NYC')"),
      }),
    },
    async (args) => {
      try {
        const result = await querySchools(args.city);
        return { content: [{ type: "text" as const, text: `# ${result.city} — Schools\n\n${formatSchoolResults(result)}` }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }] };
      }
    }
  );

  // --- Tool 17: query_permits ---
  server.registerTool(
    "query_permits",
    {
      title: "Query Building Permits",
      description: `Building permit trends from the Census Bureau's Building Permits Survey. Shows 5-year trend (2020-2024) of permits and housing units authorized at the county level.

${listPermitCities().length} cities available. Rising permits = development activity; declining = slowdown.`,
      inputSchema: z.object({
        city: z.string().describe("City name (e.g., 'Austin', 'Phoenix', 'Seattle')"),
      }),
    },
    async (args) => {
      try {
        const result = await queryPermits(args.city);
        return { content: [{ type: "text" as const, text: `# ${result.city} — Building Permits\n\n${formatPermitResults(result)}` }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }] };
      }
    }
  );

  // --- Tool 18: query_budget ---
  server.registerTool(
    "query_budget",
    {
      title: "Query City Budget",
      description: `City government budget breakdown from published municipal budgets. Shows total budget, per-capita spending, and spending by category (police, fire, education, infrastructure, etc.).

${listBudgetCities().length} major cities available. Great for understanding city priorities — where money goes vs. what residents care about.`,
      inputSchema: z.object({
        city: z.string().describe("City name (e.g., 'NYC', 'Denver', 'SF')"),
      }),
    },
    async (args) => {
      try {
        const result = await queryBudget(args.city);
        return { content: [{ type: "text" as const, text: `# ${result.city} — City Budget\n\n${formatBudgetResults(result)}` }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }] };
      }
    }
  );

  // --- Tool: query_traffic ---
  server.registerTool(
    "query_traffic",
    {
      title: "Query Traffic Safety & Congestion",
      description: `Traffic safety data from NHTSA FARS (Fatality Analysis Reporting System) and TTI congestion metrics. Returns fatal crash statistics (2019-2022) including pedestrian, cyclist, and alcohol-related breakdowns.

County-level data as primary view with state-level context. Falls back to state-only if county data is unavailable.

Congestion data (TTI Urban Mobility Report) available for ${listTrafficCities().length} metros — annual delay hours and cost per commuter.

No API key needed. Works for any US city via geo-resolver.`,
      inputSchema: z.object({
        city: z.string().describe("City name (e.g., 'Denver', 'Austin', 'NYC')"),
      }),
    },
    async (args) => {
      try {
        const result = await queryTraffic(args.city);
        return { content: [{ type: "text" as const, text: `# ${result.city} — Traffic Safety\n\n${formatTrafficResults(result)}` }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }] };
      }
    }
  );

  // --- Tool 19: create_city_briefing ---
  server.registerTool(
    "create_city_briefing",
    {
      title: "Create Comprehensive City Briefing",
      description: `Pull data from ALL available sources and assemble a structured executive briefing for any US city. Covers demographics, economy, housing, safety, quality of life, government, and community voice.

This is the "give me everything" tool — fetches 14 data sources in parallel. Takes 10-20 seconds but returns a complete city profile.

Great for: QBR prep, council presentations, new market research, benchmarking.`,
      inputSchema: z.object({
        city: z.string().describe("City name (e.g., 'Denver', 'Austin', 'NYC')"),
      }),
    },
    async (args) => {
      try {
        const briefing = await buildCityBriefing(args.city);
        return { content: [{ type: "text" as const, text: formatBriefing(briefing) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error creating briefing for "${args.city}": ${error instanceof Error ? error.message : String(error)}` }] };
      }
    }
  );

  // --- Tool 20: map_issue_data ---
  server.registerTool(
    "map_issue_data",
    {
      title: "Map Community Issue to Data",
      description: `Given a community concern or issue topic, find all relevant hard data for a city. The cross-reference engine — "residents say X, here's what the data shows."

Available topics: ${listIssueTopics().join(", ")}.

Also accepts free-text issues (matched to closest topic by keywords).

Example: "housing affordability" in Denver → pulls home values, rent, FMR, permits, housing budget allocation.`,
      inputSchema: z.object({
        city: z.string().describe("City name (e.g., 'Denver', 'NYC')"),
        issue: z.string().describe("Issue topic or free-text concern (e.g., 'housing affordability', 'public safety', 'residents complain about potholes')"),
      }),
    },
    async (args) => {
      try {
        const result = await mapIssueData(args.city, args.issue);
        return { content: [{ type: "text" as const, text: formatIssueData(result) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error mapping issue data: ${error instanceof Error ? error.message : String(error)}` }] };
      }
    }
  );

  // --- Tool 21: track_city_changes ---
  server.registerTool(
    "track_city_changes",
    {
      title: "Track City Changes Over Time",
      description: `Show how a city is changing — what's improving, declining, or holding steady. Pulls trend data from BLS (unemployment), FRED (economics), FBI (crime), building permits, and 311 complaints.

Returns a directional dashboard: each metric tagged as improving, declining, or stable with supporting data. Great for spotting momentum or emerging problems.`,
      inputSchema: z.object({
        city: z.string().describe("City name (e.g., 'Denver', 'Austin', 'NYC')"),
      }),
    },
    async (args) => {
      try {
        const result = await trackCityChanges(args.city);
        return { content: [{ type: "text" as const, text: formatChangeTracker(result) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error tracking changes for "${args.city}": ${error instanceof Error ? error.message : String(error)}` }] };
      }
    }
  );

  return server;
}

/**
 * Start the server in the appropriate transport mode.
 *
 * - Default (no args): stdio mode — for Claude Code / Claude Desktop
 * - --http flag or PORT env var: HTTP mode — for remote deployment (Vercel, Railway, etc.)
 */
async function main() {
  const server = await createMcpServer();
  const useHttp = process.argv.includes("--http") || !!process.env.PORT;

  if (useHttp) {
    // HTTP mode: Streamable HTTP transport for remote access
    const port = parseInt(process.env.PORT || "3000", 10);

    // Store transports by session ID for stateful connections
    const transports = new Map<string, StreamableHTTPServerTransport>();

    const httpServer = createServer(async (req, res) => {
      // CORS headers for remote access
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, mcp-session-id");
      res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      // Health check
      if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", server: "city-data-mcp", version: "0.2.0" }));
        return;
      }

      // MCP endpoint
      if (req.url === "/mcp") {
        const sessionId = req.headers["mcp-session-id"] as string | undefined;

        if (req.method === "POST") {
          // Check for existing session
          let transport = sessionId ? transports.get(sessionId) : undefined;

          if (!transport) {
            // New session — create transport and connect
            transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: () => crypto.randomUUID(),
            });

            transport.onclose = () => {
              const sid = (transport as any).sessionId;
              if (sid) transports.delete(sid);
            };

            await server.connect(transport);

            // Store by session ID after connection
            const newSessionId = (transport as any).sessionId;
            if (newSessionId) transports.set(newSessionId, transport);
          }

          await transport.handleRequest(req, res);
          return;
        }

        if (req.method === "GET") {
          // SSE stream for server-initiated messages
          const transport = sessionId ? transports.get(sessionId) : undefined;
          if (transport) {
            await transport.handleRequest(req, res);
            return;
          }
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "No session found. Send a POST first." }));
          return;
        }

        if (req.method === "DELETE") {
          // Close session
          const transport = sessionId ? transports.get(sessionId) : undefined;
          if (transport) {
            await transport.handleRequest(req, res);
            transports.delete(sessionId!);
            return;
          }
          res.writeHead(404);
          res.end();
          return;
        }
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found. Use /mcp for MCP protocol or /health for status." }));
    });

    httpServer.listen(port, () => {
      console.error(`[city-data-mcp] HTTP server running on port ${port}`);
      console.error(`[city-data-mcp] MCP endpoint: http://localhost:${port}/mcp`);
      console.error(`[city-data-mcp] Health check: http://localhost:${port}/health`);
    });
  } else {
    // Stdio mode: for Claude Code / Claude Desktop (local)
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("[city-data-mcp] Server started in stdio mode, waiting for requests...");
  }
}

main().catch((error) => {
  console.error("[city-data-mcp] Fatal error:", error);
  process.exit(1);
});
