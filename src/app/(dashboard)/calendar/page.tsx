import { CalendarView } from "@/components/calendar/CalendarView";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function CalendarPage() {
  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="space-y-1">
          <CardTitle>Agenda operativa</CardTitle>
          <p className="text-sm text-muted-foreground">
            Haz clic en un día o arrastra una franja para abrir el popup de agenda. Desde ahí puedes crear una cita o bloquear horas en tramos de 30 minutos.
          </p>
        </div>
      </CardHeader>
      <CardContent>
        <CalendarView />
      </CardContent>
    </Card>
  );
}
