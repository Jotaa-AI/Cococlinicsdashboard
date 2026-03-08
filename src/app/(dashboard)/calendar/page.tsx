import { CalendarView } from "@/components/calendar/CalendarView";
import { NewAppointmentButton } from "@/components/calendar/NewAppointmentButton";
import { NewBusyBlockButton } from "@/components/calendar/NewBusyBlockButton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function CalendarPage() {
  return (
    <Card>
      <CardHeader className="gap-4">
        <div className="space-y-1">
          <CardTitle>Agenda operativa</CardTitle>
          <p className="text-sm text-muted-foreground">
            La agenda trabaja directamente sobre Supabase. n8n puede crear, cancelar o bloquear huecos usando los webhooks internos.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <NewAppointmentButton />
          <NewBusyBlockButton />
        </div>
      </CardHeader>
      <CardContent>
        <CalendarView />
      </CardContent>
    </Card>
  );
}
