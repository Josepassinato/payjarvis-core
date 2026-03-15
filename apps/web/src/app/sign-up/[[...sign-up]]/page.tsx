import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="hero-mesh fixed inset-0 pointer-events-none" />
      <div className="grid-pattern fixed inset-0 pointer-events-none opacity-30" />
      <div className="relative animate-fade-in">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-display font-bold text-gradient-brand">PayJarvis</h1>
          <p className="text-gray-400 mt-2 font-body text-sm">Bot Payment Identity</p>
        </div>
        <SignUp
          appearance={{
            elements: {
              rootBox: "mx-auto",
              card: "bg-white border border-gray-200 shadow-xl",
              headerTitle: "text-gray-900 font-display",
              headerSubtitle: "text-gray-400",
              socialButtonsBlockButton: "bg-gray-50 border border-gray-200 hover:bg-gray-100 text-gray-900",
              socialButtonsBlockButtonText: "text-gray-900 font-medium",
              formFieldLabel: "text-gray-700",
              formFieldInput: "bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-500",
              footerActionLink: "text-brand-400 hover:text-brand-500",
              formButtonPrimary: "bg-brand-600 hover:bg-brand-500 shadow-lg shadow-brand-600/20",
              dividerLine: "bg-gray-200",
              dividerText: "text-gray-500",
              identityPreviewText: "text-gray-900",
              identityPreviewEditButton: "text-brand-400",
              alert: "bg-red-500/10 border-red-500/30 text-red-400",
            },
          }}
          routing="path"
          path="/sign-up"
          signInUrl="/sign-in"
          forceRedirectUrl="/onboarding/step/1"
        />
      </div>
    </div>
  );
}
