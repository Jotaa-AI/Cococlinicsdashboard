import { GoogleCalendarSettings } from "@/components/calendar/GoogleCalendarSettings";
import { AgentRuntimeControlsSettings } from "@/components/settings/AgentRuntimeControls";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <GoogleCalendarSettings />
      <AgentRuntimeControlsSettings />
    </div>
  );
}
