import { GlassCard } from "@/components/common/GlassCard";
import type { SensorSample } from "@/types";
import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Props = {
  samples: SensorSample[];
};

export function LiveWaveform({ samples }: Props) {
  const [scrollOffset, setScrollOffset] = useState(0);
  
  const data = useMemo(() => {
    const s = samples.slice(-200); // Show more samples for scrolling
    if (!s.length) return [];
    const t0 = new Date(s[0].timestamp).getTime();
    // Display heart rate and SpO2 instead of raw optical data
    const heartRates = s.map((x) => x.heartRate);
    const spo2s = s.map((x) => x.spo2);
    const min = (arr: number[]) => Math.min(...arr);
    const max = (arr: number[]) => Math.max(...arr);
    const hrMin = min(heartRates), hrMax = max(heartRates);
    const spo2Min = min(spo2s), spo2Max = max(spo2s);
    return s.map((x) => {
      const t = new Date(x.timestamp).getTime();
      return {
        t: ((t - t0) / 1000).toFixed(1),
        HeartRate: hrMax === hrMin ? 0.5 : (x.heartRate - hrMin) / (hrMax - hrMin),
        SpO2: spo2Max === spo2Min ? 0.5 : (x.spo2 - spo2Min) / (spo2Max - spo2Min),
        hrValue: x.heartRate,
        spo2Value: x.spo2,
      };
    });
  }, [samples]);

  const displayData = useMemo(() => {
    if (scrollOffset === 0) {
      return data.slice(-80); // Show latest 80 samples by default
    }
    return data.slice(scrollOffset, scrollOffset + 80);
  }, [data, scrollOffset]);

  const handleScroll = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 10 : -10;
    const newOffset = Math.max(0, Math.min(data.length - 80, scrollOffset + delta));
    setScrollOffset(newOffset);
  };

  return (
    <GlassCard padded={false} className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-border/60 px-5 py-3">
        <div>
          <div className="text-sm font-semibold">Live Sensor Data</div>
          <div className="text-xs text-muted-foreground">Heart Rate / SpO2 — normalized values · Scroll to view history</div>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-brand" /> Heart Rate</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-teal" /> SpO2</span>
        </div>
      </div>
      <div className="h-96 p-3" onWheel={handleScroll}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={displayData} margin={{ top: 10, right: 20, bottom: 4, left: -20 }}>
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
              dataKey="HeartRate"
              stroke="oklch(0.55 0.18 250)"
              strokeWidth={1.8}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="SpO2"
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
