import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/sidebar";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

async function getOnboardingStatus(token: string): Promise<{ step: number; status: string }> {
  try {
    const res = await fetch(`${API_URL}/onboarding/status`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return { step: 99, status: "ACTIVE" }; // API error → don't block
    const json = await res.json();
    return {
      step: json.data?.onboardingStep ?? 0,
      status: json.data?.status ?? "PENDING",
    };
  } catch {
    return { step: 99, status: "ACTIVE" }; // Network error → don't block
  }
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId, getToken } = await auth();
  if (!userId) {
    redirect("/sign-in");
  }

  const token = await getToken();
  if (token) {
    const { step, status } = await getOnboardingStatus(token);
    // Onboarding has 3 steps. Step >= 4 or status ACTIVE = completed.
    if (step < 4 && status !== "ACTIVE") {
      const nextStep = Math.min(step + 1, 3);
      redirect(`/onboarding/step/${nextStep}`);
    }
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 md:ml-56 p-4 pt-16 md:p-8 md:pt-8">{children}</main>
    </div>
  );
}
