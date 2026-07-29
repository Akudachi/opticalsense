/**
 * Environment configuration — single source of truth.
 * Never hardcode URLs, keys, or credentials elsewhere.
 *
 * Read at module scope; validated in Live Mode.
 */

type Env = {
  APP_NAME: string;
  USE_MOCK: boolean;
  API_URL: string;
  SOCKET_URL: string;
  MQTT: {
    host: string;
    port: number;
    username: string;
    password: string;
    topicPrefix: string;
  };
  JWT_ISSUER: string;
};

function readBool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v === "") return fallback;
  return v === "true" || v === "1";
}

function readNum(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const raw = (import.meta as unknown as { env: Record<string, string | undefined> }).env ?? {};

export const env: Env = {
  APP_NAME: raw.VITE_APP_NAME ?? "OpticalSense",
  USE_MOCK: readBool(raw.VITE_USE_MOCK, true),
  API_URL: raw.VITE_API_URL ?? "",
  SOCKET_URL: raw.VITE_SOCKET_URL ?? "",
  MQTT: {
    host: raw.VITE_MQTT_HOST ?? "",
    port: readNum(raw.VITE_MQTT_PORT, 8883),
    username: raw.VITE_MQTT_USERNAME ?? "",
    password: raw.VITE_MQTT_PASSWORD ?? "",
    topicPrefix: raw.VITE_MQTT_TOPIC_PREFIX ?? "opticalsense",
  },
  JWT_ISSUER: raw.VITE_JWT_ISSUER ?? "opticalsense",
};

export const isDemoMode = () => env.USE_MOCK;

/** Called by live service factory — throws if required config missing. */
export function assertLiveConfig(): void {
  const missing: string[] = [];
  if (!env.API_URL) missing.push("VITE_API_URL");
  if (!env.SOCKET_URL) missing.push("VITE_SOCKET_URL");
  if (!env.MQTT.host) missing.push("VITE_MQTT_HOST");
  if (missing.length) {
    throw new Error(
      `Live Mode requires: ${missing.join(", ")}. Set VITE_USE_MOCK=true for Demo Mode.`,
    );
  }
}
