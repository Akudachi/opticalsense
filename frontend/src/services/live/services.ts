/**
 * Live service implementations.
 *
 * These implement the same interfaces as the mock services.
 * MQTT streaming is implemented for device telemetry.
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
import type { SensorSample, SystemStatus, Device } from "@/types";
import { mqttClient } from "@/lib/mqtt-client";
import { env } from "@/config/env";

// Mock implementations for services that need backend API
const NI = (name: string) =>
  () => {
    throw new Error(`Live ${name} not implemented — needs backend API`);
  };

const notImpl = <T extends object>(name: string): T =>
  new Proxy({} as T, {
    get: (_t, prop) => NI(`${name}.${String(prop)}`),
  });

export const liveAuth: IAuthService = notImpl<IAuthService>("auth");
export const livePatients: IPatientService = notImpl<IPatientService>("patients");
export const liveTests: ITestService = notImpl<ITestService>("tests");
export const liveReports: IReportService = notImpl<IReportService>("reports");
export const liveClinic: IClinicService = notImpl<IClinicService>("clinic");
export const liveActivity: IActivityService = notImpl<IActivityService>("activity");

// Device service with MQTT pairing support
export const liveDevices: IDeviceService = {
  list: async (): Promise<Device[]> => {
    // For now, return empty list - should fetch from backend
    return [];
  },
  
  get: async (id: string): Promise<Device | null> => {
    // Should fetch from backend
    return null;
  },
  
  pair: async (code: string): Promise<Device> => {
    // Subscribe to pairing topic to receive device info
    return new Promise(async (resolve, reject) => {
      const topic = `${env.MQTT.topicPrefix}/device/+/pair/request`;
      console.log('Starting pairing with code:', code);
      console.log('Subscribing to topic:', topic);
      
      // Ensure MQTT is connected before subscribing
      try {
        await mqttClient.connect();
        console.log('MQTT connected, now subscribing to pairing topic');
      } catch (err) {
        console.error('Failed to connect to MQTT:', err);
        reject(new Error('Failed to connect to MQTT'));
        return;
      }
      
      const timeout = setTimeout(() => {
        console.error('Pairing timeout - no device found with code:', code);
        reject(new Error('Pairing timeout - no device found'));
      }, 30000);

      const unsubscribe = mqttClient.subscribe(topic, (topic, message) => {
        console.log('Received message on topic:', topic);
        console.log('Message content:', message.toString());
        try {
          const data = JSON.parse(message.toString());
          console.log('Parsed data:', data);
          console.log('Looking for code:', code, 'Got code:', data.pairingCode);
          if (data.pairingCode === code) {
            console.log('Code matched! Resolving device');
            clearTimeout(timeout);
            unsubscribe();
            
            const device: Device = {
              id: data.deviceId,
              name: data.name || data.deviceId,
              status: 'online',
              battery: data.battery || 100,
              lastSeen: new Date().toISOString(),
              firmware: data.firmware || 'unknown',
            };
            
            resolve(device);
          }
        } catch (err) {
          console.error('Error parsing pairing message:', err);
        }
      });
    });
  },
  
  unpair: async (id: string): Promise<void> => {
    // Should call backend API
    console.log('Unpairing device:', id);
  },
  
  refresh: async (id: string): Promise<Device> => {
    // Should fetch fresh status from backend
    throw new Error('Device refresh not implemented');
  },
};

// Live MQTT streaming service
export const liveStream: ISensorStream = {
  subscribe: (deviceId: string, onSample: (s: SensorSample) => void): (() => void) => {
    const telemetryTopic = `${env.MQTT.topicPrefix}/${deviceId}/telemetry`;
    const statusTopic = `${env.MQTT.topicPrefix}/${deviceId}/status`;
    
    // Connect to MQTT if not already connected
    mqttClient.connect().catch(err => {
      console.error('Failed to connect to MQTT:', err);
    });

    const unsubscribeTelemetry = mqttClient.subscribe(telemetryTopic, (topic, message) => {
      try {
        const data = JSON.parse(message.toString());
        
        const sample: SensorSample = {
          id: `${deviceId}-${data.timestamp}`,
          deviceId: data.deviceId,
          timestamp: new Date(data.timestamp).toISOString(),
          heartRate: data.heartRate,
          spo2: data.spo2,
          temperature: data.temperature,
          battery: data.battery,
          voltage: data.voltage,
          signalQuality: data.signalQuality,
          vitalityIndex: data.vitalityIndex,
          vitalityStatus: data.vitalityStatus,
          probeQuality: data.probeQuality,
          deviceState: data.deviceState,
          demoMode: data.demoMode || false,
        };
        
        onSample(sample);
      } catch (err) {
        console.error('Error parsing telemetry message:', err);
      }
    });

    const unsubscribeStatus = mqttClient.subscribe(statusTopic, (topic, message) => {
      try {
        const data = JSON.parse(message.toString());
        console.log('Device status update:', data);
      } catch (err) {
        console.error('Error parsing status message:', err);
      }
    });

    // Return combined unsubscribe function
    return () => {
      unsubscribeTelemetry();
      unsubscribeStatus();
    };
  },

  systemStatus: (): SystemStatus => {
    return {
      connected: mqttClient.isConnected(),
      devicesOnline: 0,
      lastUpdate: new Date().toISOString(),
    };
  },

  onStatus: (cb: (s: SystemStatus) => void): (() => void) => {
    return mqttClient.onConnectionChange((connected) => {
      cb({
        connected,
        devicesOnline: connected ? 1 : 0,
        lastUpdate: new Date().toISOString(),
      });
    });
  },
};
