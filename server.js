#!/usr/bin/env node

"use strict";

const BASE_URL = "https://roundz.ai";
const USER_AGENT =
  "roundz-company-mcp/1.0 (+https://roundz.ai; MCP company interview lookup)";

function slugifyCompanyName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function cleanReactPayloadString(value) {
  return decodeEntities(value)
    .replace(/\\"/g, '"')
    .replace(/\\n/g, "\n")
    .replace(/\\u0026/g, "&")
    .replace(/\\u003c/g, "<")
    .replace(/\\u003e/g, ">");
}

function getMetaContent(html, key, attr = "name") {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(
      `<meta\\s+[^>]*${attr}=["']${escapedKey}["'][^>]*content=["']([^"']*)["'][^>]*>`,
      "i"
    ),
    new RegExp(
      `<meta\\s+[^>]*content=["']([^"']*)["'][^>]*${attr}=["']${escapedKey}["'][^>]*>`,
      "i"
    ),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return decodeEntities(match[1]).trim();
  }

  return undefined;
}

function readJsonObjectAt(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }

  return undefined;
}

function extractJsonObjects(html) {
  const objects = [];

  for (const match of html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )) {
    const raw = decodeEntities(match[1]).trim();
    try {
      objects.push(JSON.parse(raw));
    } catch {
      // Some Next.js pages store the useful JSON-LD in the flight payload instead.
    }
  }

  for (const match of html.matchAll(
    /"children":"((?:\\.|[^"\\])*\\"@context\\":\\"https:\/\/schema\.org[\s\S]*?)"/g
  )) {
    const raw = cleanReactPayloadString(match[1]);
    const start = raw.indexOf('{"@context":"https://schema.org"');
    if (start === -1) continue;

    const candidate = raw.slice(start);
    try {
      objects.push(JSON.parse(candidate));
    } catch {
      const end = candidate.lastIndexOf("}");
      if (end > 0) {
        try {
          objects.push(JSON.parse(candidate.slice(0, end + 1)));
        } catch {
          // Ignore malformed payload fragments.
        }
      }
    }
  }

  const cleanedHtml = cleanReactPayloadString(html);
  let searchFrom = 0;
  const needle = '{"@context":"https://schema.org"';
  while (searchFrom < cleanedHtml.length) {
    const start = cleanedHtml.indexOf(needle, searchFrom);
    if (start === -1) break;
    const rawObject = readJsonObjectAt(cleanedHtml, start);
    if (rawObject) {
      try {
        objects.push(JSON.parse(rawObject));
      } catch {
        // Ignore malformed or partial objects.
      }
      searchFrom = start + rawObject.length;
    } else {
      searchFrom = start + needle.length;
    }
  }

  return objects;
}

function flattenGraph(jsonObjects) {
  const nodes = [];
  for (const item of jsonObjects) {
    if (item && Array.isArray(item["@graph"])) {
      nodes.push(...item["@graph"]);
    } else if (item && typeof item === "object") {
      nodes.push(item);
    }
  }
  return nodes;
}

function normalizeCompanyDetails(html, slug, requestedName) {
  const nodes = flattenGraph(extractJsonObjects(html));
  const organization =
    nodes.find(
      (node) =>
        node &&
        node["@type"] === "Organization" &&
        typeof node["@id"] === "string" &&
        node["@id"].includes(`/company/${slug}`)
    ) ||
    nodes.find(
      (node) =>
        node &&
        node["@type"] === "Organization" &&
        node.name &&
        node.description &&
        node.aggregateRating
    );

  const title =
    getMetaContent(html, "og:title", "property") ||
    getMetaContent(html, "twitter:title") ||
    requestedName;
  const description =
    (organization && organization.description) ||
    getMetaContent(html, "description") ||
    getMetaContent(html, "og:description", "property");
  const canonicalMatch = html.match(
    /<link\s+[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/i
  );

  const rating = organization && organization.aggregateRating;
  const interaction = organization && organization.interactionStatistic;
  const address =
    organization &&
    (organization.address ||
      (organization.location && organization.location.address) ||
      {});
  const logo = organization && organization.logo;

  return {
    requested_company: requestedName,
    matched_slug: slug,
    source_url:
      decodeEntities(canonicalMatch && canonicalMatch[1]) ||
      `${BASE_URL}/company/${slug}`,
    company: {
      name: (organization && organization.name) || title,
      description,
      website: organization && organization.url,
      industry: organization && organization.industry,
      founding_date: organization && organization.foundingDate,
      employee_count: organization && organization.numberOfEmployees,
      location: {
        city: address && address.addressLocality,
        country: address && address.addressCountry,
      },
      logo_url:
        (logo && typeof logo === "object" && logo.url) ||
        (typeof logo === "string" ? logo : undefined) ||
        getMetaContent(html, "og:image", "property"),
    },
    interview_signals: {
      roundz_rating: rating && rating.ratingValue,
      roundz_review_count: rating && rating.reviewCount,
      page_views: interaction && interaction.userInteractionCount,
      listed_topics: organization && organization.knowsAbout,
    },
    notes: [
      "Roundz company pages expose company profile and interview-signal metadata publicly.",
      "Detailed user-submitted interview rounds may be loaded client-side or require authenticated app/API access, so this MCP returns only public data visible in Roundz HTML/Schema.org.",
    ],
  };
}

async function fetchCompanyDetails(companyName) {
  const slug = slugifyCompanyName(companyName);
  if (!slug) {
    throw new Error("company_name is required");
  }

  const url = `${BASE_URL}/company/${slug}`;
  const response = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
      accept: "text/html,application/xhtml+xml",
    },
  });

  const html = await response.text();
  const pageTitle = (html.match(/<title>([^<]*)<\/title>/i) || [])[1] || "";
  const looksLike404 =
    /\b(404|not found|not-found)\b/i.test(pageTitle) ||
    /Cannot GET \/company\//i.test(html);

  if (!response.ok || looksLike404) {
    return {
      requested_company: companyName,
      matched_slug: slug,
      source_url: url,
      found: false,
      status: response.status,
      message:
        "No public Roundz company page was found for this slug. Try the exact Roundz company name, e.g. 'Google', 'Microsoft', 'Juspay', or 'Tata Consultancy Services TCS'.",
    };
  }

  return {
    found: true,
    ...normalizeCompanyDetails(html, slug, companyName),
  };
}

function textContent(payload) {
  return [
    {
      type: "text",
      text: JSON.stringify(payload, null, 2),
    },
  ];
}

function makeResponse(id, result) {
  return JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n";
}

function makeError(id, code, message) {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    error: { code, message },
  }) + "\n";
}

async function handleRequest(request) {
  const { id, method, params = {} } = request;

  if (method === "initialize") {
    return makeResponse(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "roundz-company-mcp", version: "1.0.0" },
    });
  }

  if (method === "notifications/initialized") {
    return "";
  }

  if (method === "tools/list") {
    return makeResponse(id, {
      tools: [
        {
          name: "get_company_interview_details",
          description:
            "Fetch public Roundz.ai company interview/profile details for a company name.",
          inputSchema: {
            type: "object",
            properties: {
              company_name: {
                type: "string",
                description:
                  "Company name to look up on Roundz.ai, e.g. Google, Microsoft, Juspay.",
              },
            },
            required: ["company_name"],
          },
        },
      ],
    });
  }

  if (method === "tools/call") {
    const { name, arguments: args = {} } = params;
    if (name !== "get_company_interview_details") {
      return makeError(id, -32602, `Unknown tool: ${name}`);
    }

    const details = await fetchCompanyDetails(args.company_name);
    return makeResponse(id, { content: textContent(details) });
  }

  return makeError(id, -32601, `Method not found: ${method}`);
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split(/\r?\n/);
  buffer = lines.pop() || "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    Promise.resolve()
      .then(() => handleRequest(JSON.parse(trimmed)))
      .then((response) => {
        if (response) process.stdout.write(response);
      })
      .catch((error) => {
        let id = null;
        try {
          id = JSON.parse(trimmed).id;
        } catch {
          // Keep id null for parse errors.
        }
        process.stdout.write(makeError(id, -32000, error.message));
      });
  }
});
