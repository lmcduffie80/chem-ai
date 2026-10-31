import { clerkMiddleware } from "@clerk/nextjs/server";

// Auth is enforced per page, route handler and server action; this only attaches the Clerk session.
export default clerkMiddleware();

export const config = {
  matcher: [
    // Skip Next.js internals, static files and Workflow's internal routes.
    "/((?!_next|\\.well-known/workflow/|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
