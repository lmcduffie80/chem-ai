import { REGULATORY_LIST_CODES } from "@/lib/reglists-meta";

const error = {
  type: "object",
  properties: { error: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } } } },
};

const casParam = {
  name: "cas",
  in: "path",
  required: true,
  schema: { type: "string", example: "67-64-1" },
  description: "CAS Registry Number, with or without hyphens.",
};

const errors = {
  "401": { description: "Missing or invalid API key", content: { "application/json": { schema: error } } },
  "403": { description: "Plan does not include API access", content: { "application/json": { schema: error } } },
  "404": { description: "Not found", content: { "application/json": { schema: error } } },
  "429": { description: "Rate limit or monthly quota exceeded", content: { "application/json": { schema: error } } },
};

export function openApiDocument(serverUrl: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Chemspace API",
      version: "1.0.0",
      description:
        "Chemical reference data for every substance on the EPA TSCA inventory: identity, GHS hazards, regulatory lists, suppliers, SDS documents and safer alternatives. Requests are limited per API key per minute and per organization per month according to your plan.",
    },
    servers: [{ url: `${serverUrl}/api/v1` }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", description: "API key beginning with `cs_`" } },
      schemas: {
        Error: error,
        Hazard: {
          type: "object",
          properties: {
            source: { type: "string" },
            signalWord: { type: ["string", "null"] },
            hStatements: { type: "array", items: { type: "string" } },
            pStatements: { type: "array", items: { type: "string" } },
            pictograms: { type: "array", items: { type: "string" } },
            score: { type: ["number", "null"] },
          },
        },
        Chemical: {
          type: "object",
          properties: {
            casRn: { type: "string" },
            name: { type: "string" },
            identifiers: {
              type: "object",
              properties: {
                dtxsid: { type: ["string", "null"] },
                pubchemCid: { type: ["integer", "null"] },
                inchikey: { type: ["string", "null"] },
                smiles: { type: ["string", "null"] },
              },
            },
            molecularFormula: { type: ["string", "null"] },
            molecularWeight: { type: ["number", "null"] },
            tsca: {
              type: "object",
              properties: {
                status: { type: ["string", "null"] },
                flags: { type: "array", items: { type: "string" } },
                uvcb: { type: "boolean" },
              },
            },
            hazardScore: { type: ["number", "null"], description: "0-100, higher is more hazardous" },
            hazards: { type: "array", items: { $ref: "#/components/schemas/Hazard" } },
            regulatoryLists: {
              type: "array",
              items: { type: "object", properties: { code: { enum: REGULATORY_LIST_CODES }, details: { type: "object" } } },
            },
            saferChoiceStatus: { type: ["string", "null"] },
            functionClasses: { type: "array", items: { type: "string" } },
            synonyms: { type: "array", items: { type: "string" } },
            products: { type: "array", items: { type: "object" } },
            sdsDocuments: { type: "array", items: { type: "object" } },
            url: { type: "string", format: "uri" },
          },
        },
      },
    },
    paths: {
      "/chemicals/{cas}": {
        get: {
          summary: "Get a chemical by CAS number",
          parameters: [casParam],
          responses: {
            "200": {
              description: "Chemical",
              content: {
                "application/json": {
                  schema: { type: "object", properties: { data: { $ref: "#/components/schemas/Chemical" } } },
                },
              },
            },
            ...errors,
          },
        },
      },
      "/search": {
        get: {
          summary: "Search by CAS, name or synonym",
          parameters: [
            { name: "q", in: "query", schema: { type: "string" }, description: "CAS number, name or synonym" },
            {
              name: "lists",
              in: "query",
              schema: { type: "string" },
              description: `Comma-separated list codes the chemical must be on (${REGULATORY_LIST_CODES.join(", ")})`,
            },
            { name: "excludeLists", in: "query", schema: { type: "string" } },
            { name: "maxHazardScore", in: "query", schema: { type: "number" } },
            { name: "functionClass", in: "query", schema: { type: "string" }, example: "Solvents" },
            { name: "tscaActiveOnly", in: "query", schema: { type: "boolean" } },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 25 } },
            { name: "offset", in: "query", schema: { type: "integer", minimum: 0, default: 0 } },
          ],
          responses: { "200": { description: "Matching chemicals" }, "400": { description: "Invalid parameters" }, ...errors },
        },
      },
      "/alternatives/{cas}": {
        get: {
          summary: "Safer alternatives for a chemical",
          description: "Ranked candidates that share a functional use and have lower hazard. Rejected suggestions are excluded.",
          parameters: [casParam],
          responses: { "200": { description: "Alternatives" }, ...errors },
        },
      },
      "/sds/{id}": {
        get: {
          summary: "Parsed SDS document",
          description: "Summary and the 16 GHS sections. Organization uploads are visible only to keys of that organization.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
          responses: { "200": { description: "SDS" }, ...errors },
        },
      },
    },
  };
}
