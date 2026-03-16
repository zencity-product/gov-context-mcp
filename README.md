# city-data-mcp

An MCP server that gives Claude access to US civic data — demographics, economics, crime, and employment across 30 major cities.

## What it does

8 tools that let Claude query and compare real public data:

| Tool | Source | What it does |
|------|--------|-------------|
| `query_city_data` | Socrata | Crime & 311 service requests (5 cities) |
| `list_available_data` | All | Discover available cities and datasets |
| `query_demographics` | US Census | Population, income, poverty, education, housing, commuting (30 cities) |
| `compare_demographics` | US Census | Side-by-side comparison table for 2-6 cities |
| `query_economics` | FRED | Unemployment, housing index, personal income with trends (20 metros) |
| `query_employment` | BLS | Metro unemployment rate, employment, labor force (20 metros) |
| `query_national_crime` | FBI UCR | State-level crime stats with multi-year trends |
| `create_cohort` | Census | Find peer cities by demographic/economic similarity |

## Quick start

### Claude Desktop (local, stdio)

1. Clone and build:
```bash
git clone https://github.com/noareikhav/city-data-mcp.git
cd city-data-mcp
npm install && npm run build
```

2. Get free API keys:
   - **Census API** (required): https://api.census.gov/data/key_signup.html
   - **FRED API** (required): https://fred.stlouisfed.org/docs/api/api_key.html
   - **BLS API** (optional, higher rate limits): https://www.bls.gov/developers/home.htm

3. Add to Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "city-data-mcp": {
      "command": "node",
      "args": ["/path/to/city-data-mcp/dist/index.js"],
      "env": {
        "CENSUS_API_KEY": "your-census-key",
        "FRED_API_KEY": "your-fred-key"
      }
    }
  }
}
```

4. Restart Claude Desktop.

### Remote (HTTP mode)

Run as an HTTP server for remote access:

```bash
PORT=3000 CENSUS_API_KEY=xxx FRED_API_KEY=xxx node dist/index.js --http
```

MCP endpoint: `http://localhost:3000/mcp`
Health check: `http://localhost:3000/health`

## Example prompts

- "Compare demographics for Denver, Austin, and Portland"
- "What are the economic indicators for Seattle?"
- "Find cities similar to Boston based on housing costs"
- "Create a peer cohort for Miami weighted by economics"
- "Show me crime data for Chicago"
- "What's the unemployment rate in the NYC metro?"

## Data sources

| Source | Coverage | Freshness | Auth |
|--------|----------|-----------|------|
| [Socrata](https://dev.socrata.com/) | 5 cities (crime, 311) | Near real-time | None |
| [US Census ACS](https://api.census.gov/) | 30 cities (demographics) | Annual (5-year estimates) | Free key |
| [FRED](https://fred.stlouisfed.org/) | 20 metros (economic indicators) | Monthly to annual | Free key |
| [BLS](https://www.bls.gov/developers/) | 20 metros (employment) | Monthly | Optional key |
| [FBI UCR](https://crime-data-explorer.fr.cloud.gov/) | All states (crime stats) | Annual (1-2yr lag) | Reuses Census key |

## Covered cities

Demographics (Census): NYC, Chicago, San Francisco, Los Angeles, Seattle, Houston, Phoenix, Philadelphia, San Antonio, San Diego, Dallas, Austin, Denver, Boston, Nashville, Portland, Baltimore, Atlanta, Miami, Washington D.C., Minneapolis, Detroit, Pittsburgh, Charlotte, Columbus, Indianapolis, Memphis, Milwaukee, Jacksonville, Raleigh

Economics (FRED) & Employment (BLS): NYC, Chicago, San Francisco, Los Angeles, Seattle, Houston, Phoenix, Denver, Boston, Austin, Dallas, Washington D.C., Atlanta, Miami, Portland, Detroit, Minneapolis, Philadelphia, Nashville, Charlotte

## Architecture

```
src/
├── index.ts              # Server entry point (stdio + HTTP transports)
├── cities.ts             # City registry lookup (Socrata cities)
├── types.ts              # Type definitions
└── sources/
    ├── socrata.ts        # Socrata API client (crime, 311)
    ├── census.ts         # US Census ACS API client
    ├── fred.ts           # FRED economic data API client
    ├── bls.ts            # BLS employment data API client
    ├── fbi.ts            # FBI UCR crime data API client
    └── cohort.ts         # Peer city cohort builder
```

## License

MIT
