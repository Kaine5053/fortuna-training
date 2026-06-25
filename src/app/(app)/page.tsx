import { getMatrixData } from "@/lib/matrixData";
import MatrixGrid from "@/components/MatrixGrid";

export const dynamic = "force-dynamic";

export default async function MatrixPage() {
  const data = await getMatrixData();
  return <MatrixGrid data={data} />;
}
