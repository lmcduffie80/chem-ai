"use client";

import { OrganizationSwitcher, Show, SignInButton, UserButton } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";

export function AuthControls() {
  return (
    <div className="flex items-center gap-3">
      <Show when="signed-out">
        <SignInButton mode="modal">
          <Button size="sm" variant="outline">
            Sign in
          </Button>
        </SignInButton>
      </Show>
      <Show when="signed-in">
        <OrganizationSwitcher
          hidePersonal={false}
          afterSelectOrganizationUrl="/workspace"
          afterCreateOrganizationUrl="/workspace"
          appearance={{ elements: { rootBox: "hidden sm:flex" } }}
        />
        <UserButton />
      </Show>
    </div>
  );
}
