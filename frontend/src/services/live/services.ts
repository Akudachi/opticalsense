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

// Global device status listener for online/offline detection
let globalStatusUnsubscribe: (() => void) | null = null;
let globalStatusInitializing = false; // Prevent concurrent initialization
let globalStatusListenerInitialized = false; // Complete flag to prevent any further calls
let globalStatusInitPromise: Promise<void> | null = null; // Module-level promise to ensure single execution

export async function initializeGlobalStatusListener() {
  console.log('initializeGlobalStatusListener called');
  
  // If we already have a promise, return it (ensures single execution)
  if (globalStatusInitPromise) {
    console.log('Returning existing initialization promise');
    return globalStatusInitPromise;
  }
  
  console.log('Creating new initialization promise');
  
  globalStatusInitPromise = (async () => {
    console.log('Global status listener initialization started');
    
    if (globalStatusListenerInitialized) {
      console.log('Global status listener COMPLETELY initialized - ignoring call');
      console.trace('Stack trace of blocked call:');
      return; // Already initialized - ignore all further calls
    }

    if (globalStatusUnsubscribe) {
      console.log('Global status listener already initialized');
      return; // Already initialized
    }

    if (globalStatusInitializing) {
      console.log('Global status listener already initializing - skipping');
      console.trace('Stack trace of concurrent call:');
      return; // Already in progress
    }

    globalStatusInitializing = true;
    console.log('Setting globalStatusInitializing = true');

    try {
      // Connect to MQTT first, then subscribe
      // This ensures a stable connection before we start listening for status updates
      if (!mqttClient.isConnected()) {
        console.log('MQTT not connected, connecting now for global status listener...');
        await mqttClient.connect();
        console.log('MQTT connected successfully');
      }
      
      const statusTopic = `${env.MQTT.topicPrefix}/device/+/status/+`;
      const directStatusTopic = `${env.MQTT.topicPrefix}/device/+/status`;
      console.log('Initializing global device status listener on topics:', statusTopic, directStatusTopic);
      console.log('MQTT connected:', mqttClient.isConnected());

    // Subscribe to status/+ for backend-generated online/offline messages
    const unsubscribeStatusPlus = mqttClient.subscribe(statusTopic, (topic, message) => {
      try {
        const data = JSON.parse(message.toString());
        console.log('=== GLOBAL STATUS UPDATE (status/+) ===');
        console.log('Topic:', topic);
        console.log('Data:', data);

        // Extract device ID from topic
        const deviceIdMatch = topic.match(/device\/([^\/]+)\/status/);
        if (!deviceIdMatch) {
          console.log('Could not extract device ID from topic:', topic);
          return;
        }
        const deviceId = deviceIdMatch[1];
        console.log('Device ID from topic:', deviceId);

        // Update device online status
        const devices = getStoredDevices();
        console.log('Current devices:', devices.map(d => ({ id: d.id, deviceId: d.deviceId, online: d.online })));

        const idx = devices.findIndex(d => d.id === deviceId || d.deviceId === deviceId);
        if (idx >= 0) {
          const oldStatus = devices[idx].online;
          devices[idx] = {
            ...devices[idx],
            online: data.online ?? devices[idx].online,
            status: data.status ?? devices[idx].status,
            lastSeen: data.lastSeen ?? devices[idx].lastSeen,
            deviceState: data.deviceState ?? devices[idx].deviceState,
            battery: data.battery ?? devices[idx].battery,
            batteryPct: data.battery ?? devices[idx].batteryPct,
          };
          storeDevices(devices);
          console.log(`Device ${deviceId} status updated: ${oldStatus} -> ${data.online}, status: ${data.status}`);
        } else {
          console.log(`Device ${deviceId} not found in stored devices`);
        }
      } catch (err) {
        console.error('Error parsing global status message:', err);
      }
    });

    // Also subscribe to direct status topic for device Last Will messages
    const unsubscribeDirectStatus = mqttClient.subscribe(directStatusTopic, (topic, message) => {
      try {
        const data = JSON.parse(message.toString());
        console.log('=== DIRECT STATUS UPDATE (status) ===');
        console.log('Topic:', topic);
        console.log('Data:', data);

        // Extract device ID from topic
        const deviceIdMatch = topic.match(/device\/([^\/]+)\/status$/);
        if (!deviceIdMatch) {
          console.log('Could not extract device ID from topic:', topic);
          return;
        }
        const deviceId = deviceIdMatch[1];
        console.log('Device ID from topic:', deviceId);

        // Update device online status - this catches Last Will messages
        const devices = getStoredDevices();
        const idx = devices.findIndex(d => d.id === deviceId || d.deviceId === deviceId);
        if (idx >= 0) {
          const oldStatus = devices[idx].online;
          devices[idx] = {
            ...devices[idx],
            online: data.online ?? devices[idx].online,
            status: data.status ?? devices[idx].status,
            lastSeen: data.lastSeen ?? devices[idx].lastSeen,
            deviceState: data.deviceState ?? devices[idx].deviceState,
            battery: data.battery ?? devices[idx].battery,
            batteryPct: data.battery ?? devices[idx].batteryPct,
          };
          storeDevices(devices);
          console.log(`Device ${deviceId} direct status updated: ${oldStatus} -> ${data.online}, status: ${data.status}`);
        }
      } catch (err) {
        console.error('Error parsing direct status message:', err);
      }
    });

    // After subscribing, immediately check all stored devices and mark them offline
    // if they haven't been seen recently (in case we missed the Last Will message)
    const devices = getStoredDevices();
    const now = Date.now();
    const offlineThreshold = 35000; // 35 seconds - slightly more than backend's 30s to avoid race conditions

    devices.forEach(device => {
      const lastSeenTime = new Date(device.lastSeen).getTime();
      const timeSinceLastSeen = now - lastSeenTime;

      if (timeSinceLastSeen > offlineThreshold && device.online) {
        console.log(`Initial offline check: Device ${device.deviceId} last seen ${Math.floor(timeSinceLastSeen / 1000)}s ago, marking offline`);
        const idx = devices.findIndex(d => d.id === device.id);
        if (idx >= 0) {
          devices[idx] = {
            ...devices[idx],
            online: false,
            status: 'offline',
          };
        }
      }
    });

    storeDevices(devices);
    console.log('Global status listener subscription successful');

    // Return combined unsubscribe function
    globalStatusUnsubscribe = () => {
      unsubscribeStatusPlus();
      unsubscribeDirectStatus();
    };
    
    globalStatusListenerInitialized = true;
    console.log('Global status listener COMPLETELY initialized');
  } catch (err) {
    console.error('Failed to initialize global status listener:', err);
    // Reset promise on error so it can be retried
    globalStatusInitPromise = null;
  } finally {
    globalStatusInitializing = false;
  }
  })(); // Immediately invoke the async function
  
  return globalStatusInitPromise;
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

    // Send start command to device via MQTT
    try {
      await mqttClient.connect();
      const commandTopic = `${env.MQTT.topicPrefix}/device/${data.deviceId}/commands`;
      const commandData = {
        command: 'start_test',
        testId: newTest.id,
        timestamp: new Date().toISOString()
      };
      mqttClient.publish(commandTopic, JSON.stringify(commandData), { qos: 1 });
      console.log('Sent start_test command to device:', data.deviceId);
    } catch (err) {
      console.error('Failed to send start command:', err);
      // Even if MQTT fails, we still return the test (frontend state will handle it)
    }

    return newTest;
  },
  
  stop: async (id, data) => {
    const tests = getStoredTests();
    const index = tests.findIndex(t => t.id === id);
    if (index >= 0) {
      const test = tests[index];
      
      // Send stop command to device via MQTT
      try {
        await mqttClient.connect();
        const commandTopic = `${env.MQTT.topicPrefix}/device/${test.deviceId}/commands`;
        const commandData = {
          command: 'stop_test',
          testId: id,
          timestamp: new Date().toISOString()
        };
        mqttClient.publish(commandTopic, JSON.stringify(commandData), { qos: 1 });
        console.log('Sent stop_test command to device:', test.deviceId);
      } catch (err) {
        console.error('Failed to send stop command:', err);
      }
      
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

  remove: async (id: string) => {
    const reports = getStoredReports();
    const filtered = reports.filter(r => r.id !== id);
    storeReports(filtered);
    
    addActivityEvent('report_deleted', `Report ${id} deleted`, id);
    
    return true;
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
    // NOTE: Global status listener is now initialized at app level in _authenticated.tsx
    // to prevent it from being called repeatedly by refetchInterval queries

    // Return devices from local storage
    // Don't do client-side offline detection here - rely on backend status updates
    // The backend sends explicit online/offline status via MQTT
    const devices = getStoredDevices();

    // Add client-side offline detection as backup only for devices marked online
    const now = Date.now();
    const offlineThreshold = 35000; // 35 seconds - slightly more than backend's 30s to avoid race conditions

    return devices.map(device => {
      // If device is already marked offline by backend, keep it offline
      if (device.status === 'offline' || !device.online) {
        return device;
      }

      // Only apply client-side detection if device is currently marked online
      const lastSeenTime = new Date(device.lastSeen).getTime();
      const timeSinceLastSeen = now - lastSeenTime;
      const isOffline = timeSinceLastSeen > offlineThreshold;

      if (isOffline) {
        console.log(`Client-side offline detection: Device ${device.deviceId} last seen ${Math.floor(timeSinceLastSeen / 1000)}s ago, marking offline`);
        return {
          ...device,
          online: false,
          status: 'offline',
        };
      }

      return device;
    });
  },
  
  get: async (id: string): Promise<Device | null> => {
    const devices = getStoredDevices();
    return devices.find(d => d.id === id) || null;
  },
  
  pair: async (code: string): Promise<Device> => {
    // Ensure MQTT is connected before proceeding
    if (!mqttClient.isConnected()) {
      console.log('MQTT not connected yet, connecting before pairing...');
      await mqttClient.connect();
    }

    return new Promise((resolve, reject) => {
      const topic = `${env.MQTT.topicPrefix}/device/+/pair/request`;
      console.log('=== PAIRING START ===');
      console.log('Pairing code entered by user:', code);
      console.log('Subscribing to topic:', topic);
      
      const timeout = setTimeout(() => {
        console.error('=== PAIRING TIMEOUT ===');
        console.error('No device found with code:', code);
        unsubscribe();
        reject(new Error('Pairing timeout - no device found matching code ' + code));
      }, 30000);

      const unsubscribe = mqttClient.subscribe(topic, (receivedTopic, message) => {
        console.log('=== RECEIVED PAIRING REQUEST ===');
        console.log('Topic:', receivedTopic);
        try {
          const data = JSON.parse(message.toString());
          console.log('Parsed device data:', data);
          
          if (String(data.pairingCode).trim() === String(code).trim()) {
            console.log('=== CODE MATCHED! ===');
            clearTimeout(timeout);
            unsubscribe();
            
            // Send pairing response to device immediately
            const responseTopic = `${env.MQTT.topicPrefix}/device/${data.deviceId}/pair/response`;
            const responseData = {
              status: 'SUCCESS',
              deviceId: data.deviceId,
              clinicId: 'demo-clinic-id',
              clinicName: 'Demo Clinic',
              deviceName: data.name || data.deviceId,
              timestamp: new Date().toISOString()
            };
            
            console.log('Publishing pairing response to:', responseTopic, responseData);
            mqttClient.publish(responseTopic, JSON.stringify(responseData), { retain: false, qos: 1 });
            
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
            const existingIndex = devices.findIndex(d => d.id === device.id || d.deviceId === device.deviceId);
            if (existingIndex >= 0) {
              devices[existingIndex] = device;
            } else {
              devices.push(device);
            }
            storeDevices(devices);
            
            console.log('=== PAIRING SUCCESSFUL ===');
            console.log('Device stored:', device);
            resolve(device);
          } else {
            console.log(`Code received (${data.pairingCode}) does not match entered code (${code})`);
          }
        } catch (err) {
          console.error('Error parsing pairing message:', err);
        }
      });
      
      console.log('Waiting for device to publish pairing request...');
    });
  },
  
  unpair: async (id: string): Promise<void> => {
    // Send unpair command to device via MQTT
    const devices = getStoredDevices();
    const device = devices.find(d => d.id === id);
    if (device) {
      try {
        await mqttClient.connect();
        const commandTopic = `${env.MQTT.topicPrefix}/device/${device.deviceId}/commands`;
        const commandData = {
          command: 'unpair',
          deviceId: device.deviceId,
          timestamp: new Date().toISOString()
        };
        mqttClient.publish(commandTopic, JSON.stringify(commandData), { qos: 1 });
        console.log('Sent unpair command to device:', device.deviceId);
      } catch (err) {
        console.error('Failed to send unpair command:', err);
      }
    }

    // Remove device from localStorage
    const filtered = devices.filter(d => d.id !== id);
    storeDevices(filtered);
    console.log('Device unpaired:', id);
  },
  
  refresh: async (id: string): Promise<Device> => {
    // Send get_status command to device and wait for response
    // Do not trust retained messages - only accept fresh responses
    const devices = getStoredDevices();
    const index = devices.findIndex(d => d.id === id);
    if (index < 0) {
      throw new Error('Device not found');
    }
    
    const device = devices[index];
    console.log('Refreshing device status for:', device.deviceId);
    
    return new Promise(async (resolve, reject) => {
      try {
        await mqttClient.connect();
      } catch (err) {
        console.error('Failed to connect to MQTT:', err);
        // If MQTT connection fails, device is considered offline
        devices[index] = {
          ...device,
          online: false,
          status: 'offline',
        };
        storeDevices(devices);
        resolve(devices[index]);
        return;
      }
      
      // Send get_status command to device
      const commandTopic = `${env.MQTT.topicPrefix}/device/${device.deviceId}/commands`;
      const commandData = {
        command: 'get_status',
        timestamp: new Date().toISOString()
      };
      
      console.log('Sending get_status command to device:', device.deviceId);
      mqttClient.publish(commandTopic, JSON.stringify(commandData), { qos: 1 });
      
      // Subscribe to status topic to wait for response
      const statusTopic = `${env.MQTT.topicPrefix}/device/${device.deviceId}/status`;
      let responseReceived = false;
      
      const timeout = setTimeout(() => {
        if (!responseReceived) {
          console.log('No status response received within timeout, device is offline');
          // Mark device as offline - no response means device is not actually online
          devices[index] = {
            ...device,
            online: false,
            status: 'offline',
          };
          storeDevices(devices);
          resolve(devices[index]);
        }
      }, 5000); // 5 second timeout for status check
      
      const unsubscribe = mqttClient.subscribe(statusTopic, (topic, message) => {
        if (!responseReceived) {
          responseReceived = true;
          clearTimeout(timeout);
          unsubscribe();
          
          try {
            const data = JSON.parse(message.toString());
            console.log('Received status response during refresh:', data);
            
            // Only trust the response if it was sent recently (within last 10 seconds)
            const messageTime = new Date(data.timestamp || data.lastSeen).getTime();
            const now = Date.now();
            const isRecent = (now - messageTime) < 10000; // 10 seconds
            
            if (!isRecent) {
              console.log('Received old retained message, ignoring');
              // Treat as offline if we only get old messages
              devices[index] = {
                ...device,
                online: false,
                status: 'offline',
              };
              storeDevices(devices);
              resolve(devices[index]);
              return;
            }
            
            // Update device status based on fresh response
            const isOnline = data.status?.toLowerCase().includes('online') || 
                           data.online === true || 
                           (data.deviceState && data.deviceState !== 'offline');
            
            devices[index] = {
              ...device,
              online: isOnline,
              status: isOnline ? (data.status || 'online') : 'offline',
              lastSeen: data.lastSeen || device.lastSeen,
              deviceState: data.deviceState || device.deviceState,
              battery: data.battery ?? device.battery,
              batteryPct: data.battery ?? device.batteryPct,
              wifi: { 
                ssid: data.wifi?.ssid || device.wifi?.ssid || 'Unknown', 
                rssi: data.wifi?.rssi || device.wifi?.rssi || -50, 
                connected: isOnline 
              },
              mqtt: data.mqtt || 'unknown',
            };
            storeDevices(devices);
            console.log('Device status updated after refresh:', isOnline);
            resolve(devices[index]);
          } catch (err) {
            console.error('Error parsing status message:', err);
            // If we can't parse the message, treat as offline
            devices[index] = {
              ...device,
              online: false,
              status: 'offline',
            };
            storeDevices(devices);
            resolve(devices[index]);
          }
        }
      });
    });
  },
  
  repair: async (id: string): Promise<Device> => {
    // Strong repair logic - actually check if device is responsive
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
      
      let messageReceived = false;
      let isActuallyOnline = false;
      
      const timeout = setTimeout(() => {
        if (!messageReceived) {
          console.log('Repair timeout - no status update received, device is offline');
          const updatedDevice: Device = {
            ...device,
            online: false,
            status: 'offline',
            lastSeen: new Date().toISOString(),
          };
          
          const deviceIndex = devices.findIndex(d => d.id === id);
          if (deviceIndex >= 0) {
            devices[deviceIndex] = updatedDevice;
            storeDevices(devices);
          }
          
          reject(new Error('Device is offline - no response received'));
        }
      }, 10000); // 10 second timeout
      
      const unsubscribe = mqttClient.subscribe(statusTopic, (topic, message) => {
        if (!messageReceived) {
          messageReceived = true;
          clearTimeout(timeout);
          unsubscribe();
          
          try {
            const data = JSON.parse(message.toString());
            console.log('Received status message during repair:', data);
            
            // Only mark as online if status explicitly says online
            isActuallyOnline = data.status?.toLowerCase().includes('online') || false;
            
            const updatedDevice: Device = {
              ...device,
              online: isActuallyOnline,
              status: isActuallyOnline ? 'online' : 'offline',
              battery: data.battery || device.battery,
              batteryPct: data.battery || device.batteryPct,
              lastSeen: new Date().toISOString(),
              wifi: { 
                ssid: device.wifi?.ssid || 'Unknown', 
                rssi: data.wifi || device.wifi?.rssi || -50, 
                connected: isActuallyOnline 
              },
              mqtt: data.mqtt || 'unknown',
            };
            
            const deviceIndex = devices.findIndex(d => d.id === id);
            if (deviceIndex >= 0) {
              devices[deviceIndex] = updatedDevice;
              storeDevices(devices);
            }
            
            if (isActuallyOnline) {
              console.log('Device repaired and is online:', updatedDevice);
              resolve(updatedDevice);
            } else {
              console.log('Device responded but reports offline status');
              reject(new Error('Device is offline'));
            }
          } catch (err) {
            console.error('Error parsing status message:', err);
            const updatedDevice: Device = {
              ...device,
              online: false,
              status: 'offline',
              lastSeen: new Date().toISOString(),
            };
            
            const deviceIndex = devices.findIndex(d => d.id === id);
            if (deviceIndex >= 0) {
              devices[deviceIndex] = updatedDevice;
              storeDevices(devices);
            }
            
            reject(new Error('Error parsing device status'));
          }
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
    const heartbeatTopic = `${env.MQTT.topicPrefix}/device/${deviceId}/heartbeat`;
    
    console.log('=== MQTT SUBSCRIPTION START ===');
    console.log('Device ID:', deviceId);
    console.log('Telemetry topic:', telemetryTopic);
    console.log('Heartbeat topic:', heartbeatTopic);
    console.log('MQTT Config:', env.MQTT);
    console.log('USE_MOCK:', env.USE_MOCK);
    
    // Connect to MQTT if not already connected
    mqttClient.connect().catch(err => {
      console.error('Failed to connect to MQTT:', err);
    });

    const unsubscribeTelemetry = mqttClient.subscribe(telemetryTopic, (topic, message) => {
      console.log('=== MQTT MESSAGE RECEIVED ===');
      console.log('Topic:', topic);
      console.log('Expected topic:', telemetryTopic);
      console.log('Message content:', message.toString());
      try {
        const data = JSON.parse(message.toString());
        console.log('Parsed telemetry data:', data);
        
        const sample: SensorSample = {
          id: `${deviceId}-${Date.now()}`,
          deviceId: data.deviceId,
          timestamp: new Date().toISOString(), // Use receive time; ESP sends millis() not epoch
          heartRate: data.heartRate ?? 0,
          spo2: data.spo2 ?? 0,
          temperature: data.temperature ?? 0,
          battery: data.battery ?? 0,
          voltage: data.voltage,
          signalQuality: data.signalQuality ?? 0,
          heartRateConfidence: data.heartRateConfidence,
          spo2Confidence: data.spo2Confidence,
          motionDetected: data.motionDetected,
          sensorSaturated: data.sensorSaturated,
          vitalityIndex: data.vitalityIndex ?? 0,
          vitalityStatus: data.vitalityStatus,
          probeQuality: data.probeQuality,
          deviceState: data.deviceState,
          sampleCount: data.sampleCount,
          demoMode: data.demoMode || false,
          // GY-MAX3010x specific fields
          redRaw: data.redRaw,
          irRaw: data.irRaw,
          fingerDetected: data.fingerDetected,
          stableSampleCount: data.stableSampleCount,
          redFiltered: data.redFiltered,
          irFiltered: data.irFiltered,
          redAC: data.redAC,
          redDC: data.redDC,
          irAC: data.irAC,
          irDC: data.irDC,
          testDuration: data.testDuration,
        };
        
        console.log('Calling onSample with sample:', sample);
        onSample(sample);
        
        // Update device lastSeen and state from telemetry
        const devices = getStoredDevices();
        const idx = devices.findIndex(d => d.id === deviceId || d.deviceId === deviceId);
        if (idx >= 0) {
          devices[idx] = {
            ...devices[idx],
            lastSeen: new Date().toISOString(),
            deviceState: data.deviceState || data.state || 'UNKNOWN',
            battery: data.battery ?? devices[idx].battery,
            batteryPct: data.battery ?? devices[idx].batteryPct,
          };
          storeDevices(devices);
        }
        
        console.log('=== MQTT MESSAGE PROCESSED ===');
      } catch (err) {
        console.error('Error parsing telemetry message:', err);
      }
    });

    const unsubscribeStatus = mqttClient.subscribe(statusTopic, (topic, message) => {
      try {
        const data = JSON.parse(message.toString());
        console.log('Device status update:', data);
        
        // Update stored device with fresh data
        const devices = getStoredDevices();
        const idx = devices.findIndex(d => d.id === deviceId || d.deviceId === deviceId);
        if (idx >= 0) {
          devices[idx] = {
            ...devices[idx],
            lastSeen: new Date().toISOString(),
            deviceState: data.state || data.deviceState || 'UNKNOWN',
            battery: data.battery ?? devices[idx].battery,
            batteryPct: data.battery ?? devices[idx].batteryPct,
            wifi: {
              ssid: devices[idx].wifi?.ssid || 'Connected',
              rssi: data.wifi ?? devices[idx].wifi?.rssi ?? -50,
              connected: true,
            },
            mqtt: data.mqtt?.toLowerCase().includes('connected') ? 'connected' : devices[idx].mqtt,
          };
          storeDevices(devices);
        }
      } catch (err) {
        console.error('Error parsing status message:', err);
      }
    });

    const unsubscribeHeartbeat = mqttClient.subscribe(heartbeatTopic, (topic, message) => {
      try {
        const data = JSON.parse(message.toString());
        console.log('Device heartbeat received:', data);

        // Heartbeat always indicates device is online
        const devices = getStoredDevices();
        const idx = devices.findIndex(d => d.id === deviceId || d.deviceId === deviceId);
        if (idx >= 0) {
          devices[idx] = {
            ...devices[idx],
            online: true,
            status: 'online',
            lastSeen: new Date().toISOString(),
            deviceState: data.state || devices[idx].deviceState,
            battery: data.battery ?? devices[idx].battery,
            batteryPct: data.battery ?? devices[idx].batteryPct,
            wifi: {
              ssid: devices[idx].wifi?.ssid || 'Connected',
              rssi: data.wifi ?? devices[idx].wifi?.rssi ?? -50,
              connected: true,
            },
            mqtt: data.mqtt?.toLowerCase().includes('connected') ? 'connected' : devices[idx].mqtt,
          };
          storeDevices(devices);
        }
      } catch (err) {
        console.error('Error parsing heartbeat message:', err);
      }
    });

    // Return combined unsubscribe function
    return () => {
      unsubscribeTelemetry();
      unsubscribeStatus();
      unsubscribeHeartbeat();
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
