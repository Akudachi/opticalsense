import { STORAGE_KEYS } from "@/config/constants";
import type {
  IActivityService,
  IAuthService,
  IClinicService,
  IDeviceService,
  IPatientService,
  IReportService,
  ISensorStream,
  ITestService,
  StreamOptions,
} from "@/services/interfaces";
import type {
  ActivityEvent,
  Clinic,
  Device,
  Paged,
  Patient,
  Report,
  ReportReading,
  SensorSample,
  SystemStatus,
  Test,
  User,
} from "@/types";
import { mockDb, SEED } from "./db";
import { delay, storage, uid } from "./storage";

const DEMO_DOCTOR: User = {
  id: SEED.DOCTOR_ID,
  email: "doctor@opticalsense.io",
  fullName: "Dr. Priya Kaur",
  role: "doctor",
  clinicId: SEED.CLINIC_ID,
};

// ── Auth ────────────────────────────────────────────────────────────────────
export const mockAuth: IAuthService = {
  async login(email, password) {
    await delay(400);
    if (!email || !password) throw new Error("Email and password are required");
    if (password.length < 4) throw new Error("Invalid credentials");
    const user: User = { ...DEMO_DOCTOR, email };
    storage.set(STORAGE_KEYS.AUTH, user);
    return user;
  },
  async logout() {
    storage.remove(STORAGE_KEYS.AUTH);
  },
  currentUser() {
    return storage.get<User | null>(STORAGE_KEYS.AUTH, null);
  },
  async updateProfile(patch) {
    await delay(120);
    const current = storage.get<User | null>(STORAGE_KEYS.AUTH, null);
    if (!current) throw new Error("Not signed in");
    const next: User = { ...current, ...patch };
    storage.set(STORAGE_KEYS.AUTH, next);
    return next;
  },
};

// ── Patients ────────────────────────────────────────────────────────────────
export const mockPatients: IPatientService = {
  async list({ search = "", page = 1, pageSize = 10 } = {}) {
    mockDb.init();
    await delay(120);
    const term = search.trim().toLowerCase();
    const all = term
      ? mockDb.patients.filter(
          (p) =>
            p.fullName.toLowerCase().includes(term) ||
            p.phone.toLowerCase().includes(term) ||
            (p.email ?? "").toLowerCase().includes(term) ||
            (p.toothOfInterest ?? "").includes(term),
        )
      : mockDb.patients;
    const start = (page - 1) * pageSize;
    return {
      items: all.slice(start, start + pageSize),
      total: all.length,
      page,
      pageSize,
    } satisfies Paged<Patient>;
  },
  async get(id) {
    mockDb.init();
    await delay(80);
    return mockDb.patients.find((p) => p.id === id) ?? null;
  },
  async create(input) {
    mockDb.init();
    await delay(180);
    const now = new Date().toISOString();
    const patient: Patient = {
      id: uid("pat"),
      clinicId: SEED.CLINIC_ID,
      createdAt: now,
      updatedAt: now,
      ...input,
    };
    mockDb.patients.unshift(patient);
    mockDb.savePatients();
    return patient;
  },
  async update(id, input) {
    mockDb.init();
    await delay(160);
    const i = mockDb.patients.findIndex((p) => p.id === id);
    if (i < 0) throw new Error("Patient not found");
    mockDb.patients[i] = { ...mockDb.patients[i], ...input, updatedAt: new Date().toISOString() };
    mockDb.savePatients();
    return mockDb.patients[i];
  },
  async remove(id) {
    mockDb.init();
    await delay(140);
    mockDb.patients = mockDb.patients.filter((p) => p.id !== id);
    mockDb.savePatients();
  },
};

// ── Tests ───────────────────────────────────────────────────────────────────
function summarize(samples: SensorSample[], durationSec: number) {
  if (!samples.length) {
    return {
      avgSpO2: 0, avgPulse: 0, avgTemp: 0, minSpO2: 0, maxPulse: 0,
      signalQuality: 0, confidence: "low" as const, durationSec,
    };
  }
  const avg = (fn: (s: SensorSample) => number) => samples.reduce((s, x) => s + fn(x), 0) / samples.length;
  const avgSpO2 = +avg((s) => s.spo2).toFixed(1);
  const avgPulse = Math.round(avg((s) => s.heartRate ?? s.pulse ?? 70));
  const avgTemp = +avg((s) => s.temperature).toFixed(2);
  const signalQuality = Math.round(avg((s) => s.signalQuality));
  return {
    avgSpO2, avgPulse, avgTemp,
    minSpO2: +Math.min(...samples.map((s) => s.spo2)).toFixed(1),
    maxPulse: Math.round(Math.max(...samples.map((s) => s.heartRate ?? s.pulse ?? 70))),
    signalQuality,
    confidence: (signalQuality > 82 ? "high" : signalQuality > 68 ? "medium" : "low") as "low" | "medium" | "high",
    durationSec,
  };
}

function deriveVerdict(summary: ReturnType<typeof summarize>): Test["pulpVerdict"] {
  if (summary.confidence === "low") return "inconclusive";
  if (summary.avgSpO2 >= 94 && summary.avgPulse >= 50 && summary.avgPulse <= 110) return "vital";
  return "non_vital";
}

export const mockTests: ITestService = {
  async list({ patientId, page = 1, pageSize = 20 } = {}) {
    mockDb.init();
    await delay(120);
    const all = patientId ? mockDb.tests.filter((t) => t.patientId === patientId) : mockDb.tests;
    const start = (page - 1) * pageSize;
    return { items: all.slice(start, start + pageSize), total: all.length, page, pageSize };
  },
  async get(id) {
    mockDb.init();
    await delay(80);
    return mockDb.tests.find((t) => t.id === id) ?? null;
  },
  async start({ patientId, deviceId, toothOfInterest }) {
    mockDb.init();
    await delay(140);
    const test: Test = {
      id: uid("test"),
      clinicId: SEED.CLINIC_ID,
      patientId,
      deviceId,
      doctorId: SEED.DOCTOR_ID,
      startedAt: new Date().toISOString(),
      status: "in_progress",
      toothOfInterest,
      samples: [],
      summary: summarize([], 0),
      observations: "",
      pulpVerdict: "inconclusive",
    };
    mockDb.tests.unshift(test);
    mockDb.saveTests();
    mockDb.activity.unshift({
      id: uid("act"),
      at: test.startedAt,
      kind: "test_started",
      message: `Test started (${toothOfInterest ? "tooth " + toothOfInterest : "no tooth"})`,
      refId: test.id,
    });
    mockDb.saveActivity();
    return test;
  },
  async stop(id, payload) {
    mockDb.init();
    await delay(160);
    const { samples = [], observations } = payload || {};
    const i = mockDb.tests.findIndex((t) => t.id === id);
    if (i < 0) throw new Error("Test not found");
    const endedAt = new Date().toISOString();
    const durationSec = Math.max(1, Math.round((new Date(endedAt).getTime() - new Date(mockDb.tests[i].startedAt).getTime()) / 1000));
    const summary = summarize(samples, durationSec);
    mockDb.tests[i] = {
      ...mockDb.tests[i],
      status: "completed",
      endedAt,
      samples,
      summary,
      observations: observations ?? mockDb.tests[i].observations,
      pulpVerdict: deriveVerdict(summary),
    };
    mockDb.saveTests();
    mockDb.activity.unshift({
      id: uid("act"),
      at: endedAt,
      kind: "test_stopped",
      message: `Test completed — verdict: ${mockDb.tests[i].pulpVerdict.replace("_", " ")}`,
      refId: id,
    });
    mockDb.saveActivity();
    return mockDb.tests[i];
  },
  async saveResult(id, result, metadata) {
    mockDb.init();
    await delay(120);
    const reading = metadata?.reportReading;
    const avgSpO2 = reading?.valid ? reading.spo2 : (result.finalSpo2 ?? result.spo2 ?? 0);
    const avgPulse = reading?.valid ? reading.heartRate : (result.finalHeartRate ?? result.heartRate ?? 0);
    const avgTemp = reading?.valid ? reading.temperature : (result.finalTemperature ?? result.temperature ?? 0);
    const signalQuality = reading?.valid ? reading.signalQuality : (result.signalQuality ?? 0);
    const vitalityStatus = reading?.valid ? reading.vitalityStatus : result.vitalityStatus;
    const durationSec = reading?.testDuration
      ? Math.round(reading.testDuration / 1000)
      : (result.durationMs ? Math.round(result.durationMs / 1000) : 0);
    const validReadings = reading?.validReadings ?? result.validReadings ?? 0;
    const endedAt = new Date().toISOString();

    let verdict: Test['pulpVerdict'] = 'inconclusive';
    const sLower = (vitalityStatus || '').toLowerCase();
    if (sLower.includes('non')) verdict = 'non_vital';
    else if (sLower.includes('vital')) verdict = 'vital';

    const summary = {
      avgSpO2,
      avgPulse,
      avgTemp,
      minSpO2: avgSpO2,
      maxPulse: avgPulse,
      signalQuality,
      confidence: signalQuality > 75 ? 'high' as const : 'medium' as const,
      durationSec,
      vitalityIndex: reading?.vitalityIndex ?? result.vitalityIndex,
      vitalityStatus,
      valid: reading ? reading.valid : result.valid,
      validReadings,
    };

    const post20sSamples: SensorSample[] = metadata?.samples && metadata.samples.length > 0
      ? metadata.samples
      : metadata?.reportReading?.valid
      ? [
          {
            deviceId: result.deviceId || metadata?.deviceId || "device-1",
            timestamp: metadata.reportReading.timestamp,
            battery: 100,
            temperature: metadata.reportReading.temperature,
            heartRate: metadata.reportReading.heartRate,
            spo2: metadata.reportReading.spo2,
            signalQuality: metadata.reportReading.signalQuality,
            vitalityStatus: metadata.reportReading.vitalityStatus,
            vitalityIndex: metadata.reportReading.vitalityIndex,
            testDuration: metadata.reportReading.testDuration,
          },
        ]
      : [];

    const i = mockDb.tests.findIndex((t) => t.id === id);
    if (i >= 0) {
      mockDb.tests[i] = {
        ...mockDb.tests[i],
        status: "completed",
        endedAt,
        summary,
        pulpVerdict: verdict,
        valid: summary.valid,
        reportReading: metadata?.reportReading,
        samples: post20sSamples,
      };
      mockDb.saveTests();
      return mockDb.tests[i];
    }

    const newTest: Test = {
      id,
      clinicId: SEED.CLINIC_ID,
      patientId: metadata?.patientId || "patient-1",
      deviceId: result.deviceId || metadata?.deviceId || "device-1",
      doctorId: SEED.DOCTOR_ID,
      startedAt: new Date(Date.now() - (result.durationMs || 10000)).toISOString(),
      endedAt,
      status: "completed",
      toothOfInterest: metadata?.toothOfInterest,
      samples: post20sSamples,
      summary,
      observations: metadata?.observations || "",
      pulpVerdict: verdict,
      valid: summary.valid,
      reportReading: metadata?.reportReading,
    };
    mockDb.tests.unshift(newTest);
    mockDb.saveTests();
    return newTest;
  },
  async discard(id) {
    mockDb.init();
    await delay(50);
    mockDb.tests = mockDb.tests.filter((t) => t.id !== id);
    mockDb.saveTests();
  },
  async update(id, input) {
    mockDb.init();
    await delay(120);
    const i = mockDb.tests.findIndex((t) => t.id === id);
    if (i < 0) throw new Error("Test not found");
    mockDb.tests[i] = { ...mockDb.tests[i], ...input };
    mockDb.saveTests();
    return mockDb.tests[i];
  },
  async remove(id) {
    mockDb.init();
    await delay(120);
    mockDb.tests = mockDb.tests.filter((t) => t.id !== id);
    mockDb.saveTests();
  },
};

// ── Reports ─────────────────────────────────────────────────────────────────
export const mockReports: IReportService = {
  async list({ patientId } = {}) {
    mockDb.init();
    await delay(120);
    return patientId ? mockDb.reports.filter((r) => r.patientId === patientId) : mockDb.reports;
  },
  async get(id) {
    mockDb.init();
    await delay(80);
    return mockDb.reports.find((r) => r.id === id) ?? null;
  },
  async generate(testId, aiAnalysis, reading) {
    mockDb.init();
    await delay(180);
    const test = mockDb.tests.find((t) => t.id === testId);
    if (!test) throw new Error("Test not found");
    const existing = mockDb.reports.find((r) => r.testId === testId);
    if (existing && !reading) return existing;

    // Pick the report reading taken after first 20s (never use /result average)
    let reportReading: ReportReading;
    if (reading) {
      reportReading = reading;
    } else if (test.reportReading) {
      reportReading = test.reportReading;
    } else {
      const validSample = test.samples.find(
        (s) => (s.testDuration ?? 0) >= 20000 && (s.heartRate ?? 0) > 0 && (s.spo2 ?? 0) > 0
      );
      if (validSample) {
        reportReading = {
          valid: true,
          spo2: validSample.spo2,
          heartRate: validSample.heartRate,
          temperature: validSample.temperature,
          signalQuality: validSample.signalQuality,
          vitalityStatus: validSample.vitalityStatus || (test.pulpVerdict === "non_vital" ? "Non-Vital" : "Vital"),
          vitalityIndex: validSample.vitalityIndex,
          testDuration: validSample.testDuration ?? 20000,
          timestamp: validSample.timestamp,
          validReadings: test.summary.validReadings ?? 5,
        };
      } else {
        reportReading = {
          valid: false,
          spo2: 0,
          heartRate: 0,
          temperature: 0,
          signalQuality: 0,
          vitalityStatus: "Inconclusive",
          testDuration: 0,
          timestamp: new Date().toISOString(),
          validReadings: 0,
          errorMessage: "Not enough valid readings. Keep the probe steady and run the test longer.",
        };
      }
    }

    const report: Report = {
      id: uid("rep"),
      testId,
      patientId: test.patientId,
      clinicId: SEED.CLINIC_ID,
      generatedAt: new Date().toISOString(),
      aiAnalysis,
      reading: reportReading,
      valid: reportReading.valid,
      errorMessage: reportReading.errorMessage,
    };
    mockDb.reports.unshift(report);
    mockDb.activity.unshift({
      id: uid("act"),
      at: report.generatedAt,
      kind: "report_generated",
      message: `Report generated for test ${test.id}`,
      refId: report.id,
    });
    mockDb.saveActivity();
    mockDb.saveReports();
    return report;
  },
  async remove(id) {
    mockDb.init();
    await delay(120);
    mockDb.reports = mockDb.reports.filter((r) => r.id !== id);
    mockDb.saveReports();
    return true;
  },
};

// ── Devices ─────────────────────────────────────────────────────────────────
export const mockDevices: IDeviceService = {
  async list() {
    mockDb.init();
    await delay(120);
    return mockDb.devices;
  },
  async get(id) {
    mockDb.init();
    await delay(80);
    return mockDb.devices.find((d) => d.id === id) ?? null;
  },
  async pair(code) {
    mockDb.init();
    await delay(600);
    if (!/^\d{6}$/.test(code)) throw new Error("Pairing code must be 6 digits");
    const dev: Device = {
      id: uid("dev"),
      clinicId: SEED.CLINIC_ID,
      name: `Operatory · New (${code})`,
      deviceId: `OS-ESP32-${code}`,
      firmware: "1.4.2",
      online: true,
      wifi: { ssid: "Northlake-Clinical", rssi: -55, connected: true },
      mqtt: "connected",
      batteryPct: 95,
      signalStrength: 88,
      lastSeen: new Date().toISOString(),
      pairedAt: new Date().toISOString(),
    };
    mockDb.devices.push(dev);
    mockDb.saveDevices();
    mockDb.activity.unshift({
      id: uid("act"),
      at: dev.pairedAt || new Date().toISOString(),
      kind: "device_paired",
      message: `Device ${dev.deviceId} paired successfully`,
      refId: dev.id,
    });
    mockDb.saveActivity();
    return dev;
  },
  async unpair(id) {
    mockDb.init();
    await delay(160);
    mockDb.devices = mockDb.devices.filter((d) => d.id !== id);
    mockDb.saveDevices();
  },
  async refresh(id) {
    mockDb.init();
    await delay(200);
    const d = mockDb.devices.find((x) => x.id === id);
    if (!d) throw new Error("Device not found");
    d.lastSeen = new Date().toISOString();
    d.signalStrength = Math.min(100, (d.signalStrength ?? 80) + Math.floor(Math.random() * 5));
    mockDb.saveDevices();
    return d;
  },
  async repair(id) {
    mockDb.init();
    await delay(200);
    const d = mockDb.devices.find((x) => x.id === id);
    if (!d) throw new Error("Device not found");
    d.online = true;
    d.status = "online";
    d.lastSeen = new Date().toISOString();
    mockDb.saveDevices();
    return d;
  },
};

// ── Clinic ──────────────────────────────────────────────────────────────────
export const mockClinic: IClinicService = {
  async get() {
    mockDb.init();
    await delay(80);
    return mockDb.clinic;
  },
  async update(input) {
    mockDb.init();
    await delay(160);
    mockDb.clinic = { ...mockDb.clinic, ...input };
    mockDb.saveClinic();
    return mockDb.clinic;
  },
};

// ── Activity ────────────────────────────────────────────────────────────────
export const mockActivity: IActivityService = {
  async list(limit = 25) {
    mockDb.init();
    await delay(80);
    return mockDb.activity.slice(0, limit);
  },
  async push(event) {
    mockDb.init();
    const e: ActivityEvent = { id: uid("act"), at: new Date().toISOString(), ...event };
    mockDb.activity.unshift(e);
    mockDb.saveActivity();
    return e;
  },
};

// ── Sensor stream (simulated PPG) ───────────────────────────────────────────
class MockSensorStream implements ISensorStream {
  private status: SystemStatus = {
    connected: true,
    devicesOnline: 1,
    lastUpdate: new Date().toISOString(),
    backend: "connected",
    mqtt: "connected",
    database: "connected",
    device: "connected",
  };
  private statusCbs = new Set<(s: SystemStatus) => void>();
  private subs = new Map<string, { cb: (s: SensorSample) => void; started: number; timer: ReturnType<typeof setInterval> }>();

  subscribe(deviceId: string, onSample: (s: SensorSample) => void, options?: StreamOptions) {
    const started = performance.now();
    let i = 0;
    let hrTarget = 74;
    let hr = 74;
    const spo2Base = 97 + Math.random() * 1.5;
    const timer = setInterval(() => {
      i++;
      // gentle HR wander
      if (i % 40 === 0) hrTarget = 68 + Math.random() * 22;
      hr += (hrTarget - hr) * 0.05;
      const t = performance.now() - started;
      const phase = (t / 1000) * (hr / 60) * Math.PI * 2;
      const beat = Math.sin(phase) * 0.6 + Math.sin(phase * 2) * 0.15;
      const noise = (Math.random() - 0.5) * 0.06;
      const ir = 42000 + beat * 3200 + noise * 400;
      const red = 28000 + beat * 2100 + noise * 300;
      const spo2 = Math.max(93, Math.min(99, spo2Base + Math.sin(i / 45) * 0.6 + (Math.random() - 0.5) * 0.3));
      const pulse = Math.round(hr + (Math.random() - 0.5) * 1.5);
      const temperature = +(36.6 + Math.sin(i / 200) * 0.15 + (Math.random() - 0.5) * 0.04).toFixed(2);
      const signalQuality = Math.max(60, Math.min(98, Math.round(88 + Math.sin(i / 25) * 6 + (Math.random() - 0.5) * 3)));
      const sample: SensorSample = {
        deviceId,
        timestamp: new Date().toISOString(),
        t,
        red,
        ir,
        spo2: +spo2.toFixed(1),
        pulse,
        heartRate: pulse,
        temperature,
        battery: Math.max(15, 90 - Math.floor(i / 800)),
        signalQuality,
        confidence: signalQuality > 82 ? "high" : signalQuality > 68 ? "medium" : "low",
        deviceState: "TESTING",
        testSource: "web",
        testDuration: Math.round(t),
      };
      onSample(sample);
    }, 100);
    this.subs.set(deviceId + ":" + uid("sub"), { cb: onSample, started, timer });
    const key = [...this.subs.keys()].pop()!;
    return () => {
      const s = this.subs.get(key);
      if (s) {
        clearInterval(s.timer);
        this.subs.delete(key);
      }
    };
  }

  systemStatus() {
    return this.status;
  }

  onStatus(cb: (s: SystemStatus) => void) {
    this.statusCbs.add(cb);
    cb(this.status);
    return () => {
      this.statusCbs.delete(cb);
    };
  }
}

export const mockStream: ISensorStream = new MockSensorStream();
