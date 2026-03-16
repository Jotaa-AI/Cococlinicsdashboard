import { MessagesInbox } from "@/components/messages/MessagesInbox";

export default function MessagesPage() {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold text-foreground">Mensajes</h1>
        <p className="text-sm text-muted-foreground">
          Aquí veremos todas las conversaciones del agente con cada lead, separando la llamada inicial y el hilo de WhatsApp.
        </p>
      </div>
      <MessagesInbox />
    </div>
  );
}
