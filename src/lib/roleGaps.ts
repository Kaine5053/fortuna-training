import type { MatrixData } from "@/lib/matrixData";
import { statusFromExpiry } from "@/lib/types";

export interface RoleGap {
  operativeId: string;
  operativeName: string;
  roleId: string | null;
  roleName: string;
  hasRole: boolean;
  missing: string[]; // competency names with no/held-less ticket
  lapsed: string[]; // required but lapsed
  meets: boolean; // hasRole && no missing && no lapsed
}

/**
 * Compare each ACTIVE operative's held competencies against their role's
 * requirements. Held = ticket with status in_date | expiring | no_expiry.
 * Missing = no ticket (not_held). Lapsed = ticket present but lapsed.
 */
export function computeRoleGaps(data: MatrixData): {
  gaps: RoleGap[];
  gapCount: number;
} {
  const { operatives, roles, competencies, roleRequirements, tickets } = data;
  const roleName = new Map(roles.map((r) => [r.id, r.name]));
  const compName = new Map(competencies.map((c) => [c.id, c.name]));
  const noExpiry = new Map(competencies.map((c) => [c.id, c.no_expiry]));

  // role_id -> required competency ids
  const reqByRole = new Map<string, string[]>();
  for (const rr of roleRequirements) {
    const arr = reqByRole.get(rr.role_id) ?? [];
    arr.push(rr.competency_id);
    reqByRole.set(rr.role_id, arr);
  }

  // operative_id:competency_id -> ticket
  const ticketMap = new Map<string, (typeof tickets)[number]>();
  for (const t of tickets) ticketMap.set(`${t.operative_id}:${t.competency_id}`, t);

  const gaps: RoleGap[] = [];
  for (const o of operatives) {
    if (o.archived) continue;
    const required = o.role_id ? reqByRole.get(o.role_id) ?? [] : [];
    const missing: string[] = [];
    const lapsed: string[] = [];

    for (const compId of required) {
      const t = ticketMap.get(`${o.id}:${compId}`);
      const status = t
        ? statusFromExpiry(t.expiry_date, noExpiry.get(compId) ?? false)
        : "not_held";
      if (status === "lapsed") lapsed.push(compName.get(compId) ?? "—");
      else if (status === "not_held") missing.push(compName.get(compId) ?? "—");
      // in_date / expiring / no_expiry => held (satisfied)
    }

    const hasRole = !!o.role_id;
    gaps.push({
      operativeId: o.id,
      operativeName: o.full_name,
      roleId: o.role_id,
      roleName: o.role_id ? roleName.get(o.role_id) ?? "—" : "—",
      hasRole,
      missing,
      lapsed,
      meets: hasRole && missing.length === 0 && lapsed.length === 0,
    });
  }

  const gapCount = gaps.filter((g) => g.missing.length > 0 || g.lapsed.length > 0).length;
  return { gaps, gapCount };
}
