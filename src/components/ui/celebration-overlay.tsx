"use client";

import { useMemo } from "react";
import { Trophy } from "lucide-react";

interface CelebrationOverlayProps {
  open: boolean;
  title?: string;
  subtitle?: string;
}

const COLORS = ["bg-amber-300", "bg-emerald-300", "bg-sky-300", "bg-rose-300", "bg-violet-300", "bg-fuchsia-300"];

export function CelebrationOverlay({
  open,
  title = "Cliente cerrado",
  subtitle = "Venta registrada. El cierre ya cuenta en el dashboard.",
}: CelebrationOverlayProps) {
  const pieces = useMemo(
    () =>
      Array.from({ length: 28 }, (_, index) => ({
        left: `${6 + (index % 14) * 6.4}%`,
        top: `${10 + Math.floor(index / 14) * 8}%`,
        delay: `${index * 45}ms`,
        duration: `${820 + (index % 5) * 140}ms`,
        color: COLORS[index % COLORS.length],
      })),
    []
  );

  if (!open) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[120] flex items-start justify-center overflow-hidden px-4 pt-10">
      <div className="absolute inset-0 bg-slate-950/20 backdrop-blur-[2px]" />
      <div className="absolute left-1/2 top-24 h-48 w-48 -translate-x-1/2 rounded-full bg-emerald-400/20 blur-3xl" />
      <div className="absolute left-1/2 top-28 h-72 w-72 -translate-x-1/2 rounded-full border border-emerald-300/30 animate-ping" />

      {pieces.map((piece, index) => (
        <span
          key={index}
          className={`absolute h-3.5 w-2.5 rotate-12 rounded-sm ${piece.color} animate-bounce shadow-xl`}
          style={{ left: piece.left, top: piece.top, animationDelay: piece.delay, animationDuration: piece.duration }}
        />
      ))}

      <div className="relative mt-10 flex items-center gap-4 rounded-3xl border border-emerald-200 bg-white px-6 py-5 shadow-2xl shadow-emerald-950/20">
        <div className="absolute inset-0 rounded-3xl border border-emerald-200/70" />
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow-lg shadow-emerald-500/40">
          <Trophy className="h-7 w-7" />
        </div>
        <div>
          <p className="text-base font-semibold text-foreground">{title}</p>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
      </div>
    </div>
  );
}
