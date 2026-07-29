/*
 * OpticalSense ESP32 Firmware - DEMO / CONNECTIVITY TEST VERSION
 * Version: demo-1.0.0
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
 * WiFi credentials are NOT hardcoded - on boot, the device asks for them
 * over the Serial Monitor (115200 baud). Type the SSID, press Enter, then
 * type the password, press Enter.
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

// ============================================================
// WIFI CREDENTIALS - left blank; entered at runtime over Serial instead.
// (Not hardcoded so this sketch is safe to keep in a public repo.)
// ============================================================
String WIFI_SSID     = "";
String WIFI_PASSWORD = "";

// ============================================================
// CONFIGURATION (copied from production firmware)
// ============================================================
constexpr char FIRMWARE_VERSION[] = "demo-1.0.0";
constexpr char DEVICE_NAME_PREFIX[] = "OPT";

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

String deviceId;
String pairingCode;   // 6-digit pairing code shown on Serial / display
char mqttTopic[128];
char mqttPayload[512];
StaticJsonDocument<512> jsonDoc;

unsigned long lastHeartbeat = 0;
unsigned long lastTelemetry = 0;
unsigned long sampleCount = 0;

// Demo "vitals" - drift slowly + jitter so the website sees realistic-looking
// live movement rather than static numbers.
float demoHeartRate   = 72.0;
float demoSpo2        = 97.5;
float demoTemperature = 36.6;
float demoVitality    = 78.0;
float demoBattery     = 85.0;

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
  readWiFiCredentialsFromSerial();
  connectWiFi();
  connectMQTT();

  // Publish the pairing code so the website can match it
  publishPairingCode();

  Serial.println(F("Setup complete - starting demo telemetry loop"));
  Serial.println(F("=========================================="));
}

// ============================================================
// READ WIFI SSID + PASSWORD FROM SERIAL MONITOR
// ============================================================
String readSerialLine() {
  String line = "";
  while (true) {
    if (Serial.available()) {
      char c = Serial.read();
      if (c == '\n' || c == '\r') {
        if (line.length() > 0) break;   // ignore stray \r\n pairs / blank presses
        else continue;
      }
      line += c;
    }
  }
  line.trim();
  return line;
}

void readWiFiCredentialsFromSerial() {
  Serial.println(F("=========================================="));
  Serial.println(F("Enter WiFi SSID and press Enter:"));
  WIFI_SSID = readSerialLine();
  Serial.print(F("SSID received: "));
  Serial.println(WIFI_SSID);

  Serial.println(F("Enter WiFi Password and press Enter:"));
  WIFI_PASSWORD = readSerialLine();
  Serial.println(F("Password received."));
}

// ============================================================
// LOOP
// ============================================================
void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  if (!mqttClient.connected()) {
    connectMQTT();
  }
  mqttClient.loop();

  unsigned long now = millis();

  if (now - lastHeartbeat >= HEARTBEAT_INTERVAL) {
    publishHeartbeat();
    publishPairingCode();   // re-advertise so the website can still pick it up
    lastHeartbeat = now;
  }

  if (now - lastTelemetry >= TELEMETRY_INTERVAL) {
    publishDemoTelemetry();
    lastTelemetry = now;
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

  serializeJson(jsonDoc, mqttPayload);
  sprintf(mqttTopic, TOPIC_TELEMETRY, deviceId.c_str());
  mqttClient.publish(mqttTopic, mqttPayload, MQTT_QOS);

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
  demoSpo2        = constrain(demoSpo2, 94.0, 99.5);
  demoTemperature = constrain(demoTemperature, 36.0, 37.5);
  demoVitality    = constrain(demoVitality, 40.0, 95.0);
  demoBattery     = constrain(demoBattery, 15.0, 100.0);
}
