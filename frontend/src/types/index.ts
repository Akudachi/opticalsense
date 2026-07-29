export type ID = string;
export type ISODate = string;

export type ConnectionStatus = "connected" | "connecting" | "disconnected" | "error";

export type User = {
  id: ID;
  email: string;
  fullName: string;
  role: "doctor" | "admin";
  clinicId: ID;
  avatarUrl?: string;
};

export type Clinic = {
  id: ID;
  name: string;
  logoDataUrl?: string;
  doctorName: string;
  address: string;
  phone: string;
  email: string;
  licenseNo?: string;
};

export type Patient = {
  id: ID;
  clinicId: ID;
  fullName: string;
  dateOfBirth: ISODate;
  sex: "male" | "female" | "other";
  phone: string;
  email?: string;
  medicalNotes?: string;
  toothOfInterest?: string; // FDI notation e.g. "16"
  createdAt: ISODate;
  updatedAt: ISODate;
};

export type Device = {
  id: ID;
  clinicId: ID;
  name: string;
  deviceId: string; // hardware id
  firmware: string;
  online: boolean;
  wifi: { ssid: string; rssi: number; connected: boolean };
  mqtt: ConnectionStatus;
  batteryPct: number;
  signalStrength: number; // 0-100
  lastSeen: ISODate;
  pairedAt: ISODate;
};

export type SensorSample = {
  t: number; // ms since stream start
  red: number;
  ir: number;
  spo2: number;
  pulse: number;
  temperature: number;
  batteryPct: number;
  signalQuality: number; // 0-100
  confidence: "low" | "medium" | "high";
};

export type TestStatus = "in_progress" | "completed" | "aborted";

export type TestSummary = {
  avgSpO2: number;
  avgPulse: number;
  avgTemp: number;
  minSpO2: number;
  maxPulse: number;
  signalQuality: number;
  confidence: "low" | "medium" | "high";
  durationSec: number;
};

export type Test = {
  id: ID;
  clinicId: ID;
  patientId: ID;
  deviceId: ID;
  doctorId: ID;
  startedAt: ISODate;
  endedAt?: ISODate;
  status: TestStatus;
  toothOfInterest?: string;
  samples: SensorSample[]; // downsampled preserved
  summary: TestSummary;
  observations: string;
  pulpVerdict: "vital" | "non_vital" | "inconclusive";
};

export type Report = {
  id: ID;
  testId: ID;
  patientId: ID;
  clinicId: ID;
  generatedAt: ISODate;
  aiAnalysis?: string; // reserved
};

export type ActivityEvent = {
  id: ID;
  at: ISODate;
  kind:
    | "test_started"
    | "test_stopped"
    | "report_generated"
    | "patient_added"
    | "device_paired"
    | "device_online"
    | "device_offline";
  message: string;
  refId?: ID;
};

export type SystemStatus = {
  backend: ConnectionStatus;
  mqtt: ConnectionStatus;
  database: ConnectionStatus;
  device: ConnectionStatus;
};

export type Paged<T> = { items: T[]; total: number; page: number; pageSize: number };
