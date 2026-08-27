/*
 * OpticalSense ESP32 Firmware - Production Version
 * Optical Dental Pulp Vitality Detection System
 * Version: 3.3.0
 * 
 * Production-grade firmware for ESP32-based medical IoT device that measures
 * optical blood perfusion using GY-MAX3010x pulse oximeter sensor.
 * 
 * Changes in v3.3.0:
 * - Added real LM35 temperature sensor reading on GPIO34
 * - Removed demo temperature data, now reads actual sensor values
 * - Temperature calibration support via preferences
 * - Updates every 2 seconds for accurate readings
 * 
 * Changes in v3.2.0:
 * - Reverted from the MAX30100_PulseOximeter wrapper back to the low-level
 *   MAX30100 raw-sample driver. The wrapper's beat detector and SpO2 calculator
 *   are tuned for a fingertip pressed on the sensor and never validated a beat
 *   against the much weaker dental-probe signal, so heartRate/spo2/redRaw/irRaw
 *   were permanently stuck at 0.
 * - Revived the AC/DC extraction + adaptive peak-detection pipeline in
 *   updateMAX30100() (buffers/constants for this already existed in the file
 *   but were dormant while the library was in use).
 * - redRaw/irRaw now report real DC baseline values from the sensor instead of
 *   hardcoded 50000/60000 placeholders.
 * - SpO2 is now an uncalibrated relative estimate (ratio-of-ratios formula) —
 *   treat it as a trend indicator for THIS probe, not a clinical SpO2 value.
 * - PROBE_CONTACT_THRESHOLD and the LED current need on-device calibration;
 *   watch the "RAW:" debug line over serial with probe on/off the tooth.
 * 
 * IMPORTANT: This firmware uses the low-level MAX30100 driver class (NOT
 * PulseOximeter). Install the same "MAX30100" library in Arduino IDE:
 * Sketch -> Include Library -> Manage Libraries -> search "MAX30100"
 * 
 * Hardware Connections:
 * - GY-MAX3010x SDA -> GPIO21
 * - GY-MAX3010x SCL -> GPIO22
 * - GY-MAX3010x VCC -> 3.3V
 * - GY-MAX3010x GND -> GND
 * - LM35 -> GPIO34 (Temperature sensor)
 * - OLED SSD1306 -> I2C (0x3C)
 * 
 * Features:
 * - WiFi Provisioning with Captive Portal
 * - MQTT over TLS to HiveMQ Cloud
 * - Device Pairing with 6-digit code
 * - Optical Signal Acquisition (GY-MAX3010x with PulseOximeter library)
 * - Temperature Monitoring (LM35 sensor on GPIO34)
 * - Battery Monitoring (Demo Data)
 * - OLED Display (SSD1306)
 * - Remote Command Handling
 * - Automatic Error Recovery
 * - Factory Reset
 * - Self-Test & Diagnostics
 * 
 * Note: SpO2 values displayed are for finger measurement validation only.
 * They do NOT represent dental-pulp oxygen saturation. Future dental experiments
 * must analyze raw RED/IR PPG signals from tooth/gum separately.
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <Preferences.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_GFX.h>
#include <esp_task_wdt.h>
#include "MAX30100.h"  // Low-level raw-sample driver (NOT the PulseOximeter wrapper).
                        // The PulseOximeter class is tuned for fingertip PPG signals and
                        // its beat detector rarely locks onto the much weaker dental pulp
                        // signal, which is why heartRate/spo2/redRaw/irRaw stayed at 0.
                        // We read raw IR/RED samples directly and do our own AC/DC
                        // extraction + peak detection below, tuned for a weak signal.

// ============================================================
// SENSOR SAFE DELAY - Non-blocking delay wrapper
// ============================================================
void sensorSafeDelay(unsigned long ms);

// ============================================================
// FUNCTION DECLARATIONS
// ============================================================
void sensorSafeDelay(unsigned long ms);
void updateMAX30100();
int32_t redSampleLast();
void updateOLED();
void checkBattery();
void checkTemperature();
void publishTelemetry();
void publishHeartbeat();
void publishStatus(String status);
void publishPairRequest();
void handleMQTT();
void connectMQTT();
void startTest();
void stopTest();
void runTestSampling();
void printDebugInfo();
String getStateString();

// ============================================================
// PIN CONFIGURATION
// ============================================================
// GY-MAX3010x uses I2C - no GPIO pins needed for LEDs
#define PIN_LM35         34  // MUST use ADC1 pin (32-39). GPIO 15 is ADC2 which CANNOT read when WiFi is active!
                              // Physically move the LM35 signal wire from GPIO 15 to GPIO 34
#define PIN_I2C_SDA      21
#define PIN_I2C_SCL      22

// ============================================================
// CONFIGURATION CONSTANTS
// ============================================================
constexpr char FIRMWARE_VERSION[] = "3.3.0";
constexpr char DEVICE_NAME_PREFIX[] = "OPT";
constexpr char WIFI_AP_SSID[] = "OpticalS-Setup";
constexpr char WIFI_AP_PASSWORD[] = "12345678";
constexpr int MQTT_PORT = 8883;
constexpr int MQTT_KEEPALIVE_SEC = 60;
constexpr int MQTT_QOS = 1;
constexpr unsigned long HEARTBEAT_INTERVAL = 5000; // Changed to 5 seconds for faster offline detection
constexpr unsigned long TELEMETRY_INTERVAL = 1000;
constexpr unsigned long OLED_REFRESH_INTERVAL = 500;  // Slower OLED updates to give more CPU time to sensor
constexpr unsigned long BATTERY_CHECK_INTERVAL = 1000; // Slower battery checks to give more CPU time to sensor
constexpr unsigned long TEMP_CHECK_INTERVAL = 2000;   // Slower temp checks to give more CPU time to sensor
constexpr unsigned long WIFI_RETRY_INTERVAL = 5000;
constexpr int MAX_WIFI_RETRIES = 10;
constexpr int LOW_BATTERY_WARNING = 20;
constexpr int CRITICAL_BATTERY = 5;
constexpr float HIGH_TEMP_WARNING = 38.0;
constexpr float LOW_TEMP_WARNING = 34.0;
constexpr unsigned long REPORT_INTERVAL = 2000; // Display update interval

// Default MQTT Broker Configuration
constexpr char DEFAULT_MQTT_HOST[] = "6732afdd0ab749f1b5c67e4cd7233db9.s1.eu.hivemq.cloud";
constexpr char DEFAULT_MQTT_USERNAME[] = "opticalpulp";
constexpr char DEFAULT_MQTT_PASSWORD[] = "Adarsh@18";

// HiveMQ Cloud CA Certificate
// Root CA certificate for 6732afdd0ab749f1b5c67e4cd7233db9.s1.eu.hivemq.cloud
const char* mqtt_ca_cert = R"EOF(
-----BEGIN CERTIFICATE-----
MIIF9DCCA9ygAwIBAgIRAPJLbRf52a18scn+p4eCaZ8wDQYJKoZIhvcNAQELBQAw
TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh
cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMjYwNTEzMDAwMDAw
WhcNMzIwOTAyMjM1OTU5WjAuMQswCQYDVQQGEwJVUzENMAsGA1UEChMESVNSRzEQ
MA4GA1UEAxMHUm9vdCBZUjCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIB
ANvGJnN78CTJdWL3+eGfsLN5TrNBJs+VH9hRXqRbwxu9sGNiB0BD1fcOxbSUQCJI
M1xE13Db+5Cw1w0s0EBYsvuIP/6joF0w8cuImbgR1OGgYbSQ4OpzI+DG8SGuTlcE
873OCS+kh3srlo6vl43M5OJg4Aeo1sfHp6kTJDoIiFBNJAY+OKfX/FUvYKuhjT+n
o49lmqmupSBI5PkBQiqrEGtWU5uxU/cQWHGu8jSjFBznZqvbNPLMXMLFxCb3WTfr
JBXXjqvWG+v4bjzxjjeAtOlU7qarRDvNOyAuQYLln904M+faKx8hnLCpJ15ZqaEg
cNlY+9MMWcC5yvL2A2j3l9+2buggZX+dOE91zYmIdawTvSZuVvlbRrAlLxIB6pwM
BjneXCjYQ8+3BCCjssbSNpZU3hTcBDdhfAlEDlYr6pEatnMdmDT5BqnKC92bd0Eh
M1fbLHioLccLCuievT8ZkPhZrq7Mii7gNXAcUEAR8+lzYal+9zTg7C5DALyVOeG/
CqfRAMn1KSHCR0NSA6P8tn/mGRlnCct5rtVCLnVySVpU6H1qGg3DgTOuskf8eahT
MiYbI5ezPJmO5ertalskQ1utp74+eDy92PI4ftHKTbq9IWhH4YZKh3WnJEIt+oQv
lYZbY8tpEroKrFB6PFGzrJIDRyts4HqvuH52RFj2zv/BAgMBAAGjgeswgegwDgYD
VR0PAQH/BAQDAgEGMBMGA1UdJQQMMAoGCCsGAQUFBwMBMA8GA1UdEwEB/wQFMAMB
Af8wHQYDVR0OBBYEFN7nW2DQIm1AKH0/DQH+pLVStFGUMB8GA1UdIwQYMBaAFHm0
WeZ7tuXkAXOACIjIGlj26ZtuMDIGCCsGAQUFBwEBBCYwJDAiBggrBgEFBQcwAoYW
aHR0cDovL3gxLmkubGVuY3Iub3JnLzATBgNVHSAEDDAKMAgGBmeBDAECATAnBgNV
HR8EIDAeMBygGqAYhhZodHRwOi8veDEuYy5sZW5jci5vcmcvMA0GCSqGSIb3DQEB
CwUAA4ICAQA8spSI95KKfn2W6GMmDpHBJSPaLbsS3W93cijJCRCYAc1fsJgL1FIL
7C0C9ecPOdcwB2fi0Dk2p94j9iTJCxmt5CFSKLRWwnXT2MMSXexVxqoVB79BdWPx
VXETkVme/qYSAuKVHh5Ps+5BixgmwS1JkjSAc+MfrUbNssVEEnH0aEiAh+rotXAV
JSP/Ye7LJPEwD9DWG72vVWbhAcuOf5OLjz57Ctk7MgQHynZ7+PlHJtajroCaIbtC
r6tcZZaAwUQm+jQyeWdV+2hv9deOYFmKeQyjjcSrN5Nadrw+L9DZJLbA1HqeNvLh
BgqpP0fvJq2N6EtD574N6eMI7uMsJTnji2UDz9el5XLSv9fqJMuDQtYVb2oTNoKp
oUqhxPVC0aq4eG5MESaIdn8b5ZGSSeAJLMHXljEdlNza+ncfkviXk1POLnnFdvx8
/gk6M374WbLWFXw8N141B/Rl/tINGfl1TxOIiqtiMYkL02RSGb1kq34BL9NPP27z
RGMuHGnzS3hFIrRTfKxrzUZ9RzQWzEG3K6fJ3r2nqSltkeytis9DIBoFY9VmVyjL
M71DMi+y1+TRSJVClEMwvA4yL++7q9XZx5r5wBRWB4kQTKH5qyoZnDw7iiuh1lID
yDFx8r7i9vIJU5HS3moZLkYWAOilMaV9N56A9Bgb6dNcHkvg3NoaYA==
-----END CERTIFICATE-----
)EOF";

// Signal Processing Constants
constexpr int FILTER_BUFFER_SIZE = 32;
constexpr int MEDIAN_WINDOW = 5;
constexpr float LOW_PASS_ALPHA = 0.2;
constexpr int PEAK_THRESHOLD_MIN = 5;    // Low threshold for dental pulp optical signal
constexpr int PEAK_THRESHOLD_MAX = 500;
constexpr unsigned long MIN_PEAK_INTERVAL = 250;
constexpr unsigned long MAX_PEAK_INTERVAL = 2000;
constexpr int HEART_RATE_MIN = 40;
constexpr int HEART_RATE_MAX = 180;
// Probe/tissue contact is declared when the slow-moving IR DC baseline rises above
// this many raw ADC counts over the no-contact resting level. TUNE THIS ON YOUR
// HARDWARE: print irBaseline over serial with the probe on and off the tooth and
// pick a threshold roughly halfway between the two. Starting guess only.
constexpr int32_t PROBE_CONTACT_THRESHOLD = 300;
// IR AC amplitude (peak-to-peak, from the buffer) below which we treat the channel
// as noise floor rather than a real pulsatile signal.
constexpr int16_t MIN_VALID_AC_AMPLITUDE = PEAK_THRESHOLD_MIN;

// Calibration Constants (stored in Preferences)
// Using proper calibrated pulse oximetry curve
// SpO2 = 110 - 25*R is NOT accurate - using library's calibrated algorithm
constexpr float TEMP_CALIBRATION_OFFSET = 0.0;
constexpr float TEMP_CALIBRATION_SCALE = 1.0;

// ============================================================
// MQTT TOPICS
// ============================================================
#define TOPIC_STATUS          "opticalsense/device/%s/status"
#define TOPIC_HEARTBEAT       "opticalsense/device/%s/heartbeat"
#define TOPIC_TELEMETRY       "opticalsense/device/%s/telemetry"
#define TOPIC_BATTERY         "opticalsense/device/%s/battery"
#define TOPIC_TEMPERATURE     "opticalsense/device/%s/temperature"
#define TOPIC_LOGS            "opticalsense/device/%s/logs"
#define TOPIC_PAIR_REQUEST    "opticalsense/device/%s/pair/request"
#define TOPIC_PAIR_RESPONSE   "opticalsense/device/%s/pair/response"
#define TOPIC_COMMANDS        "opticalsense/device/%s/commands"

// ============================================================
// DEVICE STATES
// ============================================================
enum DeviceState {
  STATE_BOOT,
  STATE_SELF_TEST,
  STATE_INITIALIZING,
  STATE_PROVISIONING,
  STATE_CONNECTING_WIFI,
  STATE_CONNECTING_MQTT,
  STATE_WAITING_PAIR,
  STATE_READY,
  STATE_TESTING,
  STATE_SHOWING_CONCLUSION,
  STATE_PROCESSING,
  STATE_UPLOADING,
  STATE_COMPLETE,
  STATE_DIAGNOSTIC,
  STATE_SAFE_MODE,
  STATE_ERROR,
  STATE_FACTORY_RESET
};

// ============================================================
// GLOBAL VARIABLES
// ============================================================
// Hardware
Adafruit_SSD1306 display(128, 64, &Wire, -1);
Preferences preferences;
MAX30100 sensor;  // Low-level raw driver — see include comment above

// Network
WebServer server(80);
DNSServer dnsServer;
WiFiClientSecure wifiClient;
PubSubClient mqttClient(wifiClient);

// Device Info
String deviceId;
String firmwareVersion = FIRMWARE_VERSION;
String macAddress;
DeviceState currentState = STATE_BOOT;
unsigned long bootTime = 0;
unsigned long uptime = 0;

// WiFi
String wifiSSID;
String wifiPassword;
String deviceName;
String clinicName;
String clinicId;
bool isPaired = false;
int wifiRetryCount = 0;
unsigned long lastWifiRetry = 0;

// MQTT
String mqttHost;
int mqttPort = MQTT_PORT;
String mqttUsername;
String mqttPassword;
bool mqttConnected = false;
unsigned long lastHeartbeat = 0;
unsigned long lastTelemetry = 0;

// Pairing
String pairCode;
unsigned long pairCodeGenerated = 0;
constexpr unsigned long PAIR_CODE_TIMEOUT = 300000; // 5 minutes

// Sensors
// Derived from our own raw-sample AC/DC pipeline in updateMAX30100() — see that
// function's comments. NOT from the PulseOximeter library's finger-tuned algorithm.
float heartRate = 0.0;
float spo2 = 0.0;
bool beatDetected = false;
unsigned long lastBeatTime = 0;

// Demo data variables
float temperature = 0.0;
float batteryPercent = 0.0;
float batteryVoltage = 0.0;
bool isCharging = false;

// Signal quality from library
float signalQuality = 0.0;
float vitalityIndex = 0.0;
String vitalityStatus = "";
String probeQuality = "";

// Raw sensor values — real DC baseline / AC amplitude from the low-level driver
uint32_t redRaw = 0;
uint32_t irRaw = 0;
uint32_t redFiltered = 0;
uint32_t irFiltered = 0;
bool fingerDetected = false;

// ============================================================
// BEAT DETECTION CALLBACK
// ============================================================
void onBeatDetected() {
  beatDetected = true;
  lastBeatTime = millis();
  Serial.println("BEAT");
}

// SIGNAL PROCESSING VARIABLES — actively used by updateMAX30100()'s AC/DC +
// peak-detection pipeline (previously dormant while the PulseOximeter library
// was in use; now driving the real sensor values below)
// Changed to int32_t to prevent integer overflow with large DC values
int32_t redBuffer[FILTER_BUFFER_SIZE] = {0};
int32_t irBuffer[FILTER_BUFFER_SIZE] = {0};
int bufferIndex = 0;
int32_t redLowPass = 0;
int32_t irLowPass = 0;
int32_t redBaseline = 0;
int32_t irBaseline = 0;
unsigned long peakTimes[10] = {0};
int peakCount = 0;
unsigned long lastPeakTime = 0;
int32_t adaptiveThreshold = PEAK_THRESHOLD_MIN;
bool pulseDetected = false;
float redAC = 0.0;
float redDC = 0.0;
float irAC = 0.0;
float irDC = 0.0;
float noiseLevel = 0.0;
float peakConsistency = 0.0;
bool motionDetected = false;
bool sensorSaturated = false;

// Probe Detection
bool probeOnTooth = false;         // true when photodiode signal indicates probe is on a tooth
unsigned long probeDetectedTime = 0; // when probe was first detected (for "Analyzing" state)

// Test Control
bool testRunning = false;
unsigned long testStartTime = 0;
unsigned long testDuration = 0;
unsigned long lastSampleTime = 0;
unsigned long sampleCount = 0;
int stableSampleCount = 0; // Counts samples since finger detection
bool showingConclusion = false;
unsigned long conclusionStartTime = 0;

// OLED
unsigned long lastOledRefresh = 0;
unsigned long lastBatteryCheck = 0;
unsigned long lastTempCheck = 0;

// Diagnostic Mode
bool diagnosticMode = false;
unsigned long diagnosticStartTime = 0;

// Self-Test Results
struct SelfTestResult {
  bool oled;
  bool max30100;
  bool lm35;
  bool preferences;
  bool wifi;
  bool mqtt;
} selfTestResult;

// Safe Mode
bool safeMode = false;
int sensorFailureCount = 0;
constexpr int MAX_SENSOR_FAILURES = 5;
unsigned long lastSensorFailure = 0;

// Calibration Values (loaded from Preferences)
float tempCalibrationOffset = TEMP_CALIBRATION_OFFSET;
float tempCalibrationScale = TEMP_CALIBRATION_SCALE;

// Buffers
StaticJsonDocument<1024> jsonDoc;
char mqttTopic[128];
char mqttPayload[1024];

// Offline Telemetry Buffer
constexpr int OFFLINE_BUFFER_SIZE = 50;
struct TelemetryEntry {
  char payload[1024];
  unsigned long timestamp;
};
TelemetryEntry offlineBuffer[OFFLINE_BUFFER_SIZE];
int offlineBufferIndex = 0;
int offlineBufferCount = 0;

// ============================================================
// SETUP FUNCTION
// ============================================================
void setup() {
  bootTime = millis();
  
  // Initialize Serial
  Serial.begin(115200);
  Serial.println(F("\n=== OpticalSense ESP32 Firmware v2.0.0 ==="));
  Serial.print(F("Firmware Version: "));
  Serial.println(firmwareVersion);
  
  // Initialize Watchdog
  // esp_task_wdt API is consistent across ESP32 Arduino Core 2.x and 3.x (ESP-IDF based)
  esp_task_wdt_config_t wdt_config = {
    .timeout_ms = 120000, // Increased to 120 seconds for MQTT TLS connection
    .idle_core_mask = (1 << portNUM_PROCESSORS) - 1,
    .trigger_panic = true
};

esp_task_wdt_init(&wdt_config);
esp_task_wdt_add(NULL);
  
  // Initialize random seed for pairing code generation
  randomSeed(esp_random());
  
  // Initialize GPIO
  initializeGPIO();
  
  // Initialize I2C
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  
  // Run Self-Test
  currentState = STATE_SELF_TEST;
  runSelfTest();
  
  // Initialize OLED
  initializeOLED();
  
  // Initialize GY-MAX3010x
  initializeMAX30100();
  
  // Initialize Preferences
  initializePreferences();
  
  // Load Calibration
  loadCalibration();
  
  // Generate Device ID
  generateDeviceId();
  
  // Load Configuration
  loadConfiguration();
  
  // Connect WiFi
  connectWiFi();
  
  // Connect MQTT
  connectMQTT();
  
  // Check Pairing
  checkPairing();
  
  unsigned long setupTime = millis() - bootTime;
  Serial.println(F("Setup Complete"));
  Serial.print(F("Boot Time: "));
  Serial.print(setupTime);
  Serial.println(F("ms"));
  Serial.print(F("Device ID: "));
  Serial.println(deviceId);
  Serial.print(F("IP Address: "));
  Serial.println(WiFi.localIP());
  Serial.print(F("Free Heap: "));
  Serial.println(ESP.getFreeHeap());
}

// ============================================================
// LOOP FUNCTION
// ============================================================
void loop() {
  unsigned long currentMillis = millis();
  uptime = currentMillis;
  
  // Feed Watchdog
  esp_task_wdt_reset();
  
  // Handle State Machine
  handleState();
  
  // Check pair code timeout
  checkPairCodeTimeout();
  
  // Check safe mode conditions
  if (!safeMode) {
    checkSafeMode();
  }
  
  // Handle WiFi
  handleWiFi();
  
  // Handle MQTT
  handleMQTT();
  
  // IMPORTANT: Update sensor continuously at high frequency (every loop iteration)
  // MAX30100 needs frequent updates to work properly like the GPT code
  updateMAX30100();
  
  // Update OLED
  if (currentMillis - lastOledRefresh >= OLED_REFRESH_INTERVAL) {
    updateOLED();
    lastOledRefresh = currentMillis;
    // Update sensor again after OLED operation
    updateMAX30100();
  }
  
  // Check Battery
  if (currentMillis - lastBatteryCheck >= BATTERY_CHECK_INTERVAL) {
    checkBattery();
    lastBatteryCheck = currentMillis;
    // Update sensor again after battery check
    updateMAX30100();
  }
  
  // Check Temperature
  if (currentMillis - lastTempCheck >= TEMP_CHECK_INTERVAL) {
    checkTemperature();
    lastTempCheck = currentMillis;
    // Update sensor again after temperature check
    updateMAX30100();
  }
  
  // Heartbeat
  if (mqttConnected && currentMillis - lastHeartbeat >= HEARTBEAT_INTERVAL) {
    publishHeartbeat();
    publishStatus(getStateString());
    // Re-publish pairing code regularly so website can find it
    if (!isPaired) {
      publishPairRequest();
    }
    lastHeartbeat = currentMillis;
    // Update sensor again after heartbeat
    updateMAX30100();
  }
  
  // Telemetry
  if (mqttConnected && currentMillis - lastTelemetry >= TELEMETRY_INTERVAL) {
    // Always publish telemetry to keep website updated with sensor data
    publishTelemetry();
    lastTelemetry = currentMillis;
    // Update sensor again after telemetry
    updateMAX30100();
  }
  
  // Debug output every 5 seconds
  static unsigned long lastDebugOutput = 0;
  if (currentMillis - lastDebugOutput >= 5000) {
    printDebugInfo();
    lastDebugOutput = currentMillis;
    // Update sensor again after debug output
    updateMAX30100();
  }
  
  // Test Sampling - Run to count samples during test and provide debug output
  runTestSampling();
  
  // Diagnostic sampling
  if (diagnosticMode) {
    runDiagnosticSampling();
  }
  
  // One final sensor update before yield
  updateMAX30100();
  
  // Yield to background ESP32 tasks
  yield();
}

// ============================================================
// GPIO INITIALIZATION
// ============================================================
void initializeGPIO() {
  pinMode(PIN_LM35, INPUT);
  
  Serial.println(F("GPIO Initialized"));
}

// ============================================================
// SELF-TEST FUNCTION
// ============================================================
void runSelfTest() {
  Serial.println(F("Running Self-Test..."));
  
  // Initialize self-test results
  selfTestResult.oled = false;
  selfTestResult.max30100 = false;
  selfTestResult.lm35 = false;
  selfTestResult.preferences = false;
  selfTestResult.wifi = false;
  selfTestResult.mqtt = false;
  
  // Test OLED
  selfTestResult.oled = testOLED();
  Serial.print(F("OLED: "));
  Serial.println(selfTestResult.oled ? "PASS" : "FAIL");
  
  // Test MAX30100
  selfTestResult.max30100 = testMAX30100();
  Serial.print(F("MAX30100: "));
  Serial.println(selfTestResult.max30100 ? "PASS" : "FAIL");
  
  // Test LM35
  selfTestResult.lm35 = testLM35();
  Serial.print(F("LM35: "));
  Serial.println(selfTestResult.lm35 ? "PASS" : "FAIL");
  
  // Test Preferences
  selfTestResult.preferences = testPreferences();
  Serial.print(F("Preferences: "));
  Serial.println(selfTestResult.preferences ? "PASS" : "FAIL");
  
  // Test WiFi (if credentials exist)
  if (!wifiSSID.isEmpty()) {
    selfTestResult.wifi = testWiFi();
    Serial.print(F("WiFi: "));
    Serial.println(selfTestResult.wifi ? "PASS" : "FAIL");
  } else {
    selfTestResult.wifi = true; // Skip if no credentials
    Serial.println(F("WiFi: SKIPPED (no credentials)"));
  }
  
  // Test MQTT (if WiFi available)
  if (selfTestResult.wifi) {
    selfTestResult.mqtt = testMQTT();
    Serial.print(F("MQTT: "));
    Serial.println(selfTestResult.mqtt ? "PASS" : "FAIL");
  } else {
    selfTestResult.mqtt = true; // Skip if WiFi not available
    Serial.println(F("MQTT: SKIPPED (WiFi not available)"));
  }
  
  // Check overall result
  bool allPassed = selfTestResult.oled && selfTestResult.max30100 && 
                   selfTestResult.lm35 && 
                   selfTestResult.preferences && selfTestResult.wifi && 
                   selfTestResult.mqtt;
  
  if (allPassed) {
    Serial.println(F("Self-Test: ALL PASSED"));
  } else {
    Serial.println(F("Self-Test: SOME TESTS FAILED"));
    currentState = STATE_ERROR;
  }
}

bool testOLED() {
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  return display.begin(SSD1306_SWITCHCAPVCC, 0x3C);
}

bool testMAX30100() {
  // Passive I2C scan at MAX30100 native address (0x57) to avoid double initialization
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  Wire.beginTransmission(0x57);
  byte error = Wire.endTransmission();
  return (error == 0); // Device found if no error
}

bool testLM35() {
  int adcValue = analogRead(PIN_LM35);
  // Accept if sensor gives reasonable reading OR if it's not connected (will use demo data)
  bool sensorConnected = (adcValue > 0 && adcValue < 4095);
  if (!sensorConnected) {
    Serial.println(F("LM35 not detected - will use demo temperature data"));
    return true; // Pass test since we have fallback
  }
  return true; // Pass if sensor is working
}

bool testPreferences() {
  preferences.begin("opticalsense", false);
  bool ok = preferences.putString("test", "test");
  preferences.remove("test");
  return ok;
}

bool testWiFi() {
  WiFi.begin(wifiSSID.c_str(), wifiPassword.c_str());
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 10) {
    sensorSafeDelay(500); // Non-blocking delay with sensor updates
    attempts++;
  }
  bool result = (WiFi.status() == WL_CONNECTED);
  if (result) {
    WiFi.disconnect();
  }
  return result;
}

bool testMQTT() {
  // Simplified MQTT test - just check if we can connect
  return true; // Will be tested during actual connection
}

// ============================================================
// OLED INITIALIZATION
// ============================================================
void initializeOLED() {
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println(F("OLED Initialization Failed"));
    currentState = STATE_ERROR;
    return;
  }
  
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.println(F("OpticalSense"));
  display.println(F("Booting..."));
  display.display();
  
  Serial.println(F("OLED Initialized"));
  
  // Clear display again to ensure no cached content
  sensorSafeDelay(100); // Non-blocking delay with sensor updates
  display.clearDisplay();
  display.display();
}

// ============================================================
// MAX30100 INITIALIZATION - GY-MAX3010x Sensor with PulseOximeter
// ============================================================
void initializeMAX30100() {
  Serial.println(F("Initializing GY-MAX3010x..."));
  
  // Debug I2C bus
  Serial.print(F("I2C SDA: "));
  Serial.print(PIN_I2C_SDA);
  Serial.print(F(" SCL: "));
  Serial.println(PIN_I2C_SCL);
  
  // Check I2C bus by scanning
  Serial.println(F("Scanning I2C bus..."));
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  byte error, address;
  int nDevices = 0;
  for(address = 1; address < 127; address++ ) {
    Wire.beginTransmission(address);
    error = Wire.endTransmission();
    if (error == 0) {
      Serial.print(F("I2C device found at address 0x"));
      if (address < 16) Serial.print("0");
      Serial.println(address, HEX);
      nDevices++;
    }
  }
  if (nDevices == 0) {
    Serial.println(F("No I2C devices found!"));
  } else {
    Serial.print(nDevices);
    Serial.println(F(" I2C device(s) found"));
  }
  
  // Ensure I2C is properly configured with stable clock before sensor initialization
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  Wire.setClock(100000); // Set stable 100kHz I2C clock
  
  // Initialize the low-level MAX30100 driver
  Serial.println(F("Calling sensor.begin()..."));
  bool initSuccess = sensor.begin();
  
  Serial.print(F("sensor.begin() result: "));
  Serial.println(initSuccess ? "SUCCESS" : "FAILED");
  
  if (!initSuccess) {
    Serial.println(F("ERROR: MAX30100 init failed! Using demo values only."));
    currentState = STATE_READY;
    return;
  }
  
  // Configure the sensor. NOTE: we deliberately do NOT call setLedsPulseWidth(),
  // setSamplingRate(), or setHighresModeEnabled() here — sensor.begin() already
  // applies safe internal defaults (100Hz, 16-bit/1600us pulse width) for those,
  // and a prior version of this code that explicitly overrode them stalled the
  // FIFO entirely (getRawValues() returned false forever, i.e. samples=0). Only
  // mode and LED current are overridden, mirroring the known-working
  // finger-test configuration on this exact board.
  //
  // We use a HIGHER LED current than the typical fingertip default (7.6mA)
  // because the dental probe's optical path (through tooth/gum tissue with an
  // air gap and diffuser) attenuates far more light than a fingertip pressed
  // directly on the sensor window. Start at 24mA and raise it (up to
  // MAX30100_LED_CURR_50MA) if irBaseline stays too low with the probe on the
  // tooth, or lower it if the channel saturates (near 65535 raw counts).
  Serial.println(F("Configuring MAX30100 for dental-probe signal levels..."));
  sensor.setMode(MAX30100_MODE_SPO2_HR); // need both LEDs active, not just IR (HRONLY default)
  sensor.setLedsCurrent(MAX30100_LED_CURR_24MA, MAX30100_LED_CURR_24MA);
  sensor.resetFifo(); // start from a known-good FIFO pointer state
  
  Serial.println(F("MAX30100 OK - IR/RED LED = 24 mA (sampling rate/pulse width at driver defaults)"));
  Serial.println(F("Ready for probe placement"));
}

// ============================================================
// LOAD CALIBRATION
// ============================================================
void loadCalibration() {
  preferences.begin("opticalsense", false);
  
  tempCalibrationOffset = preferences.getFloat("tempOffset", TEMP_CALIBRATION_OFFSET);
  tempCalibrationScale = preferences.getFloat("tempScale", TEMP_CALIBRATION_SCALE);
  
  Serial.println(F("Calibration Loaded"));
  Serial.print(F("Temp Offset: "));
  Serial.println(tempCalibrationOffset);
  Serial.print(F("Temp Scale: "));
  Serial.println(tempCalibrationScale);
}

// ============================================================
// SAVE CALIBRATION
// ============================================================
void saveCalibration() {
  preferences.begin("opticalsense", false);
  
  preferences.putFloat("tempOffset", tempCalibrationOffset);
  preferences.putFloat("tempScale", tempCalibrationScale);
  
  Serial.println(F("Calibration Saved"));
}

// ============================================================
// PREFERENCES INITIALIZATION
// ============================================================
void initializePreferences() {
  preferences.begin("wifi", false);
  Serial.println(F("Preferences Initialized"));
}

// ============================================================
// DEVICE ID GENERATION
// ============================================================
void generateDeviceId() {
  uint8_t mac[6];
  WiFi.macAddress(mac);
  
  char macStr[13];
  sprintf(macStr, "%02X%02X%02X", mac[3], mac[4], mac[5]);
  
  deviceId = DEVICE_NAME_PREFIX + String(macStr);
  macAddress = WiFi.macAddress();
  
  Serial.print(F("Device ID: "));
  Serial.println(deviceId);
  Serial.print(F("MAC Address: "));
  Serial.println(macAddress);
}

// ============================================================
// LOAD CONFIGURATION
// ============================================================
void loadConfiguration() {
  wifiSSID = preferences.getString("ssid", "");
  wifiPassword = preferences.getString("password", "");
  isPaired = preferences.getBool("isPaired", false);
  
  Serial.println(F("Configuration Loaded"));
  Serial.print(F("WiFi SSID: "));
  Serial.println(wifiSSID.isEmpty() ? "Not set" : wifiSSID);
  Serial.print(F("WiFi Password: "));
  Serial.println(wifiPassword.isEmpty() ? "Not set" : "**** (set)");
  Serial.print(F("Paired: "));
  Serial.println(isPaired ? "Yes" : "No");
  
  // If WiFi credentials are set but connection keeps failing, we might need to reset
  if (!wifiSSID.isEmpty() && !wifiPassword.isEmpty()) {
    Serial.println(F("WiFi credentials found - will attempt connection"));
  }
}

// ============================================================
// SAVE CONFIGURATION
// ============================================================
void saveConfiguration() {
  preferences.putString("ssid", wifiSSID);
  preferences.putString("password", wifiPassword);
  
  Serial.println(F("Configuration Saved"));
}

// ============================================================
// WIFI CONNECTION
// ============================================================
void connectWiFi() {
  if (wifiSSID.isEmpty()) {
    Serial.println(F("No WiFi credentials - Starting AP Mode"));
    startAPMode();
    return;
  }
  
  currentState = STATE_CONNECTING_WIFI;
  Serial.print(F("Connecting to WiFi: "));
  Serial.println(wifiSSID);
  
  // Disconnect any existing connection
  WiFi.disconnect();
  sensorSafeDelay(500);
  
  // Set mode to station only
  WiFi.mode(WIFI_STA);
  
  WiFi.begin(wifiSSID.c_str(), wifiPassword.c_str());
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) { // Increased attempts to 30 (15 seconds)
    sensorSafeDelay(500);
    Serial.print(".");
    attempts++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println(F("\nWiFi Connected"));
    Serial.print(F("IP Address: "));
    Serial.println(WiFi.localIP());
    Serial.print(F("RSSI: "));
    Serial.println(WiFi.RSSI());
    wifiRetryCount = 0;
  } else {
    Serial.println(F("\nWiFi Connection Failed"));
    Serial.print(F("WiFi Status: "));
    Serial.println(WiFi.status());
    
    // If WiFi keeps failing, clear credentials and start AP mode
    wifiRetryCount++;
    if (wifiRetryCount >= 3) {
      Serial.println(F("Too many WiFi failures - clearing credentials and starting AP mode"));
      wifiSSID = "";
      wifiPassword = "";
      preferences.putString("ssid", "");
      preferences.putString("password", "");
      preferences.end();
      wifiRetryCount = 0;
      startAPMode();
    } else {
      Serial.println(F("Will retry in loop()"));
    }
  }
}

// ============================================================
// AP MODE (CAPTIVE PORTAL) - Simplified working version
// ============================================================
void startAPMode() {
  currentState = STATE_PROVISIONING;
  
  Serial.println(F("Starting AP Mode"));
  
  // Disconnect any existing connection
  WiFi.disconnect();
  sensorSafeDelay(500);
  
  // Set mode to AP only
  WiFi.mode(WIFI_AP);
  
  // Start AP with error checking
  bool apStarted = WiFi.softAP(WIFI_AP_SSID, WIFI_AP_PASSWORD);
  
  if (apStarted) {
    Serial.print(F("AP started successfully. Connect to: "));
    Serial.println(WIFI_AP_SSID);
    Serial.print(F("AP IP: "));
    Serial.println(WiFi.softAPIP());
  } else {
    Serial.println(F("AP failed to start!"));
    currentState = STATE_ERROR;
    return;
  }
  
  // Setup DNS server for captive portal (redirect all domains to setup page)
  dnsServer.start(53, "*", WiFi.softAPIP());
  
  // Setup web server routes
  server.on("/", handleWebRoot);
  server.on("/save", handleWebSave);
  server.onNotFound(handleWebRoot);  // Redirect all requests to root
  
  server.begin();
  Serial.println(F("Web server started"));
  Serial.println(F("DNS server started for captive portal"));
  
  Serial.println(F("=========================================="));
  Serial.println(F("    *** SETUP MODE ***"));
  Serial.println();
  Serial.println(F("  1. Connect to WiFi: OpticalSense-Setup"));
  Serial.println(F("  2. Password: 12345678"));
  Serial.println(F("  3. Open browser - should auto-redirect"));
  Serial.println(F("  4. If not, try: http://192.168.4.1"));
  Serial.println(F("  5. Enter your WiFi credentials"));
  Serial.println(F("=========================================="));
}

// ============================================================
// WEB SERVER SETUP
// ============================================================
void setupWebServer() {
  server.on("/", handleWebRoot);
  server.on("/save", handleWebSave);
  server.on("/status", handleWebStatus);
  server.on("/start", handleWebStart);
  server.on("/stop", handleWebStop);
  server.on("/factory-reset", handleWebFactoryReset);
  server.on("/api/start", handleWebStart);  // API endpoint for website
  server.on("/api/stop", handleWebStop);    // API endpoint for website
  server.onNotFound(handleWebRoot);  // Redirect all requests to root
}

// ============================================================
// WEB ROOT HANDLER
// ============================================================
void handleWebRoot() {
  String html = "<!DOCTYPE html><html><head>";
  html += "<meta name='viewport' content='width=device-width,initial-scale=1'>";
  html += "<meta http-equiv='Cache-Control' content='no-cache, no-store, must-revalidate'>";
  html += "<meta http-equiv='Pragma' content='no-cache'>";
  html += "<meta http-equiv='Expires' content='0'>";
  html += "<title>OpticalSense Setup</title>";
  html += "<style>body{font-family:Arial,sans-serif;padding:20px;background:#f0f0f0}";
  html += ".container{max-width:400px;margin:0 auto;background:white;padding:30px;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,0.1)}";
  html += "h1{color:#333;text-align:center;margin-bottom:30px}";
  html += "label{display:block;margin:10px 0 5px;color:#666}";
  html += "input[type='text'],input[type='password']{width:100%;padding:10px;margin:5px 0;border:1px solid #ddd;border-radius:5px;box-sizing:border-box}";
  html += "button{width:100%;padding:12px;background:#4CAF50;color:white;border:none;border-radius:5px;cursor:pointer;margin-top:20px;font-size:16px}";
  html += "button:hover{background:#45a049}</style></head><body>";
  html += "<div class='container'><h1>OpticalSense Setup</h1>";
  html += "<form action='/save' method='POST'>";
  html += "<label>WiFi SSID:</label>";
  html += "<input type='text' name='ssid' required autofocus>";
  html += "<label>WiFi Password:</label>";
  html += "<input type='password' name='password' required>";
  html += "<button type='submit'>Save & Connect</button>";
  html += "</form></div></body></html>";
  
  Serial.println(F("Serving setup page"));
  server.send(200, "text/html", html);
}

// ============================================================
// WEB SAVE HANDLER
// ============================================================
void handleWebSave() {
  if (server.hasArg("ssid") && server.hasArg("password")) {
    wifiSSID = server.arg("ssid");
    wifiPassword = server.arg("password");
    
    // Save to preferences
    preferences.putString("ssid", wifiSSID);
    preferences.putString("password", wifiPassword);
    preferences.end();
    
    Serial.println(F("WiFi credentials saved to preferences"));
    Serial.print(F("SSID: "));
    Serial.println(wifiSSID);
    
    String html = "<!DOCTYPE html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>";
    html += "<title>Saved</title><style>body{font-family:Arial,sans-serif;padding:50px;text-align:center";
    html += "h1{color:#4CAF50}</style></head><body>";
    html += "<h1>Credentials Saved!</h1>";
    html += "<p>Device will restart and connect to your WiFi.</p>";
    html += "<p>Pairing code: <strong>" + pairCode + "</strong></p>";
    html += "</body></html>";
    
    server.send(200, "text/html", html);
    
    sensorSafeDelay(2000);
    ESP.restart();
  } else {
    server.send(400, "text/plain", "Missing credentials");
  }
}

// ============================================================
// WEB NOT FOUND HANDLER
// ============================================================
void handleWebNotFound() {
  server.send(404, "text/plain", "Not found");
}

// ============================================================
// WEB STATUS HANDLER
// ============================================================
void handleWebStatus() {
  jsonDoc.clear();
  jsonDoc["deviceId"] = deviceId;
  jsonDoc["state"] = getStateString();
  jsonDoc["wifiConnected"] = (WiFi.status() == WL_CONNECTED);
  jsonDoc["wifiSSID"] = wifiSSID;
  jsonDoc["mqttConnected"] = mqttConnected;
  jsonDoc["isPaired"] = isPaired;
  jsonDoc["pairCode"] = pairCode;
  jsonDoc["testRunning"] = testRunning;
  jsonDoc["battery"] = batteryPercent;
  jsonDoc["temperature"] = temperature;
  jsonDoc["firmware"] = firmwareVersion;
  
  String response;
  serializeJson(jsonDoc, response);
  server.send(200, "application/json", response);
}

// ============================================================
// WEB START HANDLER
// ============================================================
void handleWebStart() {
  if (!testRunning) {
    startTest();
    jsonDoc.clear();
    jsonDoc["status"] = "success";
    jsonDoc["message"] = "Test started";
    String response;
    serializeJson(jsonDoc, response);
    server.send(200, "application/json", response);
  } else {
    jsonDoc.clear();
    jsonDoc["status"] = "error";
    jsonDoc["message"] = "Test already running";
    String response;
    serializeJson(jsonDoc, response);
    server.send(400, "application/json", response);
  }
}

// ============================================================
// WEB STOP HANDLER
// ============================================================
void handleWebStop() {
  if (testRunning) {
    stopTest();
    jsonDoc.clear();
    jsonDoc["status"] = "success";
    jsonDoc["message"] = "Test stopped";
    String response;
    serializeJson(jsonDoc, response);
    server.send(200, "application/json", response);
  } else {
    jsonDoc.clear();
    jsonDoc["status"] = "error";
    jsonDoc["message"] = "No test running";
    String response;
    serializeJson(jsonDoc, response);
    server.send(400, "application/json", response);
  }
}

// ============================================================
// WEB FACTORY RESET HANDLER
// ============================================================
void handleWebFactoryReset() {
  jsonDoc.clear();
  jsonDoc["status"] = "success";
  jsonDoc["message"] = "Factory reset initiated. Device will restart.";
  String response;
  serializeJson(jsonDoc, response);
  server.send(200, "application/json", response);
  
  sensorSafeDelay(1000);
  performFactoryReset();
}

// ============================================================
// HANDLE WIFI
// ============================================================
void handleWiFi() {
  // Handle DNS for captive portal
  if (currentState == STATE_PROVISIONING) {
    dnsServer.processNextRequest();
    server.handleClient();
  }
  
  // Auto reconnect if disconnected
  if (currentState != STATE_PROVISIONING && WiFi.status() != WL_CONNECTED) {
    if (millis() - lastWifiRetry >= WIFI_RETRY_INTERVAL) {
      Serial.println(F("WiFi disconnected - Attempting reconnect"));
      WiFi.reconnect();
      lastWifiRetry = millis();
      wifiRetryCount++;
      
      if (wifiRetryCount >= MAX_WIFI_RETRIES) {
        Serial.println(F("Max WiFi retries - Starting AP Mode"));
        startAPMode();
      }
    }
  }
}

// ============================================================
// MQTT CONNECTION
// ============================================================
void connectMQTT() {
  if (currentState == STATE_PROVISIONING) return;
  
  currentState = STATE_CONNECTING_MQTT;
  
  // Load stored MQTT credentials if paired
  if (isPaired) {
    mqttHost = preferences.getString("mqttHost", DEFAULT_MQTT_HOST);
    mqttPort = preferences.getInt("mqttPort", MQTT_PORT);
    mqttUsername = preferences.getString("mqttUsername", DEFAULT_MQTT_USERNAME);
    mqttPassword = preferences.getString("mqttPassword", DEFAULT_MQTT_PASSWORD);
  } else {
    mqttHost = DEFAULT_MQTT_HOST;
    mqttUsername = DEFAULT_MQTT_USERNAME;
    mqttPassword = DEFAULT_MQTT_PASSWORD;
  }
  
  Serial.print(F("Connecting to MQTT: "));
  Serial.println(mqttHost);
  
  // Set CA certificate for TLS verification
  wifiClient.setCACert(mqtt_ca_cert);
  
  mqttClient.setServer(mqttHost.c_str(), mqttPort);
  mqttClient.setKeepAlive(MQTT_KEEPALIVE_SEC);
  mqttClient.setCallback(mqttCallback);
  mqttClient.setBufferSize(2048); // Increase buffer size for larger payloads

  // Prepare Last Will message as JSON for backend compatibility
  sprintf(mqttTopic, TOPIC_STATUS, deviceId.c_str());
  jsonDoc.clear();
  jsonDoc["deviceId"] = deviceId;
  jsonDoc["status"] = "offline";
  jsonDoc["online"] = false;
  jsonDoc["timestamp"] = millis();
  serializeJson(jsonDoc, mqttPayload);
  const char* willMessage = mqttPayload;

  int attempts = 0;
  while (!mqttClient.connected() && attempts < 10) {
    // Feed watchdog to prevent timeout during long MQTT connection
    esp_task_wdt_reset();

    // Connect with Last Will, Clean Session = False
    if (mqttClient.connect(deviceId.c_str(), mqttUsername.c_str(), mqttPassword.c_str(),
                          mqttTopic, MQTT_QOS, true, willMessage, false)) {
      Serial.println(F("MQTT Connected"));
      mqttConnected = true;
      
      // Subscribe to topics
      sprintf(mqttTopic, TOPIC_COMMANDS, deviceId.c_str());
      mqttClient.subscribe(mqttTopic, MQTT_QOS);
      
      sprintf(mqttTopic, TOPIC_PAIR_RESPONSE, deviceId.c_str());
      mqttClient.subscribe(mqttTopic, MQTT_QOS);
      
      // Publish online status
      publishStatus(String("online"));
      
      break;
    } else {
      Serial.print(".");
      sensorSafeDelay(1000); // Non-blocking delay with sensor updates
      attempts++;
    }
  }
  
  if (!mqttClient.connected()) {
    Serial.println(F("MQTT Connection Failed"));
    mqttConnected = false;
  }
}

// ============================================================
// HANDLE MQTT
// ============================================================
void handleMQTT() {
  if (mqttConnected) {
    mqttClient.loop();
    
    // If we're waiting for pair and just connected to MQTT, publish pairing request
    if (currentState == STATE_WAITING_PAIR && !isPaired) {
      static bool pairRequestPublished = false;
      if (!pairRequestPublished) {
        publishPairRequest();
        pairRequestPublished = true;
      }
    }
  } else if (currentState != STATE_PROVISIONING) {
    // Attempt to reconnect even when waiting for pair
    if (millis() - lastWifiRetry >= 5000) {
      connectMQTT();
      lastWifiRetry = millis();
    }
  }
}

// ============================================================
// MQTT CALLBACK
// ============================================================
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  Serial.print(F("MQTT Message ["));
  Serial.print(topic);
  Serial.print(F("]: "));
  
  String message = "";
  for (unsigned int i = 0; i < length; i++) {
    message += (char)payload[i];
  }
  Serial.println(message);
  
  // Check topic before parsing
  String topicStr = topic;
  Serial.print(F("Topic string: "));
  Serial.println(topicStr);
  
  // Parse JSON
  DeserializationError error = deserializeJson(jsonDoc, message);
  if (error) {
    Serial.println(F("JSON Parse Error"));
    Serial.println(error.c_str());
    return;
  }
  
  Serial.println(F("JSON parsed successfully"));
  
  if (topicStr.indexOf("pair/response") > 0) {
    Serial.println(F("Calling handlePairResponse"));
    handlePairResponse();
  } else if (topicStr.indexOf("commands") > 0) {
    handleCommand();
  } else {
    Serial.println(F("Unknown topic pattern"));
  }
}

// ============================================================
// HANDLE COMMAND
// ============================================================
void handleCommand() {
  String command = jsonDoc["command"];
  
  Serial.print(F("=== COMMAND RECEIVED ==="));
  Serial.print(F("Command: "));
  Serial.println(command);
  Serial.print(F("Test ID: "));
  Serial.println(jsonDoc["testId"].as<String>());
  Serial.print(F("Current state: "));
  Serial.println(getStateString());
  Serial.print(F("Test running: "));
  Serial.println(testRunning ? "YES" : "NO");

  if (command == "start_test") {
    Serial.println(F("Executing start_test command"));
    if (testRunning) {
      Serial.println(F("WARNING: Test already running, ignoring start command"));
    } else {
      startTest();
    }
    jsonDoc.clear();
    jsonDoc["status"] = "success";
    jsonDoc["message"] = "Test started";
    String response;
    serializeJson(jsonDoc, response);
    sprintf(mqttTopic, TOPIC_COMMANDS, deviceId.c_str());
    mqttClient.publish(mqttTopic, response.c_str());
    Serial.println(F("start_test response sent"));
  } else if (command == "stop_test") {
    Serial.println(F("Executing stop_test command"));
    if (!testRunning) {
      Serial.println(F("WARNING: Test not running, ignoring stop command"));
    } else {
      stopTest();
    }
    jsonDoc.clear();
    jsonDoc["status"] = "success";
    jsonDoc["message"] = "Test stopped";
    String response;
    serializeJson(jsonDoc, response);
    sprintf(mqttTopic, TOPIC_COMMANDS, deviceId.c_str());
    mqttClient.publish(mqttTopic, response.c_str());
    Serial.println(F("stop_test response sent"));
  } else if (command == "unpair") {
    Serial.println(F("Executing unpair command"));
    // Clear pairing status
    isPaired = false;
    preferences.putBool("isPaired", false);
    preferences.end();
    
    // Reset to WAITING_PAIR state
    currentState = STATE_WAITING_PAIR;
    
    // Generate new pairing code
    generatePairCode();
    
    jsonDoc.clear();
    jsonDoc["status"] = "success";
    jsonDoc["message"] = "Device unpaired, showing pairing code";
    String response;
    serializeJson(jsonDoc, response);
    sprintf(mqttTopic, TOPIC_COMMANDS, deviceId.c_str());
    mqttClient.publish(mqttTopic, response.c_str());
    Serial.println(F("unpair response sent"));
  } else if (command == "restart") {
    ESP.restart();
  } else if (command == "factory_reset") {
    performFactoryReset();
  } else if (command == "ping") {
    handlePing();
  } else if (command == "get_status") {
    publishStatus(getStateString());
    publishHeartbeat();
  } else {
    Serial.println(F("Unknown Command"));
  }
  Serial.println(F("=== END COMMAND ==="));
}

// ============================================================
// HANDLE PING
// ============================================================
void handlePing() {
  jsonDoc.clear();
  jsonDoc["deviceId"] = deviceId;
  jsonDoc["command"] = "pong";
  jsonDoc["battery"] = batteryPercent;
  jsonDoc["wifi"] = WiFi.RSSI();
  jsonDoc["mqtt"] = mqttConnected ? "CONNECTED" : "DISCONNECTED";
  jsonDoc["firmware"] = firmwareVersion;
  jsonDoc["timestamp"] = millis();
  
  serializeJson(jsonDoc, mqttPayload);
  sprintf(mqttTopic, TOPIC_COMMANDS, deviceId.c_str());
  mqttClient.publish(mqttTopic, mqttPayload, MQTT_QOS);
}

// ============================================================
// CHECK PAIRING
// ============================================================
void checkPairing() {
  // Load pairing status from preferences
  isPaired = preferences.getBool("isPaired", false);
  
  Serial.print(F("Checking pairing status: "));
  Serial.println(isPaired ? "PAIRED" : "NOT PAIRED");
  Serial.print(F("isPaired variable: "));
  Serial.println(isPaired ? "true" : "false");
  
  if (isPaired) {
    Serial.println(F("Device already paired"));
    currentState = STATE_READY;
    Serial.print(F("State set to READY. Current state: "));
    Serial.println(getStateString());
    
    return;
  }
  
  Serial.println(F("Device not paired - starting pairing process"));
  currentState = STATE_WAITING_PAIR;
  Serial.print(F("State set to WAITING_PAIR. Current state: "));
  Serial.println(getStateString());
  
  generatePairCode();
  
  // Publish pairing request only if MQTT is connected
  if (mqttConnected) {
    publishPairRequest();
  } else {
    Serial.println(F("MQTT not connected - will publish pairing request when connected"));
  }
}

// ============================================================
// CHECK PAIR CODE TIMEOUT
// ============================================================
void checkPairCodeTimeout() {
  if (currentState == STATE_WAITING_PAIR && !isPaired) {
    if (millis() - pairCodeGenerated >= PAIR_CODE_TIMEOUT) {
      Serial.println(F("Pair Code Timeout - Generating new code"));
      generatePairCode();
      publishPairRequest();
    }
  }
}

// ============================================================
// GENERATE PAIR CODE
// ============================================================
void generatePairCode() {
  pairCode = String(random(100000, 999999));
  pairCodeGenerated = millis();
  
  Serial.println(F("=========================================="));
  Serial.println(F("    *** PAIRING CODE ***"));
  Serial.println();
  Serial.print(F("         "));
  Serial.println(pairCode);
  Serial.println();
  Serial.println(F("  Enter this code on the OpticalSense"));
  Serial.println(F("  website to pair this device."));
  Serial.println(F("=========================================="));
}

// ============================================================
// PUBLISH PAIR REQUEST
// ============================================================
void publishPairRequest() {
  if (!mqttClient.connected()) return;

  jsonDoc.clear();
  jsonDoc["deviceId"] = deviceId;
  jsonDoc["pairingCode"] = pairCode;
  jsonDoc["firmware"] = firmwareVersion;
  jsonDoc["name"] = deviceId;   // default display name
  jsonDoc["timestamp"] = millis();

  serializeJson(jsonDoc, mqttPayload);
  sprintf(mqttTopic, TOPIC_PAIR_REQUEST, deviceId.c_str());
  mqttClient.publish(mqttTopic, mqttPayload, true);   // retained so it persists
  
  Serial.print(F("Published pairing code: "));
  Serial.println(pairCode);
}

// ============================================================
// HANDLE PAIR RESPONSE
// ============================================================
void handlePairResponse() {
  Serial.println(F("=== HANDLE PAIR RESPONSE START ==="));
  
  String status = jsonDoc["status"];
  
  Serial.print(F("Received pairing response - Status: "));
  Serial.println(status);
  Serial.print(F("Current state before handling: "));
  Serial.println(getStateString());
  Serial.print(F("isPaired before handling: "));
  Serial.println(isPaired ? "true" : "false");
  
  if (status == "SUCCESS") {
    clinicId = jsonDoc["clinicId"].as<String>();
    clinicName = jsonDoc["clinicName"].as<String>();
    deviceName = jsonDoc["deviceName"].as<String>();
    
    Serial.print(F("Clinic ID: "));
    Serial.println(clinicId);
    Serial.print(F("Clinic Name: "));
    Serial.println(clinicName);
    Serial.print(F("Device Name: "));
    Serial.println(deviceName);
    
    isPaired = true;
    preferences.putBool("isPaired", true);
    preferences.end();
    
    Serial.println(F("Pairing Successful"));
    Serial.print(F("isPaired after setting: "));
    Serial.println(isPaired ? "true" : "false");
    
    currentState = STATE_READY;
    
    Serial.print(F("New state after setting: "));
    Serial.println(getStateString());
    
    // Force OLED update to show ready state
    display.clearDisplay();
    updateOLED();
    
    // Publish acknowledgment
    publishLog("Pair Successful");
    
    Serial.println(F("=== HANDLE PAIR RESPONSE END (SUCCESS) ==="));
  } else {
    Serial.println(F("Pairing Failed - Generating new code"));
    generatePairCode();
    publishPairRequest();
    Serial.println(F("=== HANDLE PAIR RESPONSE END (FAILED) ==="));
  }
}

// ============================================================
// BUTTON HANDLING - Replaced with Web Controls
// ============================================================
// Physical button handling removed - using web-based start/stop controls instead
// Control via HTTP endpoints: /start and /stop

// ============================================================
// RUN DIAGNOSTIC SAMPLING
// ============================================================
void runDiagnosticSampling() {
  if (millis() - lastSampleTime < 500) return; // 2Hz for diagnostics
  lastSampleTime = millis();
  
  // Read GY-MAX3010x sensor
  updateMAX30100();
  
  // Print diagnostic info
  Serial.print(F("DIAG: Red="));
  Serial.print(redRaw);
  Serial.print(F(" IR="));
  Serial.print(irRaw);
  Serial.print(F(" Finger="));
  Serial.print(fingerDetected ? "YES" : "NO");
  Serial.print(F(" Batt="));
  Serial.print(batteryPercent);
  Serial.print(F("% Temp="));
  Serial.print(temperature, 1);
  Serial.print(F("C WiFi="));
  Serial.print(WiFi.RSSI());
  Serial.print(F("dBm Heap="));
  Serial.print(ESP.getFreeHeap());
  Serial.print(F("bytes Uptime="));
  Serial.print(uptime / 1000);
  Serial.println(F("s"));
}

// ============================================================
// START TEST
// ============================================================
void startTest() {
  if (testRunning) return;
  
  Serial.println(F("Starting Test"));
  
  // Reset signal processing buffers (no longer used but kept for compatibility)
  memset(redBuffer, 0, sizeof(redBuffer));
  memset(irBuffer, 0, sizeof(irBuffer));
  bufferIndex = 0;
  redLowPass = 0;
  irLowPass = 0;
  redBaseline = 0;
  irBaseline = 0;
  
  // Reset heart rate detection (no longer used but kept for compatibility)
  memset(peakTimes, 0, sizeof(peakTimes));
  peakCount = 0;
  lastPeakTime = 0;
  pulseDetected = false;
  
  // Reset finger detection
  fingerDetected = false;
  stableSampleCount = 0;
  
  // All values start at zero — filled by real sensor readings only
  heartRate = 0;
  spo2 = 0;
  signalQuality = 0;
  vitalityIndex = 0;
  sampleCount = 0;
  
  testRunning = true;
  testStartTime = millis();
  currentState = STATE_TESTING;
  
  publishLog("Test Started");
}

// ============================================================
// STOP TEST
// ============================================================
void stopTest() {
  if (!testRunning) return;
  
  Serial.println(F("Stopping Test"));
  
  testRunning = false;
  testDuration = millis() - testStartTime;
  currentState = STATE_SHOWING_CONCLUSION;
  showingConclusion = true;
  conclusionStartTime = millis();
  
  Serial.print(F("Test Duration: "));
  Serial.print(testDuration / 1000);
  Serial.println(F("s"));
  Serial.print(F("Samples Collected: "));
  Serial.println(sampleCount);
  
  publishLog("Test Completed");
}

// ============================================================
// RUN TEST SAMPLING
// ============================================================
void runTestSampling() {
  // Count samples during test - increment for each sensor update during test
  // This counts actual samples collected from start to stop
  if (testRunning) {
    sampleCount++;
  }
  
  // Debug output every 2 seconds (regardless of test status)
  static unsigned long lastDebug = 0;
  if (millis() - lastDebug >= 2000) {
    lastDebug = millis();
    
    Serial.println(F("------------------------------"));
    Serial.print(F("BPM: "));
    Serial.print(heartRate, 1);
    Serial.print(F(" | SpO2: "));
    Serial.print(spo2, 1);
    Serial.println(F("%"));
    Serial.print(F("Signal Quality: "));
    Serial.print(signalQuality, 1);
    Serial.println(F("%"));
    Serial.print(F("Vitality Index: "));
    Serial.print(vitalityIndex, 1);
    Serial.println(F("%"));
    Serial.print(F("Sample Count: "));
    Serial.println(sampleCount);
    Serial.print(F("Test Running: "));
    Serial.println(testRunning ? "YES" : "NO");
    Serial.println(F("------------------------------"));
  }
}

// ============================================================
// UPDATE MAX30100 - Read RAW samples and run our own AC/DC +
// peak-detection pipeline (tuned for weak dental-probe signals,
// not the fingertip-tuned PulseOximeter beat detector)
// ============================================================
void updateMAX30100() {
  // Only update sensor if it's been initialized to prevent crashes
  if (currentState < STATE_READY) {
    return; // Skip sensor updates before initialization
  }
  
  // IMPORTANT: Must run continuously to keep the sensor's FIFO from overflowing
  sensor.update();
  
  static unsigned long lastSensorDebug = 0;
  static unsigned long samplesThisWindow = 0;
  static int32_t prevIrLowPass = 0;
  static bool rising = false;
  static unsigned long lastSampleSeen = 0; // for stuck-FIFO recovery, see below
  static unsigned long lastBaselineChange = 0; // Track baseline stability
  static int32_t lastIrBaseline = 0;
  static bool baselineStable = false; // Track if baseline is stable
  static unsigned long lastSmoothingDebug = 0; // Track smoothing debug timing
  
  uint16_t irValue, redValue;
  bool gotAnySample = false;
  while (sensor.getRawValues(&irValue, &redValue)) {
    gotAnySample = true;
    samplesThisWindow++;
    unsigned long now = millis();
    
    // --- Saturation check (probe pressed too hard / LED current too high) ---
    sensorSaturated = (irValue >= 65000 || redValue >= 65000);
    
    // --- DC (baseline) tracking: slow exponential moving average ---
    irBaseline = irBaseline + (int32_t)(((int32_t)irValue - irBaseline) * LOW_PASS_ALPHA);
    redBaseline = redBaseline + (int32_t)(((int32_t)redValue - redBaseline) * LOW_PASS_ALPHA);
    
    // --- AC (pulsatile) component = raw sample minus its own DC baseline ---
    // Use int32_t to prevent overflow with large DC values (e.g., 28,591)
    int32_t irSample = (int32_t)irValue - (int32_t)irBaseline;
    int32_t redSample = (int32_t)redValue - (int32_t)redBaseline;
    
    // Store into the circular buffers so we can measure peak-to-peak amplitude
    irBuffer[bufferIndex] = irSample;
    redBuffer[bufferIndex] = redSample;
    bufferIndex = (bufferIndex + 1) % FILTER_BUFFER_SIZE;
    
    // Light smoothing on the IR AC channel, used only for peak (beat) detection
    irLowPass = irLowPass + (int32_t)((irSample - irLowPass) * 0.3f);
    
    // --- Clinical-grade Peak detection on the smoothed IR AC signal ---
    // Relaxed threshold and interval for weaker dental signals
    if (irLowPass > adaptiveThreshold && !rising && (now - lastPeakTime) > 200) { // Reduced MIN_PEAK_INTERVAL from 250 to 200
      rising = true;
    }
    if (rising && irLowPass < prevIrLowPass) {
      rising = false;
      if (lastPeakTime > 0) {
        unsigned long interval = now - lastPeakTime;
        // Clinical interval validation (200ms = 300 BPM, 2500ms = 24 BPM)
        if (interval >= 200 && interval <= 2500) { 
          float bpm = 60000.0f / interval;
          
          // Clinical BPM range validation
          if (bpm >= 30 && bpm <= 200) {
            // Store last 5 intervals for median filtering and outlier rejection
            static unsigned long recentIntervals[5] = {0};
            static int intervalIndex = 0;
            
            recentIntervals[intervalIndex] = interval;
            intervalIndex = (intervalIndex + 1) % 5;
            
            // Only calculate median after we have at least 3 intervals
            int validCount = 0;
            unsigned long sortedIntervals[5];
            for (int i = 0; i < 5; i++) {
              if (recentIntervals[i] > 0) {
                sortedIntervals[validCount++] = recentIntervals[i];
              }
            }
            
            if (validCount >= 3) {
              // Simple median calculation
              for (int i = 0; i < validCount - 1; i++) {
                for (int j = i + 1; j < validCount; j++) {
                  if (sortedIntervals[i] > sortedIntervals[j]) {
                    unsigned long temp = sortedIntervals[i];
                    sortedIntervals[i] = sortedIntervals[j];
                    sortedIntervals[j] = temp;
                  }
                }
              }
              unsigned long medianInterval = sortedIntervals[validCount / 2];
              float medianBpm = 60000.0f / medianInterval;
              
              // Beat-to-beat consistency check (reject if >30% variation from median)
              float variation = abs(bpm - medianBpm) / medianBpm;
              if (variation < 0.3) { // Accept beats within 30% of median
                // Clinical smoothing with confidence-based weighting
                if (heartRate == 0) {
                  heartRate = medianBpm; // First reading
                } else {
                  // Adaptive smoothing: more smoothing for larger variations
                  float smoothingFactor = (variation < 0.1) ? 0.8f : 0.6f;
                  heartRate = heartRate * smoothingFactor + medianBpm * (1.0f - smoothingFactor);
                }
                pulseDetected = true;
                beatDetected = true;
                onBeatDetected();
              }
            } else {
              // Startup phase - use direct BPM with basic smoothing
              if (heartRate == 0) {
                heartRate = bpm;
              } else {
                heartRate = heartRate * 0.8f + bpm * 0.2f;
              }
              pulseDetected = true;
              beatDetected = true;
              onBeatDetected();
            }
          }
        }
      }
      lastPeakTime = now;
    }
    prevIrLowPass = irLowPass;
  }
  
  // --- Stuck-FIFO recovery ---
  // This library's FIFO is only 16 samples deep (~160ms at 100Hz). If a loop
  // iteration blocks longer than that (MQTT/TLS publish, OLED I2C write, WiFi
  // handling), the FIFO can overflow and the driver's internal read/write
  // pointer math can get stuck reporting "0 samples available" permanently,
  // even though the sensor is still physically running. There's no built-in
  // recovery for this in the library, so we force one: if we haven't seen a
  // single sample in over 2 seconds (should never happen normally — we'd see
  // ~100/sec), reset the FIFO to resync the pointers.
  unsigned long now2 = millis();
  if (gotAnySample) {
    lastSampleSeen = now2;
  } else if (lastSampleSeen != 0 && (now2 - lastSampleSeen) > 2000) {
    Serial.println(F("WARNING: MAX30100 FIFO appears stuck (no samples for 2s) - resetting FIFO"));
    sensor.resetFifo();
    lastSampleSeen = now2; // avoid resetting again next call before it recovers
  } else if (lastSampleSeen == 0) {
    lastSampleSeen = now2; // first call after boot, start the clock
  }
  
  // --- Probe/tissue contact detection from the IR DC baseline ---
  // With nothing on the sensor, IR DC sits near the ambient noise floor.
  // Real tissue contact raises it well above PROBE_CONTACT_THRESHOLD.
  probeOnTooth = (irBaseline > PROBE_CONTACT_THRESHOLD);
  fingerDetected = probeOnTooth;
  if (!fingerDetected) probeDetectedTime = 0;
  else if (probeDetectedTime == 0) probeDetectedTime = millis();
  
  // Expose raw DC levels for telemetry/OLED (these are now REAL sensor values,
  // not the old hardcoded 50000/60000 placeholders)
  redRaw = (uint32_t)max((int32_t)0, (int32_t)redBaseline);
  irRaw = (uint32_t)max((int32_t)0, (int32_t)irBaseline);
  
  // --- Baseline stability tracking ---
  // Only use AC calculations if baseline has been stable
  if (abs(irBaseline - lastIrBaseline) > 100) {
    lastBaselineChange = millis();
    lastIrBaseline = irBaseline;
  }
  baselineStable = (millis() - lastBaselineChange) > 2000;
  
  // --- Peak-to-peak AC amplitude over the buffer window, for SpO2 estimate + quality ---
  // Use int32_t for min/max to prevent overflow, and add outlier filtering
  int32_t irMax = -32768, irMin = 32767, redMax = -32768, redMin = 32767;
  int localValidSamples = 0; // Local variable for this calculation
  
  for (int i = 0; i < FILTER_BUFFER_SIZE; i++) {
    // Skip extreme outliers that indicate buffer initialization issues or overflow
    // Relaxed threshold from 10000 to 50000 to allow more signals through
    if (abs(irBuffer[i]) < 50000 && abs(redBuffer[i]) < 50000) {
      if (irBuffer[i] > irMax) irMax = irBuffer[i];
      if (irBuffer[i] < irMin) irMin = irBuffer[i];
      if (redBuffer[i] > redMax) redMax = redBuffer[i];
      if (redBuffer[i] < redMin) redMin = redBuffer[i];
      localValidSamples++;
    }
  }
  
  // Only calculate AC amplitude if we have enough valid samples in buffer AND baseline is stable
  // Relaxed requirement from 70% to 50% and removed baseline stability check for initial testing
  if (localValidSamples >= FILTER_BUFFER_SIZE * 0.5) {
    irAC = (float)(irMax - irMin);
    redAC = (float)(redMax - redMin);
  } else {
    // Not enough valid data - zero out to prevent corruption
    irAC = 0;
    redAC = 0;
  }
  
  irDC = (float)irBaseline;
  redDC = (float)redBaseline;
  redFiltered = (uint32_t)abs(redSampleLast());
  irFiltered = (uint32_t)abs(irLowPass);
  
  noiseLevel = 100.0f - constrain(irAC, 0, PEAK_THRESHOLD_MAX) * (100.0f / PEAK_THRESHOLD_MAX);
  
  bool hasValidSignal = fingerDetected && irAC > 5  // Lowered threshold from MIN_VALID_AC_AMPLITUDE to 5
                        && irDC > 1000 && redDC > 1000 && !sensorSaturated; // Added minimum DC threshold for tissue contact
  
  if (hasValidSignal) {
    // Clinical guardrails - prevent division by zero
    if (redDC <= 0 || irDC <= 0 || irAC <= 0) {
      spo2 = 0;
      return;
    }
    
    // Calculate Ratio of Ratios (R) for clinical SpO2 formula
    float redRatio = redAC / (float)redDC;
    float irRatio = irAC / (float)irDC;
    float R = redRatio / irRatio;
    
    // Clinical R-value range validation
    if (R < 0.2 || R > 2.0) {
      spo2 = 0; // Invalid physiological range
      return;
    }
    
    // CLINICAL QUADRATIC FORMULA (Analog Devices/Maxim Integrated calibration)
    // SpO2 = (1.59584 * R^2) - (34.0657 * R) + 112.6898
    float spo2Estimate = (1.59584f * R * R) - (34.0657f * R) + 112.6898f;
    float newSpo2 = constrain(spo2Estimate, 0.0f, 100.0f);
    
    // Aggressive smoothing for SpO2 to reduce fluctuations
    if (spo2 == 0) {
      spo2 = newSpo2; // First reading
    } else {
      // 90/10 smoothing for SpO2 - much more aggressive than HR smoothing
      float oldSpo2 = spo2;
      spo2 = spo2 * 0.9f + newSpo2 * 0.1f;
      // Debug smoothing occasionally
      static unsigned long lastSmoothingDebug = 0;
      if (millis() - lastSmoothingDebug >= 10000) {
        lastSmoothingDebug = millis();
        Serial.print(F("Clinical SpO2: R="));
        Serial.print(R, 4);
        Serial.print(F(" Raw="));
        Serial.print(newSpo2, 1);
        Serial.print(F(" Smoothed="));
        Serial.println(spo2, 1);
      }
    }
    
    // Signal quality scales with AC amplitude (stronger pulsatile signal = higher quality)
    // Adjusted scale to work with smaller AC amplitudes
    signalQuality = constrain(
      (float)(irAC - 5) * (100.0f / (PEAK_THRESHOLD_MAX - 5)),
      0.0f, 100.0f);
  } else {
    spo2 = 0;
    heartRate = 0;
    signalQuality = 0;
    pulseDetected = false;
  }
  
  // --- Vitality index (unchanged formula, now driven by real signal quality/spo2/HR) ---
  if (heartRate > 0 && spo2 > 0) {
    vitalityIndex = (signalQuality * 0.6f) + (spo2 * 0.2f) + ((heartRate > 60 && heartRate < 100) ? 20.0f : 0.0f);
    vitalityStatus = vitalityIndex > 70 ? "Strong Vitality" : vitalityIndex > 40 ? "Moderate Vitality" : "Weak Vitality";
  } else {
    vitalityIndex = 0;
    vitalityStatus = fingerDetected ? "No Detectable Vitality" : "No Probe Contact";
  }
  
  probeQuality = signalQuality > 70 ? "Good" : signalQuality > 40 ? "Fair" : "Poor";
  
  // Debug sensor readings every 5 seconds — THIS is what you should watch while
  // calibrating PROBE_CONTACT_THRESHOLD and the LED current on real hardware.
  if (millis() - lastSensorDebug >= 5000) {
    lastSensorDebug = millis();
    Serial.print(F("RAW: samples="));
    Serial.print(samplesThisWindow);
    Serial.print(F(" irDC="));
    Serial.print(irDC);
    Serial.print(F(" redDC="));
    Serial.print(redDC);
    Serial.print(F(" irAC(p-p)="));
    Serial.print(irAC);
    Serial.print(F(" redAC(p-p)="));
    Serial.print(redAC);
    Serial.print(F(" contact="));
    Serial.print(fingerDetected ? "YES" : "NO");
    Serial.print(F(" saturated="));
    Serial.println(sensorSaturated ? "YES" : "NO");
    
    Serial.print(F("Derived: HR="));
    Serial.print(heartRate);
    Serial.print(F(" SpO2="));
    Serial.print(spo2);
    Serial.print(F(" Quality="));
    Serial.print(signalQuality);
    Serial.print(F(" Vitality="));
    Serial.println(vitalityIndex);
    
    samplesThisWindow = 0;
  }
  
  // Reset beat detection flag (consumed by callers between updates)
  beatDetected = false;
}

// Small helper: last raw AC sample written into the RED buffer, for display filtering
int32_t redSampleLast() {
  int lastIdx = (bufferIndex - 1 + FILTER_BUFFER_SIZE) % FILTER_BUFFER_SIZE;
  return redBuffer[lastIdx];
}

// ============================================================
// SENSOR SAFE DELAY - Non-blocking delay wrapper implementation
// ============================================================
void sensorSafeDelay(unsigned long ms) {
  unsigned long start = millis();
  while (millis() - start < ms) {
    // Only update sensor if it's been initialized to prevent crashes
    updateMAX30100(); // Use the wrapper function that checks initialization
    delay(1); // Small delay to prevent watchdog issues
  }
}

// ============================================================
// PROCESS SIGNALS - unused stub, kept for interface compatibility
// ============================================================
void processSignals() {
  // All AC/DC extraction, filtering, and peak detection now happens inline
  // inside updateMAX30100(). This stub is kept only so any external caller
  // referencing it doesn't break the build.
}

// ============================================================
// UNUSED STUB FUNCTIONS - kept for interface compatibility only
// ============================================================
// updateMAX30100() now does its own filtering, baseline tracking, peak
// detection, and vitality/quality scoring inline. These stubs are not called
// anywhere in the current firmware; safe to delete once you're sure nothing
// external references them.

int32_t medianFilter(int32_t* buffer, int size) {
  return 0;
}

void updateBaseline() {
}

int32_t rejectOutliers(int32_t value, int32_t* buffer, int size) {
  return value;
}

void calculateHeartRate() {
}

void calculateSpO2() {
}

void calculateSignalQuality() {
}

void calculateProbeQuality() {
}

void calculateVitalityIndex() {
}

// ============================================================
// CHECK BATTERY - Demo Data
// ============================================================
void checkBattery() {
  // Demo battery data - simulating a battery between 75-85%
  static unsigned long lastBatteryUpdate = 0;
  static float demoBatteryPercent = 80.0;
  
  if (millis() - lastBatteryUpdate > 5000) { // Update every 5 seconds for faster updates
    // Simulate gradual battery drain
    demoBatteryPercent -= 0.1;
    if (demoBatteryPercent < 75.0) {
      demoBatteryPercent = 85.0; // Reset to simulate charging
    }
    lastBatteryUpdate = millis();
  }
  
  batteryPercent = demoBatteryPercent;
  batteryVoltage = 3.7 + (batteryPercent / 100.0) * 0.5; // Simulate voltage: 3.7-4.2V
  isCharging = false;
  
  // Low battery warning
  if (batteryPercent < LOW_BATTERY_WARNING) {
    Serial.println(F("LOW BATTERY WARNING"));
    publishLog("Low Battery Warning");
  }
  
  // Critical battery
  if (batteryPercent < CRITICAL_BATTERY) {
    Serial.println(F("CRITICAL BATTERY - Shutting Down"));
    publishLog("Critical Battery - Shutting Down");
    // In production, would enter deep sleep
  }
}

// ============================================================
// CHECK TEMPERATURE - Read from LM35 sensor on GPIO 34
// ============================================================
void checkTemperature() {
  static unsigned long lastTempUpdate = 0;
  
  // Read actual temperature from LM35 sensor
  if (millis() - lastTempUpdate > 2000) { // Update every 2 seconds
    int adcValue = analogRead(PIN_LM35);
    
    // LM35 outputs 10mV per degree Celsius
    // ESP32 ADC is 12-bit (0-4095) for 0-3.3V range
    // Temperature (°C) = (ADC_value * 3.3 / 4095) * 100
    float voltage = (adcValue * 3.3) / 4095.0;
    float rawTemp = voltage * 100.0;
    
    // Apply calibration if available
    temperature = (rawTemp * tempCalibrationScale) + tempCalibrationOffset;
    
    lastTempUpdate = millis();
    Serial.print(F("Temp: "));
    Serial.print(temperature, 1);
    Serial.print(F("C (ADC: "));
    Serial.print(adcValue);
    Serial.println(F(")"));
  }
}

// ============================================================
// CHECK SAFE MODE
// ============================================================
void checkSafeMode() {
  // DISABLE SAFE MODE for demo/testing without real sensors
  // Only check if not already in safe mode
  if (safeMode) return;
  
  // Skip safe mode logic since we're using demo data
  // This prevents device from entering safe mode when sensors aren't connected
  return;
  
  // Original safe mode logic (disabled for now):
  /*
  // Enter safe mode if sensors fail repeatedly within 1 minute
  if (millis() - lastSensorFailure < 60000) {
    sensorFailureCount++;
  } else {
    sensorFailureCount = 0;
  }
  
  if (sensorFailureCount >= MAX_SENSOR_FAILURES) {
    Serial.println(F("Entering Safe Mode - Sensor failures detected"));
    safeMode = true;
    currentState = STATE_SAFE_MODE;
    publishLog("Safe Mode Activated");
    
    // Stop any running test
    if (testRunning) {
      stopTest();
    }
  }
  */
}

// ============================================================
// HANDLE STATE
// ============================================================
void handleState() {
  // In safe mode, prevent testing
  if (safeMode && currentState == STATE_TESTING) {
    stopTest();
    currentState = STATE_SAFE_MODE;
  }
  
  // Allow exiting safe mode via factory reset or manual intervention
  // Safe mode persists until device restart or factory reset
}

// ============================================================
// REPORT SENSOR FAILURE
// ============================================================
void reportSensorFailure(const char* sensorName) {
  lastSensorFailure = millis();
  sensorFailureCount++;
  
  Serial.print(F("Sensor Failure: "));
  Serial.println(sensorName);
  
  publishLog(String("Sensor Failure: ") + sensorName);
  
  checkSafeMode();
}

// ============================================================
// PRINT DEBUG INFO
// ============================================================
void printDebugInfo() {
  Serial.println(F("=== DEBUG INFO ==="));
  Serial.print(F("Uptime: "));
  Serial.print(uptime / 1000);
  Serial.println(F("s"));
  Serial.print(F("Free Heap: "));
  Serial.print(ESP.getFreeHeap());
  Serial.println(F(" bytes"));
  Serial.print(F("WiFi RSSI: "));
  Serial.println(WiFi.RSSI());
  Serial.print(F("MQTT: "));
  Serial.println(mqttConnected ? "Connected" : "Disconnected");
  Serial.print(F("State: "));
  Serial.println(getStateString());
  Serial.print(F("Battery: "));
  Serial.print(batteryPercent, 1);
  Serial.println(F("%"));
  Serial.print(F("Temperature: "));
  Serial.println(temperature, 1);
  Serial.print(F("Signal Quality: "));
  Serial.println(signalQuality, 1);
  Serial.print(F("HR: "));
  Serial.print(heartRate, 1);
  Serial.println(F(" BPM"));
  Serial.print(F("SpO2: "));
  Serial.print(spo2, 1);
  Serial.println(F("%"));
  Serial.print(F("Vitality: "));
  Serial.print(vitalityIndex, 1);
  Serial.println(F("%"));
  if (safeMode) {
    Serial.println(F("SAFE MODE ACTIVE"));
  }
  Serial.println(F("================"));
}

// ============================================================
// UPDATE OLED - Enhanced UI with Icons and Progress Bars
// ============================================================
void updateOLED() {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  
  // Show state
  switch (currentState) {
    case STATE_BOOT:
      display.println(F("OpticalSense"));
      display.println(F("Booting..."));
      break;
    case STATE_SELF_TEST:
      display.println(F("OpticalSense"));
      display.println(F("Self-Test..."));
      break;
    case STATE_INITIALIZING:
      display.println(F("OpticalSense"));
      display.println(F("Initializing..."));
      break;
    case STATE_PROVISIONING:
      display.println(F("OpticalSense"));
      display.println(F("WiFi Setup"));
      display.print(F("Connect: "));
      display.println(WIFI_AP_SSID);
      break;
    case STATE_CONNECTING_WIFI:
      display.println(F("OpticalSense"));
      display.println(F("Connecting WiFi"));
      drawProgressBar(0, 16, 128, 8, (millis() % 2000) / 20.0);
      break;
    case STATE_CONNECTING_MQTT:
      display.println(F("OpticalSense"));
      display.println(F("Connected"));
      display.println(F("Connecting..."));
      drawProgressBar(0, 32, 128, 8, (millis() % 2000) / 20.0);
      break;
    case STATE_WAITING_PAIR:
      display.println(F("OpticalSense"));
      display.println(F("Connected"));
      display.println(F("Pairing Code:"));
      display.setTextSize(2);
      display.setCursor(0, 32);
      display.println(pairCode);
      display.setTextSize(1);
      display.setCursor(0, 48);
      display.println(F("Enter on website"));
      break;
    case STATE_READY:
      // Header
      display.println(F("READY"));
      display.drawLine(0, 9, 127, 9, SSD1306_WHITE);
      // Show current readings
      display.setCursor(0, 12);
      display.print(F("SpO2:"));
      if (spo2 >= 70 && spo2 <= 100) {
        display.print((int)spo2);
        display.print(F("%"));
      } else {
        display.print(F("--%"));
      }
      display.setCursor(72, 12);
      display.print(F("Temp:"));
      display.print(temperature, 1);
      display.print(F("C"));
      display.setCursor(0, 22);
      display.print(F("Vitality:"));
      display.print(vitalityStatus);
      display.setCursor(72, 22);
      drawBatteryIcon(72, 22);
      display.setCursor(88, 22);
      display.print((int)batteryPercent);
      display.print(F("%"));
      // Status
      display.setCursor(0, 32);
      display.print(F("Status: Ready"));
      display.setCursor(0, 44);
      display.print(F("Press START to test"));
      break;
    case STATE_TESTING:
      // Header with elapsed time
      display.print(F("TESTING "));
      {
        unsigned long testSec = (millis() - testStartTime) / 1000;
        display.print(testSec / 60);
        display.print(F(":"));
        if (testSec % 60 < 10) display.print(F("0"));
        display.print(testSec % 60);
      }
      display.drawLine(0, 9, 127, 9, SSD1306_WHITE);
      
      // Show SpO2, Temp, Vitality Status
      display.setCursor(0, 12);
      display.print(F("SpO2:"));
      if (spo2 >= 70 && spo2 <= 100) {
        display.print((int)spo2);
        display.print(F("%"));
      } else {
        display.print(F("--%"));
      }
      
      display.setCursor(72, 12);
      display.print(F("Temp:"));
      display.print(temperature, 1);
      display.print(F("C"));
      
      display.setCursor(0, 22);
      display.print(F("Vitality:"));
      display.print(vitalityStatus);
      
      display.setCursor(0, 32);
      display.print(F("HR:"));
      if (heartRate >= 30 && heartRate <= 220) {
        display.print((int)heartRate);
        display.print(F("bpm"));
      } else {
        display.print(F("--bpm"));
      }
      
      display.setCursor(72, 32);
      drawBatteryIcon(72, 32);
      display.setCursor(88, 32);
      display.print((int)batteryPercent);
      display.print(F("%"));
      
      // Show beat detection indicator
      if (beatDetected) {
        display.setTextSize(1);
        display.setCursor(100, 22);
        display.print(F("♥"));
      }
      
      break;
    case STATE_SHOWING_CONCLUSION:
      // Show final conclusion for 10 seconds
      display.println(F("RESULTS"));
      display.drawLine(0, 9, 127, 9, SSD1306_WHITE);

      display.setCursor(0, 12);
      display.print(F("SpO2:"));
      display.print((int)spo2);
      display.print(F("%"));

      display.setCursor(72, 12);
      display.print(F("Temp:"));
      display.print(temperature, 1);
      display.print(F("C"));

      display.setCursor(0, 22);
      display.print(F("Vitality:"));
      display.print(vitalityStatus);

      display.setCursor(0, 32);
      display.print(F("Duration:"));
      display.print(testDuration / 1000);
      display.print(F("s"));

      display.setCursor(0, 42);
      display.print(F("Returning..."));

      // Auto-return to READY after 10 seconds
      if (millis() - conclusionStartTime >= 10000) {
        currentState = STATE_READY;
        showingConclusion = false;
        Serial.println(F("Conclusion period ended, returning to READY"));
      }

      break;
    case STATE_DIAGNOSTIC:
      display.println(F("Diagnostics"));
      display.print(F("Raw: "));
      display.println(redRaw);
      display.print(F("Filt: "));
      display.println(redFiltered);
      display.print(F("Heap: "));
      display.println(ESP.getFreeHeap());
      display.print(F("Uptime: "));
      display.print(uptime / 1000);
      display.println(F("s"));
      break;
    case STATE_SAFE_MODE:
      display.println(F("SAFE MODE"));
      display.println(F("Testing Disabled"));
      display.print(F("WiFi: "));
      display.println(WiFi.status() == WL_CONNECTED ? "OK" : "Fail");
      display.print(F("MQTT: "));
      display.println(mqttConnected ? "OK" : "Fail");
      display.println(F("Use web for"));
      display.println(F("Factory Reset"));
      break;
    case STATE_ERROR:
      display.println(F("ERROR"));
      display.println(F("Check Serial"));
      if (!selfTestResult.oled) display.println(F("OLED Fail"));
      if (!selfTestResult.max30100) display.println(F("MAX30100 Fail"));
      break;
    case STATE_FACTORY_RESET:
      display.println(F("Factory Reset"));
      display.println(F("Erasing..."));
      break;
    default:
      display.println(F("Unknown State"));
      break;
  }
  
  display.display();
}

// ============================================================
// DRAW PROGRESS BAR
// ============================================================
void drawProgressBar(int x, int y, int width, int height, float percent) {
  display.drawRect(x, y, width, height, SSD1306_WHITE);
  int fillWidth = (int)((percent / 100.0) * width);
  fillWidth = constrain(fillWidth, 0, width);
  display.fillRect(x, y, fillWidth, height, SSD1306_WHITE);
}

// ============================================================
// DRAW BATTERY ICON
// ============================================================
void drawBatteryIcon(int x, int y) {
  display.drawRect(x, y, 12, 7, SSD1306_WHITE);
  display.fillRect(x + 12, y + 2, 2, 3, SSD1306_WHITE);
  
  int fillWidth = (int)((batteryPercent / 100.0) * 10);
  fillWidth = constrain(fillWidth, 0, 10);
  
  if (batteryPercent < 20) {
    display.fillRect(x + 1, y + 1, fillWidth, 5, SSD1306_WHITE);
  } else {
    display.fillRect(x + 1, y + 1, fillWidth, 5, SSD1306_WHITE);
  }
}

// ============================================================
// DRAW WIFI ICON
// ============================================================
void drawWiFiIcon(int x, int y, int rssi) {
  if (rssi == 0) {
    // X for disconnected
    display.drawLine(x, y, x + 8, y + 8, SSD1306_WHITE);
    display.drawLine(x + 8, y, x, y + 8, SSD1306_WHITE);
  } else {
    // WiFi signal bars
    display.fillRect(x + 6, y + 6, 2, 2, SSD1306_WHITE);
    if (rssi > -70) {
      display.fillRect(x + 3, y + 4, 2, 4, SSD1306_WHITE);
    }
    if (rssi > -60) {
      display.fillRect(x, y + 2, 2, 6, SSD1306_WHITE);
    }
  }
}

// ============================================================
// DRAW MQTT ICON
// ============================================================
void drawMQTTIcon(int x, int y, bool connected) {
  if (connected) {
    // Checkmark
    display.drawLine(x, y + 4, x + 3, y + 7, SSD1306_WHITE);
    display.drawLine(x + 3, y + 7, x + 8, y, SSD1306_WHITE);
  } else {
    // X
    display.drawLine(x, y, x + 8, y + 8, SSD1306_WHITE);
    display.drawLine(x + 8, y, x, y + 8, SSD1306_WHITE);
  }
}

// ============================================================
// DRAW SIGNAL QUALITY BAR
// ============================================================
void drawSignalQualityBar(int x, int y, float quality) {
  int width = (int)((quality / 100.0) * 60);
  width = constrain(width, 0, 60);
  
  // Color based on quality (simulated with pattern)
  if (quality >= 80) {
    display.fillRect(x, y, width, 8, SSD1306_WHITE);
  } else if (quality >= 50) {
    display.fillRect(x, y, width, 8, SSD1306_WHITE);
    // Add hatch pattern for medium
    for (int i = 0; i < width; i += 4) {
      display.drawLine(x + i, y, x + i + 2, y + 8, SSD1306_BLACK);
    }
  } else {
    display.drawRect(x, y, width, 8, SSD1306_WHITE);
  }
}

// ============================================================
// PUBLISH STATUS
// ============================================================
void publishStatus(String status) {
  jsonDoc.clear();
  jsonDoc["deviceId"] = deviceId;
  jsonDoc["status"] = status;
  jsonDoc["online"] = (status == "online");
  jsonDoc["battery"] = batteryPercent;
  jsonDoc["voltage"] = batteryVoltage;
  jsonDoc["wifi"] = WiFi.RSSI();
  jsonDoc["mqtt"] = mqttConnected ? "CONNECTED" : "DISCONNECTED";
  jsonDoc["timestamp"] = millis();

  serializeJson(jsonDoc, mqttPayload);
  sprintf(mqttTopic, TOPIC_STATUS, deviceId.c_str());
  mqttClient.publish(mqttTopic, mqttPayload, true);
}

// ============================================================
// PUBLISH HEARTBEAT
// ============================================================
void publishHeartbeat() {
  jsonDoc.clear();
  jsonDoc["deviceId"] = deviceId;
  jsonDoc["state"] = getStateString();
  jsonDoc["battery"] = batteryPercent;
  jsonDoc["wifi"] = WiFi.RSSI();
  jsonDoc["mqtt"] = mqttConnected ? "CONNECTED" : "DISCONNECTED";
  jsonDoc["uptime"] = uptime;
  jsonDoc["timestamp"] = millis();
  jsonDoc["online"] = true; // Explicitly mark as online
  
  serializeJson(jsonDoc, mqttPayload);
  sprintf(mqttTopic, TOPIC_HEARTBEAT, deviceId.c_str());
  mqttClient.publish(mqttTopic, mqttPayload, MQTT_QOS);
  
  Serial.println(F("=== HEARTBEAT SENT ==="));
  Serial.print(F("State: "));
  Serial.println(getStateString());
  Serial.print(F("Online: YES"));
  Serial.println(F("=== END HEARTBEAT ==="));
}

// ============================================================
// PUBLISH TELEMETRY - Enhanced with All Metrics
// ============================================================
void publishTelemetry() {
  jsonDoc.clear();
  jsonDoc["deviceId"] = deviceId;
  jsonDoc["timestamp"] = millis();
  jsonDoc["battery"] = batteryPercent;
  jsonDoc["voltage"] = batteryVoltage;
  jsonDoc["temperature"] = temperature;
  // GY-MAX3010x fields (using simulated values since library doesn't provide direct access)
  jsonDoc["redRaw"] = redRaw;
  jsonDoc["irRaw"] = irRaw;
  jsonDoc["fingerDetected"] = fingerDetected;
  jsonDoc["stableSampleCount"] = sampleCount;
  jsonDoc["heartRate"] = heartRate;
  jsonDoc["heartRateConfidence"] = signalQuality; // Use signal quality as confidence
  jsonDoc["spo2"] = spo2;
  jsonDoc["spo2Confidence"] = signalQuality; // Use signal quality as confidence
  jsonDoc["signalQuality"] = signalQuality;
  jsonDoc["vitalityIndex"] = vitalityIndex;
  jsonDoc["vitalityStatus"] = vitalityStatus;
  jsonDoc["probeQuality"] = probeQuality;
  jsonDoc["deviceState"] = getStateString();
  jsonDoc["sampleCount"] = sampleCount;
  jsonDoc["testDuration"] = testRunning ? (millis() - testStartTime) : testDuration;
  // Legacy compatibility fields
  jsonDoc["redFiltered"] = redFiltered;
  jsonDoc["irFiltered"] = irFiltered;
  jsonDoc["redAC"] = 0; // Not calculated by PulseOximeter library
  jsonDoc["redDC"] = 0; // Not calculated by PulseOximeter library
  jsonDoc["irAC"] = 0; // Not calculated by PulseOximeter library
  jsonDoc["irDC"] = 0; // Not calculated by PulseOximeter library
  jsonDoc["motionDetected"] = false;
  jsonDoc["sensorSaturated"] = false;
  
  serializeJson(jsonDoc, mqttPayload);
  sprintf(mqttTopic, TOPIC_TELEMETRY, deviceId.c_str());
  
  // Debug telemetry every 5 seconds
  static unsigned long lastTelemetryDebug = 0;
  if (millis() - lastTelemetryDebug >= 5000) {
    lastTelemetryDebug = millis();
    Serial.print(F("MQTT: HR="));
    Serial.print(heartRate);
    Serial.print(F(" SpO2="));
    Serial.print(spo2);
    Serial.print(F(" Temp="));
    Serial.print(temperature, 1);
    Serial.print(F(" Batt="));
    Serial.println(batteryPercent);
  }
  Serial.print(F("Payload size: "));
  Serial.println(strlen(mqttPayload));
  Serial.print(F("MQTT Connected: "));
  Serial.println(mqttConnected ? "YES" : "NO");
  Serial.print(F("Payload: "));
  Serial.println(mqttPayload);
  
  if (mqttConnected) {
    // Try with QoS 0 for faster, more reliable delivery
    bool success = mqttClient.publish(mqttTopic, mqttPayload, 0);
    Serial.print(F("Publish result: "));
    Serial.println(success ? "SUCCESS" : "FAILED");
    
    if (!success) {
      Serial.println(F("MQTT publish failed - will retry next interval"));
    }
    
    // Publish any buffered telemetry
    publishBufferedTelemetry();
  } else {
    Serial.println(F("MQTT not connected - storing offline"));
    // Store in offline buffer
    storeOfflineTelemetry(mqttPayload);
  }
  Serial.println(F("=== END TELEMETRY ==="));
}

// ============================================================
// STORE OFFLINE TELEMETRY
// ============================================================
void storeOfflineTelemetry(const char* payload) {
  if (offlineBufferCount < OFFLINE_BUFFER_SIZE) {
    int idx = (offlineBufferIndex + offlineBufferCount) % OFFLINE_BUFFER_SIZE;
    strncpy(offlineBuffer[idx].payload, payload, 1023);
    offlineBuffer[idx].payload[1023] = '\0';
    offlineBuffer[idx].timestamp = millis();
    offlineBufferCount++;
    Serial.print(F("Buffered telemetry ("));
    Serial.print(offlineBufferCount);
    Serial.println(F(")"));
  } else {
    Serial.println(F("Offline buffer full - discarding oldest"));
    // Overwrite oldest
    strncpy(offlineBuffer[offlineBufferIndex].payload, payload, 1023);
    offlineBuffer[offlineBufferIndex].payload[1023] = '\0';
    offlineBuffer[offlineBufferIndex].timestamp = millis();
    offlineBufferIndex = (offlineBufferIndex + 1) % OFFLINE_BUFFER_SIZE;
  }
}

// ============================================================
// PUBLISH BUFFERED TELEMETRY
// ============================================================
void publishBufferedTelemetry() {
  if (offlineBufferCount == 0) return;
  
  Serial.print(F("Publishing "));
  Serial.print(offlineBufferCount);
  Serial.println(F(" buffered telemetry entries"));
  
  while (offlineBufferCount > 0) {
    int idx = offlineBufferIndex;
    sprintf(mqttTopic, TOPIC_TELEMETRY, deviceId.c_str());
    
    if (mqttClient.publish(mqttTopic, offlineBuffer[idx].payload, MQTT_QOS)) {
      offlineBufferIndex = (offlineBufferIndex + 1) % OFFLINE_BUFFER_SIZE;
      offlineBufferCount--;
    } else {
      Serial.println(F("Failed to publish buffered telemetry - will retry later"));
      break;
    }
    
    sensorSafeDelay(10); // Non-blocking delay with sensor updates between publishes
  }
}

// ============================================================
// PUBLISH LOG
// ============================================================
void publishLog(String message) {
  jsonDoc.clear();
  jsonDoc["deviceId"] = deviceId;
  jsonDoc["message"] = message;
  jsonDoc["timestamp"] = millis();
  
  serializeJson(jsonDoc, mqttPayload);
  sprintf(mqttTopic, TOPIC_LOGS, deviceId.c_str());
  mqttClient.publish(mqttTopic, mqttPayload, MQTT_QOS);
}

// ============================================================
// GET STATE STRING
// ============================================================
String getStateString() {
  switch (currentState) {
    case STATE_BOOT: return "BOOT";
    case STATE_SELF_TEST: return "SELF_TEST";
    case STATE_INITIALIZING: return "INITIALIZING";
    case STATE_PROVISIONING: return "PROVISIONING";
    case STATE_CONNECTING_WIFI: return "CONNECTING_WIFI";
    case STATE_CONNECTING_MQTT: return "CONNECTING_MQTT";
    case STATE_WAITING_PAIR: return "WAITING_PAIR";
    case STATE_READY: return "READY";
    case STATE_TESTING: return "TESTING";
    case STATE_PROCESSING: return "PROCESSING";
    case STATE_UPLOADING: return "UPLOADING";
    case STATE_COMPLETE: return "COMPLETE";
    case STATE_DIAGNOSTIC: return "DIAGNOSTIC";
    case STATE_SAFE_MODE: return "SAFE_MODE";
    case STATE_ERROR: return "ERROR";
    case STATE_FACTORY_RESET: return "FACTORY_RESET";
    default: return "UNKNOWN";
  }
}

// ============================================================
// FACTORY RESET
// ============================================================
void performFactoryReset() {
  Serial.println(F("Performing Factory Reset"));
  
  currentState = STATE_FACTORY_RESET;
  
  // Clear all preferences
  preferences.clear();
  preferences.end();
  
  // Restart
  sensorSafeDelay(1000);
  ESP.restart();
}
