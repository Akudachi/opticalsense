# ESP32 Integration Guide

## Overview

This document describes how the ESP32 firmware integrates with the OpticalSense web application. The ESP32 serves as the hardware device that captures sensor data and streams it to the cloud for real-time monitoring and analysis. The specific sensor hardware is configurable and can be adapted based on your requirements.

## System Architecture

The OpticalSense system consists of the following components:

1. **ESP32 Device** - Hardware device with sensors (configurable based on requirements), WiFi connectivity, and MQTT client
2. **MQTT Broker** (HiveMQ Cloud) - Real-time message broker for telemetry and commands
3. **Backend Server** - REST API + Socket.IO bridge for MQTT
4. **Web Application** - React-based clinical dashboard
5. **Database** (MongoDB Atlas) - Persistent storage for patients, tests, reports, and device records

## Communication Flow

```
ESP32 <---> MQTT Broker <---> Backend Server <---> Web Application
```

### ESP32 to Cloud Path

1. **Sensor Data Flow**
   - ESP32 reads connected sensors at configured rate (default: 10Hz)
   - Processes raw signals to compute metrics (configurable based on sensor type)
   - Publishes telemetry to MQTT topic: `opticalsense/device/{deviceId}/telemetry`
   - Backend subscribes to MQTT topic and bridges to Socket.IO
   - Web application receives real-time data via Socket.IO

2. **Status Updates**
   - ESP32 publishes device status to: `opticalsense/device/{deviceId}/status`
   - Includes WiFi signal, battery level, MQTT connection state
   - Backend updates device record in database

3. **Heartbeat**
   - ESP32 publishes heartbeat every 30 seconds to: `opticalsense/device/{deviceId}/heartbeat`
   - Backend marks device as online/offline based on heartbeat

### Cloud to ESP32 Path

1. **Commands**
   - Web application sends command via REST API to backend
   - Backend publishes to MQTT topic: `opticalsense/device/{deviceId}/command`
   - ESP32 subscribes to command topic and executes commands
   - ESP32 publishes acknowledgment to: `opticalsense/device/{deviceId}/command/response`

2. **Pairing**
   - ESP32 generates 6-digit pairing code
   - ESP32 publishes pairing request to: `opticalsense/device/{deviceId}/pair/request`
   - User enters code in web application
   - Backend validates and publishes pairing response to: `opticalsense/device/{deviceId}/pair/response`
   - ESP32 receives clinic credentials and stores them

## MQTT Workflow

### Topics

| Topic | Direction | Purpose |
|-------|-----------|---------|
| `opticalsense/device/{deviceId}/telemetry` | ESP32 → Cloud | Real-time sensor data |
| `opticalsense/device/{deviceId}/status` | ESP32 → Cloud | Device status updates |
| `opticalsense/device/{deviceId}/command` | Cloud → ESP32 | Command execution |
| `opticalsense/device/{deviceId}/command/response` | ESP32 → Cloud | Command acknowledgment |
| `opticalsense/device/{deviceId}/pair/request` | ESP32 → Cloud | Pairing initiation |
| `opticalsense/device/{deviceId}/pair/response` | Cloud → ESP32 | Pairing completion |
| `opticalsense/device/{deviceId}/heartbeat` | ESP32 → Cloud | Keep-alive signal |

### QoS and Retain

- **Telemetry**: QoS 1, retain false (real-time, no persistence)
- **Status**: QoS 1, retain true (last known state)
- **Commands**: QoS 2, retain false (exactly once delivery)
- **Heartbeat**: QoS 0, retain false (fire and forget)
- **Pairing**: QoS 2, retain false (critical transaction)

## Backend Workflow

### Device Registration

1. ESP32 boots and generates unique device ID (MAC address based)
2. ESP32 connects to WiFi using WiFi Manager
3. ESP32 connects to MQTT broker with device credentials
4. ESP32 publishes pairing request with generated 6-digit code
5. Backend creates pending device record
6. User enters pairing code in web application
7. Backend validates code and associates device with clinic
8. Backend publishes pairing response with clinic credentials
9. ESP32 stores credentials and switches to paired mode

### Test Execution

1. User selects patient and device in web application
2. User clicks "Start Test"
3. Backend creates test record in database
4. Backend publishes `start_test` command to device
5. ESP32 acknowledges and begins streaming telemetry
6. Web application displays real-time waveforms and metrics
7. User clicks "Stop Test"
8. Backend publishes `stop_test` command to device
9. ESP32 stops streaming and sends final sample batch
10. Backend computes summary and pulp verdict
11. Backend updates test record with results

### Device Monitoring

1. Backend subscribes to all device topics
2. Backend updates device status on heartbeat
3. Backend marks device offline after 90 seconds without heartbeat
4. Backend logs device online/offline events to activity feed

## Device Lifecycle

### 1. Unpaired State

- Device boots with factory settings
- No clinic credentials stored
- WiFi Manager active for network configuration
- MQTT connection using temporary credentials
- Only pairing operations allowed
- Telemetry streaming disabled

### 2. Pairing State

- Device generates 6-digit pairing code
- Displays code on LED/serial
- Publishes pairing request
- Waits for pairing response (5-minute timeout)
- On success: stores clinic credentials, transitions to paired state
- On timeout: generates new code, retries

### 3. Paired State

- Device has clinic credentials stored
- Connects to WiFi using saved network
- Connects to MQTT broker with device credentials
- Publishes telemetry, status, heartbeat
- Accepts commands from backend
- Normal operating mode

### 4. Test Active State

- Device received `start_test` command
- Streaming telemetry at 10Hz
- Computing real-time metrics
- Accepting `stop_test` command
- Rejecting other commands (except emergency stop)

### 5. Error State

- Critical error detected (sensor failure, WiFi disconnect, etc.)
- Stops telemetry streaming
- Publishes error status
- Attempts recovery (reconnect, restart)
- If unrecoverable: enters factory reset mode

### 6. Factory Reset State

- User-initiated or critical failure
- Clears all stored credentials
- Returns to unpaired state
- Requires re-pairing

## Pairing Workflow

### Step-by-Step

1. **Device Initialization**
   - ESP32 boots
   - Checks NVS for stored clinic credentials
   - If none found: enter pairing mode

2. **WiFi Configuration**
   - Start WiFi Manager AP
   - User connects to "OpticalSense-Setup" WiFi
   - User configures network credentials
   - ESP32 connects to configured network

3. **MQTT Connection**
   - ESP32 connects to MQTT broker with temporary credentials
   - Subscribe to: `opticalsense/device/{deviceId}/pair/response`
   - Subscribe to: `opticalsense/device/{deviceId}/command`

4. **Pairing Code Generation**
   - Generate random 6-digit code (000000-999999)
   - Display on LED matrix or serial monitor
   - Publish pairing request:
     ```json
     {
       "deviceId": "OS-ESP32-123456",
       "pairingCode": "123456",
       "firmwareVersion": "1.0.0",
       "timestamp": "2024-01-15T10:30:00Z"
     }
     ```

5. **Backend Processing**
   - Backend receives pairing request
   - Creates pending device record
   - Waits for user to enter code in web application

6. **User Pairing**
   - User navigates to Devices page in web application
   - Clicks "Pair Device"
   - Enters 6-digit code
   - Backend validates code
   - Backend associates device with clinic
   - Backend publishes pairing response:
     ```json
     {
       "deviceId": "OS-ESP32-123456",
       "clinicId": "clinic-abc123",
       "clinicName": "Dental Clinic XYZ",
       "mqttCredentials": {
         "username": "device-123456",
         "password": "secret-password"
       },
       "apiEndpoint": "https://api.opticalsense.io",
       "timestamp": "2024-01-15T10:31:00Z"
     }
     ```

7. **Device Completion**
   - ESP32 receives pairing response
   - Validates response signature
   - Stores credentials in NVS
   - Reconnects to MQTT with device credentials
   - Publishes status: "paired"
   - Transition to paired state

## Live Mode Workflow

### Prerequisites

- Device is paired with clinic
- Device is online (heartbeat received within 90 seconds)
- User is authenticated in web application
- Backend is connected to MQTT broker

### Test Execution

1. **Test Setup**
   - User selects patient from patient list
   - User selects device from device list
   - User optionally specifies tooth of interest (FDI notation)
   - User clicks "Start Test"

2. **Backend Processing**
   - Backend validates device is online
   - Backend creates test record:
     ```json
     {
       "id": "test-xyz789",
       "patientId": "pat-abc123",
       "deviceId": "dev-def456",
       "doctorId": "doc-ghi789",
       "startedAt": "2024-01-15T10:35:00Z",
       "status": "in_progress",
       "toothOfInterest": "16"
     }
     ```
   - Backend publishes `start_test` command:
     ```json
     {
       "command": "start_test",
       "testId": "test-xyz789",
       "patientId": "pat-abc123",
       "timestamp": "2024-01-15T10:35:00Z"
     }
     ```

3. **Device Processing**
   - ESP32 receives command
   - Validates test ID format
   - Acknowledges command:
     ```json
     {
       "command": "start_test",
       "testId": "test-xyz789",
       "status": "acknowledged",
       "timestamp": "2024-01-15T10:35:01Z"
     }
     ```
   - Activates sensor sampling
   - Begins telemetry streaming

4. **Telemetry Streaming**
   - ESP32 samples sensors at 10Hz
   - Processes each sample:
     - Filters noise
     - Computes SpO₂ from Red/IR ratio
     - Detects pulse peaks
     - Measures temperature
     - Calculates signal quality
     - Determines confidence level
   - Publishes telemetry:
     ```json
     {
       "testId": "test-xyz789",
       "t": 1234,
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

5. **Real-time Display**
   - Backend receives telemetry via MQTT
   - Bridges to Socket.IO room: `test-{testId}`
   - Web application receives samples via Socket.IO
   - Displays waveform charts
   - Updates metrics display
   - Stores samples in memory buffer

6. **Test Completion**
   - User clicks "Stop Test"
   - Backend publishes `stop_test` command:
     ```json
     {
       "command": "stop_test",
       "testId": "test-xyz789",
       "timestamp": "2024-01-15T10:40:00Z"
     }
     ```
   - ESP32 acknowledges and stops streaming
   - ESP32 sends final sample batch
   - Backend computes summary statistics
   - Backend determines pulp verdict:
     - Vital: SpO₂ ≥ 94%, pulse 50-110 bpm, high confidence
     - Non-vital: SpO₂ < 94% or pulse outside range, high confidence
     - Inconclusive: low confidence
   - Backend updates test record
   - Backend generates activity event

## Demo Mode Workflow

### Overview

Demo mode allows the web application to function without hardware. The mock service layer simulates device behavior and generates realistic PPG data.

### Mock Sensor Stream

- Generates synthetic PPG waveforms
- Simulates heart rate variability
- Adds realistic noise
- Computes derived metrics
- Emits samples at 10Hz via callback

### Demo Device Behavior

- Mock device always online
- Mock device has fixed credentials
- Mock device responds to all commands
- Mock device simulates pairing delay

### Demo Test Execution

- Same workflow as live mode
- Uses mock sensor stream instead of MQTT
- Generates realistic test results
- Stores data in browser localStorage

## Expected Firmware Behavior

### Startup Sequence

1. Initialize hardware (sensors, WiFi, MQTT)
2. Check NVS for stored credentials
3. If no credentials: enter pairing mode
4. If credentials exist: connect to WiFi
5. Connect to MQTT broker
6. Subscribe to command topic
7. Publish status: "online"
8. Start heartbeat timer (30s interval)
9. Enter idle state

### Idle State Behavior

- Maintain MQTT connection
- Publish heartbeat every 30s
- Monitor sensor health
- Accept commands
- Do not stream telemetry

### Test Active State Behavior

- Stream telemetry at 10Hz
- Monitor for stop command
- Detect sensor disconnection
- Detect low battery
- Compute real-time metrics
- Maintain signal quality assessment

### Error Handling

- **WiFi Disconnect**: Attempt reconnection (exponential backoff, max 5 min)
- **MQTT Disconnect**: Attempt reconnection (exponential backoff, max 5 min)
- **Sensor Failure**: Publish error status, attempt sensor reset
- **Low Battery**: Publish warning, continue operation until critical
- **Invalid Command**: Publish error response, ignore command
- **Timeout**: Retry operation with backoff, log error

### Recovery Logic

- **Transient Errors**: Automatic retry with exponential backoff
- **Persistent Errors**: Enter error state, await user intervention
- **Critical Errors**: Factory reset after 10 consecutive failures
- **Network Recovery**: Resume normal operation automatically

### Watchdog

- Hardware watchdog timer: 60 seconds
- Software watchdog: Monitor main loop execution
- Feed watchdog in main loop
- Watchdog trigger: device reset

### Power Management

- Deep sleep when idle (optional)
- Wake on command via MQTT
- Battery monitoring every 60s
- Low battery warning at 20%
- Critical battery shutdown at 5%

### Firmware Updates

- Check for updates on boot (optional)
- Download OTA firmware from backend
- Verify firmware signature
- Apply update
- Reboot

## Security Considerations

### MQTT Security

- Use TLS (MQTTS) on port 8883
- Device-specific credentials
- Client certificate authentication (optional)
- Topic ACLs (device can only publish/subscribe to its own topics)

### Data Security

- Encrypt sensitive data at rest (clinic credentials)
- Use secure MQTT credentials
- Validate all incoming commands
- Rate limit command processing

### Network Security

- Use WPA2/WPA3 for WiFi
- Validate WiFi certificates (enterprise networks)
- Use secure MQTT broker (HiveMQ Cloud with TLS)

## Performance Requirements

### Latency

- Command acknowledgment: < 500ms
- Telemetry publish: < 100ms per sample
- WiFi connection: < 10s
- MQTT connection: < 5s

### Throughput

- Telemetry rate: 10 samples/second
- Sample size: ~200 bytes
- Total bandwidth: ~2 KB/s

### Reliability

- MQTT connection uptime: > 99%
- Command success rate: > 99.9%
- Data loss rate: < 0.1%

## Hardware Requirements

### Minimum Specifications

- ESP32-WROOM-32 or equivalent
- Red PPG sensor (e.g., MAX30101)
- IR PPG sensor (e.g., MAX30101)
- Temperature sensor (e.g., built-in ESP32)
- WiFi antenna
- Battery monitoring circuit
- LED indicator (optional)
- Button for factory reset (optional)

### Pin Assignments (Example)

- GPIO 21: I2C SDA (sensor)
- GPIO 22: I2C SCL (sensor)
- GPIO 4: Battery ADC
- GPIO 2: Status LED
- GPIO 0: Factory reset button

## Testing

### Unit Testing

- Test each module independently
- Mock hardware dependencies
- Validate error handling
- Test edge cases

### Integration Testing

- Test MQTT communication
- Test command processing
- Test sensor integration
- Test error recovery

### System Testing

- Test full pairing workflow
- Test full test execution
- Test error scenarios
- Test long-running operation

## Troubleshooting

### Common Issues

1. **Device not pairing**
   - Check WiFi connection
   - Check MQTT broker connectivity
   - Verify pairing code
   - Check backend logs

2. **Telemetry not streaming**
   - Verify device is online
   - Check MQTT subscription
   - Verify command acknowledgment
   - Check sensor health

3. **High latency**
   - Check WiFi signal strength
   - Check MQTT broker load
   - Check network bandwidth
   - Optimize firmware code

4. **Frequent disconnections**
   - Check WiFi stability
   - Check MQTT keep-alive settings
   - Check power supply stability
   - Review watchdog configuration

## References

- MQTT Specification: http://mqtt.org/
- ESP32 Documentation: https://docs.espressif.com/projects/esp-idf/
- HiveMQ Cloud: https://www.hivemq.com/cloud/
- MAX30101 Datasheet: https://www.maximintegrated.com/
