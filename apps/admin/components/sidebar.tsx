"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearToken } from "@/lib/api";
import { useState } from "react";

const navItems = [
  { label: "Overview", icon: "📊", href: "/overview" },
  { label: "Users", icon: "👥", href: "/users" },
  { label: "Broadcast", icon: "📢", href: "/broadcast" },
  { label: "Revenue", icon: "💰", href: "/revenue" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const handleLogout = () => {
    clearToken();
    router.push("/login");
  };

  return (
    <>
      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 bg-[#F8FAFC] border-b border-[#E2E8F0] flex items-center justify-between px-4 py-3">
        <div>
          <h1 className="text-base font-bold text-[#0F172A]">PayJarvis Admin</h1>
          <p className="text-[10px] text-[#64748B]">12Brain Operations</p>
        </div>
        <button onClick={() => setOpen(!open)} className="p-2 text-[#64748B]">
          {open ? (
            <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M6 18L18 6"/></svg>
          ) : (
            <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
          )}
        </button>
      </div>

      {/* Mobile dropdown menu */}
      {open && (
        <div className="md:hidden fixed top-[56px] left-0 right-0 z-30 bg-white border-b border-[#E2E8F0] shadow-lg">
          {navItems.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-3 px-5 py-3.5 text-sm border-b border-[#F1F5F9] ${
                  active ? "bg-[#4A9EFF]/10 text-[#4A9EFF] font-medium" : "text-[#64748B]"
                }`}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
          <button
            onClick={handleLogout}
            className="w-full text-left px-5 py-3.5 text-sm text-[#64748B] hover:text-[#EF4444]"
          >
            Logout
          </button>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-64 min-h-screen bg-[#F8FAFC] border-r border-[#E2E8F0] flex-col flex-shrink-0">
        <div className="p-6 border-b border-[#E2E8F0]">
          <h1 className="text-lg font-bold text-[#0F172A]">PayJarvis Admin</h1>
          <p className="text-xs text-[#64748B] mt-0.5">12Brain Operations</p>
        </div>

        <nav className="flex-1 py-4">
          {navItems.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-6 py-3 text-sm transition-colors ${
                  active
                    ? "bg-[#4A9EFF]/10 text-[#4A9EFF] font-medium border-r-2 border-[#4A9EFF]"
                    : "text-[#64748B] hover:bg-[#F1F5F9] hover:text-[#0F172A]"
                }`}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-[#E2E8F0]">
          <button
            onClick={handleLogout}
            className="w-full text-left px-2 py-2 text-sm text-[#64748B] hover:text-[#EF4444] transition-colors"
          >
            Logout
          </button>
          <p className="text-xs text-[#94A3B8] mt-2 px-2">v1.0 · 12Brain</p>
        </div>
      </aside>
    </>
  );
}
