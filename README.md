# Roundz Company MCP

Simple dependency-free MCP server for looking up public Roundz.ai company interview/profile details.

## What It Returns

Input:

```json
{ "company_name": "Google" }
```

Output includes:

- Roundz company page URL
- Company name, description, website, logo, industry
- Founding date, employee count, location when exposed
- Roundz rating/review count/page-view signals when exposed
- Notes about public-data limitations

Roundz exposes company profile and interview-signal metadata in public HTML/Schema.org. Some detailed interview rounds appear to be client-side or private API data, so this MCP does not pretend to fetch hidden/authenticated details.

## Run Locally

Requires Node.js 18+.

```bash
cd /Users/jys/Documents/Codex/2026-07-01/re/outputs/roundz-company-mcp
npm start
```

## MCP Client Config

Use this in an MCP client config:

```json
{
  "mcpServers": {
    "roundz-company": {
      "command": "node",
      "args": [
        "/Users/jys/Documents/Codex/2026-07-01/re/outputs/roundz-company-mcp/server.js"
      ]
    }
  }
}
```

## Tool

`get_company_interview_details`

Arguments:

```json
{
  "company_name": "Microsoft"
}
```

## Smoke Test

```bash
npm run smoke
```
