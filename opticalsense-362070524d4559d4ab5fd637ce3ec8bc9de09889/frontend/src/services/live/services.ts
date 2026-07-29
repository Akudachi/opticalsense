/**
 * Live service stubs.
 *
 * These implement the same interfaces as the mock services. Every method
 * throws until you wire it up.
 *
 * Suggested wiring:
 *   auth       →  fetch(env.API_URL + "/auth/login")   with JWT + refresh
 *   patients   →  fetch(env.API_URL + "/patients")
 *   tests      →  fetch(env.API_URL + "/tests")
 *   reports    →  fetch(env.API_URL + "/reports")
 *   devices    →  fetch(env.API_URL + "/devices")
 *   clinic     →  fetch(env.API_URL + "/clinic")
 *   activity   →  fetch(env.API_URL + "/activity")
 *   stream     →  Socket.IO client @ env.SOCKET_URL, subscribes to
 *                 `${env.MQTT.topicPrefix}/${deviceId}/telemetry` bridged
 *                 through the backend, or connect mqtt.js directly to
 *                 HiveMQ Cloud over wss.
 */
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

const NI = (name: string) =>
  () => {
    throw new Error(`Live ${name} not implemented — implement in src/services/live/services.ts`);
  };

const notImpl = <T extends object>(name: string): T =>
  new Proxy({} as T, {
    get: (_t, prop) => NI(`${name}.${String(prop)}`),
  });

export const liveAuth: IAuthService = notImpl<IAuthService>("auth");
export const livePatients: IPatientService = notImpl<IPatientService>("patients");
export const liveTests: ITestService = notImpl<ITestService>("tests");
export const liveReports: IReportService = notImpl<IReportService>("reports");
export const liveDevices: IDeviceService = notImpl<IDeviceService>("devices");
export const liveClinic: IClinicService = notImpl<IClinicService>("clinic");
export const liveActivity: IActivityService = notImpl<IActivityService>("activity");
export const liveStream: ISensorStream = notImpl<ISensorStream>("stream");
