import { SENSOR } from "@/config/constants";
import { getServices } from "@/services";
import type { StreamOptions } from "@/services/interfaces";
import type { SensorSample, SystemStatus } from "@/types";
import { useEffect, useRef, useState } from "react";

/** Subscribes to the sensor stream for a device and keeps a rolling window of valid samples. */
export function useLiveSensors(
  deviceId: string | undefined,
  active: boolean,
  options?: StreamOptions
) {
  const services = getServices();
  const [latest, setLatest] = useState<SensorSample | null>(null);
  const windowRef = useRef<SensorSample[]>([]);
  const [tick, setTick] = useState(0);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const clearSamples = () => {
    windowRef.current = [];
    setTick((t) => (t + 1) % 1_000_000);
  };

  useEffect(() => {
    if (!active || !deviceId) return;
    windowRef.current = [];
    setLatest(null);
    const maxSamples = SENSOR.SAMPLE_HZ * SENSOR.METRIC_WINDOW_SEC;

    const unsub = services.stream.subscribe(
      deviceId,
      (s) => {
        setLatest(s);

        // Rule 2: Device-started button tests publish NO readings/result to website.
        // Do NOT record or chart anything.
        if (s.deviceState === "TESTING" && s.testSource === "button") {
          setTick((t) => (t + 1) % 1_000_000);
          return;
        }

        // Rule 1: A value of 0 means "no valid reading right now" (probe not on tooth, signal noisy).
        // Display "--", do not plot it as a real zero, and do not store it as a sample.
        const hasValidPerfusion = (s.spo2 ?? 0) > 0 && (s.heartRate ?? 0) > 0;
        if (hasValidPerfusion) {
          const next = windowRef.current.concat(s);
          windowRef.current = next.length > maxSamples ? next.slice(-maxSamples) : next;
        }
        setTick((t) => (t + 1) % 1_000_000);
      },
      {
        onResult: (result) => optionsRef.current?.onResult?.(result),
        onCommandAck: (ack) => optionsRef.current?.onCommandAck?.(ack),
        onDeviceOffline: () => optionsRef.current?.onDeviceOffline?.(),
      }
    );

    return () => unsub();
  }, [active, deviceId, services.stream]);

  return { latest, samples: windowRef.current, tick, clearSamples };
}

export function useSystemStatus() {
  const services = getServices();
  const [status, setStatus] = useState<SystemStatus>(services.stream.systemStatus());

  // Also update devicesOnline count from actual device list
  useEffect(() => {
    const updateStatus = async () => {
      const devices = await services.devices.list();
      const onlineCount = devices.filter(d => d.online).length;
      setStatus({
        ...services.stream.systemStatus(),
        devicesOnline: onlineCount,
        lastUpdate: new Date().toISOString(),
      });
    };

    updateStatus();
    const interval = setInterval(updateStatus, 3000); // Update every 3 seconds
    return () => clearInterval(interval);
  }, [services]);

  useEffect(() => services.stream.onStatus(setStatus), [services.stream]);
  return status;
}
