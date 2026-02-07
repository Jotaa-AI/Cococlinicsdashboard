import { PipelineBoard } from "@/components/pipeline/PipelineBoard";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";

export default function PipelinePage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Pipeline de leads</CardTitle>
      </CardHeader>
      <div className="px-6 pb-6">
        <PipelineBoard />
      </div>
    </Card>
  );
}
