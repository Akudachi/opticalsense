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
  clinicId?: ID;
  name: string;
  deviceId?: string; // hardware id
  firmware: string;
  online?: boolean;
  status?: "online" | "offline" | "connecting";
  wifi?: { ssid: string; rssi: number; connected: boolean };
  mqtt?: ConnectionStatus;
  batteryPct?: number;
  battery?: number;
  signalStrength?: number; // 0-100
  deviceState?: string;
  lastSeen: ISODate;
  pairedAt?: ISODate;
};

export type SensorSample = {
  id?: string;
  deviceId: string;
  timestamp: string; // ISO date
  battery: number;
  voltage?: number;
  temperature: number;
  heartRate: number;
  pulse?: number;
  t?: number;
  red?: number;
  ir?: number;
  confidence?: "low" | "medium" | "high";
  heartRateConfidence?: number;
  spo2: number;
  spo2Confidence?: number;
  signalQuality: number; // 0-100
  motionDetected?: boolean;
  sensorSaturated?: boolean;
  vitalityIndex?: number;
  vitalityStatus?: string;
  probeQuality?: string;
  deviceState?: string;
  sampleCount?: number;
  demoMode?: boolean;
  // GY-MAX3010x specific fields
  redRaw?: number; // Raw RED value from GY-MAX3010x
  irRaw?: number; // Raw IR value from GY-MAX3010x
  fingerDetected?: boolean; // Finger detection status
  stableSampleCount?: number; // Number of stable samples collected
  redFiltered?: number; // Filtered RED signal
  irFiltered?: number; // Filtered IR signal
  redAC?: number; // RED AC component for SpO2 calculation
  redDC?: number; // RED DC component for SpO2 calculation
  irAC?: number; // IR AC component for SpO2 calculation
  irDC?: number; // IR DC component for SpO2 calculation
  // Firmware v3.7.0 telemetry fields
  testSource?: "web" | "button" | string;
  testDuration?: number; // Test duration in milliseconds
  finalHeartRate?: number;
  finalSpo2?: number;
  finalTemperature?: number;
};

export type DeviceResultPayload = {
  deviceId: string;
  completed: boolean;
  valid: boolean;
  spo2: number;
  heartRate: number;
  signalQuality: number;
  vitalityIndex: number;
  vitalityStatus: string;
  temperature: number;
  finalSpo2?: number;
  finalHeartRate?: number;
  finalTemperature?: number;
  durationMs: number;
  validReadings?: number;
  timestamp: number; // Device uptime in ms
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
  vitalityIndex?: number;
  vitalityStatus?: string;
  valid?: boolean;
  validReadings?: number;
};

export type RunningReportStats = {
  count: number;
  sumSpo2: number;
  sumHeartRate: number;
  sumTemperature: number;
  sumSignalQuality: number;
  currentSpo2: number;
  currentHeartRate: number;
  currentTemperature: number;
  currentSignalQuality: number;
  vitalityStatus: string;
  vitalityIndex?: number;
  lastTestDuration: number;
};

export type IntervalReading = {
  intervalIndex: number; // 1, 2, 3...
  timeMarkSec: number; // 20, 40, 60, 80...
  timeWindowLabel: string; // "0s - 20s", "20s - 40s", "40s - 60s"...
  timestamp: string;
  heartRate: number;
  spo2: number;
  temperature: number;
  signalQuality: number;
  vitalityStatus: string;
  vitalityIndex?: number;
  validReadingsCount: number;
};

export type ReportReading = {
  valid: boolean;
  spo2: number; // running average since 20s
  heartRate: number; // running average since 20s
  temperature: number; // running average since 20s
  signalQuality: number; // running average since 20s
  vitalityStatus: string;
  vitalityIndex?: number;
  testDuration: number; // in milliseconds (from telemetry.testDuration)
  timestamp: string; // ISO date
  validReadings?: number; // count of valid samples collected after 20s
  currentSpo2?: number;
  currentHeartRate?: number;
  currentTemperature?: number;
  currentSignalQuality?: number;
  intervalReadings?: IntervalReading[]; // 20-second interval readings
  errorMessage?: string;
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
  valid?: boolean;
  reportReading?: ReportReading;
};

export type Report = {
  id: ID;
  testId: ID;
  patientId: ID;
  clinicId: ID;
  generatedAt: ISODate;
  aiAnalysis?: string; // reserved
  reading?: ReportReading;
  valid?: boolean;
  errorMessage?: string;
};

export type ActivityEvent = {
  id: ID;
  at: ISODate;
  kind:
    | "test_started"
    | "test_stopped"
    | "report_generated"
    | "report_deleted"
    | "patient_added"
    | "device_paired"
    | "device_online"
    | "device_offline";
  message: string;
  refId?: ID;
};

export type SystemStatus = {
  connected: boolean;
  devicesOnline: number;
  lastUpdate: string;
  backend?: ConnectionStatus;
  mqtt?: ConnectionStatus;
  database?: ConnectionStatus;
  device?: ConnectionStatus;
};

export type Paged<T> = { items: T[]; total: number; page: number; pageSize: number };
