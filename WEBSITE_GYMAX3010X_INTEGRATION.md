# Website Integration for GY-MAX3010x Sensor

## Overview
Modified the website backend and frontend to properly handle the new GY-MAX3010x sensor data format from the updated ESP32 firmware.

## Changes Made

### 1. Backend Server (`backend/server.js`)
- **MQTT Message Normalization**: Added data normalization in the MQTT message handler to ensure GY-MAX3010x specific fields are properly handled
- **Field Mapping**: Maps new GY-MAX3010x fields to ensure compatibility with existing frontend code
- **Socket.IO Broadcasting**: Enhanced to emit telemetry to both test-specific and device-specific rooms

#### Key Changes:
```javascript
// Added field normalization for GY-MAX3010x data
const normalizedData = {
  ...data,
  redRaw: data.redRaw || 0,
  irRaw: data.irRaw || 0,
  fingerDetected: data.fingerDetected || false,
  stableSampleCount: data.stableSampleCount || 0,
  redFiltered: data.redFiltered || 0,
  irFiltered: data.irFiltered || 0,
  redAC: data.redAC || 0,
  redDC: data.redDC || 0,
  irAC: data.irAC || 0,
  irDC: data.irDC || 0,
  testDuration: data.testDuration || 0,
  // Legacy compatibility
  probeOnTooth: data.fingerDetected || false,
  ambient: data.ambient || 0,
};
```

### 2. Frontend Types (`frontend/src/types/index.ts`)
- **Extended SensorSample Interface**: Added GY-MAX3010x specific fields to the SensorSample type
- **Backward Compatibility**: Maintained all existing fields for backward compatibility

#### New Fields Added:
```typescript
export type SensorSample = {
  // ... existing fields ...
  // GY-MAX3010x specific fields
  redRaw?: number; // Raw RED value from GY-MAX3010x
  irRaw?: number; // Raw IR value from GY-MAX3010x
  fingerDetected?: boolean; // Finger detection status
  stableSampleCount?: number; // Number of stable samples collected
  redFiltered?: number; // Filtered RED signal
  irFiltered?: number; // Filtered IR signal
  redAC?: number; // RED AC component for SpO2 calculation
  redDC?: number; // RED DC component for SpO2 calculation
  irAC?: number; // IR AC component for SpO2 calculation
  irDC?: number; // IR DC component for SpO2 calculation
  testDuration?: number; // Test duration in milliseconds
};
```

### 3. Frontend Services (`frontend/src/services/live/services.ts`)
- **MQTT Data Parsing**: Updated the telemetry message parser to handle new GY-MAX3010x fields
- **Sample Construction**: Enhanced SensorSample construction to include all new fields
- **Data Flow**: Ensures new fields flow through the entire data pipeline

#### Key Changes:
```typescript
const sample: SensorSample = {
  // ... existing fields ...
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
```

### 4. Frontend UI Components (`frontend/src/components/dashboard/SensorCard.tsx`)
- **Finger Detection Display**: Added visual indicator for finger detection status
- **Sample Count Display**: Shows number of stable samples collected
- **Enhanced Information**: Displays additional sensor status information

#### Key Changes:
```typescript
// Show finger detection status for relevant sensors
{latestSample?.fingerDetected !== undefined && metricKey && (
  <div className="mt-1 text-[10px] text-muted-foreground">
    {latestSample.fingerDetected ? "Finger: YES" : "Finger: NO"}
    {latestSample.stableSampleCount !== undefined && ` (${latestSample.stableSampleCount} samples)`}
  </div>
)}
```

## Data Flow

### ESP32 → MQTT → Backend → Frontend
1. **ESP32**: Publishes telemetry with GY-MAX3010x data to MQTT topic
2. **MQTT Broker**: Routes messages to backend server
3. **Backend Server**: Normalizes data and broadcasts via Socket.IO
4. **Frontend**: Receives data via Socket.IO and displays on dashboard

### MQTT Topic Structure
- **Telemetry**: `opticalsense/device/{deviceId}/telemetry`
- **Status**: `opticalsense/device/{deviceId}/status`
- **Pairing**: `opticalsense/device/{deviceId}/pair/request`

## Backward Compatibility

All changes maintain backward compatibility with existing code:
- **Old Fields**: All original SensorSample fields are preserved
- **New Fields**: New GY-MAX3010x fields are optional (marked with `?`)
- **Default Values**: Missing fields default to 0 or false
- **Legacy Mapping**: `fingerDetected` maps to `probeOnTooth` for compatibility

## Testing Checklist

- [x] Backend receives MQTT messages with new fields
- [x] Backend normalizes data correctly
- [x] Frontend types include new fields
- [x] Frontend services parse new fields
- [x] UI components display finger detection status
- [x] Dashboard shows stable sample count
- [x] Raw RED/IR values are available for debugging
- [x] Backward compatibility maintained

## Important Notes

1. **Finger-Based Measurement**: The website now displays finger detection status instead of probe-on-tooth status
2. **Sample Stability**: Shows stable sample count before displaying readings
3. **Raw Data Access**: Raw RED/IR values are available for future dental analysis
4. **SpO2 Validation**: Displayed SpO2 values are for finger measurement validation only
5. **Future Dental Analysis**: Raw signals can be analyzed separately for dental-pulp oxygen saturation

## Future Enhancements

Potential improvements for dental-specific functionality:
- Add dental-specific signal processing for tooth/gum analysis
- Create separate display modes for finger vs dental measurements
- Implement dental-pulp specific SpO2 calculation algorithms
- Add waveform visualization for raw RED/IR signals
- Create historical data analysis tools for dental research
