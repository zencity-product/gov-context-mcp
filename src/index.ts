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
import { resolveCensusFips, listCensusCities, queryCensus, formatCensusResults } from "./sources/census.js";
import { resolveFredCity, listFredCities, queryFred, formatFredResults } from "./sources/fred.js";
import { resolveFbiCity, listFbiCities, queryFbiCrime, formatFbiResults } from "./sources/fbi.js";
import { resolveBlsCity, listBlsCities, queryBls, formatBlsResults } from "./sources/bls.js";
import { buildCohort, formatCohortResults, type CohortCriteria } from "./sources/cohort.js";

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

      const censusCities = listCensusCities();
      const censusList = censusCities.map((c) => c.name).join(", ");

      const fredCities = listFredCities();
      const fredList = fredCities.map((c) => c.name).join(", ");

      const fbiCities = listFbiCities();
      const blsCities = listBlsCities();

      return {
        content: [
          {
            type: "text" as const,
            text: `# Civic Data Hub — Available Data\n\n## Crime & 311 (Socrata)\n${cityList}\n\n## Demographics (US Census ACS)\n${censusCities.length} cities: ${censusList}\n\n## Economic Indicators (FRED)\n${fredCities.length} metros: ${fredList}\n\n## Employment (BLS)\n${blsCities.length} metros: ${blsCities.map((c) => c.name).join(", ")}\n\n## FBI Crime Statistics (UCR)\n${fbiCities.length} cities (state-level)\n\n## Tools\n- \`query_city_data\` — crime/311 data\n- \`query_demographics\` — Census demographic profile\n- \`compare_demographics\` — side-by-side Census comparison\n- \`query_economics\` — FRED economic indicators\n- \`query_employment\` — BLS employment & unemployment\n- \`query_national_crime\` — FBI UCR crime statistics\n- \`create_cohort\` — find peer cities by similarity (the magic one)`,
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
      description: `Query US Census demographic data for a city. Returns population, income, poverty rate, education, housing costs, and commuting patterns.

Covers 30 major US cities. Data from American Community Survey (ACS) 5-Year Estimates.

Use this to understand the socioeconomic profile of a city or compare cities.`,
      inputSchema: z.object({
        city: z
          .string()
          .describe(
            "City name (e.g., 'Denver', 'NYC', 'San Francisco', 'DC')"
          ),
      }),
    },
    async (args) => {
      const match = resolveCensusFips(args.city);
      if (!match) {
        const available = listCensusCities()
          .map((c) => c.name)
          .join(", ");
        return {
          content: [
            {
              type: "text" as const,
              text: `City "${args.city}" not found in Census data. Available cities: ${available}`,
            },
          ],
        };
      }

      try {
        const result = await queryCensus(match.key);
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
              text: `Error fetching Census data for ${match.fips.name}: ${error instanceof Error ? error.message : String(error)}`,
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
      description: `Compare demographic data across multiple US cities side by side. Returns population, income, poverty, education, housing, and commuting for each city.

Use this to see how cities stack up against each other.`,
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
        const match = resolveCensusFips(cityInput);
        if (!match) {
          results.push({ city: cityInput, error: `Not found` });
          continue;
        }
        try {
          const data = await queryCensus(match.key);
          results.push({ city: data.city, data });
        } catch (error) {
          results.push({
            city: match.fips.name,
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
      const match = resolveFbiCity(args.city);
      if (!match) {
        const available = listFbiCities().map((c) => `${c.name} (${c.state})`).join(", ");
        return {
          content: [
            {
              type: "text" as const,
              text: `City/state "${args.city}" not found. Available: ${available}`,
            },
          ],
        };
      }

      try {
        const result = await queryFbiCrime(match.config.state);
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

  // --- Tool 8: create_cohort ---
  // The signature tool — finds peer cities based on data similarity.
  server.registerTool(
    "create_cohort",
    {
      title: "Create City Peer Cohort",
      description: `Find peer cities that are most similar to a given city based on real data.

Uses Census demographic data to compute similarity across: population, income, poverty, education, housing costs, commuting patterns, and geographic region.

Criteria options:
- "balanced" (default) — equal weight across all dimensions
- "size" — prioritize similar population
- "economics" — prioritize income and poverty levels
- "housing" — prioritize home values and rent
- "education" — prioritize education levels
- "commuting" — prioritize transit and WFH patterns
- "region" — prioritize geographic proximity

Returns a ranked list of peer cities with similarity scores, reasons, and a comparison table.

This is powerful for benchmarking — "how does Denver compare to its peers?"`,
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
