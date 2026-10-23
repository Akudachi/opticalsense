import { GlassCard } from "@/components/common/GlassCard";
import type { SensorSample } from "@/types";
import { Activity, Waves } from "lucide-react";
import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Props = {
  samples: SensorSample[];
};

export function LiveWaveform({ samples }: Props) {
  const [scrollOffset, setScrollOffset] = useState(0);
  
  // Rule 1: A value of 0 means "no valid reading right now" (probe not on tooth, signal noisy).
  // Do not plot it as a real zero.
  const validSamples = useMemo(() => {
    return samples.filter((s) => (s.spo2 ?? 0) > 0 && (s.heartRate ?? 0) > 0);
  }, [samples]);

  const data = useMemo(() => {
    const s = validSamples.slice(-200); // Show up to 200 valid samples
    if (!s.length) return [];
    const t0 = new Date(s[0].timestamp).getTime();
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
        HeartRate: hrMax === hrMin ? 0.5 : (x.heartRate - hrMin) / (hrMax - hrMin || 1),
        SpO2: spo2Max === spo2Min ? 0.5 : (x.spo2 - spo2Min) / (spo2Max - spo2Min || 1),
        hrValue: x.heartRate,
        spo2Value: x.spo2,
      };
    });
  }, [validSamples]);

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
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 sm:px-5 py-3">
        <div>
          <div className="text-sm font-semibold">Live Optical Perfusion Waveform</div>
          <div className="text-xs text-muted-foreground">Pulse & SpO₂ dynamics · 1-sec device updates</div>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-brand" /> Heart Rate</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-teal" /> SpO₂</span>
        </div>
      </div>
      <div className="h-64 sm:h-80 md:h-96 p-2 sm:p-3 relative" onWheel={handleScroll}>
        {displayData.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 text-muted-foreground p-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted/40 border border-border/50">
              <Waves className="h-6 w-6 text-muted-foreground/60 animate-pulse" />
            </div>
            <div className="text-sm font-medium">Awaiting Sensor Contact</div>
            <div className="text-xs text-muted-foreground/80 max-w-sm text-center">
              Probe must be securely placed on tooth crown to detect optical blood perfusion. Values reporting 0 are excluded from chart.
            </div>
          </div>
        ) : (
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
                labelFormatter={(v) => `Elapsed: ${v}s`}
                formatter={(val: any, name: any, item: any) => {
                  if (name === "HeartRate") return [`${item.payload.hrValue} bpm`, "Heart Rate"];
                  if (name === "SpO2") return [`${item.payload.spo2Value}%`, "SpO₂"];
                  return [val, name];
                }}
              />
              <Line
                type="monotone"
                dataKey="HeartRate"
                stroke="oklch(0.55 0.18 250)"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="SpO2"
                stroke="oklch(0.72 0.12 200)"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </GlassCard>
  );
}
