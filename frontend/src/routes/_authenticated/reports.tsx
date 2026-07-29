import { AppShell } from "@/components/layout/AppShell";
import { GlassCard } from "@/components/common/GlassCard";
import { Button } from "@/components/ui/button";
import { getServices } from "@/services";
import { formatDateTime } from "@/utils/format";
import { generateReportPdf } from "@/utils/pdf";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Download } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({ meta: [{ title: "Reports — OpticalSense" }] }),
  component: ReportsPage,
});

function ReportsPage() {
  const services = getServices();
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
  const nameFor = (id: string) => patients.find((p) => p.id === id)?.fullName ?? "—";
  const testFor = (id: string) => tests.find((t) => t.id === id);

  async function download(reportId: string) {
    const r = reports.find((x) => x.id === reportId)!;
    const t = testFor(r.testId);
    const p = patients.find((x) => x.id === r.patientId);
    if (!t || !p || !clinic) {
      toast.error("Missing linked test or patient");
      return;
    }
    await generateReportPdf({ test: t, patient: p, clinic });
  }

  return (
    <AppShell>
      <div className="mb-6">
        <p className="text-sm text-muted-foreground">All clinic-branded PDF reports generated from completed tests.</p>
      </div>
      <div className="grid gap-3">
        {reports.length === 0 && (
          <GlassCard>
            <div className="text-sm text-muted-foreground">
              No reports yet. Complete a test and generate a report from the dashboard.
            </div>
          </GlassCard>
        )}
        {reports.map((r) => (
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
                <Button size="sm" onClick={() => download(r.id)} className="bg-brand-gradient text-white hover:opacity-95">
                  <Download className="mr-1 h-4 w-4" /> PDF
                </Button>
              </div>
            </div>
          </GlassCard>
        ))}
      </div>
    </AppShell>
  );
}
