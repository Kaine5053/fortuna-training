import { getMatrixData } from "@/lib/matrixData";
import ExpiringView from "@/components/ExpiringView";

export const dynamic = "force-dynamic";

export default async function ExpiringPage() {
  const data = await getMatrixData();
  return (
    <div>
      <h2 className="mb-4 font-serif text-2xl text-ink">Expiring</h2>
      <ExpiringView data={data} />
    </div>
  );
}
