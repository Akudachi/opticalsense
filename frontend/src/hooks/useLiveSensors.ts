import { SENSOR } from "@/config/constants";
import { getServices } from "@/services";
import type { SensorSample, SystemStatus } from "@/types";
import { useEffect, useRef, useState } from "react";

/** Subscribes to the sensor stream for a device and keeps a rolling window. */
export function useLiveSensors(deviceId: string | undefined, active: boolean) {
  const services = getServices();
  const [latest, setLatest] = useState<SensorSample | null>(null);
  const windowRef = useRef<SensorSample[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!active || !deviceId) return;
    windowRef.current = [];
    setLatest(null);
    const maxSamples = SENSOR.SAMPLE_HZ * SENSOR.METRIC_WINDOW_SEC;
    const unsub = services.stream.subscribe(deviceId, (s) => {
      const next = windowRef.current.concat(s);
      windowRef.current = next.length > maxSamples ? next.slice(-maxSamples) : next;
      setLatest(s);
      setTick((t) => (t + 1) % 1_000_000);
    });
    return () => unsub();
  }, [active, deviceId, services.stream]);

  return { latest, samples: windowRef.current, tick };
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
