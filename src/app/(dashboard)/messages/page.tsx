import { MessagesInbox } from "@/components/messages/MessagesInbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function MessagesPage() {
  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="space-y-1">
          <CardTitle>Mensajes</CardTitle>
          <p className="text-sm text-muted-foreground">
            Revisa la llamada inicial del agente y el hilo posterior de WhatsApp para cada lead.
          </p>
        </div>
      </CardHeader>
      <CardContent>
        <MessagesInbox />
      </CardContent>
    </Card>
  );
}
