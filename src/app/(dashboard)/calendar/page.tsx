import { GoogleCalendarEmbed } from "@/components/calendar/GoogleCalendarEmbed";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";

export default function CalendarPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Agenda del equipo (Google Calendar)</CardTitle>
      </CardHeader>
      <div className="px-3 pb-3 sm:px-6 sm:pb-6">
        <GoogleCalendarEmbed />
      </div>
    </Card>
  );
}
