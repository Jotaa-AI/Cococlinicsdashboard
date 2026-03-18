"use client";

import { Calendar, KanbanSquare, LayoutDashboard, MessageSquare, Phone, UsersRound } from "lucide-react";

export const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/pipeline", label: "Pipeline", icon: KanbanSquare },
  { href: "/crm", label: "Clientes", icon: UsersRound },
  { href: "/calendar", label: "Agenda", icon: Calendar },
  { href: "/calls", label: "Llamadas", icon: Phone },
  { href: "/messages", label: "Mensajes", icon: MessageSquare },
];
