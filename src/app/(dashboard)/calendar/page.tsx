import { CalendarView } from "@/components/calendar/CalendarView";
import { NewAppointmentButton } from "@/components/calendar/NewAppointmentButton";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";

export default function CalendarPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Agenda del equipo</CardTitle>
        <NewAppointmentButton />
      </CardHeader>
      <div className="px-6 pb-6">
        <CalendarView />
      </div>
    </Card>
  );
}
