import "server-only";
import { notFound } from "next/navigation";
import { getViewer } from "@/lib/auth";

/** Platform admins are listed in PLATFORM_ADMIN_USER_IDS or carry `role: "admin"` in Clerk public metadata. */
export async function requirePlatformAdmin() {
  const viewer = await getViewer();
  if (!viewer.userId || !viewer.isPlatformAdmin) notFound();
  return { ...viewer, userId: viewer.userId };
}
