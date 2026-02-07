import { KpiGrid } from "@/components/dashboard/KpiGrid";
import { CurrentCallCard } from "@/components/dashboard/CurrentCallCard";
import { RecentCallsTable } from "@/components/dashboard/RecentCallsTable";
import { LeadsChart } from "@/components/dashboard/LeadsChart";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <KpiGrid />
      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <CurrentCallCard />
        <Card>
          <CardHeader>
            <CardTitle>Leads de la semana</CardTitle>
          </CardHeader>
          <div className="px-6 pb-6">
            <LeadsChart />
          </div>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Últimas llamadas</CardTitle>
        </CardHeader>
        <div className="px-6 pb-6">
          <RecentCallsTable />
        </div>
      </Card>
    </div>
  );
}
