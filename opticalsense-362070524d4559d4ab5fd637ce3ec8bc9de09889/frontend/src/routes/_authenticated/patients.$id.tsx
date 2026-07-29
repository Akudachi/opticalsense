import { AppShell } from "@/components/layout/AppShell";
import { GlassCard } from "@/components/common/GlassCard";
import { Badge } from "@/components/ui/badge";
import { getServices } from "@/services";
import { calcAge, formatDate, formatDateTime, formatDuration } from "@/utils/format";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_authenticated/patients/$id")({
  head: ({ params }) => ({
    meta: [{ title: `Patient · ${params.id} — OpticalSense` }],
  }),
  component: PatientDetailPage,
});

function PatientDetailPage() {
  const { id } = Route.useParams();
  const services = getServices();
  const { data: patient } = useQuery({
    queryKey: ["patient", id],
    queryFn: () => services.patients.get(id),
  });
  const { data: testsPage } = useQuery({
    queryKey: ["tests", "patient", id],
    queryFn: () => services.tests.list({ patientId: id, pageSize: 50 }),
  });
  const tests = testsPage?.items ?? [];

  return (
    <AppShell>
      <Link to="/patients" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> All patients
      </Link>
      {!patient ? (
        <div className="text-sm text-muted-foreground">Patient not found.</div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <GlassCard>
            <div className="font-display text-2xl font-semibold">{patient.fullName}</div>
            <div className="mt-1 text-sm text-muted-foreground">
              {calcAge(patient.dateOfBirth)} yrs · <span className="capitalize">{patient.sex}</span>
              {patient.toothOfInterest && ` · tooth ${patient.toothOfInterest}`}
            </div>
            <dl className="mt-6 space-y-3 text-sm">
              <Row k="Phone" v={patient.phone} />
              {patient.email && <Row k="Email" v={patient.email} />}
              <Row k="Date of birth" v={formatDate(patient.dateOfBirth)} />
              <Row k="Record created" v={formatDate(patient.createdAt)} />
            </dl>
            {patient.medicalNotes && (
              <>
                <div className="mt-6 text-xs uppercase tracking-wide text-muted-foreground">Clinical notes</div>
                <p className="mt-2 text-sm leading-relaxed">{patient.medicalNotes}</p>
              </>
            )}
          </GlassCard>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold">Test history</h2>
              <div className="text-xs text-muted-foreground">{tests.length} tests</div>
            </div>
            <div className="grid gap-3">
              {tests.length === 0 && (
                <GlassCard>
                  <div className="text-sm text-muted-foreground">No tests recorded yet.</div>
                </GlassCard>
              )}
              {tests.map((t) => (
                <GlassCard key={t.id}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{formatDateTime(t.startedAt)}</span>
                      <Badge
                        variant="secondary"
                        className={
                          t.pulpVerdict === "vital"
                            ? "bg-teal/15 text-teal"
                            : t.pulpVerdict === "non_vital"
                            ? "bg-destructive/10 text-destructive"
                            : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                        }
                      >
                        {t.pulpVerdict.replace("_", " ")}
                      </Badge>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Tooth {t.toothOfInterest ?? "—"} · {formatDuration(t.summary.durationSec)} · SpO₂ {t.summary.avgSpO2}% · pulse {t.summary.avgPulse} · quality {t.summary.signalQuality}
                    </div>
                    <div className="mt-2 line-clamp-2 max-w-2xl text-sm text-muted-foreground">{t.observations}</div>
                  </div>
                </GlassCard>
              ))}
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="text-right font-medium">{v}</dd>
    </div>
  );
}
