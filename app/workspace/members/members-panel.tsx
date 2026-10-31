"use client";

import { OrganizationProfile } from "@clerk/nextjs";

export function MembersPanel() {
  return <OrganizationProfile routing="hash" appearance={{ elements: { rootBox: "w-full", cardBox: "w-full max-w-none" } }} />;
}
