# MAX30100 Library Installation Guide

## Required Library

This firmware requires the MAX30100_PulseOximeter library to communicate with the GY-MAX3010x sensor.

## Installation Instructions

### Arduino IDE Library Manager

1. Open Arduino IDE
2. Go to **Sketch** → **Include Library** → **Manage Libraries...**
3. In the Library Manager search box, type: `MAX30100`
4. Look for the library by **MAX30100** (PulseOximeter)
5. Click **Install**
6. Wait for installation to complete

### Manual Installation

If the library is not available in Library Manager:

1. Download the library from GitHub: https://github.com/oxullo/Arduino-MAX30100
2. Extract the downloaded ZIP file
3. Copy the extracted folder to your Arduino libraries directory:
   - Windows: `Documents\Arduino\libraries\`
   - Mac: `~/Documents/Arduino/libraries/`
   - Linux: `~/Arduino/libraries/`
4. Restart Arduino IDE

## Hardware Connections

### GY-MAX3010x Sensor

| GY-MAX3010x Pin | ESP32 Pin |
|----------------|-----------|
| VCC            | 3.3V      |
| GND            | GND       |
| SDA            | GPIO21    |
| SCL            | GPIO22    |

### Other Components

| Component | ESP32 Pin |
|-----------|-----------|
| LM35      | GPIO34    |
| OLED SSD1306 | I2C (0x3C) via GPIO21/GPIO22 |

## I2C Configuration

- **I2C Address**: Auto-detected by library
- **SDA**: GPIO21
- **SCL**: GPIO22
- **Library**: MAX30100 PulseOximeter by oxullo

## Sensor Configuration

The firmware configures the MAX30100 with these settings using the PulseOximeter library:
- Mode: SpO2 + Heart Rate (handled automatically by library)
- IR LED Current: 7.6mA (MAX30100_LED_CURR_7_6MA)
- Beat detection callback enabled

## API Notes

The MAX30100_PulseOximeter library provides:
- `pox.begin()` - Initialize the sensor
- `pox.update()` - Must be called continuously in loop()
- `pox.getHeartRate()` - Returns heart rate in BPM
- `pox.getSpO2()` - Returns SpO2 percentage
- `pox.setOnBeatDetectedCallback()` - Set callback for beat detection
- `pox.red` - Raw RED value
- `pox.IR` - Raw IR value

## Working Configuration

The firmware uses the proven working configuration:
- IR LED current set to 7.6mA (most reliable for finger detection)
- Library handles all signal processing internally
- Beat detection callback provides heartbeat notifications
- Simplified code with better reliability

## Troubleshooting

### Sensor Not Detected

1. Check I2C connections (SDA/SCL)
2. Verify 3.3V power supply
3. Run I2C scanner to detect address
4. Check for I2C address conflicts with OLED

### Library Compilation Errors

1. Ensure library is properly installed
2. Check Arduino IDE version compatibility
3. Try manual installation if Library Manager fails
4. Make sure to include "MAX30100_PulseOximeter.h" not "MAX30100.h"

### Inaccurate Readings

1. Ensure finger is properly placed on sensor
2. Check for ambient light interference
3. Verify sensor is not saturated
4. Allow sufficient warm-up time (5-10 seconds)

## Important Notes

- This firmware uses the MAX30100_PulseOximeter library for GY-MAX3010x sensor
- The library handles all signal processing, heart rate detection, and SpO2 calculation
- Beat detection callback provides heartbeat notifications
- Simplified code with better reliability than manual signal processing
- Displayed SpO2 values are for finger measurement validation only
- They do NOT represent dental-pulp oxygen saturation
