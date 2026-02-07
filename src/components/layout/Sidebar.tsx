"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Calendar, LayoutDashboard, Phone, Settings, KanbanSquare } from "lucide-react";
import { cn } from "@/lib/utils/cn";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/pipeline", label: "Pipeline", icon: KanbanSquare },
  { href: "/calendar", label: "Agenda", icon: Calendar },
  { href: "/calls", label: "Llamadas", icon: Phone },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-64 flex-col border-r border-border bg-white/80 px-6 py-8 backdrop-blur">
      <div className="mb-10">
        <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Coco Clinics</p>
        <h1 className="font-display text-2xl font-semibold text-foreground">Panel interno</h1>
      </div>
      <nav className="flex-1 space-y-2">
        {navItems.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
                active
                  ? "bg-primary text-primary-foreground shadow-soft"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="rounded-lg bg-muted px-4 py-3 text-xs text-muted-foreground">
        Realtime activado · Supabase
      </div>
    </aside>
  );
}
