import { AppShell } from "@/components/layout/AppShell";
import { StatusStrip } from "@/components/dashboard/StatusStrip";
import { SensorCard } from "@/components/dashboard/SensorCard";
import { LiveWaveform } from "@/components/dashboard/LiveWaveform";
import { SignalQuality } from "@/components/dashboard/SignalQuality";
import { DeviceStatusCard } from "@/components/dashboard/DeviceStatusCard";
import { TestControls } from "@/components/dashboard/TestControls";
import { TestResultDialog } from "@/components/dashboard/TestResultDialog";
import { GlassCard } from "@/components/common/GlassCard";
import { useLiveSensors, useSystemStatus } from "@/hooks/useLiveSensors";
import { getServices } from "@/services";
import type { StreamOptions } from "@/services/interfaces";
import type { DeviceResultPayload, ReportReading, SensorSample } from "@/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Battery,
  HeartPulse,
  Thermometer,
  Waves,
  WifiOff,
  X,
  Zap,
} from "lucide-react";
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

function playChime(freq = 1000, duration = 0.25) {
  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    oscillator.frequency.value = freq;
    oscillator.type = "sine";
    gainNode.gain.value = 0.25;
    oscillator.start();
    oscillator.stop(audioContext.currentTime + duration);
  } catch {
    // Ignore audio context errors if browser blocks autoplay
  }
}

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
  const [finishing, setFinishing] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [activeTestId, setActiveTestId] = useState<string | null>(null);
  const [lastCompletedTestId, setLastCompletedTestId] = useState<string | null>(null);
  const [latestResult, setLatestResult] = useState<DeviceResultPayload | null>(null);
  const [showResultDialog, setShowResultDialog] = useState(false);
  const [disconnectedAlert, setDisconnectedAlert] = useState(false);

  const samplesRef = useRef<SensorSample[]>([]);
  const reportReadingRef = useRef<ReportReading | null>(null);
  const stopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTelemetryTimeRef = useRef<number>(Date.now());
  const runningRef = useRef(running);
  runningRef.current = running;
  const finishingRef = useRef(finishing);
  finishingRef.current = finishing;
  const activeTestIdRef = useRef(activeTestId);
  activeTestIdRef.current = activeTestId;

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

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (stopTimeoutRef.current) {
        clearTimeout(stopTimeoutRef.current);
      }
    };
  }, []);

  const handleDeviceDisconnected = (reason?: string) => {
    console.warn("Device disconnected mid-test:", reason);
    if (stopTimeoutRef.current) {
      clearTimeout(stopTimeoutRef.current);
      stopTimeoutRef.current = null;
    }
    const currentId = activeTestIdRef.current;
    if (currentId) {
      services.tests.discard(currentId);
    }
    setRunning(false);
    setFinishing(false);
    setActiveTestId(null);
    activeTestIdRef.current = null;
    setStartedAt(null);
    setElapsed(0);
    setDisconnectedAlert(true);
    toast.error("Device disconnected");
  };

  // Stream callbacks for results, command acks, and offline events
  const streamOptions = useMemo<StreamOptions>(
    () => ({
      onResult: async (result) => {
        console.log("Device result message received:", result);
        if (stopTimeoutRef.current) {
          clearTimeout(stopTimeoutRef.current);
          stopTimeoutRef.current = null;
        }

        setFinishing(false);
        setRunning(false);
        setLatestResult(result);
        setShowResultDialog(true);

        const currentActiveTestId = activeTestIdRef.current;
        const finalReportReading: ReportReading = reportReadingRef.current ?? {
          valid: false,
          spo2: 0,
          heartRate: 0,
          temperature: 0,
          signalQuality: 0,
          vitalityStatus: "Inconclusive",
          testDuration: latest?.testDuration ?? 0,
          timestamp: new Date().toISOString(),
          errorMessage: "No valid reading after 20 s. Retry and keep the probe steady.",
        };

        if (result.valid) {
          try {
            const saved = await services.tests.saveResult(
              currentActiveTestId || `test-${Date.now()}`,
              result,
              {
                patientId,
                deviceId,
                toothOfInterest: tooth,
                reportReading: finalReportReading,
              }
            );
            setLastCompletedTestId(saved.id);
            qc.invalidateQueries({ queryKey: ["tests"] });
            toast.success("Test completed and saved to history");
            playChime(1000, 0.3);
          } catch (err) {
            console.error("Failed to save test record:", err);
            toast.error("Failed to save test record");
          }
        } else {
          // If valid is false, do not save as test record
          if (currentActiveTestId) {
            await services.tests.discard(currentActiveTestId);
          }
          toast.error("No valid reading, check probe contact and retry");
        }

        setActiveTestId(null);
        activeTestIdRef.current = null;
      },
      onCommandAck: (ack) => {
        console.log("Device command acknowledgement received:", ack);
      },
      onDeviceOffline: () => {
        if (runningRef.current || finishingRef.current) {
          handleDeviceDisconnected("Device reported offline during test");
        }
      },
    }),
    [services, qc, patientId, deviceId, tooth]
  );

  const { latest, samples, clearSamples } = useLiveSensors(deviceId, true, streamOptions);

  // Track telemetry heartbeat for 10s disconnect watchdog
  useEffect(() => {
    if (latest) {
      lastTelemetryTimeRef.current = Date.now();
    }
  }, [latest]);

  // 10-second watchdog for mid-test offline detection
  useEffect(() => {
    if (!running && !finishing) return;

    const interval = setInterval(() => {
      const now = Date.now();
      if (now - lastTelemetryTimeRef.current >= 10000) {
        handleDeviceDisconnected("No telemetry received for 10 seconds");
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [running, finishing]);

  // Rule 2: Physical START button test detection on device
  const isButtonTesting = latest?.deviceState === "TESTING" && latest?.testSource === "button";

  // Rule 1: Web-started test live values
  const isWebTesting = latest?.deviceState === "TESTING" && latest?.testSource === "web";
  const hasValidReading = (latest?.spo2 ?? 0) > 0 && (latest?.heartRate ?? 0) > 0;

  // Elapsed timer: driven by telemetry testDuration while running, fallback to wall-clock
  useEffect(() => {
    if (!running) return;

    if (latest?.testDuration !== undefined && latest.testDuration > 0) {
      setElapsed(Math.floor(latest.testDuration / 1000));
    } else if (startedAt) {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }
  }, [running, latest?.testDuration, startedAt]);

  // Rules 1, 2, 3: Capture the single report reading strictly after 20 seconds
  // Ignore samples where testDuration < 20000.
  // The report reading is the FIRST sample with testDuration >= 20000 where all of:
  // deviceState == "TESTING", testSource == "web", fingerDetected == true, heartRate > 0, spo2 > 0.
  // Lock it in; later samples do not overwrite it.
  useEffect(() => {
    if (
      running &&
      !reportReadingRef.current &&
      latest &&
      latest.testDuration !== undefined &&
      latest.testDuration >= 20000 &&
      latest.deviceState === "TESTING" &&
      latest.testSource === "web" &&
      latest.fingerDetected === true &&
      (latest.heartRate ?? 0) > 0 &&
      (latest.spo2 ?? 0) > 0
    ) {
      const reading: ReportReading = {
        valid: true,
        spo2: latest.spo2,
        heartRate: latest.heartRate,
        temperature: latest.temperature,
        signalQuality: latest.signalQuality,
        vitalityStatus: latest.vitalityStatus || "vital",
        vitalityIndex: latest.vitalityIndex,
        testDuration: latest.testDuration,
        timestamp: latest.timestamp || new Date().toISOString(),
      };
      reportReadingRef.current = reading;
      samplesRef.current = [latest];
    }
  }, [running, latest]);

  // Beep sound for critical conditions — only when valid reading is present!
  useEffect(() => {
    if (!running || !hasValidReading || !latest) return;

    const isCritical =
      (latest.spo2 > 0 && latest.spo2 < 90) ||
      (latest.heartRate > 0 && (latest.heartRate < 50 || latest.heartRate > 120)) ||
      (latest.temperature > 0 && (latest.temperature < 35.5 || latest.temperature > 38.5)) ||
      (latest.signalQuality > 0 && latest.signalQuality < 45);

    if (isCritical) {
      playChime(800, 0.2);
    }
  }, [running, hasValidReading, latest]);

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
      clearSamples();
      samplesRef.current = [];
      reportReadingRef.current = null;
      setActiveTestId(test.id);
      activeTestIdRef.current = test.id;
      setRunning(true);
      runningRef.current = true;
      setFinishing(false);
      finishingRef.current = false;
      setStartedAt(Date.now());
      setElapsed(0);
      setDisconnectedAlert(false);
      lastTelemetryTimeRef.current = Date.now();
      toast.success("Test started");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not start test"),
  });

  const handleStop = async () => {
    if (!running || !activeTestId || finishing) return;
    setFinishing(true);
    finishingRef.current = true;

    try {
      // Publish stop command to device via MQTT QoS 1
      await services.tests.stop(activeTestId);

      // Start ~5 s timeout for device result message
      stopTimeoutRef.current = setTimeout(() => {
        toast.error("Timeout waiting for test results from device");
        setFinishing(false);
        finishingRef.current = false;
        setRunning(false);
        runningRef.current = false;
        setActiveTestId(null);
        activeTestIdRef.current = null;
      }, 5000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not stop test");
      setFinishing(false);
      finishingRef.current = false;
    }
  };

  const reportMut = useMutation({
    mutationFn: () => services.reports.generate(lastCompletedTestId!, undefined, reportReadingRef.current ?? undefined),
    onSuccess: () => {
      toast.success("Report generated — view it in the Reports section.");
      qc.invalidateQueries({ queryKey: ["reports"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not generate report"),
  });

  const handleRetry = () => {
    setShowResultDialog(false);
    if (!running && !finishing && !startMut.isPending && patientId && deviceId && activeDevice?.online && !isButtonTesting) {
      startMut.mutate();
    }
  };

  const displaySamples = useMemo(() => samples, [samples]);

  return (
    <AppShell>
      <div className="flex flex-col p-3 sm:p-4 lg:p-6 gap-3 sm:gap-4">
        <StatusStrip status={status} />

        {/* Banner: Test running on device via physical button */}
        {isButtonTesting && (
          <div className="flex items-center justify-between rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 text-sm text-amber-800 dark:text-amber-200 shadow-sm animate-in fade-in">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/20 text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <div>
                <span className="font-semibold">Test running on device (button)</span>
                <span className="hidden sm:inline"> — see device screen. Website live readings and history are disabled for on-device tests.</span>
              </div>
            </div>
            <span className="text-xs font-mono font-medium rounded bg-amber-500/20 px-2 py-0.5">Fixed 20s</span>
          </div>
        )}

        {/* Banner: Mid-test Device Disconnection Alert */}
        {disconnectedAlert && !running && (
          <div className="flex items-center justify-between rounded-xl border border-destructive/40 bg-destructive/10 p-3.5 text-sm text-destructive shadow-sm animate-in fade-in">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-destructive/20 text-destructive">
                <WifiOff className="h-4 w-4" />
              </div>
              <div>
                <span className="font-semibold">Device disconnected</span>
                <span> — Mid-test telemetry stopped. The test was ended without saving.</span>
              </div>
            </div>
            <button
              onClick={() => setDisconnectedAlert(false)}
              className="text-xs text-muted-foreground hover:text-foreground p-1 rounded-md"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Banner: Probe contact warning when test is running but no perfusion detected */}
        {running && isWebTesting && !hasValidReading && (
          <div className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300 animate-in fade-in">
            <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <span className="font-semibold">No valid reading right now:</span> Check probe contact on tooth crown. Values reporting 0 are masked until clean optical signal is acquired.
            </div>
          </div>
        )}

        <div className="grid gap-3 lg:grid-cols-[1fr_280px]">
          <div className="flex flex-col gap-3">
            <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              <SensorCard
                label="SpO₂"
                value={running && hasValidReading ? (latest?.spo2 ?? 0) : 0}
                isValid={running && hasValidReading}
                decimals={1}
                suffix="%"
                icon={HeartPulse}
                tint="brand"
                samples={displaySamples}
                metricKey="spo2"
                hint="Peripheral oxygen saturation"
              />
              <SensorCard
                label="Pulse"
                value={running && hasValidReading ? (latest?.heartRate ?? 0) : 0}
                isValid={running && hasValidReading}
                suffix=" bpm"
                icon={Activity}
                tint="teal"
                samples={displaySamples}
                metricKey="heartRate"
                hint="Heart rate"
              />
              <SensorCard
                label="Temperature"
                value={running && (latest?.temperature ?? 0) > 0 ? (latest?.temperature ?? 0) : 0}
                isValid={running && (latest?.temperature ?? 0) > 0}
                decimals={2}
                suffix=" °C"
                icon={Thermometer}
                tint="amber"
                samples={displaySamples}
                metricKey="temperature"
                hint="Ambient / probe"
              />
            </div>
            <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              <SensorCard
                label="Signal Quality"
                value={running && hasValidReading ? (latest?.signalQuality ?? 0) : 0}
                isValid={running && hasValidReading}
                suffix="%"
                icon={Waves}
                tint="rose"
                samples={displaySamples}
                metricKey="signalQuality"
                hint="Signal quality"
              />
              <SensorCard
                label="Vitality Index"
                value={running && hasValidReading ? (latest?.vitalityIndex ?? 0) : 0}
                isValid={running && hasValidReading}
                decimals={1}
                icon={Waves}
                tint="brand"
                samples={displaySamples}
                metricKey="vitalityIndex"
                hint="Vitality index"
              />
              <SensorCard
                label="Battery"
                value={latest?.battery ?? 0}
                isValid={(latest?.battery ?? 0) > 0}
                suffix="%"
                icon={Battery}
                tint="teal"
                samples={displaySamples}
                metricKey="battery"
                hint="Device battery"
              />
            </div>

            <div className="w-full">
              <LiveWaveform samples={displaySamples} />
            </div>

            <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
              <SignalQuality latest={running && hasValidReading ? latest : null} />
              <GlassCard>
                <div className="text-xs text-muted-foreground">Measurement Confidence</div>
                <div className="mt-1 font-display text-2xl font-semibold capitalize">
                  {running && hasValidReading
                    ? latest?.vitalityStatus ?? "—"
                    : running
                    ? "— (Positioning Probe)"
                    : "—"}
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Combines waveform SNR, IR/Red ratio stability, and probe contact quality. Clean
                  optical perfusion ensures accurate diagnosis.
                </p>
                <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                  <Zap className="h-3.5 w-3.5 text-brand" />
                  Live 1-sec device updates · Continuous web test
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
              finishing={finishing}
              isButtonTesting={isButtonTesting}
              elapsedSec={elapsed}
              onStart={() => {
                if (!running && !finishing && !startMut.isPending && !isButtonTesting) {
                  startMut.mutate();
                }
              }}
              onStop={handleStop}
              onGenerateReport={() => reportMut.mutate()}
              canGenerate={!!lastCompletedTestId && !running && !finishing}
            />
          </aside>
        </div>
      </div>

      {/* Result Dialog Modal */}
      <TestResultDialog
        open={showResultDialog}
        onOpenChange={setShowResultDialog}
        result={latestResult}
        patientName={activePatient?.fullName}
        tooth={tooth}
        onGenerateReport={() => reportMut.mutate()}
        onRetry={handleRetry}
      />
    </AppShell>
  );
}
