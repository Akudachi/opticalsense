# ESP32 Firmware Implementation Plan

## Overview

This document provides a step-by-step roadmap for implementing the ESP32 firmware for OpticalSense. Each phase builds upon the previous one, creating a modular, maintainable firmware architecture.

## Development Approach

- **Language**: C/C++ (ESP-IDF framework)
- **Framework**: ESP-IDF v5.x or later
- **Build System**: CMake
- **Architecture**: Event-driven with FreeRTOS tasks
- **Testing**: Unit tests + integration tests
- **Version Control**: Git with feature branches

## Phase 1: WiFi Manager

### Goal

Establish reliable WiFi connectivity with user-friendly configuration and automatic reconnection.

### Responsibilities

- Scan available WiFi networks
- Create configuration AP for initial setup
- Store WiFi credentials in NVS
- Connect to configured network
- Handle connection failures
- Monitor WiFi signal strength
- Support enterprise WiFi (WPA2-EAP) if needed

### Required Inputs

- WiFi SSID and password (from user or NVS)
- WiFi security type
- Optional: Enterprise credentials

### Expected Outputs

- WiFi connection status (connected/disconnected)
- WiFi signal strength (RSSI in dBm)
- IP address assignment
- Connection error messages

### Events Published

- `wifi_connected`: When successfully connected to network
- `wifi_disconnected`: When connection lost
- `wifi_scanning`: When scanning for networks
- `wifi_ap_started`: When configuration AP is active

### Events Received

- `wifi_connect`: Request to connect to specific network
- `wifi_disconnect`: Request to disconnect
- `wifi_scan`: Request to scan for networks
- `wifi_forget`: Request to forget saved credentials

### Error Handling

- **Connection timeout**: Retry with exponential backoff (1s, 2s, 4s, 8s, 16s, max 60s)
- **Wrong password**: Notify user, prompt for re-entry
- **Network not found**: Scan again, notify if not available
- **DHCP failure**: Retry, fallback to static IP if configured
- **AP mode timeout**: Return to station mode after 5 minutes

### Retry Logic

- Automatic reconnection on disconnect
- Exponential backoff for persistent failures
- Maximum retry count: 10 before giving up
- User notification after 3 consecutive failures

### Implementation Steps

1. Initialize WiFi driver
2. Create WiFi configuration task
3. Implement AP mode for initial setup
4. Implement HTTP server on AP for credential entry
5. Implement station mode connection
6. Add credential storage in NVS
7. Implement reconnection logic
8. Add signal strength monitoring
9. Implement WiFi event handling
10. Add enterprise WiFi support (optional)

### Testing

- Test AP mode with web interface
- Test connection to open/WPA2/WPA3 networks
- Test reconnection after disconnect
- Test credential storage and retrieval
- Test signal strength reporting
- Test enterprise WiFi (if implemented)

---

## Phase 2: MQTT Manager

### Goal

Establish reliable MQTT communication with the backend broker.

### Responsibilities

- Connect to MQTT broker over TLS
- Authenticate with device credentials
- Subscribe to required topics
- Publish messages to topics
- Handle connection failures
- Maintain QoS guarantees
- Implement Last Will and Testament

### Required Inputs

- MQTT broker host and port
- MQTT username and password
- Device ID
- Topic prefix
- TLS certificate (if using client certificate)

### Expected Outputs

- MQTT connection status (connected/disconnected)
- Message delivery confirmations
- Subscription status
- Connection error messages

### Events Published

- `mqtt_connected`: When successfully connected to broker
- `mqtt_disconnected`: When connection lost
- `mqtt_message_published`: When message published successfully
- `mqtt_message_received`: When message received from broker

### Events Received

- `mqtt_connect`: Request to connect to broker
- `mqtt_disconnect`: Request to disconnect
- `mqtt_publish`: Request to publish message
- `mqtt_subscribe`: Request to subscribe to topic
- `mqtt_unsubscribe`: Request to unsubscribe from topic

### Error Handling

- **Connection timeout**: Retry with exponential backoff
- **Authentication failure**: Log error, enter pairing mode
- **TLS handshake failure**: Retry, check certificate validity
- **Publish failure**: Retry with QoS, queue if buffer full
- **Subscribe failure**: Retry, log error

### Retry Logic

- Automatic reconnection on disconnect
- Exponential backoff for persistent failures
- Message queue for undelivered messages (QoS 1/2)
- Maximum queue size: 100 messages
- Retry undelivered messages on reconnection

### Implementation Steps

1. Initialize MQTT client library
2. Configure TLS settings
3. Implement connection logic
4. Implement authentication
5. Implement subscription management
6. Implement publish logic with QoS
7. Implement message queue for QoS 1/2
8. Implement Last Will and Testament
9. Add connection event handling
10. Implement reconnection logic

### Testing

- Test connection to broker with TLS
- Test authentication with valid/invalid credentials
- Test QoS 0, 1, 2 message delivery
- Test subscription to topics
- Test reconnection after disconnect
- Test message queue behavior
- Test Last Will and Testament

---

## Phase 3: Device Manager

### Goal

Manage device lifecycle, state, and configuration.

### Responsibilities

- Generate and store device ID
- Manage device state (unpaired, paired, test_active, error)
- Store and retrieve configuration from NVS
- Handle pairing workflow
- Manage firmware version
- Monitor device uptime
- Handle factory reset

### Required Inputs

- Device MAC address (for ID generation)
- Pairing code (from user or generated)
- Clinic credentials (from backend)
- Configuration parameters

### Expected Outputs

- Device ID
- Current device state
- Device configuration
- Pairing status
- Firmware version

### Events Published

- `device_state_changed`: When device state changes
- `device_paired`: When pairing completed
- `device_unpaired`: When factory reset
- `device_error`: When error state entered

### Events Received

- `pair_request`: Request to initiate pairing
- `factory_reset`: Request to reset to factory settings
- `get_config`: Request to get current configuration
- `set_config`: Request to update configuration

### Error Handling

- **NVS read failure**: Use default configuration
- **NVS write failure**: Retry, log error
- **Invalid state transition**: Reject, log error
- **Configuration corruption**: Use defaults, reinitialize

### Retry Logic

- NVS operations: Retry up to 3 times
- State transitions: Single attempt, reject if invalid
- Configuration updates: Retry on failure

### Implementation Steps

1. Generate device ID from MAC address
2. Initialize NVS storage
3. Define device states and transitions
4. Implement state machine
5. Implement configuration storage/retrieval
6. Implement pairing workflow
7. Implement factory reset
8. Add uptime tracking
9. Implement firmware version management
10. Add configuration validation

### Testing

- Test device ID generation
- Test state transitions
- Test configuration storage and retrieval
- Test pairing workflow end-to-end
- Test factory reset
- Test uptime tracking
- Test configuration validation

---

## Phase 4: Sensor Manager

### Goal

Interface with connected sensors (configurable based on hardware requirements).

### Responsibilities

- Initialize sensor interface (I2C, SPI, ADC, or other as needed)
- Initialize connected sensors (configurable based on hardware)
- Read raw sensor data
- Handle sensor errors
- Calibrate sensors (if supported)
- Monitor sensor health

### Required Inputs

- Sensor interface configuration (I2C, SPI, ADC, etc.)
- Sensor configuration parameters
- Calibration data (if available)

### Expected Outputs

- Raw sensor values (format depends on sensor type)
- Sensor health status
- Calibration status (if applicable)

### Events Published

- `sensor_data_ready`: When new sensor data available
- `sensor_error`: When sensor error detected
- `sensor_calibrated`: When calibration completed

### Events Received

- `sensor_start`: Request to start sampling
- `sensor_stop`: Request to stop sampling
- `sensor_calibrate`: Request to calibrate sensors
- `sensor_read`: Request to read single sample

### Error Handling

- **Sensor communication failure**: Retry, reinitialize interface
- **Sensor not found**: Log error, mark sensor as disconnected
- **Invalid data**: Filter out, log warning
- **Calibration failure**: Use default values, log error

### Retry Logic

- Sensor read: Retry up to 3 times
- Sensor initialization: Retry up to 5 times
- Calibration: Single attempt, use defaults if fails

### Implementation Steps

1. Initialize sensor interface driver (I2C, SPI, ADC, etc.)
2. Initialize connected sensors
3. Configure sensor settings (sample rate, gain, etc.)
4. Implement sensor reading routine
5. Add sensor health monitoring
6. Implement calibration routine (if supported)
7. Add error detection and handling
8. Implement sensor data buffering

### Testing

- Test sensor interface communication
- Test sensor initialization
- Test sensor reading
- Test sensor health monitoring
- Test calibration (if supported)
- Test error handling

---

## Phase 5: Signal Processing

### Goal

Process raw sensor data to compute vital signs and signal quality metrics.

### Responsibilities

- Filter raw PPG signals
- Detect pulse peaks
- Compute heart rate
- Compute SpO₂ from Red/IR ratio
- Calculate signal quality
- Determine measurement confidence
- Apply noise reduction

### Required Inputs

- Raw red PPG values
- Raw IR PPG values
- Temperature readings
- Sample timestamps

### Expected Outputs

- Filtered PPG signals
- Heart rate (BPM)
- SpO₂ percentage
- Signal quality (0-100)
- Confidence level (low/medium/high)
- Processed temperature

### Events Published

- `metrics_ready`: When new metrics computed
- `signal_quality_changed`: When signal quality changes significantly

### Events Received

- `raw_sensor_data`: Raw sensor data from sensor manager
- `processing_config`: Configuration for processing algorithms

### Error Handling

- **No pulse detected**: Set confidence to low, continue processing
- **Invalid SpO₂**: Clamp to valid range, set confidence to low
- **Signal too noisy**: Set signal quality low, continue processing
- **Processing timeout**: Use last valid values, log warning

### Retry Logic

- No retry for processing (real-time)
- Use last valid values on error
- Reset processing state on test start

### Implementation Steps

1. Implement digital filters (bandpass, moving average)
2. Implement pulse peak detection algorithm
3. Implement heart rate calculation
4. Implement SpO₂ calculation from Red/IR ratio
5. Implement signal quality assessment
6. Implement confidence determination
7. Add noise reduction algorithms
8. Implement temperature processing
9. Add signal quality monitoring
10. Optimize for real-time performance

### Testing

- Test filtering with synthetic signals
- Test pulse detection with various heart rates
- Test SpO₂ calculation with known ratios
- Test signal quality assessment
- Test confidence determination
- Test performance at 10Hz
- Test with noisy signals

---

## Phase 6: Command Handler

### Goal

Process commands received from backend via MQTT.

### Responsibilities

- Subscribe to command topic
- Parse incoming commands
- Validate command parameters
- Execute commands
- Publish command responses
- Handle command errors
- Maintain command history

### Required Inputs

- Command messages from MQTT
- Device state
- Sensor status
- Configuration

### Expected Outputs

- Command execution results
- Command acknowledgments
- Error responses

### Events Published

- `command_received`: When command received
- `command_executed`: When command executed successfully
- `command_failed`: When command execution failed

### Events Received

- MQTT messages from command topic

### Error Handling

- **Invalid command format**: Reject with error response
- **Unknown command**: Reject with error response
- **Invalid parameters**: Reject with error response
- **Wrong device state**: Reject with error response
- **Execution failure**: Return error response with details

### Retry Logic

- No automatic retry for commands
- Backend may retry if no response received
- Command handler logs all failures

### Implementation Steps

1. Implement command parser
2. Implement command validator
3. Implement command dispatcher
4. Implement start_test command
5. Implement stop_test command
6. Implement restart command
7. Implement factory_reset command
8. Implement calibrate command
9. Implement ping command
10. Implement response publisher

### Testing

- Test command parsing
- Test command validation
- Test each command type
- Test error responses
- Test command in wrong state
- Test invalid parameters
- Test response publishing

---

## Phase 7: Pairing

### Goal

Implement device pairing workflow with backend.

### Responsibilities

- Generate pairing code
- Display pairing code to user
- Publish pairing request
- Wait for pairing response
- Validate pairing response
- Store clinic credentials
- Transition to paired state

### Required Inputs

- Device ID
- Firmware version
- MAC address (optional)

### Expected Outputs

- Pairing code (6 digits)
- Pairing status
- Clinic credentials (if successful)

### Events Published

- `pairing_started`: When pairing initiated
- `pairing_code_generated`: When code generated
- `pairing_completed`: When pairing successful
- `pairing_failed`: When pairing failed

### Events Received

- Pairing response from backend

### Error Handling

- **Pairing timeout**: Generate new code, retry
- **Invalid response**: Reject, retry pairing
- **Network error**: Retry connection, continue pairing
- **Storage failure**: Log error, retry pairing

### Retry Logic

- Pairing timeout: Generate new code, retry immediately
- Network error: Retry connection, continue pairing
- Maximum retries: 10 before giving up
- Backoff: No backoff for pairing (user waiting)

### Implementation Steps

1. Generate random 6-digit code
2. Display code on LED or serial
3. Publish pairing request
4. Wait for pairing response (5-minute timeout)
5. Validate pairing response
6. Extract clinic credentials
7. Store credentials in NVS (encrypted)
8. Update device state to paired
9. Reconnect to MQTT with device credentials
10. Publish paired status

### Testing

- Test code generation
- Test pairing request publishing
- Test pairing response handling
- Test successful pairing
- Test failed pairing (invalid code)
- Test pairing timeout
- Test credential storage
- Test state transition

---

## Phase 8: OTA Updates (Future)

### Goal

Enable over-the-air firmware updates.

### Responsibilities

- Check for available updates
- Download firmware image
- Verify firmware signature
- Apply firmware update
- Handle update failures
- Rollback on failure

### Required Inputs

- Firmware update server URL
- Current firmware version
- Update manifest

### Expected Outputs

- Update availability status
- Update progress
- Update success/failure status

### Events Published

- `update_available`: When update available
- `update_downloading`: When download started
- `update_installing`: When installation started
- `update_completed`: When update successful
- `update_failed`: When update failed

### Events Received

- `check_update`: Request to check for updates
- `start_update`: Request to start update
- `cancel_update`: Request to cancel update

### Error Handling

- **Download failure**: Retry, notify user
- **Signature verification failure**: Abort, notify user
- **Installation failure**: Rollback, notify user
- **Insufficient space**: Abort, notify user

### Retry Logic

- Download: Retry up to 3 times
- Installation: Single attempt, rollback on failure
- Check for updates: Retry on network error

### Implementation Steps

1. Implement update check (HTTP request to server)
2. Implement firmware download
3. Implement signature verification
4. Implement firmware installation
5. Implement rollback mechanism
6. Add progress reporting
7. Implement error handling
8. Add user notification
9. Test update process
10. Document update procedure

### Testing

- Test update check
- Test firmware download
- Test signature verification
- Test successful update
- Test failed update (rollback)
- Test insufficient space
- Test update cancellation
- Test rollback

---

## Integration and Testing

### System Integration

After completing all phases, integrate all modules:

1. Initialize all managers in correct order
2. Connect event handlers between modules
3. Implement main application loop
4. Add system-wide error handling
5. Implement watchdog timer
6. Add logging system
7. Add performance monitoring

### End-to-End Testing

Test complete workflows:

1. **Pairing workflow**: Unpaired → Paired
2. **Test workflow**: Start test → Stream telemetry → Stop test
3. **Error recovery**: Simulate failures, verify recovery
4. **Long-running operation**: Run for 24+ hours
5. **Power cycling**: Test behavior after power loss
6. **Network interruption**: Test reconnection

### Performance Testing

- Measure memory usage
- Measure CPU usage
- Measure power consumption
- Verify 10Hz telemetry rate
- Test with multiple concurrent operations

### Security Testing

- Test credential storage encryption
- Test TLS certificate validation
- Test MQTT authentication
- Test command validation
- Test input sanitization

---

## Development Tools

### Required Tools

- ESP-IDF v5.x
- CMake
- Git
- Serial terminal (PuTTY, screen, etc.)
- MQTT client for testing (MQTT Explorer)
- Logic analyzer (optional, for I2C debugging)

### Recommended Tools

- VS Code with ESP-IDF extension
- PlatformIO (alternative to ESP-IDF)
- JTAG debugger (ESP-Prog)
- Oscilloscope (for sensor debugging)

---

## Code Structure

### Recommended Directory Structure

```
/opticalsense-esp32
├── main/
│   ├── CMakeLists.txt
│   ├── main.c                 # Application entry point
│   ├── wifi_manager.c/h       # WiFi management
│   ├── mqtt_manager.c/h       # MQTT communication
│   ├── device_manager.c/h     # Device lifecycle
│   ├── sensor_manager.c/h     # Sensor interface
│   ├── signal_processing.c/h # Signal processing
│   ├── command_handler.c/h    # Command processing
│   ├── pairing.c/h            # Pairing workflow
│   ├── ota.c/h                # OTA updates
│   ├── events.c/h             # Event system
│   ├── config.c/h             # Configuration
│   └── utils.c/h              # Utility functions
├── components/
│   └── (optional custom components)
├── tests/
│   ├── test_wifi_manager.c
│   ├── test_mqtt_manager.c
│   ├── test_sensor_manager.c
│   └── ...
├── CMakeLists.txt
├── sdkconfig
└── README.md
```

---

## Coding Standards

### General Guidelines

- Use ESP-IDF coding style
- Add comments for complex logic
- Use meaningful variable names
- Keep functions focused and short
- Handle all error cases
- Use logging for debugging

### Error Handling

- Check all return values
- Use ESP-IDF error handling macros (ESP_ERROR_CHECK)
- Log errors with context
- Graceful degradation when possible
- Never ignore errors silently

### Memory Management

- Use dynamic allocation sparingly
- Free allocated memory
- Check for memory leaks
- Use static allocation when possible
- Monitor heap usage

### Concurrency

- Use FreeRTOS tasks for concurrent operations
- Use queues for inter-task communication
- Use mutexes for shared resource protection
- Avoid busy waiting
- Use event groups for synchronization

---

## Debugging

### Logging

- Use ESP-IDF logging system (ESP_LOG)
- Set appropriate log levels (ERROR, WARN, INFO, DEBUG, VERBOSE)
- Add context to log messages
- Use structured logging where helpful

### Common Issues

- **WiFi not connecting**: Check credentials, signal strength
- **MQTT not connecting**: Check broker URL, credentials, TLS
- **Sensor not responding**: Check I2C wiring, power supply
- **High memory usage**: Check for leaks, reduce buffer sizes
- **Watchdog trigger**: Check for blocking operations

### Debugging Tools

- Serial monitor for logs
- MQTT Explorer for MQTT debugging
- Logic analyzer for I2C debugging
- GDB with JTAG for advanced debugging

---

## Deployment

### Build Process

1. Configure build parameters (sdkconfig)
2. Build firmware: `idf.py build`
3. Flash firmware: `idf.py flash`
4. Monitor output: `idf.py monitor`

### Production Build

- Set log level to ERROR/WARN
- Enable optimizations
- Disable debug features
- Sign firmware (if using secure boot)
- Generate binary for distribution

### Version Management

- Use semantic versioning (MAJOR.MINOR.PATCH)
- Tag releases in Git
- Maintain CHANGELOG
- Document breaking changes

---

## Documentation

### Required Documentation

- README.md with build instructions
- API documentation for each module
- Configuration guide
- Troubleshooting guide
- Hardware setup guide

### Code Documentation

- Document all public functions
- Add comments for complex algorithms
- Document configuration parameters
- Document error codes
- Document event types

---

## Success Criteria

### Phase Completion Criteria

Each phase is complete when:

- All functionality implemented
- Unit tests pass
- Integration tests pass
- Code reviewed
- Documentation updated
- No known critical bugs

### Overall Success Criteria

The firmware is complete when:

- All phases implemented
- End-to-end workflows tested
- Performance requirements met
- Security requirements met
- Documentation complete
- Ready for production deployment

---

## Timeline Estimate

- Phase 1 (WiFi Manager): 1-2 weeks
- Phase 2 (MQTT Manager): 1-2 weeks
- Phase 3 (Device Manager): 1 week
- Phase 4 (Sensor Manager): 1-2 weeks
- Phase 5 (Signal Processing): 2-3 weeks
- Phase 6 (Command Handler): 1 week
- Phase 7 (Pairing): 1 week
- Phase 8 (OTA Updates): 1-2 weeks (future)
- Integration and Testing: 2-3 weeks

**Total Estimated Time**: 10-15 weeks for phases 1-7

---

## References

- ESP-IDF Programming Guide: https://docs.espressif.com/projects/esp-idf/
- ESP32 Technical Reference Manual: https://www.espressif.com/sites/default/files/documentation/esp32_technical_reference_en.pdf
- MAX30101 Datasheet: https://www.maximintegrated.com/en/products/sensors/MAX30101.html
- MQTT ESP32 Client: https://github.com/espressif/esp-mqtt
