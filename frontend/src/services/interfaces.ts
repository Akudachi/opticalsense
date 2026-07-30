/**
 * Service interfaces — UI depends on these, never on implementations.
 * Swap Mock ↔ Live by editing src/services/index.ts.
 */
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

export interface IAuthService {
  login(email: string, password: string): Promise<User>;
  logout(): Promise<void>;
  currentUser(): User | null;
  updateProfile(patch: Partial<Pick<User, "fullName" | "avatarUrl">>): Promise<User>;
}

export interface IPatientService {
  list(params: { search?: string; page?: number; pageSize?: number }): Promise<Paged<Patient>>;
  get(id: string): Promise<Patient | null>;
  create(input: Omit<Patient, "id" | "createdAt" | "updatedAt" | "clinicId">): Promise<Patient>;
  update(id: string, input: Partial<Patient>): Promise<Patient>;
  remove(id: string): Promise<void>;
}

export interface ITestService {
  list(params?: { patientId?: string; page?: number; pageSize?: number }): Promise<Paged<Test>>;
  get(id: string): Promise<Test | null>;
  start(input: { patientId: string; deviceId: string; toothOfInterest?: string }): Promise<Test>;
  stop(id: string, payload: { samples: SensorSample[]; observations?: string }): Promise<Test>;
  update(id: string, input: Partial<Test>): Promise<Test>;
  remove(id: string): Promise<void>;
}

export interface IReportService {
  list(params?: { patientId?: string }): Promise<Report[]>;
  get(id: string): Promise<Report | null>;
  generate(testId: string, aiAnalysis?: string): Promise<Report>;
}

export interface IDeviceService {
  list(): Promise<Device[]>;
  get(id: string): Promise<Device | null>;
  pair(code: string): Promise<Device>;
  unpair(id: string): Promise<void>;
  refresh(id: string): Promise<Device>;
  repair(id: string): Promise<Device>;
}

export interface IClinicService {
  get(): Promise<Clinic>;
  update(input: Partial<Clinic>): Promise<Clinic>;
}

export interface IActivityService {
  list(limit?: number): Promise<ActivityEvent[]>;
  push(event: Omit<ActivityEvent, "id" | "at">): Promise<ActivityEvent>;
}

/** Stream contract used by the dashboard. Mock emits simulated ticks; Live wraps MQTT/Socket.IO. */
export interface ISensorStream {
  subscribe(deviceId: string, onSample: (s: SensorSample) => void): () => void;
  systemStatus(): SystemStatus;
  onStatus(cb: (s: SystemStatus) => void): () => void;
}

export interface Services {
  auth: IAuthService;
  patients: IPatientService;
  tests: ITestService;
  reports: IReportService;
  devices: IDeviceService;
  clinic: IClinicService;
  activity: IActivityService;
  stream: ISensorStream;
  mode: "demo" | "live";
}
