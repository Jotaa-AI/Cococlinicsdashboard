import { CallsList } from "@/components/calls/CallsList";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";

export default function CallsPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Listado de llamadas</CardTitle>
      </CardHeader>
      <div className="px-3 pb-3 sm:px-6 sm:pb-6">
        <CallsList />
      </div>
    </Card>
  );
}
