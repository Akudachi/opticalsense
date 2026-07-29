import { AppShell } from "@/components/layout/AppShell";
import { StatusStrip } from "@/components/dashboard/StatusStrip";
import { SensorCard } from "@/components/dashboard/SensorCard";
import { LiveWaveform } from "@/components/dashboard/LiveWaveform";
import { SignalQuality } from "@/components/dashboard/SignalQuality";
import { DeviceStatusCard } from "@/components/dashboard/DeviceStatusCard";
import { TestControls } from "@/components/dashboard/TestControls";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
import { GlassCard } from "@/components/common/GlassCard";
import { useLiveSensors, useSystemStatus } from "@/hooks/useLiveSensors";
import { getServices } from "@/services";
import type { SensorSample } from "@/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Activity, Battery, HeartPulse, Thermometer, Waves, Zap } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { calcAge } from "@/utils/format";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — OpticalSense" },
      { name: "description", content: "Live optical pulp vitality monitoring dashboard." },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const services = getServices();
  const qc = useQueryClient();
  const status = useSystemStatus();

  const { data: patientsPage } = useQuery({
    queryKey: ["patients", "all"],
    queryFn: () => services.patients.list({ pageSize: 500 }),
  });
  const { data: devices = [] } = useQuery({
    queryKey: ["devices"],
    queryFn: () => services.devices.list(),
  });
  const { data: activity = [] } = useQuery({
    queryKey: ["activity"],
    queryFn: () => services.activity.list(15),
    refetchInterval: 5000,
  });

  const patients = patientsPage?.items ?? [];

  const [patientId, setPatientId] = useState<string | undefined>();
  const [deviceId, setDeviceId] = useState<string | undefined>();
  const [tooth, setTooth] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [activeTestId, setActiveTestId] = useState<string | null>(null);
  const [lastCompletedTestId, setLastCompletedTestId] = useState<string | null>(null);
  const samplesRef = useRef<SensorSample[]>([]);

  // Autoselect first patient + online device
  useEffect(() => {
    if (!patientId && patients.length) setPatientId(patients[0].id);
  }, [patients, patientId]);
  useEffect(() => {
    if (!deviceId && devices.length) {
      const online = devices.find((d) => d.online) ?? devices[0];
      setDeviceId(online.id);
      setTooth(patients.find((p) => p.id === patientId)?.toothOfInterest ?? "");
    }
  }, [devices, deviceId, patientId, patients]);

  useEffect(() => {
    if (patientId) {
      const t = patients.find((p) => p.id === patientId)?.toothOfInterest;
      if (t && !running) setTooth(t);
    }
  }, [patientId, patients, running]);

  const { latest, samples } = useLiveSensors(deviceId, running);

  // Capture samples during a running test
  useEffect(() => {
    if (running && latest) samplesRef.current.push(latest);
  }, [running, latest]);

  // Timer
  useEffect(() => {
    if (!running || !startedAt) return;
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 500);
    return () => clearInterval(id);
  }, [running, startedAt]);

  const activePatient = patients.find((p) => p.id === patientId);
  const activeDevice = devices.find((d) => d.id === deviceId);

  const startMut = useMutation({
    mutationFn: () =>
      services.tests.start({
        patientId: patientId!,
        deviceId: deviceId!,
        toothOfInterest: tooth || undefined,
      }),
    onSuccess: (test) => {
      samplesRef.current = [];
      setActiveTestId(test.id);
      setRunning(true);
      setStartedAt(Date.now());
      setElapsed(0);
      toast.success("Test started");
      qc.invalidateQueries({ queryKey: ["activity"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not start test"),
  });

  const stopMut = useMutation({
    mutationFn: () =>
      services.tests.stop(activeTestId!, {
        samples: samplesRef.current,
        observations: "",
      }),
    onSuccess: (test) => {
      setRunning(false);
      setStartedAt(null);
      setLastCompletedTestId(test.id);
      toast.success(`Test complete — verdict: ${test.pulpVerdict.replace("_", " ")}`);
      qc.invalidateQueries({ queryKey: ["tests"] });
      qc.invalidateQueries({ queryKey: ["activity"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not stop test"),
  });

  const reportMut = useMutation({
    mutationFn: () => services.reports.generate(lastCompletedTestId!),
    onSuccess: () => {
      toast.success("Report generated — view it in the Reports section.");
      qc.invalidateQueries({ queryKey: ["reports"] });
      qc.invalidateQueries({ queryKey: ["activity"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not generate report"),
  });

  const displaySamples = useMemo(() => samples, [samples]);

  return (
    <AppShell>
      <div className="space-y-6">
        <StatusStrip status={status} />

        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <SensorCard label="SpO₂" value={latest?.spo2 ?? 0} decimals={1} suffix="%" icon={HeartPulse} tint="brand" samples={displaySamples} metricKey="spo2" hint="Peripheral oxygen saturation" />
              <SensorCard label="Pulse" value={latest?.pulse ?? 0} suffix=" bpm" icon={Activity} tint="teal" samples={displaySamples} metricKey="pulse" hint="Heart rate" />
              <SensorCard label="Temperature" value={latest?.temperature ?? 0} decimals={2} suffix=" °C" icon={Thermometer} tint="amber" samples={displaySamples} metricKey="temperature" hint="Ambient / probe" />
              <SensorCard label="Red Signal" value={latest?.red ?? 0} icon={Waves} tint="rose" samples={displaySamples} metricKey="red" hint="Raw amplitude" />
              <SensorCard label="IR Signal" value={latest?.ir ?? 0} icon={Waves} tint="brand" samples={displaySamples} metricKey="ir" hint="Raw amplitude" />
              <SensorCard label="Battery" value={latest?.batteryPct ?? 0} suffix="%" icon={Battery} tint="teal" samples={displaySamples} metricKey="batteryPct" hint="Device battery" />
            </div>

            <LiveWaveform samples={displaySamples} />

            <div className="grid gap-4 sm:grid-cols-2">
              <SignalQuality latest={latest} />
              <GlassCard>
                <div className="text-xs text-muted-foreground">Measurement Confidence</div>
                <div className="mt-1 font-display text-2xl font-semibold capitalize">{latest?.confidence ?? "—"}</div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Combines waveform SNR, IR/Red ratio stability, and probe contact quality. High confidence
                  indicates the capture is safe to include in clinical assessment.
                </p>
                <div className="mt-3 flex items-center gap-2 text-xs">
                  <Zap className="h-3.5 w-3.5 text-brand" />
                  Sampling at 10 Hz · window 60 s
                </div>
              </GlassCard>
            </div>
          </div>

          <aside className="space-y-4">
            <DeviceStatusCard device={activeDevice} />

            {activePatient && (
              <GlassCard>
                <div className="text-xs text-muted-foreground">Active Patient</div>
                <div className="mt-0.5 font-medium">{activePatient.fullName}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {calcAge(activePatient.dateOfBirth)} yrs · {activePatient.sex}
                  {activePatient.toothOfInterest && ` · tooth ${activePatient.toothOfInterest}`}
                </div>
                {activePatient.medicalNotes && (
                  <p className="mt-3 line-clamp-4 text-xs text-muted-foreground">{activePatient.medicalNotes}</p>
                )}
              </GlassCard>
            )}

            <TestControls
              patients={patients}
              devices={devices}
              patientId={patientId}
              deviceId={deviceId}
              toothOfInterest={tooth}
              onPatientChange={setPatientId}
              onDeviceChange={setDeviceId}
              onToothChange={setTooth}
              running={running}
              elapsedSec={elapsed}
              onStart={() => startMut.mutate()}
              onStop={() => stopMut.mutate()}
              onGenerateReport={() => reportMut.mutate()}
              canGenerate={!!lastCompletedTestId && !running}
            />

            <ActivityFeed events={activity} />
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
