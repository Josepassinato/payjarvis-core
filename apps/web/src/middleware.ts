import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher(["/", "/sign-in(.*)", "/sign-up(.*)", "/forgot-password(.*)", "/sso-callback(.*)", "/onboarding(.*)", "/api/verify-passport(.*)", "/api/agent(.*)", "/install(.*)", "/partners(.*)", "/.well-known(.*)", "/bot-policy.json"]);

export default clerkMiddleware((auth, request) => {
  if (!isPublicRoute(request)) {
    const { userId, redirectToSignIn } = auth();
    if (!userId) {
      return redirectToSignIn();
    }
  }
});

export const config = {
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)", "/(api|trpc)(.*)"],
};
