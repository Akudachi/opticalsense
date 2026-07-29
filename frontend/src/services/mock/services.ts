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
} from "@/services/interfaces";
import type {
  ActivityEvent,
  Clinic,
  Device,
  Paged,
  Patient,
  Report,
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
  const avgPulse = Math.round(avg((s) => s.pulse));
  const avgTemp = +avg((s) => s.temperature).toFixed(2);
  const signalQuality = Math.round(avg((s) => s.signalQuality));
  return {
    avgSpO2, avgPulse, avgTemp,
    minSpO2: +Math.min(...samples.map((s) => s.spo2)).toFixed(1),
    maxPulse: Math.round(Math.max(...samples.map((s) => s.pulse))),
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
  async stop(id, { samples, observations }) {
    mockDb.init();
    await delay(160);
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
  async generate(testId, aiAnalysis) {
    mockDb.init();
    await delay(180);
    const test = mockDb.tests.find((t) => t.id === testId);
    if (!test) throw new Error("Test not found");
    const existing = mockDb.reports.find((r) => r.testId === testId);
    if (existing) return existing;
    const report: Report = {
      id: uid("rep"),
      testId,
      patientId: test.patientId,
      clinicId: SEED.CLINIC_ID,
      generatedAt: new Date().toISOString(),
      aiAnalysis,
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
    return report;
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
      at: dev.pairedAt,
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
    d.signalStrength = Math.min(100, d.signalStrength + Math.floor(Math.random() * 5));
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
    backend: "connected",
    mqtt: "connected",
    database: "connected",
    device: "connected",
  };
  private statusCbs = new Set<(s: SystemStatus) => void>();
  private subs = new Map<string, { cb: (s: SensorSample) => void; started: number; timer: ReturnType<typeof setInterval> }>();

  subscribe(deviceId: string, onSample: (s: SensorSample) => void) {
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
        t,
        red,
        ir,
        spo2: +spo2.toFixed(1),
        pulse,
        temperature,
        batteryPct: Math.max(15, 90 - Math.floor(i / 800)),
        signalQuality,
        confidence: signalQuality > 82 ? "high" : signalQuality > 68 ? "medium" : "low",
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
