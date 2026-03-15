"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { getOnboardingStatus } from "@/lib/api";

export default function OnboardingRedirect() {
  const { getToken } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        const status = await getOnboardingStatus(token);

        if (status.onboardingStep >= 4) {
          router.replace("/dashboard");
          return;
        }

        const nextStep = Math.min(status.onboardingStep + 1, 3);
        router.replace(`/onboarding/step/${nextStep}`);
      } catch {
        // New user, start at step 1
        router.replace("/onboarding/step/1");
      } finally {
        setLoading(false);
      }
    })();
  }, [getToken, router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  return null;
}
