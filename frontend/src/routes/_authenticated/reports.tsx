import { AppShell } from "@/components/layout/AppShell";
import { GlassCard } from "@/components/common/GlassCard";
import { Button } from "@/components/ui/button";
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Download, FileSpreadsheet, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({ meta: [{ title: "Reports — OpticalSense" }] }),
  component: ReportsPage,
});

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
  const sortedReports = [...reports].sort((a, b) => 
    new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime()
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
    await generateReportPdf({ test: t, patient: p, clinic });
  }

  async function downloadExcel(reportId: string) {
    const r = reports.find((x) => x.id === reportId)!;
    const t = testFor(r.testId);
    const p = patients.find((x) => x.id === r.patientId);
    if (!t || !p || !clinic) {
      toast.error("Missing linked test or patient");
      return;
    }
    await generateReportExcel({ test: t, patient: p, clinic });
  }

  return (
    <AppShell>
      <div className="mb-6">
        <p className="text-sm text-muted-foreground">All clinic-branded PDF reports generated from completed tests.</p>
      </div>
      <div className="grid gap-3 max-h-[calc(100vh-200px)] overflow-y-auto pr-2">
        {reports.length === 0 && (
          <GlassCard>
            <div className="text-sm text-muted-foreground">
              No reports yet. Complete a test and generate a report from the dashboard.
            </div>
          </GlassCard>
        )}
        {sortedReports.map((r) => (
          <GlassCard key={r.id} interactive>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-sm font-medium">Report OS-{r.id.slice(-8).toUpperCase()}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {nameFor(r.patientId)} · generated {formatDateTime(r.generatedAt)}
                </div>
                {r.aiAnalysis && <div className="mt-2 text-xs italic text-muted-foreground">{r.aiAnalysis}</div>}
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={() => downloadPdf(r.id)} className="bg-brand-gradient text-white hover:opacity-95">
                  <Download className="mr-1 h-4 w-4" /> PDF
                </Button>
                <Button size="sm" onClick={() => downloadExcel(r.id)} variant="outline">
                  <FileSpreadsheet className="mr-1 h-4 w-4" /> Excel
                </Button>
                <Button size="icon" variant="ghost" onClick={() => setConfirmDelete({ id: r.id, name: nameFor(r.patientId) })}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          </GlassCard>
        ))}
      </div>

      <AlertDialog open={!!confirmDelete} onOpenChange={(v) => !v && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete report?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the report for {confirmDelete?.name}. The test data will be preserved.
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
