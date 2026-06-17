/*
 ╔══════════════════════════════════════════════════════════╗
 ║         HydroSync Smart Bottle — ESP32 Firmware v5       ║
 ║  HX711 Load Cell + WiFi WebServer + Backend Push         ║
 ╚══════════════════════════════════════════════════════════╝

 WIRING:
   HX711 DT  → GPIO 14
   HX711 SCK → GPIO 13
   HX711 VCC → 3.3V
   HX711 GND → GND

 CALIBRATION (v5 procedure):
   1. Upload with EMPTY bottle → it tares on startup
   2. Open Serial Monitor at 115200 baud
   3. Watch [RAW] lines — if always 0.00, check wiring
   4. Place a known weight (e.g. 200g / filled 200ml)
   5. If [RAW] is NEGATIVE → set AUTO_FLIP_SIGN true (or negate CALIBRATION_FACTOR)
   6. Adjust CALIBRATION_FACTOR until "Weight:" matches actual grams
      Typical range for 1kg cells: 500 – 7000 (sign handled automatically)

 BOTTLE:
   BOTTLE_CAPACITY = 500 ml (water: 1 ml ≈ 1 g)
   Adjust if your bottle differs.
*/

#include "HX711.h"
#include <WiFi.h>
#include <WebServer.h>
#include <HTTPClient.h>

// ── Pins ─────────────────────────────────────────────────────
#define DT  14
#define SCK 13

// ── WiFi ─────────────────────────────────────────────────────
const char* WIFI_SSID = "vivo Y22";
const char* WIFI_PASS = "shiny12345";

// ── Backend ──────────────────────────────────────────────────
const char* BACKEND_URL = "http://10.195.187.237:5000/api/hydration/sensor";
const char* USER_ID     = "69f58c23c38470d5f4fa29e9";

// ── Bottle ───────────────────────────────────────────────────
const int   BOTTLE_CAPACITY  = 500;   // ml
const float NOISE_FLOOR      = 2.0;   // ↓ lowered from 15 → catches small weights too
const float REFILL_THRESHOLD = 80.0;  // +80 ml = refill detected

// ── Calibration ──────────────────────────────────────────────
//  Start with 2000. Increase if readings are too LOW.
//  Decrease if readings are too HIGH.
//  If raw is always negative, set AUTO_FLIP_SIGN to true.
float CALIBRATION_FACTOR = 2000.0;
const bool AUTO_FLIP_SIGN = true;  // true = firmware corrects negative raw automatically

// ── Debug ────────────────────────────────────────────────────
const bool DEBUG_RAW = true;   // set false once calibration is confirmed good

// ── Timing ───────────────────────────────────────────────────
const unsigned long READ_MS  = 1000;  // read sensor every 1 s
const unsigned long PUSH_MS  = 5000;  // push to backend every 5 s

// ── Globals ──────────────────────────────────────────────────
HX711     scale;
WebServer server(80);

float liveWeight   = 0;
float prevPushed   = -1;
unsigned long lastPushTime = 0;
unsigned long lastReadMs   = 0;

// ────────────────────────────────────────────────────────────
float readFilteredWeight() {
  float r = scale.get_units(10);

  // ── RAW debug print (disable via DEBUG_RAW flag) ──────────
  if (DEBUG_RAW) {
    Serial.printf("  [RAW] get_units = %.4f\n", r);
  }

  // ── Auto-correct orientation (compression vs tension) ─────
  if (AUTO_FLIP_SIGN && r < 0) r = -r;

  // ── Clamp to sane range ───────────────────────────────────
  if (r < 0)                      r = 0;                          // shouldn't happen after flip
  if (r < NOISE_FLOOR)            r = 0;                          // true zero / noise
  if (r > BOTTLE_CAPACITY + 100)  r = BOTTLE_CAPACITY + 100;      // cap at 600 ml

  // ── Exponential moving average (70/30) ────────────────────
  liveWeight = liveWeight * 0.7f + r * 0.3f;
  return liveWeight;
}

// ── CORS helper ───────────────────────────────────────────────
void addCors() {
  server.sendHeader("Access-Control-Allow-Origin",  "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "*");
}

// ── WebServer: GET /weight ────────────────────────────────────
void handleWeight() {
  addCors();
  int w   = (int)liveWeight;
  int pct = min(100, (int)(liveWeight / BOTTLE_CAPACITY * 100));
  String j = "{\"weight\":"   + String(w) +
             ",\"capacity\":" + String(BOTTLE_CAPACITY) +
             ",\"pct\":"      + String(pct) +
             ",\"unit\":\"ml\"}";
  server.send(200, "application/json", j);
}

// ── WebServer: GET /status ────────────────────────────────────
void handleStatus() {
  addCors();
  String j = "{\"online\":true"
             ",\"ip\":\""    + WiFi.localIP().toString() + "\""
             ",\"weight\":"  + String((int)liveWeight) +
             ",\"capacity\":" + String(BOTTLE_CAPACITY) + "}";
  server.send(200, "application/json", j);
}

// ── WebServer: OPTIONS (pre-flight) ───────────────────────────
void handleOptions() {
  addCors();
  server.send(204);
}

// ── Push weight to backend ────────────────────────────────────
void pushToBackend(int weightMl) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("  [PUSH] Skipped — WiFi not connected");
    return;
  }

  HTTPClient http;
  http.begin(BACKEND_URL);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(4000);

  String body = "{\"userId\":\""  + String(USER_ID)        + "\""
                ",\"amount\":"    + String(weightMl)        +
                ",\"bottleCap\":" + String(BOTTLE_CAPACITY) + "}";

  int code = http.POST(body);
  if (code > 0) {
    Serial.printf("  [PUSH] HTTP %d | payload: %s\n", code, body.c_str());
  } else {
    Serial.printf("  [PUSH] Failed — error: %s\n", http.errorToString(code).c_str());
  }
  http.end();
}

// ── Setup ─────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  Serial.println("\n=== HydroSync Smart Bottle v5 ===");

  // Init HX711
  scale.begin(DT, SCK);
  Serial.println("Waiting for HX711...");
  delay(1500);

  if (!scale.is_ready()) {
    Serial.println("ERROR: HX711 not found! Check DT/SCK wiring.");
    // Continue anyway — will keep retrying in loop
  } else {
    Serial.println("Taring... (keep bottle empty)");
    scale.tare();
    scale.set_scale(CALIBRATION_FACTOR);
    Serial.printf("Tare done! Calibration factor: %.0f\n", CALIBRATION_FACTOR);
  }

  // WiFi
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.printf("Connecting to %s", WIFI_SSID);
  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 30) {
    delay(500);
    Serial.print(".");
    tries++;
  }
  if (WiFi.isConnected()) {
    Serial.println("\nWiFi OK → " + WiFi.localIP().toString());
  } else {
    Serial.println("\nWiFi FAILED — running in offline mode");
  }

  // Routes
  server.on("/weight", HTTP_GET,     handleWeight);
  server.on("/status", HTTP_GET,     handleStatus);
  server.on("/weight", HTTP_OPTIONS, handleOptions);
  server.on("/status", HTTP_OPTIONS, handleOptions);
  server.begin();

  Serial.printf("WebServer on port 80 | Bottle cap: %d ml\n", BOTTLE_CAPACITY);
  if (DEBUG_RAW) Serial.println("DEBUG_RAW is ON — disable once calibration looks good");
  Serial.println("=================================\n");
}

// ── Loop ──────────────────────────────────────────────────────
void loop() {
  server.handleClient();

  // ── Read every READ_MS ────────────────────────────────────
  if (millis() - lastReadMs >= READ_MS) {
    lastReadMs = millis();

    // Re-init scale if HX711 wasn't ready at boot
    if (!scale.is_ready()) {
      Serial.println("HX711 not ready, retrying init...");
      scale.begin(DT, SCK);
      delay(500);
      scale.tare();
      scale.set_scale(CALIBRATION_FACTOR);
      return;
    }

    readFilteredWeight();
    int pct = min(100, (int)(liveWeight / BOTTLE_CAPACITY * 100));
    Serial.printf("Weight: %.0f ml | %d%%\n", liveWeight, pct);
  }

  // ── Push every PUSH_MS if changed meaningfully ────────────
  if (millis() - lastPushTime >= PUSH_MS) {
    lastPushTime = millis();
    if (abs(liveWeight - prevPushed) >= NOISE_FLOOR || prevPushed < 0) {
      pushToBackend((int)liveWeight);
      prevPushed = liveWeight;
    }
  }
}
