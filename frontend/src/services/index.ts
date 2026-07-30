import { assertLiveConfig, env } from "@/config/env";
import type { Services } from "./interfaces";
import {
  mockActivity,
  mockAuth,
  mockClinic,
  mockDevices,
  mockPatients,
  mockReports,
  mockStream,
  mockTests,
} from "./mock/services";
import {
  liveActivity,
  liveAuth,
  liveClinic,
  liveDevices,
  livePatients,
  liveReports,
  liveStream,
  liveTests,
} from "./live/services";

let cached: Services | null = null;

/** Dependency-injection entry point. Swap Demo ↔ Live via env.USE_MOCK. */
export function getServices(): Services {
  if (cached) return cached;
  if (env.USE_MOCK) {
    cached = {
      auth: mockAuth,
      patients: mockPatients,
      tests: mockTests,
      reports: mockReports,
      devices: mockDevices,
      clinic: mockClinic,
      activity: mockActivity,
      stream: mockStream,
      mode: "demo",
    };
  } else {
    // Try live mode, fall back to mock if config is missing
    try {
      assertLiveConfig();
      cached = {
        auth: liveAuth,
        patients: livePatients,
        tests: liveTests,
        reports: liveReports,
        devices: liveDevices,
        clinic: liveClinic,
        activity: liveActivity,
        stream: liveStream,
        mode: "live",
      };
    } catch (err) {
      console.warn("Live config missing, falling back to demo mode:", err);
      cached = {
        auth: mockAuth,
        patients: mockPatients,
        tests: mockTests,
        reports: mockReports,
        devices: mockDevices,
        clinic: mockClinic,
        activity: mockActivity,
        stream: mockStream,
        mode: "demo",
      };
    }
  }
  return cached;
}

export type { Services } from "./interfaces";
