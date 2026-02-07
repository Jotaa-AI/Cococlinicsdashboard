"use client";

import { Bell, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export function Topbar() {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border bg-white/70 px-8 py-4 backdrop-blur">
      <div>
        <p className="text-sm text-muted-foreground">Hola, equipo Coco Clinics</p>
        <h2 className="font-display text-xl">Resumen de la operación</h2>
      </div>
      <div className="flex items-center gap-3">
        <div className="relative hidden md:block">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar lead o cita" />
        </div>
        <button className="rounded-full border border-border bg-white p-2 text-muted-foreground shadow-soft">
          <Bell className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
