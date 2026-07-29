import { GlassCard } from "@/components/common/GlassCard";
import type { SensorSample } from "@/types";
import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Props = {
  samples: SensorSample[];
};

export function LiveWaveform({ samples }: Props) {
  const data = useMemo(() => {
    const s = samples.slice(-80);
    if (!s.length) return [];
    const t0 = s[0].t;
    // normalize to 0..1 for smooth dual-trace display
    const irs = s.map((x) => x.ir);
    const reds = s.map((x) => x.red);
    const min = (arr: number[]) => Math.min(...arr);
    const max = (arr: number[]) => Math.max(...arr);
    const irMin = min(irs), irMax = max(irs);
    const rMin = min(reds), rMax = max(reds);
    return s.map((x) => ({
      t: ((x.t - t0) / 1000).toFixed(1),
      IR: irMax === irMin ? 0.5 : (x.ir - irMin) / (irMax - irMin),
      Red: rMax === rMin ? 0.5 : (x.red - rMin) / (rMax - rMin),
    }));
  }, [samples]);

  return (
    <GlassCard padded={false} className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-border/60 px-5 py-3">
        <div>
          <div className="text-sm font-semibold">Live Optical Waveform</div>
          <div className="text-xs text-muted-foreground">Red / IR — normalized amplitude · 8s window</div>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-brand" /> IR</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-teal" /> Red</span>
        </div>
      </div>
      <div className="h-64 p-3">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 20, bottom: 4, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.85 0.02 240 / 0.4)" />
            <XAxis dataKey="t" tick={{ fill: "oklch(0.5 0.03 250)", fontSize: 10 }} tickLine={false} axisLine={false} />
            <YAxis domain={[0, 1]} hide />
            <Tooltip
              contentStyle={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                fontSize: 12,
              }}
              labelFormatter={(v) => `t = ${v}s`}
            />
            <Line
              type="monotone"
              dataKey="IR"
              stroke="oklch(0.55 0.18 250)"
              strokeWidth={1.8}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="Red"
              stroke="oklch(0.72 0.12 200)"
              strokeWidth={1.8}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </GlassCard>
  );
}
