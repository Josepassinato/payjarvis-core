"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { getOnboardingStatus } from "@/lib/api";

export function OnboardingGuard() {
  const { getToken } = useAuth();
  const router = useRouter();

  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        const status = await getOnboardingStatus(token);
        if (status.onboardingStep < 3) {
          const nextStep = Math.min(status.onboardingStep + 1, 3);
          router.replace(`/onboarding/step/${nextStep}`);
        }
      } catch {
        // If API fails, don't block — let user stay on dashboard
      }
    })();
  }, [getToken, router]);

  return null;
}
