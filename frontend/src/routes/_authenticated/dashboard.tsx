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
import type { DeviceResultPayload, ReportReading, RunningReportStats, SensorSample } from "@/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Battery,
  Clock,
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
import { getOrComputeIntervals } from "@/utils/excel";

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

const initialReportStats: RunningReportStats = {
  count: 0,
  sumSpo2: 0,
  sumHeartRate: 0,
  sumTemperature: 0,
  sumSignalQuality: 0,
  currentSpo2: 0,
  currentHeartRate: 0,
  currentTemperature: 0,
  currentSignalQuality: 0,
  vitalityStatus: "Inconclusive",
  vitalityIndex: undefined,
  lastTestDuration: 0,
};

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
  const [liveReportStats, setLiveReportStats] = useState<RunningReportStats>({ ...initialReportStats });
  const [finalReportReading, setFinalReportReading] = useState<ReportReading | null>(null);

  const samplesRef = useRef<SensorSample[]>([]);
  const reportStatsRef = useRef<RunningReportStats>({ ...initialReportStats });
  const lastProcessedTelemetryRef = useRef<string | null>(null);
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
    runningRef.current = false;
    setFinishing(false);
    finishingRef.current = false;
    setActiveTestId(null);
    activeTestIdRef.current = null;
    setStartedAt(null);
    setElapsed(0);
    setFinalReportReading(null);
    setDisconnectedAlert(true);
    toast.error("Device disconnected");
  };

  const finalizeTest = async (deviceResult?: DeviceResultPayload | null) => {
    // Only finalize if a test was actually running or finishing
    if (!runningRef.current && !finishingRef.current) return;

    if (stopTimeoutRef.current) {
      clearTimeout(stopTimeoutRef.current);
      stopTimeoutRef.current = null;
    }

    setFinishing(false);
    finishingRef.current = false;
    setRunning(false);
    runningRef.current = false;

    const currentActiveTestId = activeTestIdRef.current;
    const stats = reportStatsRef.current;
    const currentDurationMs =
      latest?.testDuration !== undefined && latest.testDuration > 0
        ? latest.testDuration
        : startedAt
        ? Date.now() - startedAt
        : stats.lastTestDuration;

    // Rule 5: If the test is stopped before 20 s, or fewer than 5 valid samples were collected after 20 s,
    // show "Not enough valid readings. Keep the probe steady and run the test longer." Do not save a record.
    const hasEnoughReadings = currentDurationMs >= 20000 && stats.count >= 5;

    if (hasEnoughReadings) {
      const avgSpo2 = stats.sumSpo2 / stats.count;
      const avgPulse = stats.sumHeartRate / stats.count;
      const avgTemp = stats.sumTemperature / stats.count;
      const avgSignalQuality = Math.round(stats.sumSignalQuality / stats.count);

      const intervals = getOrComputeIntervals({
        samples: samplesRef.current,
        startedAt: startedAt ? new Date(startedAt).toISOString() : new Date().toISOString(),
        summary: {
          avgSpO2: avgSpo2,
          avgPulse: avgPulse,
          avgTemp: avgTemp,
          durationSec: Math.round(currentDurationMs / 1000),
          validReadings: stats.count,
        },
      });

      const reportReading: ReportReading = {
        valid: true,
        spo2: Number(avgSpo2.toFixed(1)),
        heartRate: Math.round(avgPulse),
        temperature: Number(avgTemp.toFixed(2)),
        signalQuality: avgSignalQuality,
        vitalityStatus: stats.vitalityStatus || "Vital",
        vitalityIndex: stats.vitalityIndex,
        testDuration: stats.lastTestDuration || currentDurationMs,
        timestamp: new Date().toISOString(),
        validReadings: stats.count,
        currentSpo2: stats.currentSpo2,
        currentHeartRate: stats.currentHeartRate,
        currentTemperature: stats.currentTemperature,
        currentSignalQuality: stats.currentSignalQuality,
        intervalReadings: intervals,
      };

      const recordPayload: DeviceResultPayload = {
        deviceId: deviceId || "device-1",
        completed: true,
        valid: true,
        spo2: reportReading.spo2,
        heartRate: reportReading.heartRate,
        temperature: reportReading.temperature,
        signalQuality: reportReading.signalQuality,
        vitalityIndex: reportReading.vitalityIndex ?? 1.0,
        vitalityStatus: reportReading.vitalityStatus,
        durationMs: reportReading.testDuration,
        validReadings: reportReading.validReadings,
        timestamp: Date.now(),
      };

      try {
        const saved = await services.tests.saveResult(
          currentActiveTestId || `test-${Date.now()}`,
          recordPayload,
          {
            patientId,
            deviceId,
            toothOfInterest: tooth,
            reportReading,
            samples: samplesRef.current,
          }
        );
        setLastCompletedTestId(saved.id);
        setLatestResult(recordPayload);
        setFinalReportReading(reportReading);
        setShowResultDialog(true);
        qc.invalidateQueries({ queryKey: ["tests"] });

        // Auto-generate report so it is immediately accessible in the Reports section
        try {
          await services.reports.generate(saved.id, undefined, reportReading);
          qc.invalidateQueries({ queryKey: ["reports"] });
        } catch (reportErr) {
          console.warn("Auto report generation notice:", reportErr);
        }

        toast.success("Test completed and report generated");
        playChime(1000, 0.3);
      } catch (err) {
        console.error("Failed to save test record:", err);
        toast.error("Failed to save test record");
      }
    } else {
      // Discard test if stopped before 20s or < 5 valid samples
      if (currentActiveTestId) {
        try {
          await services.tests.discard(currentActiveTestId);
        } catch (err) {
          console.error("Failed to discard invalid test:", err);
        }
      }

      const invalidReading: ReportReading = {
        valid: false,
        spo2: 0,
        heartRate: 0,
        temperature: 0,
        signalQuality: 0,
        vitalityStatus: "Inconclusive",
        testDuration: stats.lastTestDuration || currentDurationMs,
        timestamp: new Date().toISOString(),
        validReadings: stats.count,
        errorMessage: "Not enough valid readings. Keep the probe steady and run the test longer.",
      };

      setLastCompletedTestId(null);
      setLatestResult(null);
      setFinalReportReading(invalidReading);
      setShowResultDialog(true);
      toast.error("Not enough valid readings. Keep the probe steady and run the test longer.");
    }

    setActiveTestId(null);
    activeTestIdRef.current = null;
  };

  const finalizeTestRef = useRef(finalizeTest);
  finalizeTestRef.current = finalizeTest;

  // Stream callbacks for results, command acks, and offline events
  const streamOptions = useMemo<StreamOptions>(
    () => ({
      onResult: async (result) => {
        // Rule 8: Do not use the /result topic for report values. You may still use it to confirm the test ended.
        console.log("Device result message received (confirming test ended):", result);
        finalizeTestRef.current(result);
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
    []
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

  const currentDurationMs =
    latest?.testDuration !== undefined && latest.testDuration > 0
      ? latest.testDuration
      : startedAt
      ? Date.now() - startedAt
      : 0;
  const isWarmingUp = running && isWebTesting && currentDurationMs < 20000;
  const warmupRemainingSec = Math.max(1, Math.ceil((20000 - currentDurationMs) / 1000));

  // Rules 1, 2, 6, 7: Continuous calculation of report values from 20s onward
  // - Warm-up: ignore samples with testDuration < 20000 for the report.
  // - From 20s onward, on EVERY valid telemetry message (deviceState == "TESTING", testSource == "web",
  //   fingerDetected == true, heartRate > 0, spo2 > 0), update report values.
  // - Maintain running sums/counts of valid samples since 20s.
  // - Skip invalid samples (zeros). Do not store them and do not reset averages.
  // - Ignore telemetry with testSource == "button".
  useEffect(() => {
    if (!running || !latest) return;
    if (latest.testSource === "button") return;
    if (latest.deviceState !== "TESTING" || latest.testSource !== "web") return;

    const testDuration =
      latest.testDuration !== undefined && latest.testDuration > 0
        ? latest.testDuration
        : startedAt
        ? Date.now() - startedAt
        : 0;

    // Deduplicate identical telemetry messages if triggered multiple times
    const sampleKey = `${testDuration}-${latest.timestamp}-${latest.spo2}-${latest.heartRate}-${latest.temperature}`;
    if (lastProcessedTelemetryRef.current === sampleKey) return;
    lastProcessedTelemetryRef.current = sampleKey;

    // Record every telemetry sample for the full continuous test log & 20s interval slices
    const sampleRecord: SensorSample = {
      ...latest,
      testDuration,
      timestamp: latest.timestamp || new Date().toISOString(),
    };
    samplesRef.current.push(sampleRecord);

    // 1. Warm-up: ignore samples with testDuration < 20000 for the running report averages
    if (testDuration < 20000) return;

    // 2. Validate sample: fingerDetected == true, heartRate > 0, spo2 > 0
    const isValidSample =
      latest.fingerDetected === true &&
      (latest.heartRate ?? 0) > 0 &&
      (latest.spo2 ?? 0) > 0;

    // Skip invalid samples (zeros). Do not store them and do not reset the averages.
    if (!isValidSample) return;

    const prev = reportStatsRef.current;
    const newCount = prev.count + 1;
    const newSumSpo2 = prev.sumSpo2 + latest.spo2;
    const newSumHeartRate = prev.sumHeartRate + latest.heartRate;
    const newSumTemp = prev.sumTemperature + (latest.temperature ?? 0);
    const newSumSig = prev.sumSignalQuality + (latest.signalQuality ?? 0);

    const updated: RunningReportStats = {
      count: newCount,
      sumSpo2: newSumSpo2,
      sumHeartRate: newSumHeartRate,
      sumTemperature: newSumTemp,
      sumSignalQuality: newSumSig,
      currentSpo2: latest.spo2,
      currentHeartRate: latest.heartRate,
      currentTemperature: latest.temperature ?? 0,
      currentSignalQuality: latest.signalQuality ?? 0,
      vitalityStatus: latest.vitalityStatus || prev.vitalityStatus || "Vital",
      vitalityIndex: latest.vitalityIndex ?? prev.vitalityIndex,
      lastTestDuration: testDuration,
    };

    reportStatsRef.current = updated;
    setLiveReportStats(updated);
  }, [running, latest, startedAt]);

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
      reportStatsRef.current = { ...initialReportStats };
      setLiveReportStats({ ...initialReportStats });
      setFinalReportReading(null);
      setLatestResult(null);
      setLastCompletedTestId(null);
      lastProcessedTelemetryRef.current = null;
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
      // Publish stop command to device via MQTT QoS 1: {"command":"stop_test","testId":"<id>"}
      await services.tests.stop(activeTestId);

      // Rule 8: Do not use the /result topic for report values. You may still use it to confirm the test ended.
      // Wait up to 5s for confirmation, then finalize directly with accumulated report averages.
      stopTimeoutRef.current = setTimeout(() => {
        console.warn("Device confirmation timed out after 5s. Finalizing with accumulated report values.");
        finalizeTest(null);
      }, 5000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not stop test");
      setFinishing(false);
      finishingRef.current = false;
    }
  };

  const reportMut = useMutation({
    mutationFn: () => services.reports.generate(lastCompletedTestId!, undefined, finalReportReading ?? undefined),
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

        {/* Banner: Warm-up period (< 20s) */}
        {isWarmingUp && (
          <div className="flex items-center justify-between rounded-xl border border-sky-500/30 bg-sky-500/10 p-3.5 text-sm text-sky-900 dark:text-sky-200 shadow-sm animate-in fade-in">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/20 text-sky-600 dark:text-sky-400">
                <Clock className="h-4 w-4 animate-spin" />
              </div>
              <div>
                <span className="font-semibold">Stabilising... {warmupRemainingSec}s</span>
                <span className="hidden sm:inline"> — Ignore early probe positioning. Continuous report averaging will begin at 20 seconds.</span>
              </div>
            </div>
            <span className="text-xs font-mono font-medium rounded bg-sky-500/20 px-2.5 py-1">
              Warm-up {Math.floor(currentDurationMs / 1000)}s / 20s
            </span>
          </div>
        )}

        <div className="grid gap-3 lg:grid-cols-[1fr_280px]">
          <div className="flex flex-col gap-3">
            {/* Live Continuous Assessment & Report Calculation Card */}
            {running && isWebTesting && (
              <GlassCard className="border-brand/30 bg-card/75 shadow-sm overflow-hidden p-3.5 sm:p-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-border/50">
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                        isWarmingUp
                          ? "bg-sky-500/15 text-sky-600 dark:text-sky-400"
                          : "bg-teal/15 text-teal"
                      }`}
                    >
                      {isWarmingUp ? (
                        <Clock className="h-4 w-4 animate-spin" />
                      ) : (
                        <Activity className="h-4 w-4 animate-pulse" />
                      )}
                    </div>
                    <div>
                      <div className="font-semibold text-sm">
                        {isWarmingUp ? `Stabilising... ${warmupRemainingSec}s` : "Continuous Report Calculation (Post-20s)"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {isWarmingUp
                          ? "Warm-up phase in progress. Live report averages will start accumulating at 20s until you click Stop."
                          : `Continuously updating report averages on every valid message · ${liveReportStats.count} valid sample${
                              liveReportStats.count === 1 ? "" : "s"
                            } recorded`}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {isWarmingUp ? (
                      <span className="rounded-md bg-sky-500/20 px-2.5 py-1 text-xs font-semibold text-sky-700 dark:text-sky-300">
                        Stabilising... {warmupRemainingSec}s
                      </span>
                    ) : liveReportStats.count < 5 ? (
                      <span className="rounded-md bg-amber-500/20 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:text-amber-300">
                        Collecting ({liveReportStats.count}/5 min required)
                      </span>
                    ) : (
                      <span className="rounded-md bg-teal/20 px-2.5 py-1 text-xs font-semibold text-teal">
                        Ready ({liveReportStats.count} samples · safe to stop)
                      </span>
                    )}
                  </div>
                </div>

                {!isWarmingUp && (
                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <div className="rounded-lg border border-border/50 bg-background/50 p-2.5">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>SpO₂</span>
                        <span className="text-[10px] font-mono text-muted-foreground">CURRENT / AVG</span>
                      </div>
                      <div className="mt-1 flex items-baseline gap-2">
                        <span className="font-display text-lg font-bold text-foreground">
                          {liveReportStats.currentSpo2 > 0 ? `${liveReportStats.currentSpo2.toFixed(1)}%` : "--"}
                        </span>
                        <span className="text-xs text-brand font-semibold">
                          avg {liveReportStats.count > 0 ? `${(liveReportStats.sumSpo2 / liveReportStats.count).toFixed(1)}%` : "--"}
                        </span>
                      </div>
                    </div>

                    <div className="rounded-lg border border-border/50 bg-background/50 p-2.5">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Pulse</span>
                        <span className="text-[10px] font-mono text-muted-foreground">CURRENT / AVG</span>
                      </div>
                      <div className="mt-1 flex items-baseline gap-2">
                        <span className="font-display text-lg font-bold text-foreground">
                          {liveReportStats.currentHeartRate > 0 ? `${Math.round(liveReportStats.currentHeartRate)}` : "--"}
                        </span>
                        <span className="text-xs text-teal font-semibold">
                          avg {liveReportStats.count > 0 ? `${Math.round(liveReportStats.sumHeartRate / liveReportStats.count)} bpm` : "--"}
                        </span>
                      </div>
                    </div>

                    <div className="rounded-lg border border-border/50 bg-background/50 p-2.5">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Temperature</span>
                        <span className="text-[10px] font-mono text-muted-foreground">CURRENT / AVG</span>
                      </div>
                      <div className="mt-1 flex items-baseline gap-2">
                        <span className="font-display text-lg font-bold text-foreground">
                          {liveReportStats.currentTemperature > 0 ? `${liveReportStats.currentTemperature.toFixed(1)}°C` : "--"}
                        </span>
                        <span className="text-xs text-amber-600 dark:text-amber-400 font-semibold">
                          avg {liveReportStats.count > 0 ? `${(liveReportStats.sumTemperature / liveReportStats.count).toFixed(2)}°C` : "--"}
                        </span>
                      </div>
                    </div>

                    <div className="rounded-lg border border-border/50 bg-background/50 p-2.5">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Signal Quality</span>
                        <span className="text-[10px] font-mono text-muted-foreground">CURRENT / AVG</span>
                      </div>
                      <div className="mt-1 flex items-baseline gap-2">
                        <span className="font-display text-lg font-bold text-foreground">
                          {liveReportStats.currentSignalQuality > 0 ? `${Math.round(liveReportStats.currentSignalQuality)}%` : "--"}
                        </span>
                        <span className="text-xs text-rose-500 font-semibold">
                          avg {liveReportStats.count > 0 ? `${Math.round(liveReportStats.sumSignalQuality / liveReportStats.count)}%` : "--"}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </GlassCard>
            )}

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
              canGenerate={!!lastCompletedTestId && !running && !finishing && (finalReportReading?.valid ?? false)}
            />
          </aside>
        </div>
      </div>

      {/* Result Dialog Modal */}
      <TestResultDialog
        open={showResultDialog}
        onOpenChange={setShowResultDialog}
        result={latestResult}
        reportReading={finalReportReading}
        patientName={activePatient?.fullName}
        tooth={tooth}
        onGenerateReport={() => reportMut.mutate()}
        onRetry={handleRetry}
      />
    </AppShell>
  );
}
