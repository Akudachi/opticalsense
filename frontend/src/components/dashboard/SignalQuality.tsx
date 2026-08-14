import { GlassCard } from "@/components/common/GlassCard";
import { Progress } from "@/components/ui/progress";
import type { SensorSample } from "@/types";

type Props = { latest: SensorSample | null };

export function SignalQuality({ latest }: Props) {
  const q = latest?.signalQuality ?? 0;
  // Derive confidence from signal quality value
  const c: "high" | "medium" | "low" = q >= 70 ? "high" : q >= 40 ? "medium" : "low";
  const probe = latest?.probeQuality ?? "—";
  const motion = latest?.motionDetected ?? false;
  const saturated = latest?.sensorSaturated ?? false;
  
  // Use signal quality as confidence since HR/SpO2 confidence fields are not available
  const hrConf = q > 0 ? q.toFixed(0) : "—";
  const spo2Conf = q > 0 ? q.toFixed(0) : "—";

  return (
    <GlassCard>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-muted-foreground">Signal Quality</div>
          <div className="mt-1 font-display text-2xl font-semibold">
            {q}<span className="ml-1 text-sm font-normal text-muted-foreground">/ 100</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">Confidence</div>
          <div
            className={
              "mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium " +
              (c === "high" ? "bg-teal/15 text-teal" : c === "medium" ? "bg-amber-500/10 text-amber-600 dark:text-amber-400" : "bg-destructive/10 text-destructive")
            }
          >
            {c.toUpperCase()}
          </div>
        </div>
      </div>
      <Progress value={q} className="mt-3 h-1.5" />
      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Probe:</span>
          <span className={probe === "Excellent" || probe === "GOOD" ? "text-teal" : probe === "Good" || probe === "Fair" ? "text-amber-500" : "text-destructive"}>{probe}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">HR Conf:</span>
          <span>{hrConf}%</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">SpO₂ Conf:</span>
          <span>{spo2Conf}%</span>
        </div>
        <div className="flex items-center gap-1.5">
          {motion && <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />}
          {saturated && <span className="inline-block h-1.5 w-1.5 rounded-full bg-destructive animate-pulse" />}
          <span className="text-muted-foreground">{motion ? "Motion" : saturated ? "Saturated" : "Stable"}</span>
        </div>
      </div>
      <div className="mt-2 text-[11px] text-muted-foreground">
        Derived from PPG SNR, motion artifact detection, and IR/Red ratio consistency.
      </div>
    </GlassCard>
  );
}
