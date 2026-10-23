import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDuration } from "@/utils/format";
import type { DeviceResultPayload } from "@/types";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  HeartPulse,
  RotateCcw,
  Thermometer,
  Waves,
} from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: DeviceResultPayload | null;
  patientName?: string;
  tooth?: string;
  onGenerateReport?: () => void;
  onRetry?: () => void;
};

export function TestResultDialog({
  open,
  onOpenChange,
  result,
  patientName,
  tooth,
  onGenerateReport,
  onRetry,
}: Props) {
  if (!result) return null;

  const isValid = result.valid;
  const durationSec = result.durationMs ? Math.round(result.durationMs / 1000) : 0;
  const spo2 = result.finalSpo2 ?? result.spo2 ?? 0;
  const hr = result.finalHeartRate ?? result.heartRate ?? 0;
  const temp = result.finalTemperature ?? result.temperature ?? 0;

  const isVital = result.vitalityStatus?.toLowerCase().includes("vital") && !result.vitalityStatus?.toLowerCase().includes("non");
  const isNonVital = result.vitalityStatus?.toLowerCase().includes("non");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg sm:max-w-xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            {isValid ? (
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal/15 text-teal">
                <CheckCircle2 className="h-5 w-5" />
              </div>
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-5 w-5" />
              </div>
            )}
            <div>
              <DialogTitle className="text-lg font-semibold">
                {isValid ? "Test Completed" : "No valid reading, check probe contact and retry"}
              </DialogTitle>
              <DialogDescription className="text-xs">
                {patientName ? `Patient: ${patientName}` : "Patient Session"}
                {tooth ? ` · Tooth FDI ${tooth}` : ""}
                {` · Duration ${formatDuration(durationSec)}`}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {isValid ? (
          <div className="space-y-4 py-2">
            {/* Verdict Card */}
            <div className="flex items-center justify-between rounded-xl border border-border/60 bg-muted/30 p-3.5">
              <div>
                <div className="text-xs text-muted-foreground">Pulp Vitality Verdict</div>
                <div className="mt-1 font-display text-xl font-bold tracking-tight capitalize">
                  {result.vitalityStatus || "Inconclusive"}
                </div>
              </div>
              <Badge
                variant="secondary"
                className={
                  isVital
                    ? "bg-teal/15 text-teal text-xs font-semibold px-2.5 py-1"
                    : isNonVital
                    ? "bg-destructive/15 text-destructive text-xs font-semibold px-2.5 py-1"
                    : "bg-amber-500/15 text-amber-600 dark:text-amber-400 text-xs font-semibold px-2.5 py-1"
                }
              >
                {isVital ? "VITAL" : isNonVital ? "NON-VITAL" : "INCONCLUSIVE"}
              </Badge>
            </div>

            {/* Final Averages Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              <div className="rounded-xl border border-border/50 bg-card/60 p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <HeartPulse className="h-3.5 w-3.5 text-brand" />
                  SpO₂ Average
                </div>
                <div className="mt-1.5 font-display text-2xl font-bold text-brand">
                  {spo2 > 0 ? `${spo2.toFixed(1)}%` : "--"}
                </div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">Oxygen Perfusion</div>
              </div>

              <div className="rounded-xl border border-border/50 bg-card/60 p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Activity className="h-3.5 w-3.5 text-teal" />
                  Pulse Average
                </div>
                <div className="mt-1.5 font-display text-2xl font-bold text-teal">
                  {hr > 0 ? `${Math.round(hr)} bpm` : "--"}
                </div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">Heart Rate</div>
              </div>

              <div className="rounded-xl border border-border/50 bg-card/60 p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Thermometer className="h-3.5 w-3.5 text-amber-500" />
                  Temperature
                </div>
                <div className="mt-1.5 font-display text-2xl font-bold text-amber-600 dark:text-amber-400">
                  {temp > 0 ? `${temp.toFixed(2)} °C` : "--"}
                </div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">Tooth / Ambient</div>
              </div>

              <div className="rounded-xl border border-border/50 bg-card/60 p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Waves className="h-3.5 w-3.5 text-rose-500" />
                  Signal Quality
                </div>
                <div className="mt-1.5 font-display text-2xl font-bold text-foreground">
                  {result.signalQuality ?? 0}%
                </div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">SNR index</div>
              </div>

              <div className="rounded-xl border border-border/50 bg-card/60 p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Waves className="h-3.5 w-3.5 text-brand" />
                  Vitality Index
                </div>
                <div className="mt-1.5 font-display text-2xl font-bold text-brand">
                  {(result.vitalityIndex ?? 0).toFixed(1)}
                </div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">Relative ratio</div>
              </div>

              <div className="rounded-xl border border-border/50 bg-card/60 p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  Valid Readings
                </div>
                <div className="mt-1.5 font-display text-2xl font-bold text-foreground">
                  {result.validReadings ?? 0}
                </div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">Averaged samples</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3.5 py-2">
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-200">
              <div className="font-semibold text-base mb-1">Insufficient Signal Data</div>
              <p className="text-xs leading-relaxed opacity-90">
                The device was unable to register sufficient clean optical pulses. This commonly happens if the optical sensor probe was not securely held against the enamel or if excessive motion occurred.
              </p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs font-medium">
                <span className="rounded-md bg-amber-500/20 px-2 py-0.5">Duration: {formatDuration(durationSec)}</span>
                <span className="rounded-md bg-amber-500/20 px-2 py-0.5">Valid Readings: {result.validReadings ?? 0}</span>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Please reposition the probe tip securely against the labial/buccal surface of the tooth and click Retry Test.
            </p>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {isValid ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              {onGenerateReport && (
                <Button
                  className="bg-brand-gradient text-white shadow-glow hover:opacity-95"
                  onClick={() => {
                    onOpenChange(false);
                    onGenerateReport();
                  }}
                >
                  <FileText className="mr-2 h-4 w-4" /> Generate Report
                </Button>
              )}
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Dismiss
              </Button>
              {onRetry && (
                <Button
                  className="bg-brand-gradient text-white shadow-glow hover:opacity-95"
                  onClick={() => {
                    onOpenChange(false);
                    onRetry();
                  }}
                >
                  <RotateCcw className="mr-2 h-4 w-4" /> Retry Test
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
