import { getMatrixData } from "@/lib/matrixData";
import RoleGapsView from "@/components/RoleGapsView";

export const dynamic = "force-dynamic";

export default async function RoleGapsPage() {
  const data = await getMatrixData();
  return (
    <div>
      <h2 className="mb-4 font-serif text-2xl text-ink">Role gaps</h2>
      <RoleGapsView data={data} />
    </div>
  );
}
