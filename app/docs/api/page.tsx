import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PLANS } from "@/lib/entitlements";

export const metadata: Metadata = {
  title: "API documentation",
  description: "Chemspace REST API: chemicals, search, safer alternatives and SDS data.",
};

const ENDPOINTS = [
  { method: "GET", path: "/api/v1/chemicals/{cas}", description: "Identity, GHS hazards, regulatory lists, synonyms, products and SDS references." },
  { method: "GET", path: "/api/v1/search?q=acetone", description: "CAS, name and synonym search with list, hazard and function filters." },
  { method: "GET", path: "/api/v1/alternatives/{cas}", description: "Ranked safer alternatives with hazard deltas and rationale." },
  { method: "GET", path: "/api/v1/sds/{id}", description: "Parsed SDS: summary plus the 16 GHS sections." },
];

function Code({ children }: { children: string }) {
  return <pre className="bg-muted/40 border-border/60 overflow-x-auto rounded-md border p-4 text-xs leading-relaxed">{children}</pre>;
}

export default function ApiDocsPage() {
  const enterprise = PLANS.enterprise;
  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-10">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold">Chemspace API</h1>
        <p className="text-muted-foreground">
          JSON over HTTPS for every substance on the EPA TSCA inventory. Available on the Enterprise plan. The full
          OpenAPI 3.1 specification is at{" "}
          <a href="/api/v1/openapi.json" className="underline underline-offset-4">
            /api/v1/openapi.json
          </a>
          .
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Authentication</CardTitle>
          <CardDescription>
            Organization admins create keys under{" "}
            <Link href="/workspace/api-keys" className="underline underline-offset-4">
              Workspace → API keys
            </Link>
            . Keys are shown once and stored only as a hash.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Code>{`curl https://chemspace.app/api/v1/chemicals/67-64-1 \\
  -H "Authorization: Bearer cs_xxxxxxxx_..."`}</Code>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Endpoints</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-border/60 divide-y">
            {ENDPOINTS.map((e) => (
              <li key={e.path} className="space-y-1 py-3">
                <p className="font-mono text-sm">
                  <span className="text-primary mr-2">{e.method}</span>
                  {e.path}
                </p>
                <p className="text-muted-foreground text-sm">{e.description}</p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Example response</CardTitle>
        </CardHeader>
        <CardContent>
          <Code>{`{
  "data": {
    "casRn": "67-64-1",
    "name": "Acetone",
    "identifiers": { "dtxsid": "DTXSID8021482", "pubchemCid": 180, "inchikey": "CSCPPACGZOOCGX-UHFFFAOYSA-N" },
    "tsca": { "status": "ACTIVE", "flags": [], "uvcb": false },
    "hazardScore": 12,
    "hazards": [{ "source": "pubchem_ghs", "signalWord": "Danger", "hStatements": ["H225", "H319", "H336"] }],
    "regulatoryLists": [{ "code": "CERCLA", "details": { "rq": "5000" } }],
    "url": "https://chemspace.app/chemicals/67-64-1"
  }
}`}</Code>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Limits and errors</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            Enterprise keys allow {enterprise.apiRequestsPerMinute} requests per minute per key and{" "}
            {enterprise.apiRequestsPerMonth.toLocaleString()} requests per month per organization. Every response
            includes <code>x-ratelimit-limit</code>, <code>x-ratelimit-remaining</code> and <code>x-ratelimit-reset</code>.
          </p>
          <p>
            Errors use <code>{`{ "error": { "code", "message" } }`}</code> with status 400 (invalid_parameter), 401
            (unauthorized), 403 (plan_required), 404 (not_found) or 429 (rate_limited, quota_exceeded).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
