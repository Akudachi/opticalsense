# Sensor Data Schema

## Overview

This document defines the complete sensor data schema used by OpticalSense. All sensor data follows a consistent structure for telemetry streaming, test storage, and reporting. The schema is designed to be flexible and accommodate different sensor types.

## Sensor Sample Schema

### Core Sensor Sample

A single sensor sample represents one measurement point in time, captured at the configured rate during active tests.

```json
{
  "t": "number",
  "sensor1": "number",
  "sensor2": "number",
  "metric1": "number",
  "metric2": "number",
  "temperature": "number",
  "batteryPct": "number",
  "signalQuality": "number",
  "confidence": "string"
}
```

**Note**: The field names `sensor1`, `sensor2`, `metric1`, `metric2` are placeholders. Actual field names should be descriptive based on your specific sensor configuration (e.g., `red`, `ir`, `spo2`, `pulse`, etc.).

### Field Definitions

#### t (Time Offset)

- **Type**: number
- **Unit**: milliseconds (ms)
- **Description**: Time offset in milliseconds since the test started
- **Valid Range**: 0 to 3,600,000 (0 to 60 minutes)
- **Example**: 12345
- **Notes**: Used for waveform alignment and duration calculation

#### sensor1, sensor2, ... (Raw Sensor Values)

- **Type**: number
- **Unit**: Depends on sensor (ADC units, volts, etc.)
- **Description**: Raw sensor readings from connected sensors
- **Valid Range**: Depends on sensor specifications
- **Example**: 28500
- **Notes**: Field names should be descriptive (e.g., `red`, `ir`, `accelX`, `gyroY`, etc.)

#### metric1, metric2, ... (Computed Metrics)

- **Type**: number
- **Unit**: Depends on metric (percentage, BPM, etc.)
- **Description**: Computed values derived from raw sensor data
- **Valid Range**: Depends on metric
- **Example**: 97.5
- **Notes**: Field names should be descriptive (e.g., `spo2`, `pulse`, `heartRate`, etc.)

#### batteryPct (Battery Percentage)

- **Type**: number
- **Unit**: percentage (%)
- **Description**: Current battery level
- **Valid Range**: 0 to 100
- **Example**: 92
- **Thresholds**:
  - > 50%: Good
  - 20-50%: Moderate
  - < 20%: Low (warning)
  - < 5%: Critical (shutdown imminent)

#### signalQuality (Signal Quality)

- **Type**: number
- **Unit**: percentage (%)
- **Description**: Overall quality of the PPG signal
- **Valid Range**: 0 to 100
- **Example**: 88
- **Calculation**: Based on signal-to-noise ratio, motion artifact detection, and waveform regularity
- **Thresholds**:
  - ≥ 80: High quality
  - 60-79: Medium quality
  - < 60: Low quality
- **Factors**:
  - Signal-to-noise ratio
  - Motion artifact presence
  - Waveform regularity
  - Sensor contact quality

#### confidence (Measurement Confidence)

- **Type**: string (enum)
- **Description**: Confidence level in the computed metrics
- **Valid Values**: "low", "medium", "high"
- **Example**: "high"
- **Determination**:
  - **high**: signalQuality ≥ 82, stable pulse detection
  - **medium**: signalQuality 68-81, acceptable pulse detection
  - **low**: signalQuality < 68, unreliable pulse detection
- **Clinical Impact**:
  - High confidence: Metrics reliable for clinical decisions
  - Medium confidence: Metrics usable with caution
  - Low confidence: Metrics not reliable, repeat measurement

---

## Extended Sensor Sample (with Context)

### Test Context Sample

When stored with test context, the sample includes additional metadata:

```json
{
  "testId": "string",
  "deviceId": "string",
  "patientId": "string",
  "timestamp": "string",
  "t": "number",
  "red": "number",
  "ir": "number",
  "spo2": "number",
  "pulse": "number",
  "temperature": "number",
  "batteryPct": "number",
  "signalQuality": "number",
  "confidence": "string"
}
```

### Additional Field Definitions

#### testId

- **Type**: string
- **Description**: Unique identifier for the test session
- **Format**: `test-{uuid}`
- **Example**: "test-abc123-def456-ghi789"
- **Purpose**: Links sample to specific test record

#### deviceId

- **Type**: string
- **Description**: Hardware identifier of the ESP32 device
- **Format**: `OS-ESP32-{6-digit-code}` or custom
- **Example**: "OS-ESP32-123456"
- **Purpose**: Identifies which device captured the sample

#### patientId

- **Type**: string
- **Description**: Patient identifier associated with the test
- **Format**: `pat-{uuid}`
- **Example**: "pat-abc123-def456-ghi789"
- **Purpose**: Links sample to patient record

#### timestamp

- **Type**: string
- **Description**: Absolute timestamp when sample was captured
- **Format**: ISO 8601 (UTC)
- **Example**: "2024-01-15T10:35:01.234Z"
- **Purpose**: Absolute time reference for data analysis

---

## Device Status Schema

### Device Status

Device status published periodically and on state changes:

```json
{
  "deviceId": "string",
  "status": "string",
  "wifi": {
    "ssid": "string",
    "rssi": "number",
    "connected": "boolean"
  },
  "mqtt": {
    "connected": "boolean",
    "lastError": "string"
  },
  "battery": {
    "level": "number",
    "charging": "boolean",
    "voltage": "number"
  },
  "sensors": {
    "red": "string",
    "ir": "string",
    "temperature": "string"
  },
  "firmwareVersion": "string",
  "uptime": "number",
  "timestamp": "string"
}
```

### Field Definitions

#### deviceId

- **Type**: string
- **Description**: Unique device identifier
- **Format**: `OS-ESP32-{6-digit-code}` or custom
- **Example**: "OS-ESP32-123456"

#### status

- **Type**: string (enum)
- **Description**: Current device operational state
- **Valid Values**: "online", "offline", "error", "pairing"
- **Example**: "online"

#### wifi (WiFi Status)

- **ssid**: string - Connected WiFi network name
- **rssi**: number - Signal strength in dBm (-30 to -90 typical)
- **connected**: boolean - WiFi connection status

#### mqtt (MQTT Status)

- **connected**: boolean - MQTT connection status
- **lastError**: string (optional) - Last error message

#### battery (Battery Status)

- **level**: number (0-100) - Battery percentage
- **charging**: boolean - Whether battery is charging
- **voltage**: number (optional) - Battery voltage in volts (3.0-4.2 typical)

#### sensors (Sensor Status)

- **red**: string (enum) - "ok", "error", "disconnected"
- **ir**: string (enum) - "ok", "error", "disconnected"
- **temperature**: string (enum) - "ok", "error", "disconnected"

#### firmwareVersion

- **Type**: string
- **Description**: Current firmware version
- **Format**: Semantic versioning (MAJOR.MINOR.PATCH)
- **Example**: "1.0.0"

#### uptime

- **Type**: number
- **Unit**: seconds
- **Description**: Device uptime since last boot
- **Example**: 3600

#### timestamp

- **Type**: string
- **Format**: ISO 8601 (UTC)
- **Example**: "2024-01-15T10:30:00Z"

---

## Heartbeat Schema

### Heartbeat Message

Keep-alive signal published every 30 seconds:

```json
{
  "deviceId": "string",
  "uptime": "number",
  "batteryPct": "number",
  "rssi": "number",
  "timestamp": "string"
}
```

### Field Definitions

#### deviceId

- **Type**: string
- **Description**: Unique device identifier
- **Example**: "OS-ESP32-123456"

#### uptime

- **Type**: number
- **Unit**: seconds
- **Description**: Device uptime since last boot
- **Example**: 3630

#### batteryPct

- **Type**: number
- **Unit**: percentage (%)
- **Range**: 0-100
- **Example**: 91

#### rssi

- **Type**: number
- **Unit**: dBm
- **Range**: -30 to -90 typical
- **Example**: -57

#### timestamp

- **Type**: string
- **Format**: ISO 8601 (UTC)
- **Example**: "2024-01-15T10:30:30Z"

---

## Test Summary Schema

### Test Summary

Computed statistics for a completed test:

```json
{
  "avgSpO2": "number",
  "avgPulse": "number",
  "avgTemp": "number",
  "minSpO2": "number",
  "maxPulse": "number",
  "signalQuality": "number",
  "confidence": "string",
  "durationSec": "number"
}
```

### Field Definitions

#### avgSpO2

- **Type**: number
- **Unit**: percentage (%)
- **Description**: Average SpO₂ across all samples
- **Valid Range**: 70.0 to 100.0
- **Example**: 97.2
- **Calculation**: Mean of all spo2 values in the test

#### avgPulse

- **Type**: number
- **Unit**: beats per minute (BPM)
- **Description**: Average heart rate across all samples
- **Valid Range**: 30 to 200
- **Example**: 72
- **Calculation**: Mean of all pulse values in the test

#### avgTemp

- **Type**: number
- **Unit**: degrees Celsius (°C)
- **Description**: Average temperature across all samples
- **Valid Range**: 30.0 to 42.0
- **Example**: 36.5
- **Calculation**: Mean of all temperature values in the test

#### minSpO2

- **Type**: number
- **Unit**: percentage (%)
- **Description**: Minimum SpO₂ recorded during test
- **Valid Range**: 70.0 to 100.0
- **Example**: 95.0
- **Calculation**: Minimum of all spo2 values in the test

#### maxPulse

- **Type**: number
- **Unit**: beats per minute (BPM)
- **Description**: Maximum heart rate recorded during test
- **Valid Range**: 30 to 200
- **Example**: 85
- **Calculation**: Maximum of all pulse values in the test

#### signalQuality

- **Type**: number
- **Unit**: percentage (%)
- **Description**: Average signal quality across all samples
- **Valid Range**: 0 to 100
- **Example**: 85
- **Calculation**: Mean of all signalQuality values in the test

#### confidence

- **Type**: string (enum)
- **Description**: Overall confidence in test results
- **Valid Values**: "low", "medium", "high"
- **Example**: "high"
- **Calculation**: Based on average signal quality:
  - High: ≥ 82
  - Medium: 68-81
  - Low: < 68

#### durationSec

- **Type**: number
- **Unit**: seconds
- **Description**: Total duration of the test
- **Valid Range**: 1 to 3600 (1 second to 1 hour)
- **Example**: 60
- **Calculation**: (endedAt - startedAt) in seconds

---

## Data Validation Rules

### Sensor Sample Validation

- **t**: Must be non-negative, monotonically increasing
- **red**: Must be within 0-65,535
- **ir**: Must be within 0-65,535
- **spo2**: Must be within 70.0-100.0
- **pulse**: Must be within 30-200
- **temperature**: Must be within 30.0-42.0
- **batteryPct**: Must be within 0-100
- **signalQuality**: Must be within 0-100
- **confidence**: Must be one of: "low", "medium", "high"

### Device Status Validation

- **status**: Must be one of: "online", "offline", "error", "pairing"
- **wifi.rssi**: Must be within -100 to -30
- **battery.level**: Must be within 0-100
- **battery.voltage**: Must be within 2.5-4.5 (if provided)
- **firmwareVersion**: Must follow semantic versioning

### Test Summary Validation

- **avgSpO2**: Must be within 70.0-100.0
- **avgPulse**: Must be within 30-200
- **avgTemp**: Must be within 30.0-42.0
- **minSpO2**: Must be within 70.0-100.0
- **maxPulse**: Must be within 30-200
- **signalQuality**: Must be within 0-100
- **confidence**: Must be one of: "low", "medium", "high"
- **durationSec**: Must be positive

---

## Data Quality Flags

### Signal Quality Indicators

The firmware should flag samples with potential quality issues:

```json
{
  "t": 12345,
  "red": 28500,
  "ir": 42500,
  "spo2": 97.5,
  "pulse": 74,
  "temperature": 36.6,
  "batteryPct": 92,
  "signalQuality": 88,
  "confidence": "high",
  "flags": [
    "motion_artifact",
    "low_amplitude"
  ]
}
```

### Possible Flags

- **motion_artifact**: Motion detected during measurement
- **low_amplitude**: Signal amplitude below threshold
- **high_noise**: High noise level detected
- **sensor_disconnected**: Sensor momentarily disconnected
- **irregular_rhythm**: Irregular pulse pattern detected

---

## Data Storage Considerations

### Downsampling

For long-term storage, samples may be downsampled:

- **Raw storage**: 10 Hz (100 samples/second)
- **Test storage**: 10 Hz (all samples preserved)
- **Report storage**: 1 Hz (downsampled for charts)
- **Archive storage**: 0.1 Hz (summary data only)

### Compression

Consider compression for large sample arrays:

- **Delta encoding**: Store differences between consecutive values
- **Gzip compression**: Apply to sample arrays
- **Binary format**: Consider Protocol Buffers for efficiency

---

## Calibration Data

### Sensor Calibration

Calibration coefficients stored per device:

```json
{
  "deviceId": "string",
  "calibration": {
    "red": {
      "offset": "number",
      "gain": "number",
      "calibratedAt": "string"
    },
    "ir": {
      "offset": "number",
      "gain": "number",
      "calibratedAt": "string"
    },
    "temperature": {
      "offset": "number",
      "gain": "number",
      "calibratedAt": "string"
    }
  }
}
```

### Calibration Fields

- **offset**: Zero-point correction
- **gain**: Sensitivity correction
- **calibratedAt**: ISO 8601 timestamp of last calibration

---

## Error Codes

### Sensor Error Codes

Error codes included in status messages:

```json
{
  "sensors": {
    "red": "error",
    "ir": "ok",
    "temperature": "error"
  },
  "errors": {
    "red": "SENSOR_I2C_TIMEOUT",
    "temperature": "SENSOR_READ_FAILED"
  }
}
```

### Error Code Definitions

- **SENSOR_I2C_TIMEOUT**: I2C communication timeout
- **SENSOR_READ_FAILED**: Failed to read sensor data
- **SENSOR_NOT_FOUND**: Sensor not detected on I2C bus
- **SENSOR_CALIBRATION_FAILED**: Calibration routine failed
- **SENSOR_OUT_OF_RANGE**: Reading out of valid range

---

## Units Reference

| Field | Unit | Range | Notes |
|-------|------|-------|-------|
| t | milliseconds | 0-3,600,000 | Time offset |
| red | ADC units | 0-65,535 | 16-bit raw |
| ir | ADC units | 0-65,535 | 16-bit raw |
| spo2 | percentage | 70.0-100.0 | Oxygen saturation |
| pulse | BPM | 30-200 | Heart rate |
| temperature | Celsius | 30.0-42.0 | Temperature |
| batteryPct | percentage | 0-100 | Battery level |
| signalQuality | percentage | 0-100 | Signal quality |
| rssi | dBm | -100 to -30 | WiFi signal |
| voltage | volts | 2.5-4.5 | Battery voltage |
| uptime | seconds | 0+ | Device uptime |
| durationSec | seconds | 1-3600 | Test duration |

---

## Clinical Reference Ranges

### SpO₂ (Oxygen Saturation)

- **Normal**: 95-100%
- **Mild hypoxemia**: 90-94%
- **Moderate hypoxemia**: 80-89%
- **Severe hypoxemia**: < 80%

### Heart Rate (Resting Adult)

- **Normal**: 60-100 BPM
- **Bradycardia**: < 60 BPM
- **Tachycardia**: > 100 BPM

### Temperature

- **Normal**: 36.0-37.5°C
- **Fever**: > 37.5°C
- **Hypothermia**: < 35.0°C

---

## Data Privacy

### Sensitive Data

The following fields may be considered sensitive:

- **patientId**: Direct patient identifier
- **deviceId**: Device identifier (may be used for tracking)
- **timestamp**: Temporal data (may reveal patterns)

### Data Anonymization

For research/analytics, consider:

- Remove or hash patientId
- Aggregate timestamps to hours/days
- Remove deviceId or replace with random ID

---

## Version History

### Schema Version 1.0

- Initial schema definition
- Core sensor sample fields
- Device status fields
- Test summary fields

### Future Changes

Potential additions:
- Additional sensor types (ECG, respiration)
- More detailed signal quality metrics
- Advanced motion artifact detection
- Multi-site measurement support

---

## References

- MAX30101 Datasheet: https://www.maximintegrated.com/en/products/sensors/MAX30101.html
- PPG Signal Processing: https://ieeexplore.ieee.org/document/...
- Medical Device Data Standards: ISO/IEEE 11073
