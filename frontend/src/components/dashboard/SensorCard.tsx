import { GlassCard } from "@/components/common/GlassCard";
import { CountUp } from "@/components/common/CountUp";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import type { SensorSample } from "@/types";
import { Area, AreaChart, ResponsiveContainer } from "recharts";

type Props = {
  label: string;
  value: number;
  decimals?: number;
  suffix?: string;
  icon: LucideIcon;
  tint: "brand" | "teal" | "amber" | "rose";
  samples?: SensorSample[];
  metricKey?: keyof SensorSample;
  hint?: string;
};

const TINT: Record<Props["tint"], { bg: string; fg: string; stroke: string }> = {
  brand: { bg: "bg-brand/10", fg: "text-brand", stroke: "oklch(0.55 0.18 250)" },
  teal: { bg: "bg-teal/15", fg: "text-teal", stroke: "oklch(0.72 0.12 200)" },
  amber: { bg: "bg-amber-500/10", fg: "text-amber-600 dark:text-amber-400", stroke: "oklch(0.75 0.16 75)" },
  rose: { bg: "bg-rose-500/10", fg: "text-rose-600 dark:text-rose-400", stroke: "oklch(0.65 0.2 20)" },
};

// Health status colors
const STATUS_COLORS = {
  critical: { bg: "bg-red-500/10", fg: "text-red-600 dark:text-red-400", stroke: "oklch(0.55 0.2 25)" },
  normal: { bg: "bg-yellow-500/10", fg: "text-yellow-600 dark:text-yellow-400", stroke: "oklch(0.75 0.15 85)" },
  healthy: { bg: "bg-green-500/10", fg: "text-green-600 dark:text-green-400", stroke: "oklch(0.65 0.2 145)" },
};

function getHealthStatus(label: string, value: number): "critical" | "normal" | "healthy" {
  switch (label) {
    case "SpO₂":
      if (value < 90) return "critical";
      if (value < 95) return "normal";
      return "healthy";
    case "Pulse":
      if (value < 60 || value > 100) return "critical";
      if (value < 70 || value > 90) return "normal";
      return "healthy";
    case "Temperature":
      if (value < 36 || value > 38) return "critical";
      if (value < 36.5 || value > 37.5) return "normal";
      return "healthy";
    case "Signal Quality":
      if (value < 50) return "critical";
      if (value < 70) return "normal";
      return "healthy";
    case "Battery":
      if (value < 20) return "critical";
      if (value < 50) return "normal";
      return "healthy";
    default:
      return "healthy";
  }
}

export function SensorCard({ label, value, decimals = 0, suffix, icon: Icon, tint, samples, metricKey, hint }: Props) {
  const t = TINT[tint];
  const status = getHealthStatus(label, value);
  const statusColors = STATUS_COLORS[status];
  
  const data =
    samples && metricKey
      ? samples.slice(-40).map((s, i) => ({ i, v: Number(s[metricKey]) }))
      : [];
  
  // Get latest sample for additional info
  const latestSample = samples?.[samples.length - 1];
  
  return (
    <GlassCard interactive>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="mt-1 font-display text-3xl font-semibold tracking-tight">
            <CountUp value={value} decimals={decimals} suffix={suffix} className={statusColors.fg} />
          </div>
          {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
        </div>
        <div className={cn("flex h-9 w-9 items-center justify-center rounded-xl", statusColors.bg)}>
          <Icon className={cn("h-4 w-4", statusColors.fg)} />
        </div>
      </div>
      {data.length > 1 && (
        <div className="mt-3 h-10">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`spark-${label}`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={statusColors.stroke} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={statusColors.stroke} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="v" stroke={statusColors.stroke} strokeWidth={1.6} fill={`url(#spark-${label})`} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </GlassCard>
  );
}
