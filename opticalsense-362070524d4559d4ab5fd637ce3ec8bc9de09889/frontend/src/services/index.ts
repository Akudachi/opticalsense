import { assertLiveConfig } from "@/config/env";
import type { Services } from "./interfaces";
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

/** Service entry point. Returns the live service implementations. */
export function getServices(): Services {
  if (cached) return cached;
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
  };
  return cached;
}

export type { Services } from "./interfaces";
