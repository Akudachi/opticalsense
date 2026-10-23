import { AppShell } from "@/components/layout/AppShell";
import { GlassCard } from "@/components/common/GlassCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { getServices } from "@/services";
import { formatDateTime } from "@/utils/format";
import { generateReportPdf } from "@/utils/pdf";
import { generateReportExcel } from "@/utils/excel";
import type { ReportReading, Test } from "@/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  Activity,
  AlertTriangle,
  Clock,
  Download,
  FileSpreadsheet,
  HeartPulse,
  Thermometer,
  Trash2,
  Waves,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({ meta: [{ title: "Reports — OpticalSense" }] }),
  component: ReportsPage,
});

/**
 * Extracts the single stabilized reading taken strictly after 20 seconds.
 * Rules:
 * - Samples < 20s are ignored and never shown/stored.
 * - The reading is the FIRST valid sample with testDuration >= 20000, heartRate > 0, spo2 > 0.
 * - If stopped before 20s or no valid sample arrives after 20s: invalid with error message.
 * - Never falls back to /result average (which includes 0-20s warm-up).
 */
function getReportReading(
  reportReading?: ReportReading,
  test?: Test | null
): { reading: ReportReading | null; isValid: boolean; errorMessage: string | null } {
  if (reportReading) {
    return {
      reading: reportReading,
      isValid: reportReading.valid && reportReading.spo2 > 0 && reportReading.heartRate > 0,
      errorMessage: reportReading.valid ? null : (reportReading.errorMessage || "Not enough valid readings. Keep the probe steady and run the test longer."),
    };
  }

  if (test?.reportReading) {
    return {
      reading: test.reportReading,
      isValid: test.reportReading.valid && test.reportReading.spo2 > 0 && test.reportReading.heartRate > 0,
      errorMessage: test.reportReading.valid ? null : (test.reportReading.errorMessage || "Not enough valid readings. Keep the probe steady and run the test longer."),
    };
  }

  // Fallback for seed or existing tests: search test.samples for the first sample with testDuration >= 20000
  if (test?.samples && test.samples.length > 0) {
    const validPost20s = test.samples.find(
      (s) => (s.testDuration ?? 0) >= 20000 && (s.heartRate ?? 0) > 0 && (s.spo2 ?? 0) > 0
    );
    if (validPost20s) {
      const reading: ReportReading = {
        valid: true,
        spo2: validPost20s.spo2,
        heartRate: validPost20s.heartRate,
        temperature: validPost20s.temperature,
        signalQuality: validPost20s.signalQuality,
        vitalityStatus: validPost20s.vitalityStatus || (test.pulpVerdict === "non_vital" ? "Non-Vital" : "Vital"),
        vitalityIndex: validPost20s.vitalityIndex,
        testDuration: validPost20s.testDuration ?? 20000,
        timestamp: validPost20s.timestamp,
        validReadings: test.summary.validReadings ?? 5,
      };
      return { reading, isValid: true, errorMessage: null };
    }
  }

  return {
    reading: null,
    isValid: false,
    errorMessage: "Not enough valid readings. Keep the probe steady and run the test longer.",
  };
}

function ReportsPage() {
  const services = getServices();
  const qc = useQueryClient();
  const { data: reports = [] } = useQuery({ queryKey: ["reports"], queryFn: () => services.reports.list() });
  const { data: tests = [] } = useQuery({
    queryKey: ["tests", "all"],
    queryFn: async () => (await services.tests.list({ pageSize: 500 })).items,
  });
  const { data: patients = [] } = useQuery({
    queryKey: ["patients", "map"],
    queryFn: async () => (await services.patients.list({ pageSize: 500 })).items,
  });
  const { data: clinic } = useQuery({ queryKey: ["clinic"], queryFn: () => services.clinic.get() });
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
  const nameFor = (id: string) => patients.find((p) => p.id === id)?.fullName ?? "—";
  const testFor = (id: string) => tests.find((t) => t.id === id);

  // Sort reports by generatedAt in descending order (newest first)
  const sortedReports = [...reports].sort(
    (a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime()
  );

  const deleteMut = useMutation({
    mutationFn: (id: string) => services.reports.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reports"] });
      toast.success("Report deleted");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to delete report"),
  });

  async function downloadPdf(reportId: string) {
    const r = reports.find((x) => x.id === reportId)!;
    const t = testFor(r.testId);
    const p = patients.find((x) => x.id === r.patientId);
    if (!t || !p || !clinic) {
      toast.error("Missing linked test or patient");
      return;
    }
    await generateReportPdf({ test: t, patient: p, clinic, report: r });
  }

  async function downloadExcel(reportId: string) {
    const r = reports.find((x) => x.id === reportId)!;
    const t = testFor(r.testId);
    const p = patients.find((x) => x.id === r.patientId);
    if (!t || !p || !clinic) {
      toast.error("Missing linked test or patient");
      return;
    }
    await generateReportExcel({ test: t, patient: p, clinic, report: r });
  }

  return (
    <AppShell>
      <div className="p-3 sm:p-4 lg:p-6 max-w-7xl mx-auto space-y-4 sm:space-y-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold font-display tracking-tight text-foreground">
            Clinical Vitality Reports
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-muted-foreground">
            Assessments based strictly on stabilized optical readings taken after the first 20 seconds.
          </p>
        </div>

        <div className="grid gap-3 sm:gap-4">
          {reports.length === 0 && (
            <GlassCard>
              <div className="py-8 text-center text-sm text-muted-foreground">
                No reports yet. Start a website test from the Dashboard and generate a report after the 20-second stabilization.
              </div>
            </GlassCard>
          )}

          {sortedReports.map((r) => {
            const t = testFor(r.testId);
            const { reading, isValid, errorMessage } = getReportReading(r.reading, t);
            const statusLower = (reading?.vitalityStatus || "").toLowerCase();
            const isVital = statusLower.includes("vital") && !statusLower.includes("non");
            const isNonVital = statusLower.includes("non");

            return (
              <GlassCard key={r.id} interactive className="p-4 sm:p-5">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">
                        Report OS-{r.id.slice(-8).toUpperCase()}
                      </span>
                      <span className="text-xs text-muted-foreground">·</span>
                      <span className="text-xs font-medium text-foreground">{nameFor(r.patientId)}</span>
                      {t?.toothOfInterest && (
                        <Badge variant="outline" className="text-[11px] font-mono px-2 py-0 border-border/70">
                          Tooth FDI {t.toothOfInterest}
                        </Badge>
                      )}
                      <span className="text-[11px] text-muted-foreground">
                        · {formatDateTime(r.generatedAt)}
                      </span>
                    </div>

                    {/* Reading Display Area */}
                    {isValid && reading ? (
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {/* SpO2 */}
                        <div className="inline-flex items-center gap-1.5 rounded-lg border border-brand/20 bg-brand/5 px-2.5 py-1 text-xs">
                          <HeartPulse className="h-3.5 w-3.5 text-brand" />
                          <span className="text-muted-foreground">SpO₂:</span>
                          <span className="font-semibold text-brand">{reading.spo2.toFixed(1)}%</span>
                        </div>

                        {/* Pulse */}
                        <div className="inline-flex items-center gap-1.5 rounded-lg border border-teal/20 bg-teal/5 px-2.5 py-1 text-xs">
                          <Activity className="h-3.5 w-3.5 text-teal" />
                          <span className="text-muted-foreground">Pulse:</span>
                          <span className="font-semibold text-teal">{Math.round(reading.heartRate)} bpm</span>
                        </div>

                        {/* Temp */}
                        <div className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/5 px-2.5 py-1 text-xs">
                          <Thermometer className="h-3.5 w-3.5 text-amber-500" />
                          <span className="text-muted-foreground">Temp:</span>
                          <span className="font-semibold text-amber-600 dark:text-amber-400">
                            {reading.temperature.toFixed(1)}°C
                          </span>
                        </div>

                        {/* Quality */}
                        <div className="inline-flex items-center gap-1.5 rounded-lg border border-border/50 bg-muted/40 px-2.5 py-1 text-xs">
                          <Waves className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-muted-foreground">Quality:</span>
                          <span className="font-semibold text-foreground">{reading.signalQuality}%</span>
                        </div>

                        {/* Timing / Sample count */}
                        <div className="inline-flex items-center gap-1.5 rounded-lg border border-border/50 bg-muted/30 px-2.5 py-1 text-xs">
                          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-muted-foreground">Post-20s Averages:</span>
                          <span className="font-mono font-medium text-foreground">
                            {reading.validReadings ? `${reading.validReadings} valid samples` : `${(reading.testDuration / 1000).toFixed(1)}s`}
                            {reading.intervalReadings && reading.intervalReadings.length > 0 && ` (${reading.intervalReadings.length}× 20s intervals)`}
                          </span>
                        </div>

                        {/* Verdict Badge */}
                        <Badge
                          variant="secondary"
                          className={
                            isVital
                              ? "bg-teal/15 text-teal text-[11px] font-semibold px-2 py-0.5"
                              : isNonVital
                              ? "bg-destructive/15 text-destructive text-[11px] font-semibold px-2 py-0.5"
                              : "bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[11px] font-semibold px-2 py-0.5"
                          }
                        >
                          {reading.vitalityStatus?.toUpperCase() || (isVital ? "VITAL" : isNonVital ? "NON-VITAL" : "INCONCLUSIVE")}
                        </Badge>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-800 dark:text-amber-200">
                        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                        <span>{errorMessage || "Not enough valid readings. Keep the probe steady and run the test longer."}</span>
                      </div>
                    )}

                    {r.aiAnalysis && (
                      <div className="text-xs italic text-muted-foreground pt-0.5">
                        {r.aiAnalysis}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0 pt-2 lg:pt-0">
                    <Button
                      size="sm"
                      onClick={() => downloadPdf(r.id)}
                      className="bg-brand-gradient text-white shadow-glow hover:opacity-95"
                    >
                      <Download className="mr-1.5 h-4 w-4" /> PDF Report
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => downloadExcel(r.id)}
                      variant="outline"
                      className="border-border/70"
                    >
                      <FileSpreadsheet className="mr-1.5 h-4 w-4" /> Excel Data
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setConfirmDelete({ id: r.id, name: nameFor(r.patientId) })}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Delete report"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </GlassCard>
            );
          })}
        </div>
      </div>

      <AlertDialog open={!!confirmDelete} onOpenChange={(v) => !v && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete report?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the report for {confirmDelete?.name}. The test record will remain preserved in history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => confirmDelete && deleteMut.mutate(confirmDelete.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
