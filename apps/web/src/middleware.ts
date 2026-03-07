import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher(["/", "/sign-in(.*)", "/sign-up(.*)"]);

const isProtectedRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/bots(.*)",
  "/approvals(.*)",
  "/transactions(.*)",
  "/integrations(.*)",
  "/install(.*)",
  "/partners(.*)",
]);

export default clerkMiddleware(async (auth, request) => {
  if (isProtectedRoute(request)) {
    const { userId } = await auth();
    if (!userId) {
      const proto = request.headers.get("x-forwarded-proto") || "https";
      const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "www.payjarvis.com";
      const origin = `${proto}://${host}`;
      const signInUrl = new URL("/sign-in", origin);
      signInUrl.searchParams.set("redirect_url", `${origin}${request.nextUrl.pathname}${request.nextUrl.search}`);
      return NextResponse.redirect(signInUrl);
    }
  }
});

export const config = {
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)", "/(api|trpc)(.*)"],
};
