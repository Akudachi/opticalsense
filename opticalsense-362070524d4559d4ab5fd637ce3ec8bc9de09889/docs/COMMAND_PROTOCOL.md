# Command Protocol

## Overview

This document specifies the complete command protocol that the ESP32 firmware must support. Commands are sent from the backend to the ESP32 via MQTT, and the ESP32 must respond with acknowledgments and results.

## Command Format

All commands follow this structure:

```json
{
  "command": "string",
  "commandId": "string (UUID)",
  "params": "object",
  "timestamp": "string (ISO 8601)"
}
```

### Command Fields

- **command**: Type of command to execute (required)
- **commandId**: Unique identifier for this command instance (required)
- **params**: Command-specific parameters (optional, varies by command)
- **timestamp**: ISO 8601 timestamp when command was issued (required)

## Response Format

All command responses follow this structure:

```json
{
  "commandId": "string (UUID)",
  "command": "string",
  "status": "string",
  "result": "object",
  "error": "string",
  "timestamp": "string (ISO 8601)"
}
```

### Response Fields

- **commandId**: Must match the commandId from the original command (required)
- **command**: Type of command being responded to (required)
- **status**: Execution status (required)
- **result**: Command-specific result data (optional)
- **error**: Error message if status is failed or rejected (optional)
- **timestamp**: ISO 8601 timestamp of response (required)

### Response Status Values

- **acknowledged**: Command received and accepted, processing started
- **completed**: Command executed successfully
- **failed**: Command execution failed
- **rejected**: Command rejected (invalid parameters, wrong state, etc.)

---

## Command: start_test

Initiate a new test session and begin streaming telemetry.

### Request

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

### Parameters

- **testId** (required): Unique identifier for the test session
- **patientId** (required): Patient identifier associated with the test
- **toothOfInterest** (optional): FDI notation of tooth being tested (e.g., "16")

### Acknowledgment Response

```json
{
  "commandId": "cmd-abc123-def456",
  "command": "start_test",
  "status": "acknowledged",
  "result": {
    "testId": "test-xyz789"
  },
  "error": null,
  "timestamp": "2024-01-15T10:35:01Z"
}
```

### Completion Response

```json
{
  "commandId": "cmd-abc123-def456",
  "command": "start_test",
  "status": "completed",
  "result": {
    "testId": "test-xyz789",
    "startedAt": "2024-01-15T10:35:01Z"
  },
  "error": null,
  "timestamp": "2024-01-15T10:35:01Z"
}
```

### Error Response

```json
{
  "commandId": "cmd-abc123-def456",
  "command": "start_test",
  "status": "failed",
  "result": {},
  "error": "Sensor initialization failed",
  "timestamp": "2024-01-15T10:35:02Z"
}
```

### Rejection Response

```json
{
  "commandId": "cmd-abc123-def456",
  "command": "start_test",
  "status": "rejected",
  "result": {},
  "error": "Device already has an active test",
  "timestamp": "2024-01-15T10:35:01Z"
}
```

### Expected Behavior

1. Validate command parameters (testId format, patientId format)
2. Check device state (must be idle, not already in test)
3. Initialize sensors
4. Set device state to "test_active"
5. Begin sampling sensors at 10Hz
6. Begin publishing telemetry to MQTT topic
7. Send acknowledgment response within 500ms
8. Send completion response when streaming starts

### Error Conditions

- Invalid testId format
- Invalid patientId format
- Device already in test_active state
- Sensor initialization failure
- Insufficient battery (< 20%)
- Sensor not connected

### Retry Logic

No automatic retry. Backend may resend command if no acknowledgment received within 5 seconds.

---

## Command: stop_test

Stop the current test session and finalize results.

### Request

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

### Parameters

- **testId** (required): Unique identifier of the test to stop

### Acknowledgment Response

```json
{
  "commandId": "cmd-def456-ghi789",
  "command": "stop_test",
  "status": "acknowledged",
  "result": {
    "testId": "test-xyz789"
  },
  "error": null,
  "timestamp": "2024-01-15T10:40:01Z"
}
```

### Completion Response

```json
{
  "commandId": "cmd-def456-ghi789",
  "command": "stop_test",
  "status": "completed",
  "result": {
    "testId": "test-xyz789",
    "stoppedAt": "2024-01-15T10:40:02Z",
    "samplesCount": 600,
    "durationSec": 60
  },
  "error": null,
  "timestamp": "2024-01-15T10:40:02Z"
}
```

### Error Response

```json
{
  "commandId": "cmd-def456-ghi789",
  "command": "stop_test",
  "status": "failed",
  "result": {},
  "error": "Failed to stop sensor sampling",
  "timestamp": "2024-01-15T10:40:02Z"
}
```

### Rejection Response

```json
{
  "commandId": "cmd-def456-ghi789",
  "command": "stop_test",
  "status": "rejected",
  "result": {},
  "error": "No active test with specified testId",
  "timestamp": "2024-01-15T10:40:01Z"
}
```

### Expected Behavior

1. Validate command parameters
2. Check device state (must be in test_active state)
3. Verify testId matches current active test
4. Stop sensor sampling
5. Stop publishing telemetry
6. Send final sample batch (if any buffered)
7. Set device state to "idle"
8. Send acknowledgment response within 500ms
9. Send completion response when stopped

### Error Conditions

- Invalid testId format
- No active test
- testId does not match current test
- Failed to stop sensors
- Failed to send final samples

### Retry Logic

No automatic retry. Backend may resend command if no acknowledgment received within 5 seconds.

---

## Command: restart

Restart the ESP32 device.

### Request

```json
{
  "command": "restart",
  "commandId": "cmd-ghi789-jkl012",
  "params": {},
  "timestamp": "2024-01-15T11:00:00Z"
}
```

### Parameters

None.

### Acknowledgment Response

```json
{
  "commandId": "cmd-ghi789-jkl012",
  "command": "restart",
  "status": "acknowledged",
  "result": {},
  "error": null,
  "timestamp": "2024-01-15T11:00:01Z"
}
```

### Completion Response

```json
{
  "commandId": "cmd-ghi789-jkl012",
  "command": "restart",
  "status": "completed",
  "result": {
    "restartingAt": "2024-01-15T11:00:02Z"
  },
  "error": null,
  "timestamp": "2024-01-15T11:00:02Z"
}
```

### Expected Behavior

1. Send acknowledgment response within 500ms
2. Stop all active operations
3. Disconnect from MQTT
4. Save any critical state to NVS
5. Send completion response
6. Trigger ESP32 restart (ESP.restart())

### Error Conditions

None (restart always succeeds).

### Retry Logic

No automatic retry. Device will restart regardless.

---

## Command: factory_reset

Reset device to factory settings (clear all stored credentials).

### Request

```json
{
  "command": "factory_reset",
  "commandId": "cmd-jkl012-mno345",
  "params": {},
  "timestamp": "2024-01-15T12:00:00Z"
}
```

### Parameters

None.

### Acknowledgment Response

```json
{
  "commandId": "cmd-jkl012-mno345",
  "command": "factory_reset",
  "status": "acknowledged",
  "result": {},
  "error": null,
  "timestamp": "2024-01-15T12:00:01Z"
}
```

### Completion Response

```json
{
  "commandId": "cmd-jkl012-mno345",
  "command": "factory_reset",
  "status": "completed",
  "result": {
    "resetAt": "2024-01-15T12:00:02Z"
  },
  "error": null,
  "timestamp": "2024-01-15T12:00:02Z"
}
```

### Error Response

```json
{
  "commandId": "cmd-jkl012-mno345",
  "command": "factory_reset",
  "status": "failed",
  "result": {},
  "error": "Failed to clear NVS storage",
  "timestamp": "2024-01-15T12:00:02Z"
}
```

### Expected Behavior

1. Send acknowledgment response within 500ms
2. Stop all active operations
3. Disconnect from MQTT
4. Clear all stored credentials from NVS:
   - WiFi credentials
   - MQTT credentials
   - Clinic credentials
   - Device configuration
5. Reset device state to "unpaired"
6. Send completion response
7. Restart device

### Error Conditions

- Failed to clear NVS storage
- NVS corruption

### Retry Logic

If factory reset fails, device should attempt to clear NVS on next boot.

---

## Command: calibrate

Calibrate sensors to improve measurement accuracy.

### Request

```json
{
  "command": "calibrate",
  "commandId": "cmd-mno345-pqr456",
  "params": {
    "sensor": "all"
  },
  "timestamp": "2024-01-15T13:00:00Z"
}
```

### Parameters

- **sensor** (optional): Sensor to calibrate
  - "all": Calibrate all sensors (default)
  - "red": Calibrate red PPG sensor only
  - "ir": Calibrate IR PPG sensor only
  - "temperature": Calibrate temperature sensor only

### Acknowledgment Response

```json
{
  "commandId": "cmd-mno345-pqr456",
  "command": "calibrate",
  "status": "acknowledged",
  "result": {
    "sensor": "all"
  },
  "error": null,
  "timestamp": "2024-01-15T13:00:01Z"
}
```

### Completion Response

```json
{
  "commandId": "cmd-mno345-pqr456",
  "command": "calibrate",
  "status": "completed",
  "result": {
    "sensor": "all",
    "calibratedAt": "2024-01-15T13:00:05Z",
    "calibration": {
      "red": {
        "offset": 0.0,
        "gain": 1.0
      },
      "ir": {
        "offset": 0.0,
        "gain": 1.0
      },
      "temperature": {
        "offset": 0.0,
        "gain": 1.0
      }
    }
  },
  "error": null,
  "timestamp": "2024-01-15T13:00:05Z"
}
```

### Error Response

```json
{
  "commandId": "cmd-mno345-pqr456",
  "command": "calibrate",
  "status": "failed",
  "result": {},
  "error": "Red sensor not responding",
  "timestamp": "2024-01-15T13:00:03Z"
}
```

### Expected Behavior

1. Validate command parameters
2. Check device state (must be idle)
3. Initialize calibration routine for specified sensor(s)
4. Perform calibration measurements
5. Calculate calibration coefficients
6. Store calibration data in NVS
7. Send acknowledgment response within 500ms
8. Send completion response when calibration completes

### Error Conditions

- Invalid sensor parameter
- Device in test_active state
- Sensor not responding
- Calibration failed (invalid readings)
- Failed to store calibration data

### Retry Logic

Backend may retry calibration if it fails. Calibration should not be retried automatically by the device.

---

## Command: ping

Health check command to verify device is responsive.

### Request

```json
{
  "command": "ping",
  "commandId": "cmd-pqr456-stu567",
  "params": {},
  "timestamp": "2024-01-15T14:00:00Z"
}
```

### Parameters

None.

### Acknowledgment Response

```json
{
  "commandId": "cmd-pqr456-stu567",
  "command": "ping",
  "status": "acknowledged",
  "result": {},
  "error": null,
  "timestamp": "2024-01-15T14:00:00Z"
}
```

### Completion Response

```json
{
  "commandId": "cmd-pqr456-stu567",
  "command": "ping",
  "status": "completed",
  "result": {
    "deviceId": "OS-ESP32-123456",
    "firmwareVersion": "1.0.0",
    "uptime": 3600,
    "batteryPct": 92,
    "state": "idle"
  },
  "error": null,
  "timestamp": "2024-01-15T14:00:00Z"
}
```

### Expected Behavior

1. Send acknowledgment response immediately
2. Gather device status information
3. Send completion response with status

### Error Conditions

None (ping always succeeds).

### Retry Logic

No retry needed. If no response, device is considered offline.

---

## Command: update_firmware

Trigger OTA firmware update (future feature).

### Request

```json
{
  "command": "update_firmware",
  "commandId": "cmd-stu567-vwx678",
  "params": {
    "version": "1.1.0",
    "url": "https://firmware.opticalsense.io/firmware-v1.1.0.bin",
    "checksum": "sha256:abc123..."
  },
  "timestamp": "2024-01-15T15:00:00Z"
}
```

### Parameters

- **version** (required): Target firmware version
- **url** (required): URL to download firmware binary
- **checksum** (required): SHA256 checksum of firmware binary

### Acknowledgment Response

```json
{
  "commandId": "cmd-stu567-vwx678",
  "command": "update_firmware",
  "status": "acknowledged",
  "result": {
    "version": "1.1.0"
  },
  "error": null,
  "timestamp": "2024-01-15T15:00:01Z"
}
```

### Completion Response

```json
{
  "commandId": "cmd-stu567-vwx678",
  "command": "update_firmware",
  "status": "completed",
  "result": {
    "version": "1.1.0",
    "downloadedAt": "2024-01-15T15:00:30Z",
    "verifiedAt": "2024-01-15T15:00:31Z",
    "installedAt": "2024-01-15T15:00:35Z"
  },
  "error": null,
  "timestamp": "2024-01-15T15:00:35Z"
}
```

### Error Response

```json
{
  "commandId": "cmd-stu567-vwx678",
  "command": "update_firmware",
  "status": "failed",
  "result": {},
  "error": "Checksum verification failed",
  "timestamp": "2024-01-15T15:00:32Z"
}
```

### Expected Behavior

1. Validate command parameters
2. Check device state (must be idle)
3. Check battery level (must be > 50%)
4. Download firmware from URL
5. Verify checksum
6. Install firmware
7. Restart device
8. Send acknowledgment response within 500ms
9. Send completion response before restart

### Error Conditions

- Invalid version format
- Invalid URL
- Invalid checksum format
- Device in test_active state
- Insufficient battery
- Download failed
- Checksum verification failed
- Installation failed

### Retry Logic

Backend may retry update if it fails. Device should not retry automatically.

---

## Command: get_config

Retrieve current device configuration.

### Request

```json
{
  "command": "get_config",
  "commandId": "cmd-vwx678-yza789",
  "params": {},
  "timestamp": "2024-01-15T16:00:00Z"
}
```

### Parameters

None.

### Acknowledgment Response

```json
{
  "commandId": "cmd-vwx678-yza789",
  "command": "get_config",
  "status": "acknowledged",
  "result": {},
  "error": null,
  "timestamp": "2024-01-15T16:00:00Z"
}
```

### Completion Response

```json
{
  "commandId": "cmd-vwx678-yza789",
  "command": "get_config",
  "status": "completed",
  "result": {
    "deviceId": "OS-ESP32-123456",
    "firmwareVersion": "1.0.0",
    "sampleRate": 10,
    "telemetryInterval": 100,
    "heartbeatInterval": 30,
    "calibration": {
      "red": {
        "offset": 0.0,
        "gain": 1.0,
        "calibratedAt": "2024-01-01T00:00:00Z"
      },
      "ir": {
        "offset": 0.0,
        "gain": 1.0,
        "calibratedAt": "2024-01-01T00:00:00Z"
      },
      "temperature": {
        "offset": 0.0,
        "gain": 1.0,
        "calibratedAt": "2024-01-01T00:00:00Z"
      }
    }
  },
  "error": null,
  "timestamp": "2024-01-15T16:00:00Z"
}
```

### Error Response

```json
{
  "commandId": "cmd-vwx678-yza789",
  "command": "get_config",
  "status": "failed",
  "result": {},
  "error": "Failed to read配置 from NVS",
  "timestamp": "2024-01-15T16:00:00Z"
}
```

### Expected Behavior

1. Read configuration from NVS
2. Send acknowledgment response immediately
3. Send completion response with configuration

### Error Conditions

- NVS read failure
- Configuration corruption

### Retry Logic

Backend may retry if read fails.

---

## Command: set_config

Update device configuration.

### Request

```json
{
  "command": "set_config",
  "commandId": "cmd-yza789-bcd890",
  "params": {
    "sampleRate": 10,
    "telemetryInterval": 100,
    "heartbeatInterval": 30
  },
  "timestamp": "2024-01-15T17:00:00Z"
}
```

### Parameters

- **sampleRate** (optional): Sensor sampling rate in Hz (1-100)
- **telemetryInterval** (optional): Telemetry publish interval in ms (50-1000)
- **heartbeatInterval** (optional): Heartbeat interval in seconds (10-300)

### Acknowledgment Response

```json
{
  "commandId": "cmd-yza789-bcd890",
  "command": "set_config",
  "status": "acknowledged",
  "result": {},
  "error": null,
  "timestamp": "2024-01-15T17:00:01Z"
}
```

### Completion Response

```json
{
  "commandId": "cmd-yza789-bcd890",
  "command": "set_config",
  "status": "completed",
  "result": {
    "updatedAt": "2024-01-15T17:00:01Z"
  },
  "error": null,
  "timestamp": "2024-01-15T17:00:01Z"
}
```

### Error Response

```json
{
  "commandId": "cmd-yza789-bcd890",
  "command": "set_config",
  "status": "failed",
  "result": {},
  "error": "Invalid sampleRate: must be between 1 and 100",
  "timestamp": "2024-01-15T17:00:01Z"
}
```

### Expected Behavior

1. Validate command parameters
2. Check device state (must be idle)
3. Update configuration in memory
4. Save configuration to NVS
5. Apply configuration changes
6. Send acknowledgment response within 500ms
7. Send completion response when saved

### Error Conditions

- Invalid parameter values
- Device in test_active state
- NVS write failure

### Retry Logic

Backend may retry if save fails.

---

## Command State Machine

### Device States

- **unpaired**: Device not paired with clinic (only pairing commands accepted)
- **idle**: Device paired and idle (all commands accepted except start_test if already active)
- **test_active**: Device actively streaming telemetry (only stop_test, restart, factory_reset accepted)
- **error**: Device in error state (only restart, factory_reset accepted)
- **calibrating**: Device calibrating sensors (only restart, factory_reset accepted)
- **updating**: Device updating firmware (only restart, factory_reset accepted)

### Command State Matrix

| Command | unpaired | idle | test_active | error | calibrating | updating |
|---------|----------|------|-------------|-------|-------------|----------|
| start_test | rejected | accepted | rejected | rejected | rejected | rejected |
| stop_test | rejected | rejected | accepted | rejected | rejected | rejected |
| restart | accepted | accepted | accepted | accepted | accepted | accepted |
| factory_reset | accepted | accepted | accepted | accepted | accepted | accepted |
| calibrate | rejected | accepted | rejected | rejected | rejected | rejected |
| ping | accepted | accepted | accepted | accepted | accepted | accepted |
| update_firmware | rejected | accepted | rejected | rejected | rejected | rejected |
| get_config | accepted | accepted | accepted | accepted | accepted | accepted |
| set_config | rejected | accepted | rejected | rejected | rejected | rejected |

---

## Command Processing Flow

### Standard Flow

1. Receive command via MQTT
2. Parse JSON payload
3. Validate command format
4. Validate command parameters
5. Check device state
6. Send acknowledgment response (status: acknowledged)
7. Execute command logic
8. Send completion response (status: completed or failed)

### Error Flow

1. Receive command via MQTT
2. Parse JSON payload
3. Validate command format
4. If validation fails:
   - Send error response (status: rejected)
   - Include error details
5. If validation passes:
   - Check device state
   - If state invalid:
     - Send error response (status: rejected)
     - Include error details
   - If state validation passes:
     - Execute command
     - If execution fails:
       - Send error response (status: failed)
       - Include error details

---

## Timeout Handling

### Command Timeout

- **Acknowledgment timeout**: 5 seconds
- **Completion timeout**: 60 seconds (varies by command)

If acknowledgment not received within timeout:
- Backend may retry command (max 3 retries)
- After 3 failures: mark command as failed

### Command-Specific Timeouts

- **start_test**: 5 seconds (ack), 10 seconds (completion)
- **stop_test**: 5 seconds (ack), 5 seconds (completion)
- **restart**: 5 seconds (ack), 5 seconds (completion)
- **factory_reset**: 5 seconds (ack), 10 seconds (completion)
- **calibrate**: 5 seconds (ack), 30 seconds (completion)
- **ping**: 5 seconds (ack), 5 seconds (completion)
- **update_firmware**: 5 seconds (ack), 300 seconds (completion)
- **get_config**: 5 seconds (ack), 5 seconds (completion)
- **set_config**: 5 seconds (ack), 5 seconds (completion)

---

## Error Codes

### Command Error Codes

Include in error response for programmatic handling:

```json
{
  "commandId": "cmd-abc123",
  "command": "start_test",
  "status": "rejected",
  "result": {},
  "error": "Device already has an active test",
  "errorCode": "INVALID_STATE"
}
```

### Error Code Definitions

- **INVALID_FORMAT**: Command JSON format invalid
- **INVALID_COMMAND**: Unknown command type
- **INVALID_PARAMS**: Command parameters invalid
- **INVALID_STATE**: Command not valid in current device state
- **SENSOR_ERROR**: Sensor operation failed
- **NVS_ERROR**: Non-volatile storage operation failed
- **NETWORK_ERROR**: Network operation failed
- **BATTERY_LOW**: Insufficient battery for operation
- **CALIBRATION_FAILED**: Calibration routine failed
- **DOWNLOAD_FAILED**: Firmware download failed
- **VERIFICATION_FAILED**: Firmware verification failed
- **INSTALLATION_FAILED**: Firmware installation failed

---

## Security Considerations

### Command Validation

- Validate all command parameters
- Sanitize all input data
- Check device state before execution
- Validate command format (JSON schema)
- Reject malformed commands

### Authorization

- Only accept commands from authenticated MQTT connection
- Verify command source (backend)
- Reject commands from unauthorized sources

### Rate Limiting

- Limit command rate to prevent abuse
- Implement command queue with priority
- Reject commands if queue full

---

## Testing

### Command Testing

Test each command with:

1. Valid parameters
2. Invalid parameters
3. Wrong device state
4. Network interruption
5. Timeout scenarios
6. Concurrent commands

### Test Scenarios

- Start test while test already active (should reject)
- Stop test with wrong testId (should reject)
- Calibrate during test (should reject)
- Factory reset during test (should accept)
- Restart during calibration (should accept)

---

## References

- MQTT Protocol Specification: See MQTT_PROTOCOL.md
- API Contract: See API_CONTRACT.md
- Sensor Data Schema: See SENSOR_DATA_SCHEMA.md
