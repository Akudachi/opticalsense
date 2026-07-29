# MQTT Protocol Specification

## Overview

This document specifies the complete MQTT protocol used for communication between the ESP32 device and the OpticalSense backend. All topics use the prefix `opticalsense/device/{deviceId}` where `{deviceId}` is the unique hardware identifier of the ESP32.

## Broker Configuration

- **Broker**: HiveMQ Cloud
- **Protocol**: MQTTS (TLS)
- **Port**: 8883
- **QoS**: Varied by topic (specified below)
- **Topic Prefix**: `opticalsense`
- **Client ID**: `{deviceId}` (must be unique per device)

## Topics

### 1. Telemetry Topic

**Topic**: `opticalsense/device/{deviceId}/telemetry`

**Publisher**: ESP32

**Subscriber**: Backend

**QoS**: 1

**Retain**: false

**Description**: Real-time sensor data published at 10Hz during active tests. Contains processed PPG signals and computed vital signs.

**JSON Payload Schema**:
```json
{
  "testId": "string (UUID)",
  "t": "number (milliseconds since test start)",
  "red": "number (raw red PPG value)",
  "ir": "number (raw IR PPG value)",
  "spo2": "number (SpO2 percentage)",
  "pulse": "number (heart rate in BPM)",
  "temperature": "number (temperature in Celsius)",
  "batteryPct": "number (battery percentage 0-100)",
  "signalQuality": "number (signal quality 0-100)",
  "confidence": "string (low|medium|high)"
}
```

**Example Payload**:
```json
{
  "testId": "test-abc123-def456-ghi789",
  "t": 12345,
  "red": 28500,
  "ir": 42500,
  "spo2": 97.5,
  "pulse": 74,
  "temperature": 36.6,
  "batteryPct": 92,
  "signalQuality": 88,
  "confidence": "high"
}
```

**Field Descriptions**:
- `testId`: Unique identifier for the active test session
- `t`: Time offset in milliseconds since test started
- `red`: Raw red PPG sensor reading (ADC value)
- `ir`: Raw infrared PPG sensor reading (ADC value)
- `spo2`: Computed oxygen saturation percentage (70.0-100.0)
- `pulse`: Computed heart rate in beats per minute (30-200)
- `temperature`: Measured temperature in Celsius (30.0-42.0)
- `batteryPct`: Battery level percentage (0-100)
- `signalQuality`: Signal quality metric (0-100, higher is better)
- `confidence`: Measurement confidence level

---

### 2. Status Topic

**Topic**: `opticalsense/device/{deviceId}/status`

**Publisher**: ESP32

**Subscriber**: Backend

**QoS**: 1

**Retain**: true

**Description**: Device status updates published on state changes. Contains connection health, battery status, and operational state. Retained to allow new subscribers to receive current state.

**JSON Payload Schema**:
```json
{
  "deviceId": "string",
  "status": "string (online|offline|error|pairing)",
  "wifi": {
    "ssid": "string",
    "rssi": "number (dBm)",
    "connected": "boolean"
  },
  "mqtt": {
    "connected": "boolean",
    "lastError": "string (optional)"
  },
  "battery": {
    "level": "number (percentage)",
    "charging": "boolean",
    "voltage": "number (volts, optional)"
  },
  "sensors": {
    "red": "string (ok|error|disconnected)",
    "ir": "string (ok|error|disconnected)",
    "temperature": "string (ok|error|disconnected)"
  },
  "firmwareVersion": "string",
  "uptime": "number (seconds)",
  "timestamp": "string (ISO 8601)"
}
```

**Example Payload**:
```json
{
  "deviceId": "OS-ESP32-123456",
  "status": "online",
  "wifi": {
    "ssid": "Northlake-Clinical",
    "rssi": -55,
    "connected": true
  },
  "mqtt": {
    "connected": true,
    "lastError": null
  },
  "battery": {
    "level": 92,
    "charging": false,
    "voltage": 3.85
  },
  "sensors": {
    "red": "ok",
    "ir": "ok",
    "temperature": "ok"
  },
  "firmwareVersion": "1.0.0",
  "uptime": 3600,
  "timestamp": "2024-01-15T10:30:00Z"
}
```

**Field Descriptions**:
- `status`: Current device operational state
- `wifi.ssid`: Connected WiFi network name
- `wifi.rssi`: WiFi signal strength in dBm (typical range: -30 to -90)
- `wifi.connected`: WiFi connection status
- `mqtt.connected`: MQTT connection status
- `mqtt.lastError`: Last MQTT error message (if any)
- `battery.level`: Battery percentage (0-100)
- `battery.charging`: Whether battery is currently charging
- `battery.voltage`: Battery voltage in volts (optional)
- `sensors.*`: Individual sensor health status
- `firmwareVersion`: Current firmware version string
- `uptime`: Device uptime in seconds
- `timestamp`: ISO 8601 timestamp

---

### 3. Command Topic

**Topic**: `opticalsense/device/{deviceId}/command`

**Publisher**: Backend

**Subscriber**: ESP32

**QoS**: 2

**Retain**: false

**Description**: Commands sent from backend to ESP32 for device control. Uses QoS 2 to ensure exactly-once delivery for critical operations.

**JSON Payload Schema**:
```json
{
  "command": "string (command type)",
  "commandId": "string (UUID)",
  "params": "object (command-specific parameters)",
  "timestamp": "string (ISO 8601)"
}
```

**Example Payload (start_test)**:
```json
{
  "command": "start_test",
  "commandId": "cmd-abc123-def456",
  "params": {
    "testId": "test-xyz789",
    "patientId": "pat-abc123",
    "toothOfInterest": "16"
  },
  "timestamp": "2024-01-15T10:35:00Z"
}
```

**Example Payload (stop_test)**:
```json
{
  "command": "stop_test",
  "commandId": "cmd-def456-ghi789",
  "params": {
    "testId": "test-xyz789"
  },
  "timestamp": "2024-01-15T10:40:00Z"
}
```

**Example Payload (restart)**:
```json
{
  "command": "restart",
  "commandId": "cmd-ghi789-jkl012",
  "params": {},
  "timestamp": "2024-01-15T11:00:00Z"
}
```

**Supported Commands**:
- `start_test`: Begin a new test session
- `stop_test`: End current test session
- `restart`: Restart the device
- `factory_reset`: Reset to factory settings
- `calibrate`: Calibrate sensors
- `ping`: Health check
- `update_firmware`: Trigger OTA update

**Field Descriptions**:
- `command`: Type of command to execute
- `commandId`: Unique identifier for this command instance
- `params`: Command-specific parameters (varies by command type)
- `timestamp`: ISO 8601 timestamp when command was issued

---

### 4. Command Response Topic

**Topic**: `opticalsense/device/{deviceId}/command/response`

**Publisher**: ESP32

**Subscriber**: Backend

**QoS**: 2

**Retain**: false

**Description**: Acknowledgment and response to commands. ESP32 must publish this for every command received.

**JSON Payload Schema**:
```json
{
  "commandId": "string (UUID)",
  "command": "string",
  "status": "string (acknowledged|completed|failed|rejected)",
  "result": "object (command-specific result)",
  "error": "string (error message if failed)",
  "timestamp": "string (ISO 8601)"
}
```

**Example Payload (acknowledged)**:
```json
{
  "commandId": "cmd-abc123-def456",
  "command": "start_test",
  "status": "acknowledged",
  "result": {},
  "error": null,
  "timestamp": "2024-01-15T10:35:01Z"
}
```

**Example Payload (completed)**:
```json
{
  "commandId": "cmd-def456-ghi789",
  "command": "stop_test",
  "status": "completed",
  "result": {
    "samplesCount": 600,
    "duration": 60
  },
  "error": null,
  "timestamp": "2024-01-15T10:40:02Z"
}
```

**Example Payload (failed)**:
```json
{
  "commandId": "cmd-ghi789-jkl012",
  "command": "calibrate",
  "status": "failed",
  "result": {},
  "error": "Sensor not responding",
  "timestamp": "2024-01-15T11:00:05Z"
}
```

**Status Values**:
- `acknowledged`: Command received and accepted, processing started
- `completed`: Command executed successfully
- `failed`: Command execution failed
- `rejected`: Command rejected (invalid parameters, wrong state, etc.)

**Field Descriptions**:
- `commandId`: Must match the commandId from the original command
- `command`: Type of command being responded to
- `status`: Execution status
- `result`: Command-specific result data (varies by command)
- `error`: Error message if status is failed or rejected
- `timestamp`: ISO 8601 timestamp of response

---

### 5. Pair Request Topic

**Topic**: `opticalsense/device/{deviceId}/pair/request`

**Publisher**: ESP32

**Subscriber**: Backend

**QoS**: 2

**Retain**: false

**Description**: Initiated by ESP32 during pairing process. Contains generated pairing code and device information.

**JSON Payload Schema**:
```json
{
  "deviceId": "string",
  "pairingCode": "string (6 digits)",
  "firmwareVersion": "string",
  "macAddress": "string (optional)",
  "timestamp": "string (ISO 8601)"
}
```

**Example Payload**:
```json
{
  "deviceId": "OS-ESP32-123456",
  "pairingCode": "123456",
  "firmwareVersion": "1.0.0",
  "macAddress": "AA:BB:CC:DD:EE:FF",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

**Field Descriptions**:
- `deviceId`: Unique device identifier
- `pairingCode`: 6-digit numeric code (000000-999999)
- `firmwareVersion`: Current firmware version
- `macAddress`: Device MAC address (optional, for verification)
- `timestamp`: ISO 8601 timestamp

---

### 6. Pair Response Topic

**Topic**: `opticalsense/device/{deviceId}/pair/response`

**Publisher**: Backend

**Subscriber**: ESP32

**QoS**: 2

**Retain**: false

**Description**: Response to pairing request from backend. Contains clinic credentials and configuration if pairing successful.

**JSON Payload Schema**:
```json
{
  "deviceId": "string",
  "status": "string (success|failed|expired)",
  "clinicId": "string (if success)",
  "clinicName": "string (if success)",
  "mqttCredentials": {
    "username": "string (if success)",
    "password": "string (if success)"
  },
  "apiEndpoint": "string (if success)",
  "error": "string (if failed)",
  "timestamp": "string (ISO 8601)"
}
```

**Example Payload (success)**:
```json
{
  "deviceId": "OS-ESP32-123456",
  "status": "success",
  "clinicId": "clinic-abc123",
  "clinicName": "Dental Clinic XYZ",
  "mqttCredentials": {
    "username": "device-123456",
    "password": "secret-password-hash"
  },
  "apiEndpoint": "https://api.opticalsense.io",
  "error": null,
  "timestamp": "2024-01-15T10:31:00Z"
}
```

**Example Payload (failed)**:
```json
{
  "deviceId": "OS-ESP32-123456",
  "status": "failed",
  "clinicId": null,
  "clinicName": null,
  "mqttCredentials": null,
  "apiEndpoint": null,
  "error": "Invalid pairing code",
  "timestamp": "2024-01-15T10:31:00Z"
}
```

**Status Values**:
- `success`: Pairing successful, credentials provided
- `failed`: Pairing failed (invalid code, server error, etc.)
- `expired`: Pairing code expired (5-minute timeout)

**Field Descriptions**:
- `deviceId`: Device identifier being paired
- `status`: Pairing operation status
- `clinicId`: Unique clinic identifier (if successful)
- `clinicName`: Human-readable clinic name (if successful)
- `mqttCredentials`: MQTT credentials for the device (if successful)
- `apiEndpoint`: Backend API endpoint URL (if successful)
- `error`: Error message if status is failed or expired
- `timestamp`: ISO 8601 timestamp

---

### 7. Heartbeat Topic

**Topic**: `opticalsense/device/{deviceId}/heartbeat`

**Publisher**: ESP32

**Subscriber**: Backend

**QoS**: 0

**Retain**: false

**Description**: Keep-alive signal published every 30 seconds. Backend uses this to determine device online/offline status.

**JSON Payload Schema**:
```json
{
  "deviceId": "string",
  "uptime": "number (seconds)",
  "batteryPct": "number (0-100)",
  "rssi": "number (dBm)",
  "timestamp": "string (ISO 8601)"
}
```

**Example Payload**:
```json
{
  "deviceId": "OS-ESP32-123456",
  "uptime": 3630,
  "batteryPct": 91,
  "rssi": -57,
  "timestamp": "2024-01-15T10:30:30Z"
}
```

**Field Descriptions**:
- `deviceId`: Device identifier
- `uptime`: Device uptime in seconds
- `batteryPct`: Current battery percentage
- `rssi`: WiFi signal strength in dBm
- `timestamp`: ISO 8601 timestamp

---

## Topic Subscription Requirements

### ESP32 Subscriptions

The ESP32 must subscribe to the following topics on startup:

1. `opticalsense/device/{deviceId}/command` (QoS 2)
2. `opticalsense/device/{deviceId}/pair/response` (QoS 2)

During pairing mode (unpaired state):
- Only subscribe to `opticalsense/device/{deviceId}/pair/response`

During paired mode:
- Subscribe to both topics above

### Backend Subscriptions

The backend must subscribe to the following topics:

1. `opticalsense/device/+/telemetry` (QoS 1) - Wildcard for all devices
2. `opticalsense/device/+/status` (QoS 1) - Wildcard for all devices
3. `opticalsense/device/+/command/response` (QoS 2) - Wildcard for all devices
4. `opticalsense/device/+/pair/request` (QoS 2) - Wildcard for all devices
5. `opticalsense/device/+/heartbeat` (QoS 0) - Wildcard for all devices

The backend uses wildcard subscriptions (`+`) to receive messages from all devices and routes them based on the deviceId extracted from the topic.

## Message Size Limits

- **Maximum payload size**: 256 KB (HiveMQ Cloud limit)
- **Typical telemetry payload**: ~200 bytes
- **Typical status payload**: ~300 bytes
- **Typical command payload**: ~150 bytes
- **Typical heartbeat payload**: ~100 bytes

## Connection Management

### MQTT Connection Parameters

- **Clean Session**: true (for ESP32)
- **Keep Alive**: 60 seconds
- **Auto Reconnect**: true
- **Reconnect Delay**: Exponential backoff starting at 1s, max 60s
- **Last Will and Testament**: 
  - Topic: `opticalsense/device/{deviceId}/status`
  - Payload: `{"status": "offline", "timestamp": "..."}`
  - QoS: 1
  - Retain: true

### Connection Sequence

1. ESP32 connects to MQTT broker with TLS
2. ESP32 subscribes to required topics
3. ESP32 publishes retained status message
4. ESP32 starts heartbeat timer
5. Backend receives status and marks device online

### Disconnection Handling

- **ESP32 disconnect**: Backend marks device offline after 90 seconds without heartbeat
- **Backend disconnect**: ESP32 attempts reconnection with exponential backoff
- **Network failure**: Both sides attempt reconnection

## Security

### Authentication

- Device-specific username/password
- Credentials provisioned during pairing
- Credentials stored securely in NVS (encrypted)
- Credentials rotated periodically (optional)

### TLS Configuration

- Protocol: TLS 1.2 or 1.3
- Certificate validation: Enabled
- Cipher suites: Strong ciphers only
- Certificate pinning: Optional (for enhanced security)

### Authorization

- Topic ACLs restrict devices to their own topics
- Devices cannot publish to other device topics
- Devices cannot subscribe to wildcard topics
- Backend has full access to all topics

## Error Handling

### Publish Errors

- **QoS 1/2 messages**: Automatic retry by MQTT client
- **Persistent failures**: Log error, attempt reconnection
- **Buffer full**: Implement message queue with priority

### Subscribe Errors

- **Authorization failure**: Log error, enter error state
- **Network failure**: Automatic reconnection
- **Topic not found**: Continue operation (topic may not exist yet)

### Connection Errors

- **Authentication failure**: Enter pairing mode (credentials invalid)
- **TLS failure**: Log error, attempt reconnection
- **Network timeout**: Exponential backoff retry

## Testing

### MQTT Test Tools

- MQTT Explorer: GUI for MQTT debugging
- mosquitto_pub/sub: Command-line tools
- HiveMQ MQTT Client: Web-based client

### Test Scenarios

1. **Basic connectivity**: Connect, publish, subscribe
2. **QoS testing**: Verify QoS 0, 1, 2 behavior
3. **Retain testing**: Verify retained messages
4. **Reconnection testing**: Test automatic reconnection
5. **Error handling**: Test various error scenarios
6. **Load testing**: Test with 10Hz telemetry rate

## Performance

### Expected Latency

- **ESP32 to Backend**: < 100ms (typical)
- **Backend to ESP32**: < 100ms (typical)
- **Round-trip command**: < 500ms

### Bandwidth

- **Idle device**: ~1 KB/min (heartbeat only)
- **Active test**: ~2 KB/s (telemetry at 10Hz)
- **Status updates**: ~300 bytes per change

## Versioning

### Protocol Version

- Current version: 1.0
- Version included in status payload
- Breaking changes require version increment
- Backward compatibility maintained for minor versions

### Future Extensions

- Additional commands as features are added
- New telemetry fields as sensors are added
- Additional status fields for new capabilities
- Firmware update topic (planned)

## References

- MQTT 3.1.1 Specification: http://docs.oasis-open.org/mqtt/mqtt/v3.1.1/mqtt-v3.1.1.html
- MQTT 5.0 Specification: https://docs.oasis-open.org/mqtt/mqtt/v5.0/mqtt-v5.0.html
- HiveMQ Cloud Documentation: https://www.hivemq.com/docs/hivemq-cloud/
