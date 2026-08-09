/**
 * Live service implementations.
 *
 * These implement the same interfaces as the mock services.
 * MQTT streaming is implemented for device telemetry.
 * Other services use localStorage for persistence.
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
import type { SensorSample, SystemStatus, Device, Patient, Test, Report, ActivityEvent, Clinic, Paged } from "@/types";
import { mqttClient } from "@/lib/mqtt-client";
import { env } from "@/config/env";

// Local storage keys
const DEVICES_STORAGE_KEY = 'opticalsense_devices';
const PATIENTS_STORAGE_KEY = 'opticalsense_patients';
const TESTS_STORAGE_KEY = 'opticalsense_tests';
const REPORTS_STORAGE_KEY = 'opticalsense_reports';
const ACTIVITY_STORAGE_KEY = 'opticalsense_activity';
const CLINIC_STORAGE_KEY = 'opticalsense_clinic';

// Generic storage helpers
function getStored<T>(key: string): T[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function storeStored<T>(key: string, data: T[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (err) {
    console.error(`Failed to store ${key}:`, err);
  }
}

// Device storage helpers
function getStoredDevices(): Device[] {
  return getStored<Device>(DEVICES_STORAGE_KEY);
}

function storeDevices(devices: Device[]): void {
  storeStored(DEVICES_STORAGE_KEY, devices);
}

// Patient storage helpers
function getStoredPatients(): Patient[] {
  return getStored<Patient>(PATIENTS_STORAGE_KEY);
}

function storePatients(patients: Patient[]): void {
  storeStored(PATIENTS_STORAGE_KEY, patients);
}

// Test storage helpers
function getStoredTests(): Test[] {
  return getStored<Test>(TESTS_STORAGE_KEY);
}

function storeTests(tests: Test[]): void {
  storeStored(TESTS_STORAGE_KEY, tests);
}

// Report storage helpers
function getStoredReports(): Report[] {
  return getStored<Report>(REPORTS_STORAGE_KEY);
}

function storeReports(reports: Report[]): void {
  storeStored(REPORTS_STORAGE_KEY, reports);
}

// Activity storage helpers
function getStoredActivity(): ActivityEvent[] {
  return getStored<ActivityEvent>(ACTIVITY_STORAGE_KEY);
}

function storeActivity(activity: ActivityEvent[]): void {
  storeStored(ACTIVITY_STORAGE_KEY, activity);
}

// Clinic storage helpers
function getStoredClinic(): Clinic | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(CLINIC_STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

function storeClinic(clinic: Clinic): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(CLINIC_STORAGE_KEY, JSON.stringify(clinic));
  } catch (err) {
    console.error('Failed to store clinic:', err);
  }
}

// Auth service (simple localStorage-based auth)
export const liveAuth: IAuthService = {
  login: async (email: string, password: string) => {
    // Simple demo auth - accept any email/password
    const user = {
      id: 'demo-user',
      email,
      fullName: 'Demo User',
      role: 'doctor' as const,
      clinicId: 'demo-clinic',
    };
    localStorage.setItem('auth_token', JSON.stringify(user));
    return user;
  },
  logout: async () => {
    // Clear any auth state
    localStorage.removeItem('auth_token');
  },
  currentUser: () => {
    const stored = localStorage.getItem('auth_token');
    if (stored) {
      return JSON.parse(stored);
    }
    return null;
  },
  updateProfile: async (patch) => {
    const stored = localStorage.getItem('auth_token');
    if (stored) {
      const user = JSON.parse(stored);
      const updated = { ...user, ...patch };
      localStorage.setItem('auth_token', JSON.stringify(updated));
      return updated;
    }
    throw new Error('No user logged in');
  },
};

// Patient service with localStorage
export const livePatients: IPatientService = {
  list: async (params) => {
    const patients = getStoredPatients();
    const page = params?.page || 1;
    const pageSize = params?.pageSize || 20;
    const start = (page - 1) * pageSize;
    const items = patients.slice(start, start + pageSize);
    return { items, total: patients.length, page, pageSize };
  },
  
  get: async (id) => {
    const patients = getStoredPatients();
    return patients.find(p => p.id === id) || null;
  },
  
  create: async (data) => {
    const patients = getStoredPatients();
    const newPatient: Patient = {
      ...data,
      id: `patient-${Date.now()}`,
      clinicId: 'demo-clinic',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    patients.push(newPatient);
    storePatients(patients);
    
    // Add activity event
    addActivityEvent('patient_added', `Patient ${newPatient.fullName} added`, newPatient.id);
    
    return newPatient;
  },
  
  update: async (id, data) => {
    const patients = getStoredPatients();
    const index = patients.findIndex(p => p.id === id);
    if (index >= 0) {
      patients[index] = { ...patients[index], ...data, updatedAt: new Date().toISOString() };
      storePatients(patients);
      return patients[index];
    }
    throw new Error('Patient not found');
  },
  
  remove: async (id: string) => {
    const patients = getStoredPatients();
    const filtered = patients.filter(p => p.id !== id);
    storePatients(filtered);
  },
};

// Test service with localStorage
export const liveTests: ITestService = {
  list: async (params) => {
    const tests = getStoredTests();
    const page = params?.page || 1;
    const pageSize = params?.pageSize || 20;
    const start = (page - 1) * pageSize;
    const items = tests.slice(start, start + pageSize);
    return { items, total: tests.length, page, pageSize };
  },
  
  get: async (id) => {
    const tests = getStoredTests();
    return tests.find(t => t.id === id) || null;
  },
  
  start: async (data) => {
    const tests = getStoredTests();
    const newTest: Test = {
      id: `test-${Date.now()}`,
      clinicId: 'demo-clinic',
      patientId: data.patientId,
      deviceId: data.deviceId,
      doctorId: 'demo-user',
      startedAt: new Date().toISOString(),
      status: 'in_progress',
      toothOfInterest: data.toothOfInterest,
      samples: [],
      summary: {
        avgSpO2: 0,
        avgPulse: 0,
        avgTemp: 0,
        minSpO2: 0,
        maxPulse: 0,
        signalQuality: 0,
        confidence: 'medium',
        durationSec: 0,
      },
      observations: '',
      pulpVerdict: 'inconclusive',
    };
    tests.push(newTest);
    storeTests(tests);
    
    addActivityEvent('test_started', `Test started for patient ${data.patientId}`, newTest.id);
    
    return newTest;
  },
  
  stop: async (id, data) => {
    const tests = getStoredTests();
    const index = tests.findIndex(t => t.id === id);
    if (index >= 0) {
      tests[index] = {
        ...tests[index],
        endedAt: new Date().toISOString(),
        status: 'completed',
        samples: data.samples || [],
        observations: data.observations || '',
        // Calculate summary from samples
        summary: calculateSummary(data.samples || []),
        pulpVerdict: 'inconclusive', // Will be determined by AI
      };
      storeTests(tests);
      
      addActivityEvent('test_stopped', `Test completed for patient ${tests[index].patientId}`, id);
      
      return tests[index];
    }
    throw new Error('Test not found');
  },
  
  update: async (id, data) => {
    const tests = getStoredTests();
    const index = tests.findIndex(t => t.id === id);
    if (index >= 0) {
      tests[index] = { ...tests[index], ...data };
      storeTests(tests);
      return tests[index];
    }
    throw new Error('Test not found');
  },
  
  remove: async (id: string) => {
    const tests = getStoredTests();
    const filtered = tests.filter(t => t.id !== id);
    storeTests(filtered);
  },
};

function calculateSummary(samples: SensorSample[]): Test['summary'] {
  if (!samples.length) {
    return {
      avgSpO2: 0,
      avgPulse: 0,
      avgTemp: 0,
      minSpO2: 0,
      maxPulse: 0,
      signalQuality: 0,
      confidence: 'low',
      durationSec: 0,
    };
  }
  
  const spo2s = samples.map(s => s.spo2);
  const pulses = samples.map(s => s.heartRate);
  const temps = samples.map(s => s.temperature);
  const signals = samples.map(s => s.signalQuality);
  
  return {
    avgSpO2: spo2s.reduce((a, b) => a + b, 0) / spo2s.length,
    avgPulse: pulses.reduce((a, b) => a + b, 0) / pulses.length,
    avgTemp: temps.reduce((a, b) => a + b, 0) / temps.length,
    minSpO2: Math.min(...spo2s),
    maxPulse: Math.max(...pulses),
    signalQuality: signals.reduce((a, b) => a + b, 0) / signals.length,
    confidence: signals.reduce((a, b) => a + b, 0) / signals.length > 70 ? 'high' : 'medium',
    durationSec: samples.length / 10, // Assuming 10 Hz sampling
  };
}

// Report service with localStorage
export const liveReports: IReportService = {
  list: async (params) => {
    const reports = getStoredReports();
    if (params?.patientId) {
      return reports.filter(r => {
        const test = getStoredTests().find(t => t.id === r.testId);
        return test?.patientId === params.patientId;
      });
    }
    return reports;
  },
  
  get: async (id) => {
    const reports = getStoredReports();
    return reports.find(r => r.id === id) || null;
  },
  
  generate: async (testId, aiAnalysis) => {
    const tests = getStoredTests();
    const test = tests.find(t => t.id === testId);
    if (!test) throw new Error('Test not found');
    
    const reports = getStoredReports();
    const newReport: Report = {
      id: `report-${Date.now()}`,
      testId,
      patientId: test.patientId,
      clinicId: test.clinicId,
      generatedAt: new Date().toISOString(),
      aiAnalysis: aiAnalysis || 'AI analysis pending',
    };
    reports.push(newReport);
    storeReports(reports);
    
    addActivityEvent('report_generated', `Report generated for test ${testId}`, newReport.id);
    
    return newReport;
  },
};

// Clinic service with localStorage
export const liveClinic: IClinicService = {
  get: async () => {
    let clinic = getStoredClinic();
    if (!clinic) {
      // Create default clinic
      clinic = {
        id: 'demo-clinic',
        name: 'Demo Clinic',
        doctorName: 'Demo Doctor',
        address: '123 Main St',
        phone: '555-1234',
        email: 'demo@clinic.com',
      };
      storeClinic(clinic);
    }
    return clinic;
  },
  
  update: async (data) => {
    const clinic = getStoredClinic();
    if (clinic) {
      const updated = { ...clinic, ...data };
      storeClinic(updated);
      return updated;
    }
    throw new Error('Clinic not found');
  },
};

// Activity service with localStorage
export const liveActivity: IActivityService = {
  list: async (limit) => {
    const activity = getStoredActivity();
    return activity.slice(0, limit || 15);
  },
  
  push: async (event) => {
    const activity = getStoredActivity();
    const newEvent: ActivityEvent = {
      id: `activity-${Date.now()}`,
      at: new Date().toISOString(),
      ...event,
    };
    activity.unshift(newEvent);
    // Keep only last 100 events
    if (activity.length > 100) {
      activity.pop();
    }
    storeActivity(activity);
    return newEvent;
  },
};

function addActivityEvent(kind: ActivityEvent['kind'], message: string, refId?: string) {
  const activity = getStoredActivity();
  const newEvent: ActivityEvent = {
    id: `activity-${Date.now()}`,
    at: new Date().toISOString(),
    kind,
    message,
    refId,
  };
  activity.unshift(newEvent);
  // Keep only last 100 events
  if (activity.length > 100) {
    activity.pop();
  }
  storeActivity(activity);
}

// Device service with MQTT pairing support
export const liveDevices: IDeviceService = {
  list: async (): Promise<Device[]> => {
    // Return devices from local storage with updated online status
    const devices = getStoredDevices();
    const now = Date.now();
    const offlineThreshold = 60000; // 60 seconds - device considered offline if no update in 60s
    
    return devices.map(device => {
      const lastSeenTime = new Date(device.lastSeen).getTime();
      const isOffline = now - lastSeenTime > offlineThreshold;
      
      return {
        ...device,
        online: !isOffline,
        status: isOffline ? 'offline' : 'online',
      };
    });
  },
  
  get: async (id: string): Promise<Device | null> => {
    const devices = getStoredDevices();
    return devices.find(d => d.id === id) || null;
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
            console.log('Code matched! Sending pairing response');
            clearTimeout(timeout);
            unsubscribe();
            
            // Send pairing response to device
            const responseTopic = `${env.MQTT.topicPrefix}/device/${data.deviceId}/pair/response`;
            const responseData = {
              status: 'SUCCESS',
              deviceId: data.deviceId,
              clinicId: 'demo-clinic-id',
              clinicName: 'Demo Clinic',
              deviceName: data.name || data.deviceId,
              timestamp: new Date().toISOString()
            };
            
            console.log('Publishing pairing response to:', responseTopic);
            console.log('Response data:', responseData);
            
            mqttClient.publish(responseTopic, JSON.stringify(responseData), { retain: true, qos: 1 });
            
            const device: Device = {
              id: data.deviceId,
              name: data.name || data.deviceId,
              deviceId: data.deviceId,
              status: 'online',
              online: true,
              battery: data.battery || 100,
              batteryPct: data.battery || 100,
              signalStrength: 85,
              lastSeen: new Date().toISOString(),
              firmware: data.firmware || 'unknown',
              wifi: { ssid: 'Unknown', rssi: -50, connected: true },
              mqtt: 'connected',
            };
            
            // Store device in localStorage
            const devices = getStoredDevices();
            const existingIndex = devices.findIndex(d => d.id === device.id);
            if (existingIndex >= 0) {
              devices[existingIndex] = device;
            } else {
              devices.push(device);
            }
            storeDevices(devices);
            
            console.log('Device stored:', device);
            resolve(device);
          }
        } catch (err) {
          console.error('Error parsing pairing message:', err);
        }
      });
    });
  },
  
  unpair: async (id: string): Promise<void> => {
    // Remove device from localStorage
    const devices = getStoredDevices();
    const filtered = devices.filter(d => d.id !== id);
    storeDevices(filtered);
    console.log('Device unpaired:', id);
  },
  
  refresh: async (id: string): Promise<Device> => {
    // Update device lastSeen to current time and check status
    const devices = getStoredDevices();
    const index = devices.findIndex(d => d.id === id);
    if (index >= 0) {
      const now = Date.now();
      const offlineThreshold = 60000; // 60 seconds
      const lastSeenTime = new Date(devices[index].lastSeen).getTime();
      const isOffline = now - lastSeenTime > offlineThreshold;
      
      devices[index] = {
        ...devices[index],
        lastSeen: new Date().toISOString(),
        online: !isOffline,
        status: isOffline ? 'offline' : 'online',
      };
      storeDevices(devices);
      return devices[index];
    }
    throw new Error('Device not found');
  },
  
  repair: async (id: string): Promise<Device> => {
    // Re-pair device by subscribing to its status topic
    return new Promise(async (resolve, reject) => {
      const devices = getStoredDevices();
      const device = devices.find(d => d.id === id);
      if (!device) {
        reject(new Error('Device not found'));
        return;
      }
      
      const statusTopic = `${env.MQTT.topicPrefix}/device/${device.deviceId}/status`;
      console.log('Repairing device, subscribing to status topic:', statusTopic);
      
      try {
        await mqttClient.connect();
      } catch (err) {
        console.error('Failed to connect to MQTT:', err);
        reject(new Error('Failed to connect to MQTT'));
        return;
      }
      
      const timeout = setTimeout(() => {
        console.error('Repair timeout - no status update received');
        reject(new Error('Repair timeout - no status update received'));
      }, 15000);
      
      const unsubscribe = mqttClient.subscribe(statusTopic, (topic, message) => {
        console.log('Received status message during repair:', message.toString());
        try {
          const data = JSON.parse(message.toString());
          clearTimeout(timeout);
          unsubscribe();
          
          const updatedDevice: Device = {
            ...device,
            online: data.status?.toLowerCase().includes('online') || false,
            status: data.status?.toLowerCase().includes('online') ? 'online' : 'offline',
            battery: data.battery || device.battery,
            batteryPct: data.battery || device.batteryPct,
            lastSeen: new Date().toISOString(),
            wifi: { 
              ssid: device.wifi?.ssid || 'Unknown', 
              rssi: data.wifi || device.wifi?.rssi || -50, 
              connected: true 
            },
            mqtt: data.mqtt || 'connected',
          };
          
          const deviceIndex = devices.findIndex(d => d.id === id);
          if (deviceIndex >= 0) {
            devices[deviceIndex] = updatedDevice;
            storeDevices(devices);
          }
          
          console.log('Device repaired:', updatedDevice);
          resolve(updatedDevice);
        } catch (err) {
          console.error('Error parsing status message:', err);
        }
      });
    });
  },
};

// Live MQTT streaming service
export const liveStream: ISensorStream = {
  subscribe: (deviceId: string, onSample: (s: SensorSample) => void): (() => void) => {
    const telemetryTopic = `${env.MQTT.topicPrefix}/device/${deviceId}/telemetry`;
    const statusTopic = `${env.MQTT.topicPrefix}/device/${deviceId}/status`;
    
    console.log('Subscribing to telemetry for device:', deviceId);
    console.log('Telemetry topic:', telemetryTopic);
    
    // Connect to MQTT if not already connected
    mqttClient.connect().catch(err => {
      console.error('Failed to connect to MQTT:', err);
    });

    const unsubscribeTelemetry = mqttClient.subscribe(telemetryTopic, (topic, message) => {
      console.log('Received MQTT message on topic:', topic);
      console.log('Message content:', message.toString());
      try {
        const data = JSON.parse(message.toString());
        console.log('Parsed telemetry data:', data);
        
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
        
        console.log('Calling onSample with sample:', sample);
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
