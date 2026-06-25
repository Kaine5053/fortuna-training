import { createSupabaseServerClient } from "@/lib/supabaseServer";
import type {
  TmSection,
  TmCompetency,
  TmOperative,
  TmRole,
  TmRoleRequirement,
  TmTicket,
} from "@/lib/types";

export interface MatrixData {
  sections: TmSection[];
  competencies: TmCompetency[];
  operatives: TmOperative[];
  roles: TmRole[];
  roleRequirements: TmRoleRequirement[];
  tickets: TmTicket[];
}

/** Fetch the full matrix dataset (all operatives — grid filters active/archived). */
export async function getMatrixData(): Promise<MatrixData> {
  const supabase = await createSupabaseServerClient();

  const [sections, competencies, operatives, roles, roleRequirements, tickets] =
    await Promise.all([
      supabase.from("tm_sections").select("*").order("position", { ascending: true }),
      supabase.from("tm_competencies").select("*").order("position", { ascending: true }),
      supabase.from("tm_operatives").select("*").order("full_name", { ascending: true }),
      supabase.from("tm_roles").select("*").order("name", { ascending: true }),
      supabase.from("tm_role_requirements").select("*"),
      supabase.from("tm_tickets").select("*"),
    ]);

  return {
    sections: sections.data ?? [],
    competencies: competencies.data ?? [],
    operatives: operatives.data ?? [],
    roles: roles.data ?? [],
    roleRequirements: roleRequirements.data ?? [],
    tickets: tickets.data ?? [],
  };
}
