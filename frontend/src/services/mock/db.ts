import { STORAGE_KEYS } from "@/config/constants";
import {
  SEED_META,
  buildSeedActivity,
  buildSeedPatients,
  buildSeedReports,
  buildSeedTests,
  seedClinic,
  seedDevices,
} from "@/data/seed";
import type { ActivityEvent, Clinic, Device, Patient, Report, Test } from "@/types";
import { storage } from "./storage";

/** In-memory + localStorage-backed store. Seeds once, then persists user edits. */
class MockDb {
  private inited = false;
  clinic!: Clinic;
  patients: Patient[] = [];
  tests: Test[] = [];
  reports: Report[] = [];
  devices: Device[] = [];
  activity: ActivityEvent[] = [];

  init(): void {
    if (this.inited) return;
    this.clinic = storage.get<Clinic>(STORAGE_KEYS.CLINIC, seedClinic);
    const existingPatients = storage.get<Patient[] | null>(STORAGE_KEYS.PATIENTS, null);
    if (existingPatients && existingPatients.length) {
      this.patients = existingPatients;
    } else {
      this.patients = buildSeedPatients();
      storage.set(STORAGE_KEYS.PATIENTS, this.patients);
    }
    const existingTests = storage.get<Test[] | null>(STORAGE_KEYS.TESTS, null);
    if (existingTests && existingTests.length) {
      this.tests = existingTests;
    } else {
      this.tests = buildSeedTests(this.patients);
      storage.set(STORAGE_KEYS.TESTS, this.tests);
    }
    this.reports = buildSeedReports(this.tests);
    this.devices = storage.get<Device[]>(STORAGE_KEYS.DEVICES, seedDevices);
    if (!storage.get<Device[] | null>(STORAGE_KEYS.DEVICES, null)) {
      storage.set(STORAGE_KEYS.DEVICES, this.devices);
    }
    this.activity = storage.get<ActivityEvent[] | null>(STORAGE_KEYS.ACTIVITY, null) ?? buildSeedActivity(this.tests);
    this.inited = true;
  }

  saveClinic() {
    storage.set(STORAGE_KEYS.CLINIC, this.clinic);
  }
  savePatients() {
    storage.set(STORAGE_KEYS.PATIENTS, this.patients);
  }
  saveTests() {
    storage.set(STORAGE_KEYS.TESTS, this.tests);
  }
  saveDevices() {
    storage.set(STORAGE_KEYS.DEVICES, this.devices);
  }
  saveActivity() {
    storage.set(STORAGE_KEYS.ACTIVITY, this.activity.slice(0, 200));
  }
}

export const mockDb = new MockDb();
export const SEED = SEED_META;
