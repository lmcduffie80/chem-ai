import { inArray, isNull, sql } from "drizzle-orm";
import { Resend } from "resend";
import { db, schema } from "@/db";
import type { IngestStats } from "@/db/schema";
import { REGULATORY_LISTS } from "@/lib/reglists-meta";

type ChangeRow = {
  change_id: number;
  email: string;
  cas_rn: string;
  preferred_name: string;
  list_code: keyof typeof REGULATORY_LISTS;
  change_type: "added" | "removed" | "updated";
};

/** Emails watchers about regulatory list changes, then marks the changes as notified. */
export async function sendRegulatoryAlerts(): Promise<IngestStats> {
  "use step";
  const pending = await db
    .select({ id: schema.regulatoryChanges.id })
    .from(schema.regulatoryChanges)
    .where(isNull(schema.regulatoryChanges.notifiedAt))
    .limit(5000);
  if (pending.length === 0) return { processed: 0 };
  const ids = pending.map((p) => p.id);

  const { rows } = await db.execute<ChangeRow>(sql`
    with recipients as (
      select w.chemical_id, u.email
      from watchlists w join users u on w.owner_type = 'user' and u.id = w.owner_id
      union
      select w.chemical_id, u.email
      from watchlists w
      join memberships m on w.owner_type = 'org' and m.org_id = w.owner_id
      join users u on u.id = m.user_id
    )
    select rc.id as change_id, r.email, c.cas_rn, c.preferred_name, rc.list_code, rc.change_type
    from regulatory_changes rc
    join recipients r on r.chemical_id = rc.chemical_id
    join chemicals c on c.id = rc.chemical_id
    where rc.id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)}) and r.email is not null
  `);

  const byEmail = new Map<string, ChangeRow[]>();
  for (const row of rows) byEmail.set(row.email, [...(byEmail.get(row.email) ?? []), row]);

  let sent = 0;
  if (byEmail.size > 0) {
    if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not set; cannot send regulatory alerts.");
    const resend = new Resend(process.env.RESEND_API_KEY);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://allochemix.com";
    for (const [email, changes] of byEmail) {
      const lines = changes.map(
        (c) =>
          `<li><a href="${appUrl}/chemicals/${c.cas_rn}">${escapeHtml(c.preferred_name)} (${c.cas_rn})</a> was <strong>${c.change_type}</strong> ${c.change_type === "added" ? "to" : "on"} ${REGULATORY_LISTS[c.list_code].label}</li>`,
      );
      const { error } = await resend.emails.send({
        from: process.env.ALERTS_FROM_EMAIL ?? "Allochemix Alerts <alerts@allochemix.com>",
        to: email,
        subject: `Allochemix: ${changes.length} regulatory change${changes.length === 1 ? "" : "s"} on your watchlist`,
        html: `<p>The following chemicals on your watchlist changed regulatory status:</p><ul>${lines.join("")}</ul><p><a href="${appUrl}/workspace/alerts">View all alerts</a></p>`,
      });
      if (error) throw new Error(`Resend failed for ${email}: ${error.message}`);
      sent++;
    }
  }

  await db
    .update(schema.regulatoryChanges)
    .set({ notifiedAt: new Date() })
    .where(inArray(schema.regulatoryChanges.id, ids));

  return { processed: ids.length, sent };
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}
