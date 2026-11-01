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
      title: "Allochemix API",
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
            totalProducts: { type: "integer", description: "Catalog products listing this chemical" },
            products: {
              type: "array",
              description: "First page of products; see /chemicals/{cas}/products for the rest",
              items: { $ref: "#/components/schemas/ChemicalProduct" },
            },
            sdsDocuments: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string", format: "uuid" },
                  productId: { type: "string", format: "uuid" },
                  revisionDate: { type: ["string", "null"], format: "date" },
                  language: { type: "string" },
                  region: { type: "string" },
                },
              },
            },
            url: { type: "string", format: "uri" },
          },
        },
        Supplier: {
          type: "object",
          properties: { id: { type: "string", format: "uuid" }, name: { type: "string" }, kind: { type: "string" } },
        },
        ChemicalProduct: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            name: { type: "string" },
            category: { type: ["string", "null"] },
            supplier: { $ref: "#/components/schemas/Supplier" },
            minPct: { type: ["number", "null"] },
            maxPct: { type: ["number", "null"] },
            share: { type: ["number", "null"], description: "Reported weight fraction (0–1)" },
            sdsId: { type: ["string", "null"], format: "uuid" },
            url: { type: "string", format: "uri" },
          },
        },
        Alternate: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            name: { type: "string" },
            category: { type: ["string", "null"] },
            maker: { $ref: "#/components/schemas/Supplier" },
            score: { type: "number", minimum: 0, maximum: 1 },
            sharedCas: { type: "array", items: { type: "string" } },
            sharedCount: { type: "integer" },
            addedCount: { type: "integer", description: "Ingredients in the alternate that the source product lacks" },
            sds: {
              oneOf: [
                {
                  type: "object",
                  properties: { id: { type: "string", format: "uuid" }, url: { type: "string", format: "uri" } },
                },
                { type: "object", properties: { searchUrl: { type: "string", format: "uri" } } },
              ],
            },
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
      "/chemicals/{cas}/products": {
        get: {
          summary: "Products containing a chemical",
          description:
            "Every catalog product that lists this CAS number: highest reported share first (single-ingredient products count as 100%), then newest. 50 per page.",
          parameters: [
            casParam,
            { name: "category", in: "query", required: false, schema: { type: "string" }, description: 'General product category, e.g. "Personal care"' },
            { name: "page", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 10000, default: 1 } },
          ],
          responses: {
            "200": {
              description: "Products",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: {
                        type: "object",
                        properties: {
                          casRn: { type: "string" },
                          category: { type: ["string", "null"] },
                          page: { type: "integer" },
                          pageSize: { type: "integer" },
                          total: { type: "integer" },
                          products: { type: "array", items: { $ref: "#/components/schemas/ChemicalProduct" } },
                        },
                      },
                    },
                  },
                },
              },
            },
            "400": {
              description: "The chemical has no products in that category",
              content: { "application/json": { schema: error } },
            },
            ...errors,
          },
        },
      },
      "/products/{id}/alternates": {
        get: {
          summary: "Alternate products",
          description:
            "Other products sharing this product's ingredient CAS numbers, ranked by weighted composition similarity (0–1). Close matches score 0.5 or more. `reason` is `no_tsca_ingredients` when nothing can be matched.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
          responses: {
            "200": {
              description: "Alternates",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: {
                        type: "object",
                        properties: {
                          product: {
                            type: "object",
                            properties: {
                              id: { type: "string", format: "uuid" },
                              name: { type: "string" },
                              maker: { type: "string" },
                              url: { type: "string", format: "uri" },
                            },
                          },
                          reason: { type: ["string", "null"], enum: ["no_tsca_ingredients", null] },
                          close: { type: "array", items: { $ref: "#/components/schemas/Alternate" } },
                          partial: { type: "array", items: { $ref: "#/components/schemas/Alternate" } },
                        },
                      },
                    },
                  },
                },
              },
            },
            ...errors,
            "503": {
              description: "Alternates temporarily unavailable; retry shortly",
              content: { "application/json": { schema: error } },
            },
          },
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
