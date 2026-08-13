# MAX30100 Library Installation Guide

## Required Library

This firmware requires the MAX30100 library to communicate with the GY-MAX3010x sensor.

## Installation Instructions

### Arduino IDE Library Manager

1. Open Arduino IDE
2. Go to **Sketch** → **Include Library** → **Manage Libraries...**
3. In the Library Manager search box, type: `MAX30100`
4. Look for the library by **milan** (MAX30100_milan)
5. Click **Install**
6. Wait for installation to complete

### Manual Installation

If the library is not available in Library Manager:

1. Download the library from GitHub: https://github.com/milankrakic/MAX30100
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

- **I2C Address**: 0x57 (configured in firmware)
- **SDA**: GPIO21
- **SCL**: GPIO22
- **Library**: MAX30100 by oxullo

## Sensor Configuration

The firmware configures the MAX30100 with these settings using the MAX30100_milan library API:
- Mode: SpO2 + Heart Rate
- Sample Rate: 100Hz (MAX30100_SAMPRATE_100HZ)
- Pulse Width: 1600μs 16-bit (MAX30100_SPC_PW_1600US_16BITS)
- IR LED Current: 50mA (MAX30100_LED_CURR_50MA)
- Red LED Current: 37mA (MAX30100_LED_CURR_37MA)

## API Differences

The MAX30100_milan library uses different method names and constants compared to other MAX30100 libraries:

- `setSamplingRate()` instead of `setSampleRate()`
- `setLedsPulseWidth()` instead of `setPulseWidth()`
- `setLedsCurrent()` instead of separate `setIRLedCurrent()` and `setRedLedCurrent()`
- `pulseOximeter.red` and `pulseOximeter.IR` instead of `getRawRed()` and `getRawIR()`
- `MAX30100_SAMPRATE_100HZ` instead of `MAX30100_SAMPLERATE_100HZ`
- `MAX30100_LED_CURR_50MA` instead of `MAX30100_IRCURR_50MA`

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

### Inaccurate Readings

1. Ensure finger is properly placed on sensor
2. Check for ambient light interference
3. Verify sensor is not saturated
4. Allow sufficient warm-up time (5-10 seconds)

## Important Notes

- This firmware uses the MAX30100 library for GY-MAX3010x sensor
- The sensor operates at 100Hz sampling rate
- Finger detection uses IR signal threshold
- SpO2 calculation uses library's calibrated algorithm
- Raw RED/IR values are stored for debugging and future dental analysis
- Displayed SpO2 values are for finger measurement validation only
- They do NOT represent dental-pulp oxygen saturation
