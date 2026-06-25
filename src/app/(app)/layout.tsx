import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { getMatrixData } from "@/lib/matrixData";
import { computeRoleGaps } from "@/lib/roleGaps";
import { daysUntil } from "@/lib/types";
import AppHeader from "@/components/AppHeader";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Nav badge = 90-day count (brief): active dated tickets that are lapsed or
  // expiring within 90 days. (The cell amber threshold is 6 months; this badge is 90d.)
  const data = await getMatrixData();
  const { operatives, tickets } = data;
  const { gapCount } = computeRoleGaps(data);
  const activeIds = new Set(operatives.filter((o) => !o.archived).map((o) => o.id));

  let expiringBadge = 0;
  let hasLapsed = false;
  for (const t of tickets) {
    if (!activeIds.has(t.operative_id) || !t.expiry_date) continue;
    const d = daysUntil(t.expiry_date);
    if (d < 0) {
      expiringBadge++;
      hasLapsed = true;
    } else if (d <= 90) {
      expiringBadge++;
    }
  }

  return (
    <div className="min-h-screen">
      <AppHeader expiringBadge={expiringBadge} hasLapsed={hasLapsed} gapsBadge={gapCount} />
      <main className="mx-auto max-w-[1600px] px-6 py-6">{children}</main>
    </div>
  );
}
