"use client";

export function Topbar() {
  return (
    <div className="border-b border-border bg-white/70 px-3 py-3 backdrop-blur sm:px-6 sm:py-4 lg:px-8">
      <div>
        <p className="text-xs text-muted-foreground sm:text-sm">Hola, equipo Coco Clinics</p>
        <h2 className="font-display text-lg sm:text-xl">Resumen de la operación</h2>
      </div>
    </div>
  );
}
