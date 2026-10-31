import { SignIn } from "@clerk/nextjs";
import { Suspense } from "react";

export default function SignInPage() {
  return (
    <div className="flex justify-center py-16">
      <Suspense>
        <SignIn />
      </Suspense>
    </div>
  );
}
