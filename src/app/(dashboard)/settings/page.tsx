import { AgentRuntimeControlsSettings } from "@/components/settings/AgentRuntimeControls";
import { WhatsappLeadBlockSettings } from "@/components/settings/WhatsappLeadBlockSettings";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <AgentRuntimeControlsSettings />
      <WhatsappLeadBlockSettings />
    </div>
  );
}
