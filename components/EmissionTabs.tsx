"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/he-so-phat-thai", label: "Hệ số phát thải" },
  { href: "/he-so-phat-thai/cong-thuc", label: "Công thức phát thải" },
];

/** Chuyển giữa thư viện hệ số phát thải và cấu hình công thức phát thải. */
export function EmissionTabs() {
  const pathname = usePathname();
  const current = pathname.startsWith("/he-so-phat-thai/cong-thuc") ? TABS[1].href : TABS[0].href;
  return (
    <div className="mb-5 inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-xs">
      {TABS.map((tab) => {
        const active = tab.href === current;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors ${
              active ? "bg-emerald-600 text-white shadow-xs" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
