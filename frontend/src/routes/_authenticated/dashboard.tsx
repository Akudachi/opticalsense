import { AppShell } from "@/components/layout/AppShell";
import { StatusStrip } from "@/components/dashboard/StatusStrip";
import { SensorCard } from "@/components/dashboard/SensorCard";
import { LiveWaveform } from "@/components/dashboard/LiveWaveform";
import { SignalQuality } from "@/components/dashboard/SignalQuality";
import { DeviceStatusCard } from "@/components/dashboard/DeviceStatusCard";
import { TestControls } from "@/components/dashboard/TestControls";
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
    refetchInterval: 3000, // Refresh every 3 seconds to pick up online/offline status changes
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

  const { latest, samples } = useLiveSensors(deviceId, true); // Always subscribe to show live sensor data

  // Capture samples during a running test
  useEffect(() => {
    if (running && latest) samplesRef.current.push(latest);
  }, [running, latest]);

  // Beep sound for critical conditions
  useEffect(() => {
    if (!running || !latest) return;
    
    const isCritical = 
      latest.spo2 < 90 ||
      latest.heartRate < 60 || latest.heartRate > 100 ||
      latest.temperature < 36 || latest.temperature > 38 ||
      latest.signalQuality < 50;
    
    if (isCritical) {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.value = 800; // 800 Hz beep
      oscillator.type = 'sine';
      gainNode.gain.value = 0.3;
      
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.2); // 0.2 second beep
    }
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
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not start test"),
  });

  const stopMut = useMutation({
    mutationFn: () =>
      services.tests.stop(activeTestId!, {
        samples: samplesRef.current,
      }),
    onSuccess: (test) => {
      setRunning(false);
      setLastCompletedTestId(test.id);
      setActiveTestId(null);
      setStartedAt(null);
      setElapsed(0);
      toast.success("Test stopped");
      qc.invalidateQueries({ queryKey: ["tests"] });
      
      // Play beep sound on test completion
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.value = 1000; // 1000 Hz beep
      oscillator.type = 'sine';
      gainNode.gain.value = 0.3;
      
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.3); // 0.3 second beep
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not stop test"),
  });

  const reportMut = useMutation({
    mutationFn: () => services.reports.generate(lastCompletedTestId!),
    onSuccess: () => {
      toast.success("Report generated — view it in the Reports section.");
      qc.invalidateQueries({ queryKey: ["reports"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not generate report"),
  });

  const displaySamples = useMemo(() => samples, [samples]);

  return (
    <AppShell>
      <div className="h-full flex flex-col p-4 gap-3 overflow-y-auto">
        <StatusStrip status={status} />

        <div className="grid gap-3 lg:grid-cols-[1fr_280px]">
          <div className="flex flex-col gap-3">
            <div className="grid gap-2 grid-cols-3">
              <SensorCard label="SpO₂" value={latest?.spo2 ?? 0} decimals={1} suffix="%" icon={HeartPulse} tint="brand" samples={displaySamples} metricKey="spo2" hint="Peripheral oxygen saturation" />
              <SensorCard label="Pulse" value={latest?.heartRate ?? 0} suffix=" bpm" icon={Activity} tint="teal" samples={displaySamples} metricKey="heartRate" hint="Heart rate" />
              <SensorCard label="Temperature" value={latest?.temperature ?? 0} decimals={2} suffix=" °C" icon={Thermometer} tint="amber" samples={displaySamples} metricKey="temperature" hint="Ambient / probe" />
            </div>
            <div className="grid gap-2 grid-cols-3">
              <SensorCard label="Signal Quality" value={latest?.signalQuality ?? 0} suffix="%" icon={Waves} tint="rose" samples={displaySamples} metricKey="signalQuality" hint="Signal quality" />
              <SensorCard label="Vitality Index" value={latest?.vitalityIndex ?? 0} decimals={1} icon={Waves} tint="brand" samples={displaySamples} metricKey="vitalityIndex" hint="Vitality index" />
              <SensorCard label="Battery" value={latest?.battery ?? 0} suffix="%" icon={Battery} tint="teal" samples={displaySamples} metricKey="battery" hint="Device battery" />
            </div>

            <div className="h-96">
              <LiveWaveform samples={displaySamples} />
            </div>

            <div className="grid gap-2 grid-cols-2">
              <SignalQuality latest={latest} />
              <GlassCard>
                <div className="text-xs text-muted-foreground">Measurement Confidence</div>
                <div className="mt-1 font-display text-2xl font-semibold capitalize">{latest?.vitalityStatus ?? "—"}</div>
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

          <aside className="flex flex-col gap-3">
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
              onStart={() => { if (!running && !startMut.isPending) startMut.mutate(); }}
              onStop={() => { if (running && activeTestId && !stopMut.isPending) stopMut.mutate(); }}
              onGenerateReport={() => reportMut.mutate()}
              canGenerate={!!lastCompletedTestId && !running}
            />
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
