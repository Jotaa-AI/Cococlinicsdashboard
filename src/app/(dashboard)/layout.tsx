import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { GoogleCalendarAutoSync } from "@/components/calendar/GoogleCalendarAutoSync";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-background">
      <GoogleCalendarAutoSync />
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <Topbar />
        <main className="flex-1 space-y-8 px-8 py-8">{children}</main>
      </div>
    </div>
  );
}
