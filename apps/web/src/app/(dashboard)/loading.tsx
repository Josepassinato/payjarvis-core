import { Sidebar } from "@/components/sidebar";

export default function DashboardLoading() {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 md:ml-56 p-4 pt-16 md:p-8 md:pt-8">
        <div className="mb-8">
          <div className="h-8 w-40 animate-pulse rounded-lg bg-gray-100" />
          <div className="mt-2 h-4 w-56 animate-pulse rounded bg-gray-100" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-8">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-white border border-gray-200 rounded-xl p-5">
              <div className="h-3 w-20 animate-pulse rounded bg-gray-100" />
              <div className="mt-3 h-7 w-24 animate-pulse rounded bg-gray-100" />
            </div>
          ))}
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
          <div className="h-4 w-48 animate-pulse rounded bg-gray-100 mb-4" />
          <div className="h-48 md:h-64 animate-pulse rounded-lg bg-gray-100" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="h-4 w-40 animate-pulse rounded bg-gray-100 mb-4" />
            <div className="h-48 md:h-56 animate-pulse rounded-lg bg-gray-100" />
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="h-4 w-32 animate-pulse rounded bg-gray-100 mb-4" />
            <div className="h-48 md:h-56 animate-pulse rounded-lg bg-gray-100" />
          </div>
        </div>
      </main>
    </div>
  );
}
