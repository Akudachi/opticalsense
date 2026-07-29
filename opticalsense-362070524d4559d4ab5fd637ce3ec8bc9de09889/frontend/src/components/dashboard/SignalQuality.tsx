import { GlassCard } from "@/components/common/GlassCard";
import { Progress } from "@/components/ui/progress";
import type { SensorSample } from "@/types";

type Props = { latest: SensorSample | null };

export function SignalQuality({ latest }: Props) {
  const q = latest?.signalQuality ?? 0;
  const c = latest?.confidence ?? "low";
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
      <div className="mt-2 text-[11px] text-muted-foreground">
        Derived from PPG SNR, motion artifact detection, and IR/Red ratio consistency.
      </div>
    </GlassCard>
  );
}
