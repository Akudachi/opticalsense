/*
 * OpticalSense ESP32 Firmware - Production Version
 * Optical Dental Pulp Vitality Detection System
 * Version: 3.7.0
 *

 * Changes in v3.7.0 (separate button vs website tests):
 * - START button: fixed 20 s test, result shown on the OLED only (nothing
 *   is published to the website).
 * - Website start_test: runs continuously, publishing live HR / SpO2 / temp
 *   every second until the website sends stop_test (or STOP is pressed);
 *   the average is then published on .../result.
 *
 * Changes in v3.6.2 (LM35 accuracy):
 * - Temperature now uses analogReadMilliVolts() (factory-calibrated),
 *   11 dB ADC attenuation, 32x oversampling and light smoothing.
 *
 * Changes in v3.6.1 (Temperature synchronized with 20 s test):
 * - Fixed live temperature changing every second on website/telemetry.
 * - Temperature is now accumulated during the 20 s test and published only
 *   as the final test average alongside final SpO2 and Heart Rate.
 * - During idle / test running, published temperature is held at 0 (or "--"),
 *   matching heartRate and spo2.
 * - Added finalTemperature to telemetry and web status payloads.
 *
 * Changes in v3.6.0 (MAX30102 + timed 20 s test):
 * - Sensor driver switched from the MAX30100 library to the SparkFun
 *   "MAX3010x Pulse and Proximity Sensor Library" (MAX30105 class, which
 *   also drives the MAX30102). Same I2C address (0x57), same wiring.
 *   Samples are now 18-bit (0-262143), so count-based thresholds were
 *   scaled ~4x.
 * - START press now runs a fixed 20 second measurement (TEST_DURATION_MS),
 *   stops by itself, and shows the FINAL value: the average of all valid
 *   readings taken during the test. If there is not enough clean data the
 *   screen says "No valid reading" instead of showing an untrustworthy number.
 * - The final result is also published over MQTT on .../result, and
 *   finalSpo2 / finalHeartRate are added to the telemetry.
 * - DC baseline filter is now a slow float filter (DC_ALPHA). The old
 *   alpha=0.2 at 100 Hz tracked the signal so fast that it removed most of
 *   the heartbeat from the "AC" component.
 *
 * Changes in v3.5.0 (single-button flow + SpO2 stability):
 * - Time-based exponential SpO2 smoothing + per-second rate clamp.
 * - 3 s grace period before zeroing readings on one bad sample.
 * - Independent WiFi/MQTT retry timers so AP fallback works reliably.
 *
 * Earlier: LM35 temperature, OLED layout fixes, signal-quality blending,
 * adaptive peak threshold, probe settle time, factory reset, safe mode.
 *
 * Hardware Connections (ESP32 Dev Kit V1 - classic ESP32):
 * - MAX30102 SDA -> GPIO21
 * - MAX30102 SCL -> GPIO22
 * - MAX30102 VIN -> 3.3V
 * - MAX30102 GND -> GND
 * - LM35 -> GPIO34 (ADC1_CH6)
 * - OLED SSD1306 -> I2C (0x3C), shares GPIO21/GPIO22
 * - START button -> GPIO4 (other leg to GND; internal pull-up)
 * - STOP button  -> GPIO5 (other leg to GND; internal pull-up)
 *
 * Library needed (Library Manager):
 *   "SparkFun MAX3010x Pulse and Proximity Sensor Library"
 *
 * On-device controls:
 * - START short press (READY or RESULT screen): begin a 20 s test
 * - START held 3s (any state):  unpair + clear WiFi -> AP setup mode
 * - STOP short press (TESTING): end the test early
 * - STOP short press (RESULT):  dismiss results -> READY
 * - BOOT button held 5s:        FULL FACTORY RESET
 * - START+STOP held together 5s: FULL FACTORY RESET
 *
 * Note: SpO2 values are an uncalibrated relative estimate for this probe.
 * They do NOT represent clinical or dental-pulp oxygen saturation.
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <Preferences.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <math.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_GFX.h>
#include <esp_task_wdt.h>
#include <esp_system.h>
#include <string.h>
#include "MAX30105.h"  // SparkFun MAX3010x library - MAX30105 class also drives the MAX30102

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
void publishStatus(const char* status);
void publishPairRequest();
void handleMQTT();
void connectMQTT();
void startTest(uint8_t source);
void stopTest();
void checkTestAutoStop();
void accumulateTestSample();
void finalizeTestResult();
void publishTestResult();
void checkPhysicalButtons();
void runTestSampling();
void printDebugInfo();
const char* getStateString();
void reportSensorFailure(const char* sensorName);
void checkSafeMode();

// ============================================================
// TEST SOURCE
//  TEST_SRC_BUTTON: physical START button -> fixed 20 s test, shown on the
//                   OLED only (nothing is published to the website).
//  TEST_SRC_WEB:    started from the website (MQTT start_test) -> runs in a
//                   loop, publishing live readings every second until the
//                   website (or the STOP button) stops it.
// ============================================================
#define TEST_SRC_BUTTON 1
#define TEST_SRC_WEB    2
uint8_t testSource = TEST_SRC_BUTTON;

// ============================================================
// PIN CONFIGURATION
// ============================================================
#define PIN_LM35         34  // ADC1_CH6 - Temperature sensor (LM35)
#define PIN_I2C_SDA      21  // Standard ESP32 I2C SDA
#define PIN_I2C_SCL      22  // Standard ESP32 I2C SCL
#define PIN_BTN_START    4   // START button (INPUT_PULLUP)
#define PIN_BTN_STOP     5   // STOP button (INPUT_PULLUP)
#define PIN_BTN_BOOT     0   // Onboard BOOT button (GPIO0, active LOW)
constexpr unsigned long BUTTON_DEBOUNCE_MS = 250;

// ============================================================
// CONFIGURATION CONSTANTS
// ============================================================
constexpr char FIRMWARE_VERSION[] = "3.7.0";
constexpr char DEVICE_NAME_PREFIX[] = "OPT";
constexpr char WIFI_AP_SSID[] = "OpticalS-Setup";
constexpr char WIFI_AP_PASSWORD[] = "12345678";
constexpr int MQTT_PORT = 8883;
constexpr int MQTT_KEEPALIVE_SEC = 60;
constexpr int MQTT_QOS = 1;
constexpr unsigned long HEARTBEAT_INTERVAL = 5000;
constexpr unsigned long TELEMETRY_INTERVAL = 1000;
constexpr unsigned long OLED_REFRESH_INTERVAL = 500;
constexpr unsigned long BATTERY_CHECK_INTERVAL = 1000;
constexpr unsigned long TEMP_CHECK_INTERVAL = 2000;
constexpr unsigned long WIFI_RETRY_INTERVAL = 3000;
constexpr unsigned long WIFI_STABLE_CONNECTION_MS = 3000;
constexpr unsigned long WIFI_TROUBLE_TIMEOUT_MS = 20000;
constexpr int LOW_BATTERY_WARNING = 20;
constexpr int CRITICAL_BATTERY = 5;
constexpr float HIGH_TEMP_WARNING = 38.0;
constexpr float LOW_TEMP_WARNING = 34.0;
constexpr unsigned long REPORT_INTERVAL = 2000;

// ============================================================
// FACTORY-DEFAULT MQTT credentials - FIRST BOOT FALLBACK ONLY.
// ============================================================
// connectMQTT() reads credentials from NVS first and only falls back to
// these when nothing has been saved. Provision real per-device credentials
// via the AP setup page's "Advanced: MQTT broker" section, and rotate the
// broker password if this file has ever been shared.
constexpr char DEFAULT_MQTT_HOST[] = "6732afdd0ab749f1b5c67e4cd7233db9.s1.eu.hivemq.cloud";
constexpr char DEFAULT_MQTT_USERNAME[] = "opticalpulp";
constexpr char DEFAULT_MQTT_PASSWORD[] = "Adarsh@18";

// HiveMQ Cloud CA Certificate
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

// ============================================================
// Signal Processing Constants (MAX30102: 18-bit samples, 0-262143)
// ============================================================
constexpr int FILTER_BUFFER_SIZE = 64;
constexpr int MEDIAN_WINDOW = 5;
constexpr float LOW_PASS_ALPHA = 0.2;
constexpr int PEAK_THRESHOLD_MIN = 20;     // noise floor (18-bit counts)
constexpr int PEAK_THRESHOLD_MAX = 2000;
constexpr unsigned long MIN_PEAK_INTERVAL = 250;
constexpr unsigned long MAX_PEAK_INTERVAL = 2000;
constexpr int HEART_RATE_MIN = 40;
constexpr int HEART_RATE_MAX = 180;
// Probe/tissue contact is declared when the IR DC baseline rises above this.
// TUNE ON YOUR HARDWARE: watch the "RAW:" Serial line with the probe off and
// on the tooth and pick a value roughly halfway between the two irDC values.
constexpr int32_t PROBE_CONTACT_THRESHOLD = 20000;
// IR AC peak-to-peak below this is treated as noise, not a pulse.
constexpr int16_t MIN_VALID_AC_AMPLITUDE = 60;
constexpr int32_t SATURATION_LEVEL = 260000;       // 18-bit full scale is 262143
constexpr float DC_ALPHA = 0.01f;                  // slow DC-baseline filter (~1 s at 100 Hz)
constexpr unsigned long TEST_DURATION_MS = 20000;  // START -> measure 20 s -> show result
constexpr unsigned long MIN_VALID_READINGS = 20;   // >= 2 s of valid data (at 10 Hz) for a valid result

// Calibration Constants (stored in Preferences)
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
#define TOPIC_RESULT          "opticalsense/device/%s/result"

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
Preferences preferences;    // namespace "opticalsense" - calibration + self-test scratch key only
Preferences netPrefs;       // namespace "wifi" - WiFi, pairing, and MQTT credentials only
MAX30105 sensor;            // SparkFun driver (works with MAX30102)

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
int wifiLoopRetryCount = 0;
unsigned long lastWifiRetry = 0;
unsigned long lastMqttReconnectAttempt = 0; // handleMQTT()'s own timer (separate from WiFi retry)
unsigned long wifiTroubleStartMs = 0;       // 0 = stable/connected; else when trouble began
unsigned long wifiConnectedSinceMs = 0;     // start of current connected streak (0 if not connected)

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
unsigned long pairRequestSentAt = 0;
constexpr unsigned long PAIR_CODE_TIMEOUT = 300000; // 5 minutes
constexpr unsigned long MIN_PAIR_RESPONSE_DELAY_MS = 3000;

// Sensors
float heartRate = 0.0;
float spo2 = 0.0;
bool beatDetected = false;
unsigned long lastBeatTime = 0;

float temperature = 0.0;
float batteryPercent = 0.0;
float batteryVoltage = 0.0;
bool isCharging = false;

float signalQuality = 0.0;
float vitalityIndex = 0.0;
String vitalityStatus = "";
String probeQuality = "";

// Raw sensor values (real DC baseline / AC amplitude)
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
}

// SIGNAL PROCESSING VARIABLES
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

// Float DC baselines (integer math would stall with a slow filter)
float irDcF = 0;
float redDcF = 0;

// Probe Detection
bool probeOnTooth = false;
unsigned long probeDetectedTime = 0;
bool signalValidNow = false;   // set every pass by updateMAX30100()
bool sensorReady = false;      // true only after sensor.begin() succeeded - guards all driver calls
uint8_t oledAddr = 0x3C;       // auto-detected in testOLED(): 0x3C, else 0x3D

// Test Control
bool testRunning = false;
unsigned long testStartTime = 0;
unsigned long testDuration = 0;
unsigned long lastSampleTime = 0;
unsigned long sampleCount = 0;
int stableSampleCount = 0;
bool showingConclusion = false;
unsigned long conclusionStartTime = 0;

// ---- 20-second test result ----
float finalSpo2 = 0, finalHeartRate = 0, finalSignalQuality = 0;
float finalVitalityIndex = 0, finalTemperature = 0;
String finalVitalityStatus = "";
const char* finalVitalityShort = "--";
bool finalValid = false;      // enough valid readings to trust the average?
bool finalComplete = false;   // ran the full 20 s (false if stopped early)
bool haveResult = false;      // true once a test has finished; cleared when the next test starts
// Accumulators (sums of valid readings during the test)
float accSpo2 = 0, accHr = 0, accQuality = 0, accTemp = 0;
unsigned long accCount = 0;
unsigned long lastAccumMs = 0;

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
  bool max30100;   // name kept for compatibility; now checks the MAX30102 at 0x57
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
// payload[] is duplicated 50x in offlineBuffer[] - every byte here costs 50 bytes of DRAM.
StaticJsonDocument<2048> jsonDoc;   // roomy so no telemetry fields get dropped
char mqttTopic[128];
char mqttPayload[1536];     // 1536 so the telemetry JSON is never cut off

// Offline Telemetry Buffer
constexpr int OFFLINE_BUFFER_SIZE = 10;  // was 50; payload is bigger now, 10 x 1536 = 15 KB (was 50 x 1024 = 51 KB)
struct TelemetryEntry {
  char payload[1536]; // keep in sync with mqttPayload[] - see note above
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

  Serial.begin(115200);
  Serial.println(F("\n=== OpticalSense ESP32 Firmware v3.7.0 (MAX30102) ==="));
  Serial.print(F("Firmware Version: "));
  Serial.println(firmwareVersion);

  Serial.print(F("Reset Reason: "));
  switch (esp_reset_reason()) {
    case ESP_RST_POWERON:   Serial.println(F("Power-on"));                  break;
    case ESP_RST_SW:        Serial.println(F("Software (ESP.restart())"));  break;
    case ESP_RST_PANIC:     Serial.println(F("Software PANIC / crash"));    break;
    case ESP_RST_INT_WDT:   Serial.println(F("Interrupt watchdog"));        break;
    case ESP_RST_TASK_WDT:  Serial.println(F("Task watchdog timeout"));     break;
    case ESP_RST_WDT:       Serial.println(F("Other watchdog"));            break;
    case ESP_RST_BROWNOUT:  Serial.println(F("Brownout (power dip)"));      break;
    case ESP_RST_DEEPSLEEP: Serial.println(F("Woke from deep sleep"));      break;
    default:                Serial.println(F("Unknown"));                  break;
  }

  // Explicitly subscribe the loop task to the task watchdog.
  esp_err_t wdtAddResult = esp_task_wdt_add(NULL);
  if (wdtAddResult == ESP_OK) {
    Serial.println(F("Task watchdog: loop task subscribed"));
  } else {
    Serial.print(F("Task watchdog: esp_task_wdt_add() returned "));
    Serial.println((int)wdtAddResult);
  }

  randomSeed(esp_random());

  initializeGPIO();

  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  Wire.setClock(100000);
  Wire.setTimeout(1000);

  currentState = STATE_SELF_TEST;
  runSelfTest();

  initializeOLED();
  initializeMAX30100();
  initializePreferences();
  loadCalibration();
  generateDeviceId();
  loadConfiguration();
  connectWiFi();
  connectMQTT();
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

  esp_task_wdt_reset();

  handleState();
  checkPairCodeTimeout();

  // Physical Start/Stop buttons (GPIO4/GPIO5)
  checkPhysicalButtons();
  checkTestAutoStop();     // ends the test after TEST_DURATION_MS (20 s)
  accumulateTestSample();  // collects valid readings for the final average

  if (!safeMode) {
    checkSafeMode();
  }

  handleWiFi();
  handleMQTT();

  // Update sensor continuously at high frequency (every loop iteration)
  updateMAX30100();

  if (currentMillis - lastOledRefresh >= OLED_REFRESH_INTERVAL) {
    updateOLED();
    lastOledRefresh = currentMillis;
    updateMAX30100();
  }

  if (currentMillis - lastBatteryCheck >= BATTERY_CHECK_INTERVAL) {
    checkBattery();
    lastBatteryCheck = currentMillis;
    updateMAX30100();
  }

  if (currentMillis - lastTempCheck >= TEMP_CHECK_INTERVAL) {
    checkTemperature();
    lastTempCheck = currentMillis;
    updateMAX30100();
  }

  if (mqttConnected && currentMillis - lastHeartbeat >= HEARTBEAT_INTERVAL) {
    publishHeartbeat();
    publishStatus(getStateString());
    if (!isPaired) {
      publishPairRequest();
    }
    lastHeartbeat = currentMillis;
    updateMAX30100();
  }

  if (mqttConnected && currentMillis - lastTelemetry >= TELEMETRY_INTERVAL) {
    publishTelemetry();
    lastTelemetry = currentMillis;
    updateMAX30100();
  }

  static unsigned long lastDebugOutput = 0;
  if (currentMillis - lastDebugOutput >= 5000) {
    printDebugInfo();
    lastDebugOutput = currentMillis;
    updateMAX30100();
  }

  runTestSampling();

  if (diagnosticMode) {
    runDiagnosticSampling();
  }

  updateMAX30100();

  yield();
}

// ============================================================
// GPIO INITIALIZATION
// ============================================================
void initializeGPIO() {
  pinMode(PIN_LM35, INPUT);
  pinMode(PIN_BTN_START, INPUT_PULLUP);
  pinMode(PIN_BTN_STOP, INPUT_PULLUP);
  pinMode(PIN_BTN_BOOT, INPUT_PULLUP);

  Serial.println(F("GPIO Initialized"));
}

// ============================================================
// CHECK PHYSICAL BUTTONS - Two separate buttons + combo reset
// ============================================================
// START (GPIO4):
//   short press in READY or RESULT screen -> startTest() (20 s measurement)
//   hold 3s (any state)                   -> unpair + clear WiFi -> AP mode
// STOP (GPIO5):
//   short press in TESTING                -> stopTest() (ends early)
//   short press in RESULT screen          -> dismiss -> READY
// START+STOP held 5s or BOOT held 5s      -> FULL FACTORY RESET
void checkPhysicalButtons() {
  unsigned long comboNow = millis();

  // ---- Onboard BOOT button (GPIO0) held 5s -> FULL FACTORY RESET ----
  static unsigned long bootPressStart = 0;
  static bool bootTriggered = false;
  if (digitalRead(PIN_BTN_BOOT) == LOW) {
    if (bootPressStart == 0) bootPressStart = comboNow;
    unsigned long bootHeld = comboNow - bootPressStart;

    if (!bootTriggered && bootHeld < 5000) {
      if (bootHeld > 1000) {
        display.clearDisplay();
        display.setTextSize(1);
        display.setTextColor(SSD1306_WHITE);
        display.setCursor(0, 0);
        display.println(F("FACTORY RESET"));
        display.println(F("Keep holding BOOT"));
        display.setTextSize(2);
        display.setCursor(50, 40);
        display.println((5000 - bootHeld) / 1000 + 1);
        display.display();
      }
    }

    if (!bootTriggered && bootHeld >= 5000) {
      bootTriggered = true;
      Serial.println(F("BOOT held 5s -> FULL FACTORY RESET"));
      display.clearDisplay();
      display.setTextSize(1);
      display.setCursor(0, 24);
      display.println(F("FACTORY RESET"));
      display.println(F("Erasing all data..."));
      display.display();
      publishLog("Factory reset triggered (BOOT button hold)");
      performFactoryReset();
    }
    return;
  } else {
    if (bootPressStart != 0 && !bootTriggered) {
      updateOLED();
    }
    bootPressStart = 0;
    bootTriggered = false;
  }

  // ---- Combined START+STOP hold (5s) -> FULL FACTORY RESET ----
  static unsigned long comboPressStart = 0;
  static bool comboTriggered = false;
  bool comboStartHeld = (digitalRead(PIN_BTN_START) == LOW);
  bool comboStopHeld  = (digitalRead(PIN_BTN_STOP) == LOW);

  if (comboStartHeld && comboStopHeld) {
    if (comboPressStart == 0) comboPressStart = comboNow;
    unsigned long held = comboNow - comboPressStart;

    if (!comboTriggered && held < 5000) {
      display.clearDisplay();
      display.setTextSize(1);
      display.setTextColor(SSD1306_WHITE);
      display.setCursor(0, 0);
      display.println(F("FACTORY RESET"));
      display.println(F("Keep holding both"));
      display.println(F("buttons..."));
      display.setTextSize(2);
      display.setCursor(50, 40);
      display.println((5000 - held) / 1000 + 1);
      display.display();
    }

    if (!comboTriggered && held >= 5000) {
      comboTriggered = true;
      Serial.println(F("START+STOP held 5s -> FULL FACTORY RESET"));
      display.clearDisplay();
      display.setTextSize(1);
      display.setCursor(0, 24);
      display.println(F("FACTORY RESET"));
      display.println(F("Erasing all data..."));
      display.display();
      publishLog("Factory reset triggered (physical button combo)");
      performFactoryReset();
    }
    return;
  } else {
    if (comboPressStart != 0 && !comboTriggered) {
      updateOLED();
    }
    comboPressStart = 0;
    comboTriggered = false;
  }

  // START button (GPIO4) handling - starts test immediately on press
  static bool lastStartBtnState = HIGH;
  static unsigned long lastStartPress = 0;
  static unsigned long startHoldStart = 0;
  static bool startHoldHandled = false;

  bool startBtnState = digitalRead(PIN_BTN_START);
  unsigned long now = millis();

  // Press down: Start test immediately
  if (startBtnState == LOW && lastStartBtnState == HIGH) {
    if (now - lastStartPress >= BUTTON_DEBOUNCE_MS) {
      lastStartPress = now;
      startHoldStart = now;
      startHoldHandled = false;

      if (currentState == STATE_READY ||
          currentState == STATE_SHOWING_CONCLUSION ||
          currentState == STATE_WAITING_PAIR) {
        Serial.println(F("[TASK] START button pressed -> Starting 20s test"));
        startTest(TEST_SRC_BUTTON);
        publishLog("Test Started (START button)");
      } else if (currentState == STATE_TESTING) {
        Serial.println(F("[TASK] Test already running"));
      } else {
        Serial.print(F("[TASK] START ignored in state: "));
        Serial.println(getStateString());
      }
    }
  }

  // Long hold (8s) only for emergency WiFi Reset / AP setup mode
  if (startBtnState == LOW && !startHoldHandled && startHoldStart > 0) {
    if (now - startHoldStart >= 8000) {
      startHoldHandled = true;
      Serial.println(F("[TASK] START held 8s -> WiFi Reset / AP Setup Mode"));

      display.clearDisplay();
      display.setTextSize(1);
      display.setTextColor(SSD1306_WHITE);
      display.setCursor(0, 24);
      display.println(F("WiFi Reset Mode"));
      display.println(F("Starting AP..."));
      display.display();

      isPaired = false;
      netPrefs.putBool("isPaired", false);
      clinicId = "";
      clinicName = "";
      netPrefs.putString("clinicId", "");
      netPrefs.putString("clinicName", "");

      wifiSSID = "";
      wifiPassword = "";
      netPrefs.putString("ssid", "");
      netPrefs.putString("password", "");

      publishLog("Device unpaired, WiFi cleared, AP mode started (8s button hold)");
      startAPMode();
    }
  }

  if (startBtnState == HIGH) {
    startHoldStart = 0;
    startHoldHandled = false;
  }
  lastStartBtnState = startBtnState;

  // STOP button (GPIO5) handling
  static bool lastStopBtnState = HIGH;
  static unsigned long stopBtnPressStart = 0;

  bool stopBtnState = digitalRead(PIN_BTN_STOP);

  if (stopBtnState == LOW && lastStopBtnState == HIGH) {
    stopBtnPressStart = now;
  }

  if (stopBtnState == HIGH && lastStopBtnState == LOW) {
    if (now - stopBtnPressStart >= BUTTON_DEBOUNCE_MS) {
      if (currentState == STATE_TESTING) {
        Serial.println(F("STOP button: STOP TEST"));
        stopTest();
        publishLog("Test Stopped (STOP button)");
      } else if (currentState == STATE_SHOWING_CONCLUSION) {
        Serial.println(F("STOP button: DISMISS RESULTS -> READY"));
        currentState = STATE_READY;
        showingConclusion = false;
        publishLog("Results dismissed (STOP button)");
      }
    }
  }
  lastStopBtnState = stopBtnState;
}

// ============================================================
// SELF-TEST FUNCTION
// ============================================================
void runSelfTest() {
  Serial.println(F("Running Self-Test..."));

  selfTestResult.oled = false;
  selfTestResult.max30100 = false;
  selfTestResult.lm35 = false;
  selfTestResult.preferences = false;
  selfTestResult.wifi = false;
  selfTestResult.mqtt = false;

  selfTestResult.oled = testOLED();
  Serial.print(F("OLED: "));
  Serial.println(selfTestResult.oled ? "PASS" : "FAIL");

  selfTestResult.max30100 = testMAX30100();
  Serial.print(F("MAX30102: "));
  Serial.println(selfTestResult.max30100 ? "PASS" : "FAIL");

  selfTestResult.lm35 = testLM35();
  Serial.print(F("LM35: "));
  Serial.println(selfTestResult.lm35 ? "PASS" : "FAIL");

  selfTestResult.preferences = testPreferences();
  Serial.print(F("Preferences: "));
  Serial.println(selfTestResult.preferences ? "PASS" : "FAIL");

  if (!wifiSSID.isEmpty()) {
    selfTestResult.wifi = testWiFi();
    Serial.print(F("WiFi: "));
    Serial.println(selfTestResult.wifi ? "PASS" : "FAIL");
  } else {
    selfTestResult.wifi = true;
    Serial.println(F("WiFi: SKIPPED (no credentials)"));
  }

  if (selfTestResult.wifi) {
    selfTestResult.mqtt = testMQTT();
    Serial.print(F("MQTT: "));
    Serial.println(selfTestResult.mqtt ? "PASS" : "FAIL");
  } else {
    selfTestResult.mqtt = true;
    Serial.println(F("MQTT: SKIPPED (WiFi not available)"));
  }

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
  esp_task_wdt_reset();
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  Wire.setTimeout(1000);

  // Many SSD1306 modules use 0x3C, some use 0x3D - try both.
  oledAddr = 0x3C;
  Wire.beginTransmission(oledAddr);
  byte error = Wire.endTransmission();
  if (error != 0) {
    oledAddr = 0x3D;
    Wire.beginTransmission(oledAddr);
    error = Wire.endTransmission();
  }

  esp_task_wdt_reset();

  if (error != 0) {
    Serial.println(F("OLED not detected at 0x3C or 0x3D - check SDA/SCL/VCC/GND"));
    oledAddr = 0x3C;
    return false;
  }

  Serial.print(F("OLED found at 0x"));
  Serial.println(oledAddr, HEX);
  return display.begin(SSD1306_SWITCHCAPVCC, oledAddr);
}

bool testMAX30100() {
  esp_task_wdt_reset();
  // Passive I2C probe at the MAX3010x address (0x57) - same for MAX30100/MAX30102
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  Wire.setTimeout(1000);
  Wire.beginTransmission(0x57);
  byte error = Wire.endTransmission();
  return (error == 0);
}

bool testLM35() {
  int adcValue = analogRead(PIN_LM35);
  bool sensorConnected = (adcValue > 0 && adcValue < 4095);
  if (!sensorConnected) {
    Serial.println(F("LM35 not detected - will use demo temperature data"));
    return true;
  }
  return true;
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
    sensorSafeDelay(500);
    attempts++;
  }
  bool result = (WiFi.status() == WL_CONNECTED);
  if (result) {
    WiFi.disconnect();
  }
  return result;
}

bool testMQTT() {
  return true; // Will be tested during actual connection
}

// ============================================================
// OLED INITIALIZATION
// ============================================================
void initializeOLED() {
  if (!display.begin(SSD1306_SWITCHCAPVCC, oledAddr)) {
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
  // Leave "OpticalSense / Booting..." on screen until the first updateOLED().
}

// ============================================================
// MAX30102 INITIALIZATION
// ============================================================
void initializeMAX30100() {
  Serial.println(F("Initializing MAX30102..."));

  Serial.print(F("I2C SDA: "));
  Serial.print(PIN_I2C_SDA);
  Serial.print(F(" SCL: "));
  Serial.println(PIN_I2C_SCL);

  Serial.println(F("Scanning I2C bus..."));
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  Wire.setTimeout(1000);
  byte error, address;
  int nDevices = 0;
  for (address = 1; address < 127; address++) {
    Wire.beginTransmission(address);
    error = Wire.endTransmission();
    if (address % 16 == 0) {
      esp_task_wdt_reset();
    }
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

  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  Wire.setClock(100000);

  // Initialize the MAX30102 (same I2C address 0x57 as the MAX30100)
  Serial.println(F("Calling sensor.begin() for MAX30102..."));
  // begin() re-inits Wire with the default pins, which on this board ARE 21/22.
  bool initSuccess = sensor.begin(Wire, I2C_SPEED_STANDARD, 0x57);
  Wire.setTimeout(1000); // re-apply the timeout

  Serial.print(F("sensor.begin() result: "));
  Serial.println(initSuccess ? "SUCCESS" : "FAILED");

  if (!initSuccess) {
    Serial.println(F("ERROR: MAX30102 init failed (check wiring / power / part ID). Sensor disabled."));
    Serial.println(F("       Part ID must be 0x15 (MAX30102). A MAX30100 reports 0x11 and will fail here."));
    sensorReady = false;
    return;
  }
  sensorReady = true;

  // Red + IR LEDs, 100 samples/s, 18-bit resolution.
  // sampleAverage=1 keeps the true 100 Hz rate the peak detector assumes.
  // LED current: 0x78 = 120 * 0.2 mA = 24 mA. Lower it if irDC saturates
  // near 262143; raise it (max 0xFF = 51 mA) if irDC is too low with the
  // probe on the tooth.
  byte ledBrightness = 0x78;
  byte sampleAverage = 1;
  byte ledMode       = 2;      // 2 = Red + IR
  int  sampleRate    = 100;
  int  pulseWidth    = 411;    // 411 us -> 18-bit
  int  adcRange      = 16384;
  sensor.setup(ledBrightness, sampleAverage, ledMode, sampleRate, pulseWidth, adcRange);
  sensor.clearFIFO();

  Serial.println(F("MAX30102 OK - Red/IR LED = 24 mA, 100 Hz, 18-bit"));
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
// WiFi/pairing/MQTT settings live in netPrefs (namespace "wifi"), separate
// from `preferences` (namespace "opticalsense": self-test + calibration).
void initializePreferences() {
  netPrefs.begin("wifi", false);
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
  wifiSSID = netPrefs.getString("ssid", "");
  wifiPassword = netPrefs.getString("password", "");
  isPaired = netPrefs.getBool("isPaired", false);

  Serial.println(F("Configuration Loaded"));
  Serial.print(F("WiFi SSID: "));
  Serial.println(wifiSSID.isEmpty() ? "Not set" : wifiSSID);
  Serial.print(F("WiFi Password: "));
  Serial.println(wifiPassword.isEmpty() ? "Not set" : "**** (set)");
  Serial.print(F("Paired: "));
  Serial.println(isPaired ? "Yes" : "No");

  if (!wifiSSID.isEmpty() && !wifiPassword.isEmpty()) {
    Serial.println(F("WiFi credentials found - will attempt connection"));
  }
}

// ============================================================
// SAVE CONFIGURATION
// ============================================================
void saveConfiguration() {
  netPrefs.putString("ssid", wifiSSID);
  netPrefs.putString("password", wifiPassword);

  Serial.println(F("Configuration Saved"));
}

// ============================================================
// WIFI CONNECTION
// ============================================================
void connectWiFi() {
  Serial.println(F("=== connectWiFi() called ==="));
  Serial.print(F("WiFi SSID from preferences: "));
  Serial.println(wifiSSID.isEmpty() ? "EMPTY" : wifiSSID);
  Serial.print(F("WiFi Password length: "));
  Serial.println(wifiPassword.length());

  if (wifiSSID.isEmpty()) {
    Serial.println(F("No WiFi credentials - Starting AP Mode"));
    startAPMode();
    return;
  }

  currentState = STATE_CONNECTING_WIFI;
  Serial.print(F("Connecting to WiFi: "));
  Serial.println(wifiSSID);

  WiFi.disconnect();
  sensorSafeDelay(500);

  WiFi.mode(WIFI_STA);
  // Disable modem-sleep: a common cause of random WiFi drops/reconnects.
  WiFi.setSleep(false);

  Serial.println(F("Calling WiFi.begin()..."));
  WiFi.begin(wifiSSID.c_str(), wifiPassword.c_str());

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) { // 15 seconds
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
    wifiLoopRetryCount = 0;
  } else {
    // handleWiFi() in loop() owns all further retries and the AP fallback.
    Serial.println(F("\nWiFi Connection Failed - handleWiFi() will retry, then fall back to AP"));
    Serial.print(F("WiFi Status: "));
    Serial.println(WiFi.status());
  }
}

// ============================================================
// AP MODE (CAPTIVE PORTAL)
// ============================================================
void startAPMode() {
  currentState = STATE_PROVISIONING;

  Serial.println(F("Starting AP Mode"));

  WiFi.disconnect(true, true);
  sensorSafeDelay(500);

  WiFi.mode(WIFI_AP);
  sensorSafeDelay(100);

  bool apStarted = WiFi.softAP(WIFI_AP_SSID, WIFI_AP_PASSWORD, 1, 0, 4);

  IPAddress apIP = WiFi.softAPIP();
  Serial.print(F("AP startup result: "));
  Serial.println(apStarted ? "SUCCESS" : "FAILED");
  Serial.print(F("AP IP: "));
  Serial.println(apIP);
  Serial.print(F("AP SSID: "));
  Serial.println(WIFI_AP_SSID);
  Serial.print(F("AP Password: "));
  Serial.println(WIFI_AP_PASSWORD);
  Serial.print(F("AP MAC: "));
  Serial.println(WiFi.softAPmacAddress());

  if (apStarted && apIP != INADDR_NONE) {
    Serial.println(F("AP started successfully with valid IP"));
  } else {
    Serial.println(F("AP failed to start or invalid IP!"));
    Serial.println(F("Retrying with minimal config..."));
    WiFi.mode(WIFI_AP);
    sensorSafeDelay(100);
    apStarted = WiFi.softAP(WIFI_AP_SSID);
    apIP = WiFi.softAPIP();
    Serial.print(F("Retry AP IP: "));
    Serial.println(apIP);
    if (!apStarted || apIP == INADDR_NONE) {
      Serial.println(F("AP still failed to start! Entering error state."));
      currentState = STATE_ERROR;
      return;
    }
  }

  dnsServer.start(53, "*", WiFi.softAPIP());

  server.on("/", handleWebRoot);
  server.on("/save", handleWebSave);
  server.onNotFound(handleWebRoot);

  server.begin();
  Serial.println(F("Web server started"));
  Serial.println(F("DNS server started for captive portal"));

  Serial.println(F("=========================================="));
  Serial.println(F("    *** SETUP MODE ***"));
  Serial.println();
  Serial.print(F("  1. Connect to WiFi: "));
  Serial.println(WIFI_AP_SSID);
  Serial.print(F("  2. Password: "));
  Serial.println(WIFI_AP_PASSWORD);
  Serial.println(F("  3. Open browser - should auto-redirect"));
  Serial.print(F("  4. If not, try: http://"));
  Serial.println(apIP);
  Serial.println(F("  5. Enter your WiFi credentials"));
  Serial.println(F("=========================================="));
}

// ============================================================
// WEB SERVER SETUP
// ============================================================
// NOTE: this function is not called anywhere in the original firmware, so
// the /start, /stop, /status and /factory-reset routes are inactive. Only
// the AP setup routes ("/" and "/save") are registered (in startAPMode()).
void setupWebServer() {
  server.on("/", handleWebRoot);
  server.on("/save", handleWebSave);
  server.on("/status", handleWebStatus);
  server.on("/start", handleWebStart);
  server.on("/stop", handleWebStop);
  server.on("/factory-reset", handleWebFactoryReset);
  server.on("/api/start", handleWebStart);
  server.on("/api/stop", handleWebStop);
  server.onNotFound(handleWebRoot);
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
  html += "h1{color:#333;text-align:center;margin-bottom:20px}";
  html += "label{display:block;margin:10px 0 5px;color:#666}";
  html += "input[type='text'],input[type='password']{width:100%;padding:10px;margin:5px 0;border:1px solid #ddd;border-radius:5px;box-sizing:border-box}";
  html += ".checkbox-label{display:flex;align-items:center;margin:15px 0;font-size:14px;color:#444;cursor:pointer}";
  html += ".checkbox-label input{width:auto;margin:0 10px 0 0;cursor:pointer}";
  html += "button{width:100%;padding:12px;background:#4CAF50;color:white;border:none;border-radius:5px;cursor:pointer;margin-top:15px;font-size:16px}";
  html += "button:hover{background:#45a049}";
  html += "details{margin-top:15px;color:#666;font-size:13px}summary{cursor:pointer;color:#4CAF50}";
  html += "</style></head><body>";
  html += "<div class='container'><h1>OpticalSense Setup</h1>";
  html += "<form action='/save' method='POST'>";
  html += "<label>WiFi SSID:</label>";
  html += "<input type='text' name='ssid' required autofocus>";
  html += "<label>WiFi Password:</label>";
  html += "<input type='password' name='password' required>";
  html += "<label class='checkbox-label'>";
  html += "<input type='checkbox' name='reset_pair' value='1' checked>";
  html += "Reset pairing & show 6-digit code on screen";
  html += "</label>";
  html += "<details><summary>Advanced: MQTT broker (optional)</summary>";
  html += "<label>MQTT Host:</label>";
  html += "<input type='text' name='mqttHost' placeholder='Leave blank to keep current'>";
  html += "<label>MQTT Username:</label>";
  html += "<input type='text' name='mqttUser' placeholder='Leave blank to keep current'>";
  html += "<label>MQTT Password:</label>";
  html += "<input type='password' name='mqttPass' placeholder='Leave blank to keep current'>";
  html += "</details>";
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

    netPrefs.putString("ssid", wifiSSID);
    netPrefs.putString("password", wifiPassword);

    // Only overwrite MQTT settings that were actually filled in.
    if (server.hasArg("mqttHost") && server.arg("mqttHost").length() > 0) {
      netPrefs.putString("mqttHost", server.arg("mqttHost"));
      Serial.println(F("AP Setup: custom MQTT host saved"));
    }
    if (server.hasArg("mqttUser") && server.arg("mqttUser").length() > 0) {
      netPrefs.putString("mqttUsername", server.arg("mqttUser"));
      Serial.println(F("AP Setup: custom MQTT username saved"));
    }
    if (server.hasArg("mqttPass") && server.arg("mqttPass").length() > 0) {
      netPrefs.putString("mqttPassword", server.arg("mqttPass"));
      Serial.println(F("AP Setup: custom MQTT password saved"));
    }

    bool resetPair = true;
    if (server.hasArg("reset_pair")) {
      resetPair = (server.arg("reset_pair") == "1");
    }
    if (resetPair) {
      isPaired = false;
      netPrefs.putBool("isPaired", false);
      netPrefs.putString("clinicId", "");
      netPrefs.putString("clinicName", "");
      Serial.println(F("AP Setup: Pairing reset requested -> will generate 6-digit code on restart"));
    }
    // netPrefs stays open for the whole runtime - do NOT call netPrefs.end() here.

    Serial.println(F("WiFi credentials saved to preferences"));
    Serial.print(F("SSID: "));
    Serial.println(wifiSSID);
    Serial.print(F("Password length: "));
    Serial.println(wifiPassword.length());

    String html = "<!DOCTYPE html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>";
    html += "<title>Saved</title><style>body{font-family:Arial,sans-serif;padding:50px;text-align:center}";
    html += "h1{color:#4CAF50}</style></head><body>";
    html += "<h1>Credentials Saved!</h1>";
    html += "<p>Device will restart and connect to your WiFi.</p>";
    html += "<p>Once connected, check the device's screen for your <strong>6-digit pairing code</strong>, then enter it on the website to pair.</p>";
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
  float pubTemp = (haveResult && currentState != STATE_TESTING) ? finalTemperature : 0.0f;
  float pubHr = (haveResult && currentState != STATE_TESTING) ? finalHeartRate : 0.0f;
  float pubSpo2 = (haveResult && currentState != STATE_TESTING) ? finalSpo2 : 0.0f;
  jsonDoc["temperature"] = pubTemp;
  jsonDoc["heartRate"] = pubHr;
  jsonDoc["spo2"] = pubSpo2;
  jsonDoc["finalTemperature"] = haveResult ? finalTemperature : 0.0f;
  jsonDoc["finalHeartRate"] = haveResult ? finalHeartRate : 0.0f;
  jsonDoc["finalSpo2"] = haveResult ? finalSpo2 : 0.0f;
  jsonDoc["rawTemperature"] = temperature;
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
    startTest(TEST_SRC_WEB);
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
  if (currentState == STATE_PROVISIONING) {
    dnsServer.processNextRequest();
    server.handleClient();
    return;
  }

  if (WiFi.status() == WL_CONNECTED) {
    if (wifiConnectedSinceMs == 0) {
      wifiConnectedSinceMs = millis();
    }
    // Only a connection that stays up for WIFI_STABLE_CONNECTION_MS counts as
    // recovery, so a flapping network can't dodge the AP fallback forever.
    if (millis() - wifiConnectedSinceMs >= WIFI_STABLE_CONNECTION_MS) {
      wifiTroubleStartMs = 0;
      wifiLoopRetryCount = 0;
    }
    return;
  }

  wifiConnectedSinceMs = 0;
  if (wifiTroubleStartMs == 0) {
    wifiTroubleStartMs = millis();
  }

  // Absolute timeout: no STABLE connection for WIFI_TROUBLE_TIMEOUT_MS -> AP mode.
  // This clears the saved SSID/password. To keep retrying the same network
  // forever instead, remove the two putString lines below.
  if (millis() - wifiTroubleStartMs >= WIFI_TROUBLE_TIMEOUT_MS) {
    Serial.println(F("WiFi unstable/unreachable for too long - clearing saved credentials, starting AP mode"));
    wifiSSID = "";
    wifiPassword = "";
    netPrefs.putString("ssid", "");
    netPrefs.putString("password", "");
    wifiTroubleStartMs = 0;
    wifiLoopRetryCount = 0;
    startAPMode();
    return;
  }

  if (millis() - lastWifiRetry >= WIFI_RETRY_INTERVAL) {
    lastWifiRetry = millis();
    wifiLoopRetryCount++;
    Serial.print(F("WiFi disconnected - reconnect attempt "));
    Serial.print(wifiLoopRetryCount);
    Serial.print(F(" (trouble for "));
    Serial.print((millis() - wifiTroubleStartMs) / 1000);
    Serial.println(F("s so far)"));
    WiFi.reconnect();
  }
}

// ============================================================
// MQTT CONNECTION
// ============================================================
void connectMQTT() {
  if (currentState == STATE_PROVISIONING) return;

  if (WiFi.status() != WL_CONNECTED) {
    return;
  }

  currentState = STATE_CONNECTING_MQTT;

  // Saved credentials first, built-in defaults only if nothing saved.
  mqttHost = netPrefs.getString("mqttHost", DEFAULT_MQTT_HOST);
  mqttPort = netPrefs.getInt("mqttPort", MQTT_PORT);
  mqttUsername = netPrefs.getString("mqttUsername", DEFAULT_MQTT_USERNAME);
  mqttPassword = netPrefs.getString("mqttPassword", DEFAULT_MQTT_PASSWORD);

  Serial.print(F("Connecting to MQTT: "));
  Serial.println(mqttHost);

  wifiClient.setCACert(mqtt_ca_cert);

  mqttClient.setServer(mqttHost.c_str(), mqttPort);
  mqttClient.setKeepAlive(MQTT_KEEPALIVE_SEC);
  mqttClient.setCallback(mqttCallback);
  mqttClient.setBufferSize(2048);

  // Last Will as JSON for backend compatibility
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
    esp_task_wdt_reset();

    if (mqttClient.connect(deviceId.c_str(), mqttUsername.c_str(), mqttPassword.c_str(),
                          mqttTopic, MQTT_QOS, true, willMessage, false)) {
      Serial.println(F("MQTT Connected"));
      mqttConnected = true;

      sprintf(mqttTopic, TOPIC_COMMANDS, deviceId.c_str());
      mqttClient.subscribe(mqttTopic, MQTT_QOS);

      sprintf(mqttTopic, TOPIC_PAIR_RESPONSE, deviceId.c_str());
      mqttClient.subscribe(mqttTopic, MQTT_QOS);

      publishStatus("online");

      break;
    } else {
      Serial.print(".");
      sensorSafeDelay(1000);
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

    // Publish the pairing request once per generated code
    // (pairRequestSentAt is reset to 0 by generatePairCode()).
    if (currentState == STATE_WAITING_PAIR && !isPaired && pairRequestSentAt == 0) {
      publishPairRequest();
    }
  } else if (currentState != STATE_PROVISIONING) {
    if (millis() - lastMqttReconnectAttempt >= 5000) {
      connectMQTT();
      lastMqttReconnectAttempt = millis();
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

  String topicStr = topic;
  Serial.print(F("Topic string: "));
  Serial.println(topicStr);

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
      startTest(TEST_SRC_WEB);
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
    isPaired = false;
    netPrefs.putBool("isPaired", false);
    clinicId = "";
    clinicName = "";
    netPrefs.putString("clinicId", "");
    netPrefs.putString("clinicName", "");

    currentState = STATE_WAITING_PAIR;

    generatePairCode();
    publishPairRequest();

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
  isPaired = netPrefs.getBool("isPaired", false);

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
  pairRequestSentAt = 0;

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
  jsonDoc["name"] = deviceId;
  jsonDoc["timestamp"] = millis();

  serializeJson(jsonDoc, mqttPayload);
  sprintf(mqttTopic, TOPIC_PAIR_REQUEST, deviceId.c_str());
  // NOT retained - a stale retained request could re-trigger pairing.
  mqttClient.publish(mqttTopic, mqttPayload, false);
  pairRequestSentAt = millis();

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
    netPrefs.putBool("isPaired", true);
    netPrefs.putString("clinicId", clinicId);
    netPrefs.putString("clinicName", clinicName);
    netPrefs.putString("deviceName", deviceName);

    Serial.println(F("Pairing Successful"));
    Serial.print(F("isPaired after setting: "));
    Serial.println(isPaired ? "true" : "false");

    currentState = STATE_READY;

    Serial.print(F("New state after setting: "));
    Serial.println(getStateString());

    display.clearDisplay();
    updateOLED();

    publishLog("Pair Successful");
    publishStatus(getStateString());

    Serial.println(F("=== HANDLE PAIR RESPONSE END (SUCCESS) ==="));
  } else {
    Serial.println(F("Pairing Failed - Generating new code"));
    generatePairCode();
    publishPairRequest();
    Serial.println(F("=== HANDLE PAIR RESPONSE END (FAILED) ==="));
  }
}

// ============================================================
// RUN DIAGNOSTIC SAMPLING
// ============================================================
void runDiagnosticSampling() {
  if (millis() - lastSampleTime < 500) return;
  lastSampleTime = millis();

  updateMAX30100();

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
// START TEST (20 second measurement)
// ============================================================
void startTest(uint8_t source) {
  if (testRunning) return;
  testSource = source;

  if (!sensorReady) {
    Serial.println(F("Cannot start test: MAX30102 not initialized (check wiring)"));
    publishLog("Test refused: sensor not initialized");
    return;
  }

  Serial.println(testSource == TEST_SRC_WEB ? F("Starting WEB test (continuous until stopped)") : F("Starting 20 s button test (OLED only)"));

  memset(redBuffer, 0, sizeof(redBuffer));
  memset(irBuffer, 0, sizeof(irBuffer));
  bufferIndex = 0;
  redLowPass = 0;
  irLowPass = 0;
  redBaseline = 0;
  irBaseline = 0;
  irDcF = 0;       // so the DC filter re-seeds from the first sample
  redDcF = 0;

  memset(peakTimes, 0, sizeof(peakTimes));
  peakCount = 0;
  lastPeakTime = 0;
  pulseDetected = false;

  fingerDetected = false;
  stableSampleCount = 0;

  heartRate = 0;
  spo2 = 0;
  signalQuality = 0;
  vitalityIndex = 0;
  sampleCount = 0;

  // Clear previous result + accumulators
  accSpo2 = accHr = accQuality = accTemp = 0;
  accCount = 0;
  lastAccumMs = 0;
  finalSpo2 = finalHeartRate = finalSignalQuality = finalVitalityIndex = finalTemperature = 0;
  finalValid = false;
  finalComplete = false;
  finalVitalityStatus = "";
  finalVitalityShort = "--";
  haveResult = false;
  showingConclusion = false;

  testRunning = true;
  testStartTime = millis();
  currentState = STATE_TESTING;

  publishLog("Test Started");
}

// ============================================================
// STOP TEST (called by the 20 s timer, STOP button, web or app)
// ============================================================
void stopTest() {
  if (!testRunning) return;

  Serial.println(F("Stopping Test"));

  testRunning = false;
  testDuration = millis() - testStartTime;
  finalComplete = (testSource == TEST_SRC_BUTTON) && (testDuration >= TEST_DURATION_MS);
  finalizeTestResult();
  // Only website-started tests publish a result; button tests stay on the OLED.
  haveResult = (testSource == TEST_SRC_WEB);

  currentState = STATE_SHOWING_CONCLUSION;
  showingConclusion = true;
  conclusionStartTime = millis();

  Serial.print(F("Test Duration: "));
  Serial.print(testDuration / 1000);
  Serial.println(F("s"));
  Serial.print(F("Valid readings used: "));
  Serial.println(accCount);
  Serial.print(F("FINAL -> SpO2: "));
  Serial.print(finalSpo2, 1);
  Serial.print(F("%  HR: "));
  Serial.print(finalHeartRate, 0);
  Serial.print(F(" bpm  Temp: "));
  Serial.print(finalTemperature, 1);
  Serial.print(F(" C  Vitality: "));
  Serial.println(finalVitalityStatus);

  if (testSource == TEST_SRC_WEB) {
    publishLog("Web test stopped");
    publishTestResult();
  }
}

// ============================================================
// 20-SECOND TEST: auto-stop, accumulate, finalize, publish
// ============================================================
// Called every loop(): ends the test once TEST_DURATION_MS has elapsed.
void checkTestAutoStop() {
  if (testRunning && testSource == TEST_SRC_BUTTON && (millis() - testStartTime >= TEST_DURATION_MS)) {
    Serial.println(F("20 s elapsed - finishing test"));
    stopTest();
  }
}

// Called every loop(): at 10 Hz, adds the current reading to the running
// sums, but ONLY when the signal is currently valid (probe on, settled,
// not saturated, real pulse found). Stale held-over values are ignored.
void accumulateTestSample() {
  if (!testRunning) return;
  unsigned long now = millis();
  if (now - lastAccumMs < 100) return;
  lastAccumMs = now;

  if (signalValidNow && fingerDetected &&
      spo2 >= 70 && spo2 <= 100 &&
      heartRate >= HEART_RATE_MIN && heartRate <= HEART_RATE_MAX) {
    accSpo2    += spo2;
    accHr      += heartRate;
    accQuality += signalQuality;
    accTemp    += temperature;
    accCount++;
  }
}

void finalizeTestResult() {
  if (accCount >= MIN_VALID_READINGS) {
    finalSpo2          = accSpo2 / accCount;
    finalHeartRate     = accHr / accCount;
    finalSignalQuality = accQuality / accCount;
    finalTemperature   = (accTemp > 0) ? (accTemp / accCount) : temperature;
    finalValid = true;

    // Same vitality formula as the live display, applied to the averages
    finalVitalityIndex = (finalSignalQuality * 0.6f) + (finalSpo2 * 0.2f)
                       + ((finalHeartRate > 60 && finalHeartRate < 100) ? 20.0f : 0.0f);
    if (finalVitalityIndex > 70)      { finalVitalityStatus = "Strong Vitality";   finalVitalityShort = "Strong"; }
    else if (finalVitalityIndex > 40) { finalVitalityStatus = "Moderate Vitality"; finalVitalityShort = "Moderate"; }
    else                              { finalVitalityStatus = "Weak Vitality";     finalVitalityShort = "Weak"; }
  } else {
    // Not enough clean data - don't present a number we can't trust
    finalSpo2 = finalHeartRate = finalSignalQuality = finalVitalityIndex = finalTemperature = 0;
    finalValid = false;
    finalVitalityStatus = "No Valid Reading";
    finalVitalityShort = "No Valid";
  }
}

void publishTestResult() {
  if (!mqttClient.connected()) return;

  jsonDoc.clear();
  jsonDoc["deviceId"]       = deviceId;
  jsonDoc["completed"]      = finalComplete;
  jsonDoc["valid"]          = finalValid;
  jsonDoc["spo2"]           = finalSpo2;
  jsonDoc["heartRate"]      = finalHeartRate;
  jsonDoc["signalQuality"]  = finalSignalQuality;
  jsonDoc["vitalityIndex"]  = finalVitalityIndex;
  jsonDoc["vitalityStatus"] = finalVitalityStatus;
  jsonDoc["temperature"]    = finalTemperature;
  jsonDoc["finalTemperature"] = finalTemperature;
  jsonDoc["finalSpo2"]      = finalSpo2;
  jsonDoc["finalHeartRate"] = finalHeartRate;
  jsonDoc["durationMs"]     = testDuration;
  jsonDoc["validReadings"]  = accCount;
  jsonDoc["timestamp"]      = millis();

  serializeJson(jsonDoc, mqttPayload);
  sprintf(mqttTopic, TOPIC_RESULT, deviceId.c_str());
  mqttClient.publish(mqttTopic, mqttPayload, MQTT_QOS);
}

// ============================================================
// RUN TEST SAMPLING
// ============================================================
void runTestSampling() {
  static unsigned long lastStatusPrint = 0;
  unsigned long now = millis();

  if (testRunning) {
    sampleCount++;
    if (now - lastStatusPrint >= 2000) {
      lastStatusPrint = now;
      unsigned long elapsed = now - testStartTime;
      if (testSource == TEST_SRC_BUTTON) {
        unsigned long remaining = (elapsed < TEST_DURATION_MS) ? (TEST_DURATION_MS - elapsed) / 1000 : 0;
        Serial.print(F("[TASK] Button test (OLED 20s)... "));
        Serial.print(remaining);
        Serial.println(F("s remaining"));
      } else {
        Serial.print(F("[TASK] Web test (Continuous)... "));
        Serial.print(elapsed / 1000);
        Serial.println(F("s elapsed - streaming until web stop"));
      }
    }
  } else {
    if (now - lastStatusPrint >= 5000) {
      lastStatusPrint = now;
      Serial.print(F("[TASK] State: "));
      Serial.print(getStateString());
      Serial.println(F(" | Test not running"));
    }
  }
}

// ============================================================
// UPDATE SENSOR - Read RAW samples from the MAX30102 and run our own
// AC/DC + peak-detection pipeline
// ============================================================
void updateMAX30100() {
  esp_task_wdt_reset();

  // Skip sensor updates before initialization, or if begin() never succeeded
  // (calling the SparkFun driver before begin() dereferences a null I2C pointer
  // and crashes with LoadProhibited).
  if (currentState < STATE_READY || !sensorReady) {
    return;
  }

  // Must run continuously to keep the sensor's FIFO from overflowing
  sensor.check();

  static unsigned long lastSensorDebug = 0;
  static unsigned long samplesThisWindow = 0;
  static int32_t prevIrLowPass = 0;
  static bool rising = false;
  static unsigned long lastSampleSeen = 0;
  static unsigned long lastBaselineChange = 0;
  static int32_t lastIrBaseline = 0;
  static bool baselineStable = false;
  static unsigned long lastSmoothingDebug = 0;

  uint32_t irValue, redValue;
  bool gotAnySample = false;
  int maxSamplesPerLoop = 100;
  int samplesProcessed = 0;
  while (sensor.available() && samplesProcessed < maxSamplesPerLoop) {
    redValue = sensor.getFIFORed();
    irValue  = sensor.getFIFOIR();
    sensor.nextSample();
    gotAnySample = true;
    samplesProcessed++;
    samplesThisWindow++;
    unsigned long now = millis();

    if (samplesProcessed % 50 == 0) {
      esp_task_wdt_reset();
    }

    // Saturation check (probe pressed too hard / LED current too high)
    sensorSaturated = (irValue >= SATURATION_LEVEL || redValue >= SATURATION_LEVEL);

    // DC (baseline) tracking: slow float exponential moving average
    if (irDcF == 0) { irDcF = (float)irValue; redDcF = (float)redValue; } // start at first sample
    irDcF  += ((float)irValue  - irDcF)  * DC_ALPHA;
    redDcF += ((float)redValue - redDcF) * DC_ALPHA;
    irBaseline  = (int32_t)irDcF;
    redBaseline = (int32_t)redDcF;

    // AC (pulsatile) component = raw sample minus its own DC baseline
    int32_t irSample = (int32_t)irValue - (int32_t)irBaseline;
    int32_t redSample = (int32_t)redValue - (int32_t)redBaseline;

    irBuffer[bufferIndex] = irSample;
    redBuffer[bufferIndex] = redSample;
    bufferIndex = (bufferIndex + 1) % FILTER_BUFFER_SIZE;

    // Light smoothing on the IR AC channel, used only for peak (beat) detection
    irLowPass = irLowPass + (int32_t)((irSample - irLowPass) * 0.3f);

    // Peak detection on the smoothed IR AC signal
    if (irLowPass > adaptiveThreshold && !rising && (now - lastPeakTime) > 200) {
      rising = true;
    }
    if (rising && irLowPass < prevIrLowPass) {
      rising = false;
      if (lastPeakTime > 0) {
        unsigned long interval = now - lastPeakTime;
        if (interval >= 200 && interval <= 2500) {
          float bpm = 60000.0f / interval;

          if (bpm >= 30 && bpm <= 200) {
            // Last 5 intervals for median filtering and outlier rejection
            static unsigned long recentIntervals[5] = {0};
            static int intervalIndex = 0;

            recentIntervals[intervalIndex] = interval;
            intervalIndex = (intervalIndex + 1) % 5;

            int validCount = 0;
            unsigned long sortedIntervals[5];
            for (int i = 0; i < 5; i++) {
              if (recentIntervals[i] > 0) {
                sortedIntervals[validCount++] = recentIntervals[i];
              }
            }

            if (validCount >= 3) {
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

              // Beat-to-beat consistency check (reject if >30% from median)
              float variation = abs(bpm - medianBpm) / medianBpm;
              peakConsistency = constrain(100.0f * (1.0f - variation), 0.0f, 100.0f);
              if (variation < 0.3) {
                if (heartRate == 0) {
                  heartRate = medianBpm;
                } else {
                  float smoothingFactor = (variation < 0.1) ? 0.8f : 0.6f;
                  heartRate = heartRate * smoothingFactor + medianBpm * (1.0f - smoothingFactor);
                }
                pulseDetected = true;
                beatDetected = true;
                onBeatDetected();
              }
            } else {
              // Startup phase - direct BPM with basic smoothing
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

  esp_task_wdt_reset();

  // --- Stuck-FIFO recovery ---
  // If no samples arrive for 2 s (should be ~100/sec), clear the FIFO to resync.
  unsigned long now2 = millis();
  static int consecutiveFifoStalls = 0;
  if (gotAnySample) {
    lastSampleSeen = now2;
    consecutiveFifoStalls = 0;
  } else if (lastSampleSeen != 0 && (now2 - lastSampleSeen) > 2000) {
    Serial.println(F("WARNING: MAX30102 FIFO appears stuck (no samples for 2s) - clearing FIFO"));
    sensor.clearFIFO();
    lastSampleSeen = now2;
    consecutiveFifoStalls++;
    if (consecutiveFifoStalls >= 3) {
      reportSensorFailure("MAX30102_FIFO_STUCK");
      consecutiveFifoStalls = 0;
    }
  } else if (lastSampleSeen == 0) {
    lastSampleSeen = now2;
  }

  // --- Probe/tissue contact detection from the IR DC baseline ---
  probeOnTooth = (irBaseline > PROBE_CONTACT_THRESHOLD);
  fingerDetected = probeOnTooth;
  if (!fingerDetected) probeDetectedTime = 0;
  else if (probeDetectedTime == 0) probeDetectedTime = millis();

  redRaw = (uint32_t)max((int32_t)0, (int32_t)redBaseline);
  irRaw = (uint32_t)max((int32_t)0, (int32_t)irBaseline);

  // --- Baseline stability tracking ---
  if (abs(irBaseline - lastIrBaseline) > 100) {
    lastBaselineChange = millis();
    lastIrBaseline = irBaseline;
  }
  baselineStable = (millis() - lastBaselineChange) > 2000;

  // --- Peak-to-peak AC amplitude over the buffer window ---
  int32_t irMax = INT32_MIN, irMin = INT32_MAX, redMax = INT32_MIN, redMin = INT32_MAX;
  int localValidSamples = 0;

  for (int i = 0; i < FILTER_BUFFER_SIZE; i++) {
    // Skip extreme outliers (buffer init issues / overflow)
    if (abs(irBuffer[i]) < 50000 && abs(redBuffer[i]) < 50000) {
      if (irBuffer[i] > irMax) irMax = irBuffer[i];
      if (irBuffer[i] < irMin) irMin = irBuffer[i];
      if (redBuffer[i] > redMax) redMax = redBuffer[i];
      if (redBuffer[i] < redMin) redMin = redBuffer[i];
      localValidSamples++;
    }
  }

  if (localValidSamples >= FILTER_BUFFER_SIZE * 0.5) {
    irAC = (float)(irMax - irMin);
    redAC = (float)(redMax - redMin);
  } else {
    irAC = 0;
    redAC = 0;
  }

  irDC = (float)irBaseline;
  redDC = (float)redBaseline;
  redFiltered = (uint32_t)abs(redSampleLast());
  irFiltered = (uint32_t)abs(irLowPass);

  // Peak-detection threshold tracks ~35% of the measured peak-to-peak amplitude
  adaptiveThreshold = constrain((int32_t)(irAC * 0.35f), PEAK_THRESHOLD_MIN, PEAK_THRESHOLD_MAX / 2);

  noiseLevel = 100.0f - constrain(irAC, 0, PEAK_THRESHOLD_MAX) * (100.0f / PEAK_THRESHOLD_MAX);

  // Require the probe to have been on-tooth for >= 2 s before trusting AC amplitude
  bool probeSettled = fingerDetected && probeDetectedTime > 0 && (millis() - probeDetectedTime) > 2000;
  bool hasValidSignal = probeSettled && irAC > MIN_VALID_AC_AMPLITUDE
                        && irDC > 1000 && redDC > 1000 && !sensorSaturated;
  signalValidNow = hasValidSignal;

  // Last time hasValidSignal was true - used to hold the displayed reading
  // briefly through a single noisy sample instead of snapping to 0.
  static unsigned long lastValidSignalMs = 0;
  if (hasValidSignal) lastValidSignalMs = millis();

  if (hasValidSignal) {
    if (redDC <= 0 || irDC <= 0 || irAC <= 0) {
      spo2 = 0;
      return;
    }

    // Ratio of Ratios
    float redRatio = redAC / (float)redDC;
    float irRatio = irAC / (float)irDC;
    float R = redRatio / irRatio;

    if (R < 0.2 || R > 2.0) {
      spo2 = 0;
      return;
    }

    // Median filter across the last 5 valid R computations
    static float recentRValues[5] = {0, 0, 0, 0, 0};
    static int rValueIndex = 0;
    static int rValueCount = 0;
    recentRValues[rValueIndex] = R;
    rValueIndex = (rValueIndex + 1) % 5;
    if (rValueCount < 5) rValueCount++;

    float sortedR[5];
    for (int i = 0; i < rValueCount; i++) sortedR[i] = recentRValues[i];
    for (int i = 0; i < rValueCount - 1; i++) {
      for (int j = i + 1; j < rValueCount; j++) {
        if (sortedR[i] > sortedR[j]) {
          float tmp = sortedR[i]; sortedR[i] = sortedR[j]; sortedR[j] = tmp;
        }
      }
    }
    float medianR = sortedR[rValueCount / 2];

    // Maxim/Analog Devices quadratic: SpO2 = 1.59584*R^2 - 34.0657*R + 112.6898
    float spo2Estimate = (1.59584f * medianR * medianR) - (34.0657f * medianR) + 112.6898f;
    float newSpo2 = constrain(spo2Estimate, 0.0f, 100.0f);

    // Time-based smoothing + per-second rate clamp (independent of call rate)
    static unsigned long lastSpo2UpdateMs = 0;
    constexpr float SPO2_TIME_CONSTANT_MS = 6000.0f;
    constexpr float SPO2_MAX_STEP_PER_SEC = 1.0f;
    unsigned long nowMs = millis();
    if (spo2 == 0 || lastSpo2UpdateMs == 0) {
      spo2 = newSpo2;
    } else {
      float dtMs = (float)(nowMs - lastSpo2UpdateMs);
      float alpha = 1.0f - expf(-dtMs / SPO2_TIME_CONSTANT_MS);
      float smoothed = spo2 * (1.0f - alpha) + newSpo2 * alpha;
      float maxStep = SPO2_MAX_STEP_PER_SEC * (dtMs / 1000.0f);
      float delta = constrain(smoothed - spo2, -maxStep, maxStep);
      spo2 = spo2 + delta;
    }
    lastSpo2UpdateMs = nowMs;

    // Signal quality = amplitude score blended with beat-to-beat consistency
    float amplitudeScore = constrain(
      (float)(irAC - MIN_VALID_AC_AMPLITUDE) * (100.0f / (PEAK_THRESHOLD_MAX - MIN_VALID_AC_AMPLITUDE)),
      0.0f, 100.0f);
    float consistencyScore = (lastPeakTime > 0 && (millis() - lastPeakTime) < 3000) ? peakConsistency : 0.0f;
    signalQuality = constrain(amplitudeScore * 0.5f + consistencyScore * 0.5f, 0.0f, 100.0f);
  } else {
    // Grace period: hold the last good reading briefly; zero only after
    // contact has been genuinely lost for 3 s.
    if (lastValidSignalMs != 0 && (millis() - lastValidSignalMs > 3000)) {
      spo2 = 0;
      heartRate = 0;
      signalQuality = 0;
      peakConsistency = 0;
      pulseDetected = false;
    }
  }

  // --- Live vitality index ---
  if (heartRate > 0 && spo2 > 0) {
    vitalityIndex = (signalQuality * 0.6f) + (spo2 * 0.2f) + ((heartRate > 60 && heartRate < 100) ? 20.0f : 0.0f);
    vitalityStatus = vitalityIndex > 70 ? "Strong Vitality" : vitalityIndex > 40 ? "Moderate Vitality" : "Weak Vitality";
  } else {
    vitalityIndex = 0;
    vitalityStatus = fingerDetected ? "No Detectable Vitality" : "No Probe Contact";
  }

  probeQuality = signalQuality > 70 ? "Good" : signalQuality > 40 ? "Fair" : "Poor";

  if (millis() - lastSensorDebug >= 5000) {
    lastSensorDebug = millis();
    samplesThisWindow = 0;
  }

  beatDetected = false;
}

// Last raw AC sample written into the RED buffer, for display filtering
int32_t redSampleLast() {
  int lastIdx = (bufferIndex - 1 + FILTER_BUFFER_SIZE) % FILTER_BUFFER_SIZE;
  return redBuffer[lastIdx];
}

// ============================================================
// SENSOR SAFE DELAY - delay that keeps servicing the sensor FIFO
// ============================================================
void sensorSafeDelay(unsigned long ms) {
  unsigned long start = millis();
  while (millis() - start < ms) {
    updateMAX30100();
    delay(1);
  }
}

// ============================================================
// UNUSED STUBS - kept for interface compatibility only
// ============================================================
void processSignals() {
}

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
// CHECK BATTERY - Demo Data (no fuel gauge wired up in this build)
// ============================================================
void checkBattery() {
  static unsigned long lastBatteryUpdate = 0;
  static float demoBatteryPercent = 80.0;

  if (millis() - lastBatteryUpdate > 5000) {
    demoBatteryPercent -= 0.1;
    if (demoBatteryPercent < 75.0) {
      demoBatteryPercent = 85.0;
    }
    lastBatteryUpdate = millis();
  }

  batteryPercent = demoBatteryPercent;
  batteryVoltage = 3.7 + (batteryPercent / 100.0) * 0.5;
  isCharging = false;

  if (batteryPercent < LOW_BATTERY_WARNING) {
    Serial.println(F("LOW BATTERY WARNING"));
    publishLog("Low Battery Warning");
  }

  if (batteryPercent < CRITICAL_BATTERY) {
    Serial.println(F("CRITICAL BATTERY - Shutting Down"));
    publishLog("Critical Battery - Shutting Down");
  }
}

// ============================================================
// CHECK TEMPERATURE - Read from LM35 sensor on GPIO 34
// ============================================================
void checkTemperature() {
  static unsigned long lastTempUpdate = 0;

  static bool adcConfigured = false;
  static float smoothedTemp = 0;

  if (millis() - lastTempUpdate > 2000) {
    if (!adcConfigured) {
      analogReadResolution(12);
      // 11 dB attenuation (default range ~0-3.1 V). The 2.5 dB mode read
      // ~2.4x too high on this board (756 mV vs 318 mV for the same pin).
      analogSetPinAttenuation(PIN_LM35, ADC_11db);
      adcConfigured = true;
    }

    // Oversample to cancel ADC noise (WiFi/I2C activity)
    uint32_t mvSum = 0;
    const int N = 32;
    for (int i = 0; i < N; i++) {
      mvSum += analogReadMilliVolts(PIN_LM35); // factory-calibrated mV
      delayMicroseconds(200);
    }
    float millivolts = (float)mvSum / N;

    // LM35: 10 mV per degC
    float rawTemp = millivolts / 10.0f;
    float calibrated = (rawTemp * tempCalibrationScale) + tempCalibrationOffset;

    // Light smoothing so the value doesn't jitter
    smoothedTemp = (smoothedTemp == 0) ? calibrated : (smoothedTemp * 0.7f + calibrated * 0.3f);
    temperature = smoothedTemp;

    Serial.print(F("LM35 raw: "));
    Serial.print(millivolts, 1);
    Serial.print(F(" mV -> "));
    Serial.print(temperature, 1);
    Serial.println(F(" C"));

    lastTempUpdate = millis();
  }
}

// ============================================================
// CHECK SAFE MODE
// ============================================================
void checkSafeMode() {
  if (safeMode) return;

  if (sensorFailureCount > 0 && millis() - lastSensorFailure >= 60000) {
    sensorFailureCount = 0;
  }

  if (sensorFailureCount >= MAX_SENSOR_FAILURES) {
    Serial.println(F("Entering Safe Mode - repeated sensor failures detected"));
    safeMode = true;
    currentState = STATE_SAFE_MODE;
    publishLog("Safe Mode Activated - repeated sensor failures");

    if (testRunning) {
      stopTest();
    }
  }
}

// ============================================================
// HANDLE STATE
// ============================================================
void handleState() {
  if (safeMode && currentState == STATE_TESTING) {
    stopTest();
    currentState = STATE_SAFE_MODE;
  }
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
  if (!diagnosticMode) return;
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
// GET VITALITY SHORT - Compact label for OLED (live readings)
// ============================================================
const char* getVitalityShort() {
  if (vitalityStatus == "Strong Vitality") return "Strong";
  if (vitalityStatus == "Moderate Vitality") return "Moderate";
  if (vitalityStatus == "Weak Vitality") return "Weak";
  if (vitalityStatus == "No Detectable Vitality") return "No Signal";
  if (vitalityStatus == "No Probe Contact") return "No Contact";
  return "--";
}

// ============================================================
// UPDATE OLED
// ============================================================
void updateOLED() {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);

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
      display.println(F("READY"));
      display.drawLine(0, 9, 127, 9, SSD1306_WHITE);
      display.setCursor(0, 14);
      display.print(F("Temp:"));
      display.print(temperature, 1);
      display.print(F("C"));
      display.setCursor(0, 32);
      display.print(F("Ready"));
      drawBatteryIcon(88, 32);
      display.setCursor(104, 32);
      display.print((int)batteryPercent);
      display.print(F("%"));
      display.setCursor(0, 44);
      display.print(sensorReady ? F("START = 20s test") : F("SENSOR NOT FOUND"));
      break;
    case STATE_TESTING: {
      unsigned long elapsed = millis() - testStartTime;

      if (testSource == TEST_SRC_WEB) {
        // Website test: no time limit - live values until the website stops it.
        display.print(F("WEB TEST "));
        display.print(elapsed / 1000);
        display.print(F("s"));
        display.drawLine(0, 9, 127, 9, SSD1306_WHITE);
        display.setCursor(0, 14);
        if (!fingerDetected) {
          display.println(F("Place probe on tooth"));
        } else if (signalValidNow && heartRate > 0 && spo2 > 0) {
          display.print(F("SpO2:"));
          display.print((int)(spo2 + 0.5f));
          display.println(F("%"));
          display.setCursor(0, 26);
          display.print(F("HR:"));
          display.print((int)(heartRate + 0.5f));
          display.println(F(" bpm"));
        } else {
          display.println(F("Measuring..."));
        }
        display.setCursor(0, 40);
        display.print(F("Temp:"));
        display.print(temperature, 1);
        display.println(F("C"));
        display.setCursor(0, 54);
        display.print(F("Stop from website"));
        break;
      }

      // Button test: fixed 20 s, one final value at the end.
      if (elapsed > TEST_DURATION_MS) elapsed = TEST_DURATION_MS;
      unsigned long remaining = (TEST_DURATION_MS - elapsed + 999) / 1000;

      display.print(F("TESTING "));
      display.print(remaining);
      display.print(F("s left"));
      display.drawLine(0, 9, 127, 9, SSD1306_WHITE);

      display.setCursor(0, 16);
      display.println(F("Measuring..."));
      display.setCursor(0, 30);
      if (!fingerDetected) {
        display.println(F("Place probe on tooth"));
      } else {
        display.println(F("Keep probe steady"));
      }

      drawProgressBar(0, 54, 128, 10, (elapsed * 100.0f) / TEST_DURATION_MS);
      break;
    }
    case STATE_SHOWING_CONCLUSION:
      display.println(testSource == TEST_SRC_WEB ? F("RESULT (web)") : (finalComplete ? F("RESULT (20s)") : F("RESULT (early)")));
      display.drawLine(0, 9, 127, 9, SSD1306_WHITE);

      if (finalValid) {
        display.setTextSize(2);
        display.setCursor(0, 13);
        display.print(F("SpO2 "));
        display.print((int)(finalSpo2 + 0.5f));
        display.print(F("%"));
        display.setTextSize(1);

        display.setCursor(0, 34);
        display.print(F("HR:"));
        display.print((int)(finalHeartRate + 0.5f));
        display.print(F("bpm"));
        display.setCursor(72, 34);
        display.print(F("T:"));
        display.print(finalTemperature, 1);
        display.print(F("C"));

        display.setCursor(0, 44);
        display.print(F("Vit:"));
        display.print(finalVitalityShort);
      } else {
        display.setCursor(0, 16);
        display.println(F("No valid reading"));
        display.println(F("Check probe contact"));
        display.println(F("and try again"));
      }

      display.setCursor(0, 56);
      display.print(F("START=retest STOP=ok"));
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
      if (!selfTestResult.max30100) display.println(F("MAX30102 Fail"));
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

  display.fillRect(x + 1, y + 1, fillWidth, 5, SSD1306_WHITE);
}

// ============================================================
// DRAW WIFI ICON
// ============================================================
void drawWiFiIcon(int x, int y, int rssi) {
  if (rssi == 0) {
    display.drawLine(x, y, x + 8, y + 8, SSD1306_WHITE);
    display.drawLine(x + 8, y, x, y + 8, SSD1306_WHITE);
  } else {
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
    display.drawLine(x, y + 4, x + 3, y + 7, SSD1306_WHITE);
    display.drawLine(x + 3, y + 7, x + 8, y, SSD1306_WHITE);
  } else {
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

  if (quality >= 80) {
    display.fillRect(x, y, width, 8, SSD1306_WHITE);
  } else if (quality >= 50) {
    display.fillRect(x, y, width, 8, SSD1306_WHITE);
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
void publishStatus(const char* status) {
  jsonDoc.clear();
  jsonDoc["deviceId"] = deviceId;
  jsonDoc["status"] = status;
  jsonDoc["online"] = (strcmp(status, "offline") != 0);
  jsonDoc["state"] = getStateString();
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
  jsonDoc["online"] = true;

  serializeJson(jsonDoc, mqttPayload);
  sprintf(mqttTopic, TOPIC_HEARTBEAT, deviceId.c_str());
  mqttClient.publish(mqttTopic, mqttPayload, MQTT_QOS);
}

// ============================================================
// PUBLISH TELEMETRY
// ============================================================
void publishTelemetry() {
  jsonDoc.clear();
  jsonDoc["deviceId"] = deviceId;
  jsonDoc["timestamp"] = millis();
  jsonDoc["battery"] = batteryPercent;
  jsonDoc["voltage"] = batteryVoltage;
  jsonDoc["batterySource"] = "demo";
  jsonDoc["redRaw"] = redRaw;
  jsonDoc["irRaw"] = irRaw;
  jsonDoc["fingerDetected"] = fingerDetected;
  jsonDoc["stableSampleCount"] = sampleCount;
  // Website test (testSource == TEST_SRC_WEB): LIVE readings every second while
  // the test runs, until the website stops it; after the stop, the final average
  // is held. Button test (20 s, OLED only): nothing is published - all zeros.
  float pubHr = 0, pubSpo2 = 0, pubQuality = 0, pubVit = 0, pubTemp = 0;
  String pubStatus = "--";
  bool webLive = testRunning && testSource == TEST_SRC_WEB;
  if (webLive) {
    pubStatus = "Measuring";
    pubTemp = temperature;
    if (signalValidNow && fingerDetected) {
      pubHr = heartRate; pubSpo2 = spo2; pubQuality = signalQuality;
      pubVit = vitalityIndex;
      if (heartRate > 0 && spo2 > 0) pubStatus = vitalityStatus;
    }
  } else if (haveResult && currentState != STATE_TESTING) {
    pubHr = finalHeartRate; pubSpo2 = finalSpo2; pubQuality = finalSignalQuality;
    pubVit = finalVitalityIndex; pubStatus = finalVitalityStatus;
    pubTemp = finalTemperature;
  }
  jsonDoc["temperature"] = pubTemp;
  jsonDoc["heartRate"] = pubHr;
  jsonDoc["heartRateConfidence"] = pubQuality;
  jsonDoc["spo2"] = pubSpo2;
  jsonDoc["spo2Confidence"] = pubQuality;
  jsonDoc["signalQuality"] = pubQuality;
  jsonDoc["vitalityIndex"] = pubVit;
  jsonDoc["vitalityStatus"] = pubStatus;
  jsonDoc["probeQuality"] = probeQuality;
  jsonDoc["deviceState"] = getStateString();
  jsonDoc["sampleCount"] = sampleCount;
  jsonDoc["testDuration"] = testRunning ? (millis() - testStartTime) : testDuration;
  // Final result of a website test (0 until one has finished; never set by button tests)
  jsonDoc["finalSpo2"] = haveResult ? finalSpo2 : 0.0f;
  jsonDoc["finalHeartRate"] = haveResult ? finalHeartRate : 0.0f;
  jsonDoc["finalTemperature"] = haveResult ? finalTemperature : 0.0f;
  jsonDoc["testSource"] = (testSource == TEST_SRC_WEB) ? "web" : "button";
  jsonDoc["rawTemperature"] = temperature;
  // Legacy compatibility fields
  jsonDoc["redFiltered"] = redFiltered;
  jsonDoc["irFiltered"] = irFiltered;
  jsonDoc["redAC"] = 0;
  jsonDoc["redDC"] = 0;
  jsonDoc["irAC"] = 0;
  jsonDoc["irDC"] = 0;
  jsonDoc["motionDetected"] = false;
  jsonDoc["sensorSaturated"] = false;

  size_t payloadLen = serializeJson(jsonDoc, mqttPayload, sizeof(mqttPayload));
  if (jsonDoc.overflowed() || payloadLen >= sizeof(mqttPayload) - 1) {
    Serial.println(F("ERROR: telemetry JSON overflowed - fields were dropped/truncated!"));
  }
  sprintf(mqttTopic, TOPIC_TELEMETRY, deviceId.c_str());

  if (mqttConnected) {
    bool success = mqttClient.publish(mqttTopic, mqttPayload, 0);
    if (!success) {
      Serial.println(F("[MQTT] Telemetry publish failed"));
    }
    publishBufferedTelemetry();
  } else {
    storeOfflineTelemetry(mqttPayload);
  }
}

// ============================================================
// STORE OFFLINE TELEMETRY
// ============================================================
void storeOfflineTelemetry(const char* payload) {
  if (offlineBufferCount < OFFLINE_BUFFER_SIZE) {
    int idx = (offlineBufferIndex + offlineBufferCount) % OFFLINE_BUFFER_SIZE;
    strncpy(offlineBuffer[idx].payload, payload, 1535);
    offlineBuffer[idx].payload[1535] = '\0';
    offlineBuffer[idx].timestamp = millis();
    offlineBufferCount++;
    Serial.print(F("Buffered telemetry ("));
    Serial.print(offlineBufferCount);
    Serial.println(F(")"));
  } else {
    Serial.println(F("Offline buffer full - discarding oldest"));
    strncpy(offlineBuffer[offlineBufferIndex].payload, payload, 1535);
    offlineBuffer[offlineBufferIndex].payload[1535] = '\0';
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

    sensorSafeDelay(10);
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
// GET STATE STRING (string literals - no heap allocation per call)
// ============================================================
const char* getStateString() {
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

  // Clear BOTH namespaces: `preferences` (calibration) and `netPrefs`
  // (WiFi, pairing, MQTT credentials).
  preferences.clear();
  preferences.end();
  netPrefs.clear();
  netPrefs.end();

  sensorSafeDelay(1000);
  ESP.restart();
}
