"use client";

import { Calendar, KanbanSquare, LayoutDashboard, Phone } from "lucide-react";

export const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/pipeline", label: "Pipeline", icon: KanbanSquare },
  { href: "/calendar", label: "Agenda", icon: Calendar },
  { href: "/calls", label: "Llamadas", icon: Phone },
];
