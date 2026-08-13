/*
 * OpticalSense ESP32 Firmware - DEMO / CONNECTIVITY TEST VERSION
 * Version: demo-2.0.0
 *
 * Purpose: verify the WiFi -> MQTT(TLS/HiveMQ) -> website pipeline works,
 * WITHOUT any real sensor hardware attached.
 *
 * Keeps, unchanged from production firmware:
 *   - WiFi connection
 *   - MQTT over TLS to HiveMQ Cloud (same host/cert/credentials/topics)
 *   - Device ID generation from MAC address
 *   - publishStatus() / publishHeartbeat() / publishTelemetry() JSON schema
 *
 * Replaces, only for this demo:
 *   - All real sensor reads (ADS1115 optical, LM35 temp, MAX17043 battery)
 *     with randomized, realistic-looking demo values generated on a timer.
 *
 * Once this demo confirms your website is receiving data correctly, you can
 * drop the real sensor/signal-processing code from your production firmware
 * back in without touching the website side at all - the JSON keys and
 * MQTT topics are identical.
 *
 * WiFi credentials are entered via web browser - ESP32 creates AP mode,
 * user connects to "OpticalSense-Setup" and enters credentials on web page.
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <WebServer.h>
#include <Preferences.h>
#include <DNSServer.h>

// ============================================================
// WIFI CREDENTIALS - stored in NVS, entered via web AP
// ============================================================
String WIFI_SSID     = "";
String WIFI_PASSWORD = "";

// ============================================================
// CONFIGURATION (copied from production firmware)
// ============================================================
constexpr char FIRMWARE_VERSION[] = "demo-2.0.0";
constexpr char DEVICE_NAME_PREFIX[] = "OPT";
constexpr char AP_SSID[] = "OpticalSense-Setup";
constexpr char AP_PASSWORD[] = "setup1234";

constexpr int MQTT_PORT = 8883;
constexpr int MQTT_KEEPALIVE_SEC = 60;
constexpr int MQTT_QOS = 1;
constexpr unsigned long HEARTBEAT_INTERVAL = 30000;   // 30s
constexpr unsigned long TELEMETRY_INTERVAL = 2000;    // 2s - demo readings

// Same broker your website already listens to
constexpr char MQTT_HOST[] = "6732afdd0ab749f1b5c67e4cd7233db9.s1.eu.hivemq.cloud";
constexpr char MQTT_USERNAME[] = "opticalpulp";
constexpr char MQTT_PASSWORD[] = "Adarsh@18";

// Same MQTT topics as production
#define TOPIC_STATUS       "opticalsense/device/%s/status"
#define TOPIC_HEARTBEAT    "opticalsense/device/%s/heartbeat"
#define TOPIC_TELEMETRY    "opticalsense/device/%s/telemetry"
#define TOPIC_PAIR_REQUEST "opticalsense/device/%s/pair/request"

// HiveMQ Cloud Root CA (same as production firmware)
const char* mqtt_ca_cert = R"EOF(
-----BEGIN CERTIFICATE-----
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
-----END CERTIFICATE-----
)EOF";

// ============================================================
// GLOBALS
// ============================================================
WiFiClientSecure wifiClient;
PubSubClient mqttClient(wifiClient);
WebServer server(80);
DNSServer dnsServer;
Preferences preferences;

String deviceId;
String pairingCode;   // 6-digit pairing code shown on Serial / display
char mqttTopic[128];
char mqttPayload[512];
StaticJsonDocument<512> jsonDoc;

// Increase MQTT buffer size to handle larger payloads
#define MQTT_BUFFER_SIZE 1024
char mqttBuffer[MQTT_BUFFER_SIZE];

unsigned long lastHeartbeat = 0;
unsigned long lastTelemetry = 0;
unsigned long sampleCount = 0;
bool apMode = false;

// Demo "vitals" - drift slowly + jitter so the website sees realistic-looking
// live movement rather than static numbers.
float demoHeartRate   = 72.0;
float demoSpo2        = 97.5;
float demoTemperature = 36.6;
float demoVitality    = 78.0;
float demoBattery     = 85.0;

// Health status strings
String healthStatus = "HEALTHY";

const byte DNS_PORT = 53;

// ============================================================
// SETUP
// ============================================================
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println(F("\n=== OpticalSense ESP32 - DEMO MODE ==="));
  Serial.println(F("Sending simulated sensor data - no real hardware required"));

  randomSeed(esp_random());

  WiFi.mode(WIFI_STA);   // ensures a stable MAC address before we read it
  generateDeviceId();
  generatePairingCode();
  
  // Initialize NVS for WiFi credentials
  preferences.begin("wifi", false);
  
  // Try to load WiFi credentials from NVS
  WIFI_SSID = preferences.getString("ssid", "");
  WIFI_PASSWORD = preferences.getString("password", "");
  
  if (WIFI_SSID.isEmpty() || WIFI_PASSWORD.isEmpty()) {
    Serial.println(F("No WiFi credentials found in storage"));
    Serial.println(F("Starting AP mode for setup..."));
    startAPMode();
  } else {
    Serial.println(F("WiFi credentials found in storage"));
    connectWiFi();
    connectMQTT();

    // Publish the pairing code so the website can match it
    publishPairingCode();

    Serial.println(F("Setup complete - starting demo telemetry loop"));
    Serial.println(F("=========================================="));
  }
}

// ============================================================
// AP MODE - Web server for WiFi credential entry
// ============================================================
void startAPMode() {
  apMode = true;
  WiFi.mode(WIFI_AP);
  WiFi.softAP(AP_SSID, AP_PASSWORD);
  
  Serial.print(F("AP started. Connect to: "));
  Serial.println(AP_SSID);
  Serial.print(F("AP IP: "));
  Serial.println(WiFi.softAPIP());
  
  // Setup DNS server for captive portal (redirect all domains to setup page)
  dnsServer.start(DNS_PORT, "*", WiFi.softAPIP());
  
  // Setup web server routes
  server.on("/", handleRoot);
  server.on("/save", handleSave);
  server.onNotFound(handleRoot);  // Redirect all requests to root
  
  server.begin();
  Serial.println(F("Web server started"));
  Serial.println(F("DNS server started for captive portal"));
  
  Serial.println(F("=========================================="));
  Serial.println(F("    *** SETUP MODE ***"));
  Serial.println();
  Serial.println(F("  1. Connect to WiFi: OpticalSense-Setup"));
  Serial.println(F("  2. Password: setup1234"));
  Serial.println(F("  3. Open browser - should auto-redirect"));
  Serial.println(F("  4. If not, try: http://192.168.4.1"));
  Serial.println(F("  5. Enter your WiFi credentials"));
  Serial.println(F("=========================================="));
}

void handleRoot() {
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

void handleSave() {
  if (server.hasArg("ssid") && server.hasArg("password")) {
    WIFI_SSID = server.arg("ssid");
    WIFI_PASSWORD = server.arg("password");
    
    // Save to NVS
    preferences.putString("ssid", WIFI_SSID);
    preferences.putString("password", WIFI_PASSWORD);
    preferences.end();
    
    Serial.println(F("WiFi credentials saved to NVS"));
    Serial.print(F("SSID: "));
    Serial.println(WIFI_SSID);
    
    String html = "<!DOCTYPE html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>";
    html += "<title>Saved</title><style>body{font-family:Arial,sans-serif;padding:50px;text-align:center}";
    html += "h1{color:#4CAF50}</style></head><body>";
    html += "<h1>Credentials Saved!</h1>";
    html += "<p>Device will restart and connect to your WiFi.</p>";
    html += "<p>Pairing code: <strong>" + pairingCode + "</strong></p>";
    html += "</body></html>";
    
    server.send(200, "text/html", html);
    
    delay(2000);
    ESP.restart();
  } else {
    server.send(400, "text/plain", "Missing credentials");
  }
}

void handleNotFound() {
  server.send(404, "text/plain", "Not found");
}

// ============================================================
// LOOP
// ============================================================
void loop() {
  // Handle AP mode web server and DNS
  if (apMode) {
    dnsServer.processNextRequest();
    server.handleClient();
    delay(10);
    return;
  }

  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  if (!mqttClient.connected()) {
    connectMQTT();
  }
  mqttClient.loop();

  unsigned long now = millis();

  if (now - lastHeartbeat >= HEARTBEAT_INTERVAL) {
    Serial.println(F("Publishing heartbeat..."));
    publishHeartbeat();
    publishPairingCode();   // re-advertise so the website can still pick it up
    lastHeartbeat = now;
  }

  if (now - lastTelemetry >= TELEMETRY_INTERVAL) {
    Serial.println(F("Publishing telemetry..."));
    displaySensorReadings();
    publishDemoTelemetry();
    lastTelemetry = now;
  }
  
  // Debug: print loop status every 5 seconds
  static unsigned long lastDebug = 0;
  if (now - lastDebug >= 5000) {
    Serial.print(F("Loop running - MQTT connected: "));
    Serial.println(mqttClient.connected() ? "yes" : "no");
    Serial.print(F("Health Status: "));
    Serial.println(healthStatus);
    lastDebug = now;
  }

  delay(10);
}

// ============================================================
// DEVICE ID (same scheme as production)
// ============================================================
void generateDeviceId() {
  uint8_t mac[6];
  WiFi.macAddress(mac);
  char macStr[13];
  sprintf(macStr, "%02X%02X%02X", mac[3], mac[4], mac[5]);
  deviceId = String(DEVICE_NAME_PREFIX) + String(macStr);
  Serial.print(F("Device ID: "));
  Serial.println(deviceId);
}

// ============================================================
// PAIRING CODE - 6-digit code for the website pairing dialog
// ============================================================
void generatePairingCode() {
  // Generate a random 6-digit numeric code (100000 - 999999)
  long code = random(100000, 1000000);
  pairingCode = String(code);

  Serial.println(F("=========================================="));
  Serial.println(F("    *** PAIRING CODE ***"));
  Serial.println();
  Serial.print(F("         "));
  Serial.println(pairingCode);
  Serial.println();
  Serial.println(F("  Enter this code on the OpticalSense"));
  Serial.println(F("  website to pair this device."));
  Serial.println(F("=========================================="));
}

void publishPairingCode() {
  if (!mqttClient.connected()) return;

  jsonDoc.clear();
  jsonDoc["deviceId"] = deviceId;
  jsonDoc["pairingCode"] = pairingCode;
  jsonDoc["firmware"] = FIRMWARE_VERSION;
  jsonDoc["name"] = deviceId;   // default display name
  jsonDoc["timestamp"] = millis();

  serializeJson(jsonDoc, mqttPayload);
  sprintf(mqttTopic, TOPIC_PAIR_REQUEST, deviceId.c_str());
  mqttClient.publish(mqttTopic, mqttPayload, true);   // retained so it persists
 Serial.print(F("Published pairing code: "));
  Serial.println(pairingCode);

}

// ============================================================
// WIFI
// ============================================================
void connectWiFi() {
  if (WIFI_SSID.isEmpty()) {
    Serial.println(F("No WiFi SSID entered - restart and enter credentials"));
    return;
  }

  Serial.print(F("Connecting to WiFi: "));
  Serial.println(WIFI_SSID);

  WiFi.begin(WIFI_SSID.c_str(), WIFI_PASSWORD.c_str());

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 40) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println(F("\nWiFi Connected"));
    Serial.print(F("IP Address: "));
    Serial.println(WiFi.localIP());
  } else {
    Serial.println(F("\nWiFi connection failed - will retry in loop()"));
  }
}

// ============================================================
// MQTT
// ============================================================
void connectMQTT() {
  if (WiFi.status() != WL_CONNECTED) return;

  wifiClient.setCACert(mqtt_ca_cert);
  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setKeepAlive(MQTT_KEEPALIVE_SEC);
  
  // Set MQTT buffer size to handle larger payloads
  mqttClient.setBufferSize(MQTT_BUFFER_SIZE);

  Serial.print(F("Connecting to MQTT broker: "));
  Serial.println(MQTT_HOST);

  sprintf(mqttTopic, TOPIC_STATUS, deviceId.c_str());
  const char* willMessage = "Device Offline";

  int attempts = 0;
  while (!mqttClient.connected() && attempts < 10) {
    if (mqttClient.connect(deviceId.c_str(), MQTT_USERNAME, MQTT_PASSWORD,
                            mqttTopic, MQTT_QOS, false, willMessage, false)) {
      Serial.println(F("MQTT Connected"));
      publishStatus("online (demo mode)");
    } else {
      Serial.print(F("."));
      delay(1000);
      attempts++;
    }
  }

  if (!mqttClient.connected()) {
    Serial.println(F("\nMQTT connection failed - will retry in loop()"));
  }
}

// ============================================================
// PUBLISH STATUS (same schema as production)
// ============================================================
void publishStatus(const char* status) {
  jsonDoc.clear();
  jsonDoc["deviceId"] = deviceId;
  jsonDoc["status"] = status;
  jsonDoc["battery"] = demoBattery;
  jsonDoc["wifi"] = WiFi.RSSI();
  jsonDoc["mqtt"] = "CONNECTED";
  jsonDoc["timestamp"] = millis();

  serializeJson(jsonDoc, mqttPayload);
  sprintf(mqttTopic, TOPIC_STATUS, deviceId.c_str());
  mqttClient.publish(mqttTopic, mqttPayload, true);
}

// ============================================================
// PUBLISH HEARTBEAT (same schema as production)
// ============================================================
void publishHeartbeat() {
  jsonDoc.clear();
  jsonDoc["deviceId"] = deviceId;
  jsonDoc["state"] = "DEMO";
  jsonDoc["battery"] = demoBattery;
  jsonDoc["wifi"] = WiFi.RSSI();
  jsonDoc["mqtt"] = "CONNECTED";
  jsonDoc["uptime"] = millis();
  jsonDoc["timestamp"] = millis();

  serializeJson(jsonDoc, mqttPayload);
  sprintf(mqttTopic, TOPIC_HEARTBEAT, deviceId.c_str());
  mqttClient.publish(mqttTopic, mqttPayload, MQTT_QOS);


}

// ============================================================
// GENERATE + PUBLISH DEMO TELEMETRY
// (same JSON keys as production publishTelemetry())
// ============================================================
void publishDemoTelemetry() {
  updateDemoValues();

  jsonDoc.clear();
  jsonDoc["deviceId"] = deviceId;
  jsonDoc["timestamp"] = millis();
  jsonDoc["battery"] = demoBattery;
  jsonDoc["voltage"] = 3.7 + (demoBattery / 100.0) * 0.5;
  jsonDoc["temperature"] = demoTemperature;
  jsonDoc["heartRate"] = demoHeartRate;
  jsonDoc["heartRateConfidence"] = random(85, 99);
  jsonDoc["spo2"] = demoSpo2;
  jsonDoc["spo2Confidence"] = random(85, 99);
  jsonDoc["signalQuality"] = random(70, 100);
  jsonDoc["motionDetected"] = false;
  jsonDoc["sensorSaturated"] = false;
  jsonDoc["vitalityIndex"] = demoVitality;
  jsonDoc["vitalityStatus"] = demoVitality > 70 ? "VITAL" : "REDUCED_PERFUSION";
  jsonDoc["probeQuality"] = "GOOD";
  jsonDoc["deviceState"] = "DEMO";
  jsonDoc["sampleCount"] = sampleCount++;
  jsonDoc["demoMode"] = true;  // flag so your website can visually mark this as test data
  jsonDoc["healthStatus"] = healthStatus;  // Add health status to telemetry

  serializeJson(jsonDoc, mqttPayload);
  sprintf(mqttTopic, TOPIC_TELEMETRY, deviceId.c_str());
  
  // Debug MQTT client state before publish
  Serial.print(F("MQTT connected: "));
  Serial.println(mqttClient.connected() ? F("yes") : F("no"));
  Serial.print(F("MQTT state: "));
  Serial.println(mqttClient.state());
  Serial.print(F("MQTT buffer size: "));
  Serial.println(mqttClient.getBufferSize());
  
  // Try publish with QoS 0 (fire and forget)
  bool success = mqttClient.publish(mqttTopic, mqttPayload, 0);
  Serial.print(F("Telemetry publish "));
  Serial.println(success ? F("SUCCESS") : F("FAILED"));
  Serial.print(F("Topic: "));
  Serial.println(mqttTopic);
  Serial.print(F("Payload length: "));
  Serial.println(strlen(mqttPayload));
  
  // If publish failed, try to reconnect with delay
  if (!success) {
    Serial.println(F("Publish failed, attempting reconnect..."));
    mqttClient.disconnect();
    delay(1000); // Give time for disconnect
    connectMQTT();
    delay(1000); // Give time for connection to stabilize
  }

}

// ============================================================
// UPDATE DEMO VALUES - slow drift + small random jitter
// so numbers look "alive" rather than static or wildly random
// ============================================================
void updateDemoValues() {
  demoHeartRate   += random(-20, 21) / 10.0;   // +/-2.0 bpm jitter
  demoSpo2        += random(-4, 5) / 10.0;     // +/-0.4% jitter
  demoTemperature += random(-2, 3) / 100.0;    // +/-0.02C jitter
  demoVitality    += random(-15, 16) / 10.0;   // +/-1.5 jitter
  demoBattery     -= 0.01;                     // slow discharge simulation

  demoHeartRate   = constrain(demoHeartRate, 58.0, 105.0);
  demoSpo2        = constrain(demoSpo2, 88.0, 99.5);  // Allow lower for critical demo
  demoTemperature = constrain(demoTemperature, 35.5, 38.5);  // Allow wider range for demo
  demoVitality    = constrain(demoVitality, 40.0, 95.0);
  demoBattery     = constrain(demoBattery, 15.0, 100.0);
  
  // Calculate health status
  calculateHealthStatus();
}

// ============================================================
// CALCULATE HEALTH STATUS based on sensor readings
// ============================================================
void calculateHealthStatus() {
  bool critical = false;
  bool normal = false;
  
  // Check SpO2
  if (demoSpo2 < 90) critical = true;
  else if (demoSpo2 < 95) normal = true;
  
  // Check Heart Rate
  if (demoHeartRate < 60 || demoHeartRate > 100) critical = true;
  else if (demoHeartRate < 70 || demoHeartRate > 90) normal = true;
  
  // Check Temperature
  if (demoTemperature < 36 || demoTemperature > 38) critical = true;
  else if (demoTemperature < 36.5 || demoTemperature > 37.5) normal = true;
  
  // Check Battery
  if (demoBattery < 20) critical = true;
  else if (demoBattery < 50) normal = true;
  
  // Determine overall status
  if (critical) {
    healthStatus = "CRITICAL";
  } else if (normal) {
    healthStatus = "NORMAL";
  } else {
    healthStatus = "HEALTHY";
  }
}

// ============================================================
// DISPLAY SENSOR READINGS with health status
// ============================================================
void displaySensorReadings() {
  Serial.println(F("=========================================="));
  Serial.println(F("    SENSOR READINGS"));
  Serial.println(F("=========================================="));
  
  // SpO2 with status
  Serial.print(F("SpO2: "));
  Serial.print(demoSpo2, 1);
  Serial.print(F("% "));
  if (demoSpo2 < 90) Serial.println(F("[CRITICAL]"));
  else if (demoSpo2 < 95) Serial.println(F("[NORMAL]"));
  else Serial.println(F("[HEALTHY]"));
  
  // Heart Rate with status
  Serial.print(F("Heart Rate: "));
  Serial.print(demoHeartRate, 0);
  Serial.print(F(" bpm "));
  if (demoHeartRate < 60 || demoHeartRate > 100) Serial.println(F("[CRITICAL]"));
  else if (demoHeartRate < 70 || demoHeartRate > 90) Serial.println(F("[NORMAL]"));
  else Serial.println(F("[HEALTHY]"));
  
  // Temperature with status
  Serial.print(F("Temperature: "));
  Serial.print(demoTemperature, 2);
  Serial.print(F(" °C "));
  if (demoTemperature < 36 || demoTemperature > 38) Serial.println(F("[CRITICAL]"));
  else if (demoTemperature < 36.5 || demoTemperature > 37.5) Serial.println(F("[NORMAL]"));
  else Serial.println(F("[HEALTHY]"));
  
  // Battery with status
  Serial.print(F("Battery: "));
  Serial.print(demoBattery, 0);
  Serial.print(F("% "));
  if (demoBattery < 20) Serial.println(F("[CRITICAL]"));
  else if (demoBattery < 50) Serial.println(F("[NORMAL]"));
  else Serial.println(F("[HEALTHY]"));
  
  // Overall status
  Serial.print(F("Overall Status: "));
  Serial.println(healthStatus);
  Serial.println(F("=========================================="));
}
