"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Matrix" },
  { href: "/expiring", label: "Expiring" },
  { href: "/role-gaps", label: "Role gaps" },
];

export default function AppHeader({
  expiringBadge = 0,
  gapsBadge = 0,
  hasLapsed = false,
}: {
  expiringBadge?: number;
  gapsBadge?: number;
  hasLapsed?: boolean;
}) {
  const pathname = usePathname();

  return (
    <header className="bg-ink text-ivory">
      <div className="mx-auto flex max-w-[1600px] items-center justify-between px-6 py-4">
        <div>
          <h1 className="font-serif text-xl leading-tight">
            Fortuna Civils — Register of Competency
          </h1>
        </div>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="rounded border border-ivory/30 px-3 py-1.5 text-xs font-medium text-ivory/90 transition hover:bg-ivory/10"
          >
            Log out
          </button>
        </form>
      </div>
      <div className="h-px w-full bg-brass" />
      <nav className="mx-auto flex max-w-[1600px] gap-1 px-6">
        {NAV.map((item) => {
          const active =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const badge =
            item.href === "/expiring" ? expiringBadge : item.href === "/role-gaps" ? gapsBadge : 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`relative -mb-px border-b-2 px-4 py-2.5 text-sm transition ${
                active
                  ? "border-brass text-ivory"
                  : "border-transparent text-ivory/60 hover:text-ivory"
              }`}
            >
              {item.label}
              {badge > 0 && (
                <span
                  className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                    item.href === "/expiring" && hasLapsed
                      ? "bg-red-600 text-white"
                      : "bg-brass text-ink"
                  }`}
                >
                  {badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
