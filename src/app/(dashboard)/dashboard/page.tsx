import { KpiGrid } from "@/components/dashboard/KpiGrid";
import { CurrentCallCard } from "@/components/dashboard/CurrentCallCard";
import { RecentCallsTable } from "@/components/dashboard/RecentCallsTable";
import { LeadsChart } from "@/components/dashboard/LeadsChart";
import { PostVisitLeadsCard } from "@/components/dashboard/PostVisitLeadsCard";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <CardTitle>Leads y visitas agendadas</CardTitle>
        </CardHeader>
        <div className="px-3 pb-3 sm:px-6 sm:pb-6">
          <LeadsChart />
        </div>
      </Card>
      <KpiGrid />
      <PostVisitLeadsCard />
      <CurrentCallCard />
      <Card>
        <CardHeader>
          <CardTitle>Últimas llamadas</CardTitle>
        </CardHeader>
        <div className="px-3 pb-3 sm:px-6 sm:pb-6">
          <RecentCallsTable />
        </div>
      </Card>
    </div>
  );
}
