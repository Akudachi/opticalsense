export const APP = {
  NAME: "OpticalSense",
  TAGLINE: "Optical Pulp Vitality Monitoring",
  DESCRIPTION:
    "Cloud-based dental optical pulp vitality monitoring — live ESP32 telemetry, patient records, and clinical reporting.",
  COMPANY: "OpticalSense Medical Systems",
  SUPPORT_EMAIL: "support@opticalsense.io",
} as const;

export const STORAGE_KEYS = {
  AUTH: "opticalsense.auth.v1",
  PATIENTS: "opticalsense.patients.v1",
  TESTS: "opticalsense.tests.v1",
  DEVICES: "opticalsense.devices.v1",
  CLINIC: "opticalsense.clinic.v1",
  ACTIVITY: "opticalsense.activity.v1",
  THEME: "opticalsense.theme.v1",
} as const;

export const SENSOR = {
  SAMPLE_HZ: 10,
  WAVEFORM_WINDOW_SEC: 8,
  METRIC_WINDOW_SEC: 60,
} as const;
