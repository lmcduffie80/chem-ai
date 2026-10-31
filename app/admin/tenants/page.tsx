import { sql } from "drizzle-orm";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/db";
import { requirePlatformAdmin } from "@/lib/admin";

export const metadata = { title: "Tenants" };

type OrgRow = {
  id: string;
  name: string;
  members: number;
  inventory: number;
  uploads: number;
  api_keys: number;
  plan: string | null;
  status: string | null;
  created_at: Date;
};
type UserRow = { id: string; email: string | null; name: string | null; orgs: number; plan: string | null; created_at: Date };

export default function TenantsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Tenants />
    </Suspense>
  );
}

async function Tenants() {
  await requirePlatformAdmin();
  const [orgs, users] = await Promise.all([
    db.execute<OrgRow>(sql`
      select o.id, o.name, o.created_at,
        (select count(*) from memberships m where m.org_id = o.id)::int as members,
        (select count(*) from workspace_inventory w where w.org_id = o.id)::int as inventory,
        (select count(*) from sds_documents d where d.org_id = o.id)::int as uploads,
        (select count(*) from api_keys k where k.org_id = o.id and k.revoked_at is null)::int as api_keys,
        s.plan, s.status
      from organizations o
      left join lateral (
        select plan::text, status from subscriptions
        where owner_type = 'org' and owner_id = o.id order by updated_at desc limit 1
      ) s on true
      order by o.created_at desc
      limit 200
    `),
    db.execute<UserRow>(sql`
      select u.id, u.email, u.name, u.created_at,
        (select count(*) from memberships m where m.user_id = u.id)::int as orgs,
        (select plan::text from subscriptions s
          where s.owner_type = 'user' and s.owner_id = u.id and s.status in ('active','trialing','past_due')
          order by updated_at desc limit 1) as plan
      from users u
      order by u.created_at desc
      limit 200
    `),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Tenants</h1>
      <Card>
        <CardHeader>
          <CardTitle>Organizations ({orgs.rows.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Members</TableHead>
                <TableHead>Inventory</TableHead>
                <TableHead>SDS uploads</TableHead>
                <TableHead>API keys</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orgs.rows.map((o) => (
                <TableRow key={o.id}>
                  <TableCell>
                    <div className="font-medium">{o.name}</div>
                    <div className="text-muted-foreground font-mono text-xs">{o.id}</div>
                  </TableCell>
                  <TableCell>
                    {o.plan ? (
                      <Badge variant={o.status === "active" ? "secondary" : "outline"}>
                        {o.plan} · {o.status}
                      </Badge>
                    ) : (
                      "free"
                    )}
                  </TableCell>
                  <TableCell>{o.members}</TableCell>
                  <TableCell>{o.inventory}</TableCell>
                  <TableCell>{o.uploads}</TableCell>
                  <TableCell>{o.api_keys}</TableCell>
                  <TableCell className="text-xs">{new Date(o.created_at).toLocaleDateString("en-US")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Users ({users.rows.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Personal plan</TableHead>
                <TableHead>Organizations</TableHead>
                <TableHead>Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.rows.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className="font-medium">{u.name ?? u.email ?? u.id}</div>
                    <div className="text-muted-foreground text-xs">{u.email}</div>
                  </TableCell>
                  <TableCell>{u.plan ?? "free"}</TableCell>
                  <TableCell>{u.orgs}</TableCell>
                  <TableCell className="text-xs">{new Date(u.created_at).toLocaleDateString("en-US")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
