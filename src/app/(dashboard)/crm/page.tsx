import { CrmWorkspace } from "@/components/crm/CrmWorkspace";

export default function CrmPage() {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold text-foreground">CRM</h1>
        <p className="text-sm text-muted-foreground">
          Aquí podremos controlar cada lead con más contexto: gestión clínica o IA, notas manuales, citas, llamadas y evolución comercial.
        </p>
      </div>
      <CrmWorkspace />
    </div>
  );
}
