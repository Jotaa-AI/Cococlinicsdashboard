import { CalendarView } from "@/components/calendar/CalendarView";
import { NewAppointmentButton } from "@/components/calendar/NewAppointmentButton";
import { NewBusyBlockButton } from "@/components/calendar/NewBusyBlockButton";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";

export default function CalendarPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Agenda del equipo</CardTitle>
        <div className="grid gap-3">
          <NewAppointmentButton />
          <NewBusyBlockButton />
        </div>
      </CardHeader>
      <div className="px-3 pb-3 sm:px-6 sm:pb-6">
        <CalendarView />
      </div>
    </Card>
  );
}
