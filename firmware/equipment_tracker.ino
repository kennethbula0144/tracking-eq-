/*
 * ============================================================================
 * EQUIPMENT TRACKING SYSTEM
 * ESP32-S3 + MFRC522 + 16x2 I2C LCD + DS3231 + SUPABASE
 * ============================================================================
 *
 * BOARD:
 *   ESP32S3 Dev Module
 *
 * SUPABASE:
 *   https://sweycjqoubrjykgvhisf.supabase.co
 *
 * DATABASE TABLES EXPECTED:
 *   devices
 *   equipment
 *   scan_logs
 *   borrows
 *
 * BORROW WORKFLOW:
 *   1. User submits borrow form -> borrows.status = "pending"
 *   2. User scans the equipment RFID tag.
 *   3. If a pending request exists for that equipment, it is automatically
 *      approved and equipment becomes "in_use".
 *   4. Scanning equipment that is "in_use" records a return scan only.
 *      An admin must mark the borrow as returned in the dashboard.
 *
 * ============================================================================
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <SPI.h>
#include <MFRC522.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <RTClib.h>
#include <SD.h>

// ============================================================================
// 1. WIFI
// ============================================================================

const char *WIFI_SSID     = "Redmii";
const char *WIFI_PASSWORD = "123456789";

// ============================================================================
// 2. YOUR SUPABASE PROJECT
// ============================================================================

const char *SUPABASE_URL =
  "https://sweycjqoubrjykgvhisf.supabase.co";

const char *SUPABASE_KEY =
  "sb_publishable_9OqViPRLsq-mwC1nV0K8Cw_pfAJQyFJ";

// ============================================================================
// 3. DEVICE INFORMATION
// ============================================================================

const char *DEVICE_NAME =
  "Workshop Controller";

const char *DEVICE_LOCATION =
  "Main Workshop";

const char *FIRMWARE_VERSION =
  "1.3.0";

// ============================================================================
// 4. PIN CONFIGURATION
// ============================================================================

// ---------------- SPI ----------------

#define PIN_SPI_SCK   4
#define PIN_SPI_MISO  5
#define PIN_SPI_MOSI  6

// ---------------- RFID ----------------

#define PIN_RFID_SS   7
#define PIN_RFID_RST  10

// ---------------- I2C ----------------

#define PIN_I2C_SDA   8
#define PIN_I2C_SCL   9

// ---------------- MicroSD ----------------

#define PIN_SD_CS     42

// ---------------- Outputs ----------------

#define PIN_BUZZER     1
#define PIN_LED_GREEN  2
#define PIN_LED_YELLOW 38
#define PIN_LED_RED    39
#define PIN_RELAY      41

// ---------------- Emergency Stop ----------------

#define PIN_ESTOP      40

// ============================================================================
// 5. HARDWARE OBJECTS
// ============================================================================

MFRC522 rfid(
  PIN_RFID_SS,
  PIN_RFID_RST
);

// Your LCD is 16x2
LiquidCrystal_I2C lcd(
  0x27,
  16,
  2
);

RTC_DS3231 rtc;

// ============================================================================
// 6. SYSTEM VARIABLES
// ============================================================================

String deviceId = "";

bool rtcReady = false;
bool sdReady = false;
bool emergencyStop = false;

unsigned long lastHeartbeat = 0;
unsigned long lastWiFiCheck = 0;
unsigned long lastScanTime = 0;

String lastUID = "";

const unsigned long HEARTBEAT_INTERVAL = 60000;
const unsigned long WIFI_RETRY_INTERVAL = 10000;
const unsigned long RFID_COOLDOWN = 2000;

// ============================================================================
// 7. LCD FUNCTIONS
// ============================================================================

void lcdMessage(
  String line1,
  String line2
)
{
  lcd.clear();

  if (line1.length() > 16)
  {
    line1 = line1.substring(0, 16);
  }

  if (line2.length() > 16)
  {
    line2 = line2.substring(0, 16);
  }

  lcd.setCursor(0, 0);
  lcd.print(line1);

  lcd.setCursor(0, 1);
  lcd.print(line2);
}

// ============================================================================
// 8. BUZZER
// ============================================================================

void beepScan()
{
  tone(
    PIN_BUZZER,
    2000,
    80
  );
}

void beepSuccess()
{
  tone(
    PIN_BUZZER,
    2000,
    80
  );

  delay(100);

  tone(
    PIN_BUZZER,
    3000,
    100
  );
}

void beepError()
{
  tone(
    PIN_BUZZER,
    500,
    200
  );

  delay(250);

  tone(
    PIN_BUZZER,
    300,
    200
  );
}

// ============================================================================
// 9. LED FUNCTIONS
// ============================================================================

void setLeds(
  bool green,
  bool yellow,
  bool red
)
{
  digitalWrite(
    PIN_LED_GREEN,
    green ? HIGH : LOW
  );

  digitalWrite(
    PIN_LED_YELLOW,
    yellow ? HIGH : LOW
  );

  digitalWrite(
    PIN_LED_RED,
    red ? HIGH : LOW
  );
}

void showStatusLeds(
  String status
)
{
  if (status == "available")
  {
    setLeds(
      true,
      false,
      false
    );
  }
  else if (status == "in_use")
  {
    setLeds(
      false,
      true,
      false
    );
  }
  else if (status == "fault")
  {
    setLeds(
      false,
      false,
      true
    );
  }
  else if (status == "maintenance")
  {
    setLeds(
      false,
      true,
      true
    );
  }
  else
  {
    setLeds(
      false,
      false,
      true
    );
  }
}

// ============================================================================
// 10. RFID UID
// ============================================================================

String uidToString(
  MFRC522::Uid &uid
)
{
  String result = "";

  for (
    byte i = 0;
    i < uid.size;
    i++
  )
  {
    if (
      uid.uidByte[i] < 0x10
    )
    {
      result += "0";
    }

    result += String(
      uid.uidByte[i],
      HEX
    );
  }

  result.toUpperCase();

  return result;
}

// ============================================================================
// 11. RTC
// ============================================================================

String getTimestamp()
{
  if (!rtcReady)
  {
    return "";
  }

  DateTime now =
    rtc.now();

  char buffer[25];

  snprintf(
    buffer,
    sizeof(buffer),
    "%04d-%02d-%02dT%02d:%02d:%02d",
    now.year(),
    now.month(),
    now.day(),
    now.hour(),
    now.minute(),
    now.second()
  );

  return String(buffer);
}

// ============================================================================
// 12. WIFI CONNECTION
// ============================================================================

bool connectWiFi()
{
  Serial.println();
  Serial.println(
    "========================================"
  );
  Serial.println(
    "CONNECTING TO WIFI"
  );
  Serial.println(
    "========================================"
  );

  Serial.print(
    "SSID: "
  );

  Serial.println(
    WIFI_SSID
  );

  lcdMessage(
    "Connecting WiFi",
    ""
  );

  WiFi.mode(
    WIFI_STA
  );

  WiFi.disconnect(
    true
  );

  delay(500);

  WiFi.begin(
    WIFI_SSID,
    WIFI_PASSWORD
  );

  int attempts = 0;

  while (
    WiFi.status() != WL_CONNECTED &&
    attempts < 30
  )
  {
    delay(500);

    Serial.print(
      "."
    );

    lcd.setCursor(
      attempts % 16,
      1
    );

    lcd.print(
      "."
    );

    attempts++;
  }

  Serial.println();

  if (
    WiFi.status() == WL_CONNECTED
  )
  {
    Serial.println(
      "WIFI CONNECTED!"
    );

    Serial.print(
      "IP: "
    );

    Serial.println(
      WiFi.localIP()
    );

    Serial.print(
      "Gateway: "
    );

    Serial.println(
      WiFi.gatewayIP()
    );

    Serial.print(
      "RSSI: "
    );

    Serial.println(
      WiFi.RSSI()
    );

    lcdMessage(
      "WiFi Connected",
      WiFi.localIP().toString()
    );

    beepSuccess();

    delay(1500);

    return true;
  }

  Serial.println(
    "WIFI CONNECTION FAILED"
  );

  Serial.print(
    "WiFi status: "
  );

  Serial.println(
    WiFi.status()
  );

  lcdMessage(
    "WiFi FAILED",
    "Check WiFi"
  );

  beepError();

  delay(2000);

  return false;
}

// ============================================================================
// 13. WIFI RECONNECT
// ============================================================================

void reconnectWiFi()
{
  if (
    WiFi.status() ==
    WL_CONNECTED
  )
  {
    return;
  }

  if (
    millis() - lastWiFiCheck <
    WIFI_RETRY_INTERVAL
  )
  {
    return;
  }

  lastWiFiCheck =
    millis();

  Serial.println();
  Serial.println(
    "WiFi disconnected."
  );

  Serial.println(
    "Trying to reconnect..."
  );

  WiFi.disconnect();

  delay(300);

  WiFi.begin(
    WIFI_SSID,
    WIFI_PASSWORD
  );
}

// ============================================================================
// 14. SUPABASE HTTP REQUEST
// ============================================================================

String supabaseRequest(
  String method,
  String path,
  String body
)
{
  if (
    WiFi.status() != WL_CONNECTED
  )
  {
    Serial.println(
      "SUPABASE ERROR: WiFi disconnected"
    );

    return "";
  }

  WiFiClientSecure client;

  // HTTPS certificate verification disabled
  // for ESP32 compatibility.
  client.setInsecure();

  HTTPClient http;

  String url =
    String(SUPABASE_URL) +
    path;

  Serial.println();
  Serial.println(
    "========================================"
  );

  Serial.println(
    "SUPABASE REQUEST"
  );

  Serial.print(
    "METHOD: "
  );

  Serial.println(
    method
  );

  Serial.print(
    "URL: "
  );

  Serial.println(
    url
  );

  if (
    !http.begin(
      client,
      url
    )
  )
  {
    Serial.println(
      "ERROR: HTTP begin failed"
    );

    return "";
  }

  // --------------------------------------------------------------------------
  // HEADERS
  // --------------------------------------------------------------------------

  http.addHeader(
    "apikey",
    SUPABASE_KEY
  );

  http.addHeader(
    "Authorization",
    "Bearer " +
    String(SUPABASE_KEY)
  );

  http.addHeader(
    "Content-Type",
    "application/json"
  );

  http.addHeader(
    "Accept",
    "application/json"
  );

  http.addHeader(
    "Prefer",
    "return=representation"
  );

  http.setTimeout(
    15000
  );

  // --------------------------------------------------------------------------
  // REQUEST
  // --------------------------------------------------------------------------

  int httpCode = -1;

  if (
    method == "GET"
  )
  {
    httpCode =
      http.GET();
  }
  else if (
    method == "POST"
  )
  {
    httpCode =
      http.POST(
        body
      );
  }
  else if (
    method == "PATCH"
  )
  {
    httpCode =
      http.PATCH(
        body
      );
  }
  else
  {
    Serial.println(
      "ERROR: Unsupported method"
    );

    http.end();

    return "";
  }

  String response =
    http.getString();

  Serial.print(
    "HTTP STATUS: "
  );

  Serial.println(
    httpCode
  );

  Serial.print(
    "RESPONSE: "
  );

  Serial.println(
    response
  );

  if (
    httpCode < 0
  )
  {
    Serial.print(
      "HTTP ERROR: "
    );

    Serial.println(
      http.errorToString(
        httpCode
      )
    );
  }

  // --------------------------------------------------------------------------
  // INTERPRET COMMON ERRORS
  // --------------------------------------------------------------------------

  if (
    httpCode == 400
  )
  {
    Serial.println(
      ">>> HTTP 400: Database request/data problem."
    );
  }

  if (
    httpCode == 401
  )
  {
    Serial.println(
      ">>> HTTP 401: Authentication/API key problem."
    );
  }

  if (
    httpCode == 403
  )
  {
    Serial.println(
      ">>> HTTP 403: RLS/policy permission problem."
    );
  }

  if (
    httpCode == 404
  )
  {
    Serial.println(
      ">>> HTTP 404: Table/API endpoint not found."
    );
  }

  if (
    httpCode >= 500
  )
  {
    Serial.println(
      ">>> Supabase server/database error."
    );
  }

  Serial.println(
    "========================================"
  );

  http.end();

  if (httpCode < 200 || httpCode >= 300)
  {
    Serial.println("SUPABASE REQUEST FAILED");
    return "";
  }

  return response;
}

// ============================================================================
// 15. SUPABASE GET
// ============================================================================

String supabaseGet(
  String path
)
{
  return supabaseRequest(
    "GET",
    path,
    ""
  );
}

// ============================================================================
// 16. SUPABASE POST
// ============================================================================

String supabasePost(
  String path,
  String body
)
{
  return supabaseRequest(
    "POST",
    path,
    body
  );
}

// ============================================================================
// 17. SUPABASE PATCH
// ============================================================================

String supabasePatch(
  String path,
  String body
)
{
  return supabaseRequest(
    "PATCH",
    path,
    body
  );
}

// ============================================================================
// 18. TEST SUPABASE
// ============================================================================

bool testSupabase()
{
  Serial.println();
  Serial.println(
    "========================================"
  );

  Serial.println(
    "TESTING SUPABASE DATABASE"
  );

  Serial.println(
    "========================================"
  );

  String response =
    supabaseGet(
      "/rest/v1/devices?select=id&limit=1"
    );

  if (
    response.length() > 0
  )
  {
    Serial.println(
      "SUPABASE DATABASE REACHABLE"
    );

    return true;
  }

  Serial.println(
    "SUPABASE DATABASE TEST FAILED"
  );

  return false;
}

// ============================================================================
// 19. REGISTER DEVICE
// ============================================================================

bool registerDevice()
{
  Serial.println();
  Serial.println(
    "========================================"
  );

  Serial.println(
    "REGISTERING DEVICE"
  );

  Serial.println(
    "========================================"
  );

  /*
   * Query the devices table.
   *
   * We use device_name exactly as your original
   * firmware does.
   */

  String path =
    "/rest/v1/devices"
    "?select=id,device_name"
    "&device_name=eq.Workshop%20Controller";

  String response =
    supabaseGet(
      path
    );

  if (
    response.length() == 0
  )
  {
    Serial.println(
      "No response from devices table."
    );

    return false;
  }

  DynamicJsonDocument doc(
    2048
  );

  DeserializationError error =
    deserializeJson(
      doc,
      response
    );

  if (
    error
  )
  {
    Serial.print(
      "JSON ERROR: "
    );

    Serial.println(
      error.c_str()
    );

    return false;
  }

  // --------------------------------------------------------------------------
  // DEVICE EXISTS
  // --------------------------------------------------------------------------

  if (
    doc.is<JsonArray>() &&
    doc.size() > 0
  )
  {
    deviceId =
      doc[0]["id"].as<String>();

    Serial.print(
      "EXISTING DEVICE ID: "
    );

    Serial.println(
      deviceId
    );

    return true;
  }

  // --------------------------------------------------------------------------
  // CREATE DEVICE
  // --------------------------------------------------------------------------

  Serial.println(
    "Device does not exist."
  );

  Serial.println(
    "Creating device..."
  );

  DynamicJsonDocument body(
    1024
  );

  body["device_name"] =
    DEVICE_NAME;

  body["location"] =
    DEVICE_LOCATION;

  body["firmware_version"] =
    FIRMWARE_VERSION;

  String timestamp =
    getTimestamp();

  if (
    timestamp.length() > 0
  )
  {
    body["last_seen"] =
      timestamp;
  }

  String jsonBody;

  serializeJson(
    body,
    jsonBody
  );

  Serial.print(
    "POST BODY: "
  );

  Serial.println(
    jsonBody
  );

  String result =
    supabasePost(
      "/rest/v1/devices",
      jsonBody
    );

  if (
    result.length() == 0
  )
  {
    Serial.println(
      "Device creation failed."
    );

    return false;
  }

  DynamicJsonDocument resultDoc(
    2048
  );

  error =
    deserializeJson(
      resultDoc,
      result
    );

  if (
    error
  )
  {
    Serial.print(
      "JSON ERROR: "
    );

    Serial.println(
      error.c_str()
    );

    return false;
  }

  if (
    resultDoc.is<JsonArray>() &&
    resultDoc.size() > 0
  )
  {
    deviceId =
      resultDoc[0]["id"].as<String>();

    Serial.print(
      "NEW DEVICE ID: "
    );

    Serial.println(
      deviceId
    );

    return true;
  }

  Serial.println(
    "Supabase did not return a device ID."
  );

  return false;
}

// ============================================================================
// 20. HEARTBEAT
// ============================================================================

void sendHeartbeat()
{
  if (
    deviceId.length() == 0
  )
  {
    Serial.println(
      "Heartbeat skipped: no device ID."
    );

    return;
  }

  String timestamp =
    getTimestamp();

  if (
    timestamp.length() == 0
  )
  {
    Serial.println(
      "Heartbeat skipped: RTC unavailable."
    );

    return;
  }

  DynamicJsonDocument body(
    512
  );

  body["last_seen"] =
    timestamp;

  String jsonBody;

  serializeJson(
    body,
    jsonBody
  );

  String path =
    "/rest/v1/devices?id=eq." +
    deviceId;

  String response =
    supabasePatch(
      path,
      jsonBody
    );

  if (
    response.length() > 0
  )
  {
    Serial.println(
      "HEARTBEAT SENT"
    );
  }
}

// ============================================================================
// 21. FIND EQUIPMENT BY RFID
// ============================================================================

bool findEquipment(
  String uid,
  String &equipmentId,
  String &equipmentName,
  String &equipmentStatus
)
{
  String path =
    "/rest/v1/equipment"
    "?select=*"
    "&rfid_uid=eq." +
    uid;

  String response =
    supabaseGet(
      path
    );

  if (
    response.length() == 0
  )
  {
    return false;
  }

  DynamicJsonDocument doc(
    4096
  );

  DeserializationError error =
    deserializeJson(
      doc,
      response
    );

  if (
    error
  )
  {
    Serial.print(
      "Equipment JSON error: "
    );

    Serial.println(
      error.c_str()
    );

    return false;
  }

  if (
    !doc.is<JsonArray>() ||
    doc.size() == 0
  )
  {
    return false;
  }

  JsonObject equipment =
    doc[0].as<JsonObject>();

  equipmentId =
    equipment["id"].as<String>();

  equipmentName =
    equipment["name"].as<String>();

  equipmentStatus =
    equipment["status"].as<String>();

  return true;
}

// ============================================================================
// 22. UPDATE EQUIPMENT
// ============================================================================

bool updateEquipment(
  String equipmentId,
  String newStatus
)
{
  DynamicJsonDocument body(
    512
  );

  body["status"] =
    newStatus;

  String timestamp =
    getTimestamp();

  if (
    timestamp.length() > 0
  )
  {
    body["last_scanned_at"] =
      timestamp;
  }

  if (
    deviceId.length() > 0
  )
  {
    body["last_scanned_by_device"] =
      deviceId;
  }

  String jsonBody;

  serializeJson(
    body,
    jsonBody
  );

  Serial.print(
    "UPDATE BODY: "
  );

  Serial.println(
    jsonBody
  );

  String path =
    "/rest/v1/equipment?id=eq." +
    equipmentId;

  String response =
    supabasePatch(
      path,
      jsonBody
    );

  if (response.length() == 0)
  {
    return false;
  }

  DynamicJsonDocument result(2048);
  DeserializationError error = deserializeJson(result, response);

  if (error || !result.is<JsonArray>() || result.size() == 0)
  {
    Serial.println("Equipment update did not confirm a matching row.");
    return false;
  }

  return true;
}

// ============================================================================
// 23. LOG SCAN
// ============================================================================

bool logScan(
  String uid,
  String action,
  String equipmentId
)
{
  DynamicJsonDocument body(
    1024
  );

  if (
    equipmentId.length() > 0
  )
  {
    body["equipment_id"] =
      equipmentId;
  }

  body["rfid_uid"] =
    uid;

  body["action"] =
    action;

  if (
    deviceId.length() > 0
  )
  {
    body["device_id"] =
      deviceId;
  }

  String timestamp =
    getTimestamp();

  if (
    timestamp.length() > 0
  )
  {
    body["device_timestamp"] =
      timestamp;
  }

  String jsonBody;

  serializeJson(
    body,
    jsonBody
  );

  Serial.print(
    "SCAN LOG: "
  );

  Serial.println(
    jsonBody
  );

  String response =
    supabasePost(
      "/rest/v1/scan_logs",
      jsonBody
    );

  return response.length() > 0;
}

// ============================================================================
// 24. BORROW REQUEST WORKFLOW
// ============================================================================
//
// The web dashboard stores requests in `borrows`, keyed by the RFID UID.
// Its schema has id, rfid_uid, item_name, return_date, status, and created_at.
//
// The ESP32 approves a pending request with one atomic database operation.
//

bool findPendingBorrowRequest(
  String rfidUid,
  String &requestId
)
{
  requestId = "";

  String path =
    "/rest/v1/borrows"
    "?select=id"
    "&rfid_uid=eq." +
    rfidUid +
    "&status=eq.pending"
    "&order=created_at.desc"
    "&limit=1";

  String response = supabaseGet(path);

  if (response.length() == 0)
  {
    return false;
  }

  DynamicJsonDocument doc(2048);

  DeserializationError error =
    deserializeJson(doc, response);

  if (error)
  {
    Serial.print("Pending request JSON error: ");
    Serial.println(error.c_str());
    return false;
  }

  if (!doc.is<JsonArray>() || doc.size() == 0)
  {
    return false;
  }

  requestId = doc[0]["id"].as<String>();

  return requestId.length() > 0;
}

bool approveBorrowRequest(
  String requestId,
  String rfidUid
)
{
  DynamicJsonDocument body(1024);
  body["p_request_id"] = requestId;
  body["p_rfid_uid"] = rfidUid;

  String jsonBody;
  serializeJson(body, jsonBody);

  String response = supabasePost(
    "/rest/v1/rpc/approve_borrow_request",
    jsonBody
  );

  if (response.length() == 0)
  {
    Serial.println("Borrow approval RPC returned no response.");
    return false;
  }

  DynamicJsonDocument result(2048);
  DeserializationError error = deserializeJson(result, response);

  if (error)
  {
    Serial.print("Borrow approval response JSON error: ");
    Serial.println(error.c_str());
    return false;
  }

  if (!result["approved"].as<bool>())
  {
    Serial.print("Borrow approval rejected: ");
    Serial.println(result["error"].as<String>());
    return false;
  }

  return true;
}

void showBorrowWaiting()
{
  lcd.clear();

  lcd.setCursor(0, 0);
  lcd.print("BORROW REQUEST");

  lcd.setCursor(0, 1);
  lcd.print("Scan RFID Tag");

  lcd.setCursor(0, 2);
  lcd.print("to approve");

  lcd.setCursor(0, 3);
  lcd.print("request");
}

void showBorrowApproved(String equipmentName)
{
  lcd.clear();

  lcd.setCursor(0, 0);
  lcd.print("BORROW APPROVED");

  lcd.setCursor(0, 1);
  lcd.print("Equipment:");

  if (equipmentName.length() > 20)
    equipmentName = equipmentName.substring(0, 20);

  lcd.setCursor(0, 2);
  lcd.print(equipmentName);

  lcd.setCursor(0, 3);
  lcd.print("Status: IN USE");
}

// ============================================================================
// 25. SD BACKUP
// ============================================================================


void logToSD(
  String uid,
  String action,
  String equipmentName
)
{
  if (!sdReady)
  {
    return;
  }

  String timestamp =
    getTimestamp();

  if (
    timestamp.length() == 0
  )
  {
    timestamp =
      "NO_RTC";
  }

  String entry =
    timestamp +
    "," +
    uid +
    "," +
    action +
    "," +
    equipmentName;

  File file =
    SD.open(
      "/scans.csv",
      FILE_APPEND
    );

  if (
    file
  )
  {
    file.println(
      entry
    );

    file.close();

    Serial.println(
      "SD BACKUP SAVED"
    );
  }
}

// ============================================================================
// 26. PROCESS RFID
// ============================================================================

void processScan(
  String uid
)
{
  Serial.println();
  Serial.println("========================================");
  Serial.println("PROCESSING RFID");
  Serial.print("UID: ");
  Serial.println(uid);
  Serial.println("========================================");

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("RFID DETECTED");
  lcd.setCursor(0, 1);
  lcd.print("Checking...");
  lcd.setCursor(0, 2);
  lcd.print("UID:");
  lcd.setCursor(0, 3);

  String shortUID = uid;
  if (shortUID.length() > 20)
    shortUID = shortUID.substring(0, 20);

  lcd.print(shortUID);

  String equipmentId = "";
  String equipmentName = "";
  String equipmentStatus = "";

  bool found =
    findEquipment(
      uid,
      equipmentId,
      equipmentName,
      equipmentStatus
    );

  // --------------------------------------------------------------------------
  // UNKNOWN TAG
  // --------------------------------------------------------------------------

  if (!found)
  {
    Serial.println("UNKNOWN RFID TAG");

    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("UNKNOWN RFID");
    lcd.setCursor(0, 1);
    lcd.print("Tag not registered");
    lcd.setCursor(0, 2);
    lcd.print("UID:");
    lcd.setCursor(0, 3);
    lcd.print(shortUID);

    setLeds(false, false, true);
    beepError();

    logScan(
      uid,
      "unknown_tag",
      ""
    );

    logToSD(
      uid,
      "unknown_tag",
      "Unknown Tag"
    );

    delay(2500);
    return;
  }

  Serial.print("Equipment ID: ");
  Serial.println(equipmentId);

  Serial.print("Equipment Name: ");
  Serial.println(equipmentName);

  Serial.print("Current Status: ");
  Serial.println(equipmentStatus);

  // --------------------------------------------------------------------------
  // BORROW APPROVAL
  // --------------------------------------------------------------------------
  //
  // IMPORTANT:
  // An AVAILABLE item is NOT automatically borrowed anymore.
  // A pending web/dashboard request must exist first.
  //

  if (equipmentStatus == "available")
  {
    String requestId = "";

    bool pendingRequest =
      findPendingBorrowRequest(
        uid,
        requestId
      );

    if (!pendingRequest)
    {
      Serial.println("NO PENDING BORROW REQUEST");

      lcd.clear();
      lcd.setCursor(0, 0);
      lcd.print("NO BORROW REQUEST");
      lcd.setCursor(0, 1);
      lcd.print("Equipment:");
      lcd.setCursor(0, 2);

      String displayName = equipmentName;
      if (displayName.length() > 20)
        displayName = displayName.substring(0, 20);

      lcd.print(displayName);
      lcd.setCursor(0, 3);
      lcd.print("Submit form first");

      setLeds(true, false, false);
      beepError();

      logScan(
        uid,
        "no_pending_request",
        equipmentId
      );

      logToSD(
        uid,
        "no_pending_request",
        equipmentName
      );

      delay(2500);
      return;
    }

    Serial.print("PENDING REQUEST FOUND: ");
    Serial.println(requestId);

    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("REQUEST FOUND");
    lcd.setCursor(0, 1);
    lcd.print("Approving...");
    lcd.setCursor(0, 2);
    lcd.print("Please wait");

    // Approve the request and mark its equipment in use atomically.
    bool requestOK =
      approveBorrowRequest(
        requestId,
        uid
      );

    if (!requestOK)
    {
      Serial.println("BORROW REQUEST APPROVAL FAILED");

      lcd.clear();
      lcd.setCursor(0, 0);
      lcd.print("APPROVAL FAILED");
      lcd.setCursor(0, 1);
      lcd.print("Request not saved");
      lcd.setCursor(0, 2);
      lcd.print("Try scan again");

      setLeds(false, false, true);
      beepError();

      logScan(
        uid,
        "approval_failed",
        equipmentId
      );

      delay(2500);
      return;
    }

    // Log the successful borrow.
    bool logOK =
      logScan(
        uid,
        "borrow_approved",
        equipmentId
      );

    logToSD(
      uid,
      "borrow_approved",
      equipmentName
    );

    Serial.print("BORROW APPROVED. LOG: ");
    Serial.println(logOK ? "OK" : "FAILED");

    showBorrowApproved(equipmentName);

    showStatusLeds("in_use");

    beepSuccess();

    Serial.println("========================================");
    Serial.println("BORROW APPROVAL COMPLETE");
    Serial.println("Equipment: IN USE");
    Serial.println("Request: APPROVED");
    Serial.println("========================================");

    delay(3000);
    return;
  }

  // --------------------------------------------------------------------------
  // RETURN
  // --------------------------------------------------------------------------
  //
  // An in-use equipment scan records a return attempt. Only the admin
  // dashboard can complete the return and make the equipment available.
  //

  if (equipmentStatus == "in_use")
  {
    Serial.println("RETURN SCAN RECORDED; ADMIN CONFIRMATION REQUIRED");

    bool logOK = logScan(
      uid,
      "return_pending_admin",
      equipmentId
    );

    if (!logOK)
    {
      Serial.println("WARNING: Return scan could not be saved.");
    }

    logToSD(
      uid,
      "return_pending_admin",
      equipmentName
    );

    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("RETURN SCANNED");
    lcd.setCursor(0, 1);
    lcd.print("Ask admin to");
    lcd.setCursor(0, 2);
    lcd.print("mark returned");

    setLeds(false, true, false);
    beepScan();

    Serial.println("Equipment remains IN USE until admin marks returned.");
    delay(3000);
    return;
  }

  // --------------------------------------------------------------------------
  // FAULT / MAINTENANCE / OTHER STATUS
  // --------------------------------------------------------------------------

  Serial.println("EQUIPMENT NOT BORROWABLE/RETURNABLE");
  Serial.print("Status: ");
  Serial.println(equipmentStatus);

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("EQUIPMENT BLOCKED");

  lcd.setCursor(0, 1);
  String displayName = equipmentName;
  if (displayName.length() > 20)
    displayName = displayName.substring(0, 20);
  lcd.print(displayName);

  lcd.setCursor(0, 2);
  lcd.print("STATUS:");

  String statusDisplay = equipmentStatus;
  statusDisplay.toUpperCase();

  if (statusDisplay.length() > 13)
    statusDisplay = statusDisplay.substring(0, 13);

  lcd.print(statusDisplay);

  lcd.setCursor(0, 3);
  lcd.print("Cannot borrow");

  setLeds(
    false,
    false,
    true
  );

  beepError();

  logScan(
    uid,
    "blocked_scan",
    equipmentId
  );

  logToSD(
    uid,
    "blocked_scan",
    equipmentName
  );

  delay(2500);
}

// ============================================================================
// 27. EMERGENCY STOP
// ============================================================================

void checkEmergencyStop()
{
  if (
    digitalRead(PIN_ESTOP) == LOW &&
    !emergencyStop
  )
  {
    emergencyStop =
      true;

    digitalWrite(
      PIN_RELAY,
      LOW
    );

    setLeds(
      false,
      false,
      true
    );

    lcdMessage(
      "EMERGENCY STOP",
      "SYSTEM HALTED"
    );

    beepError();

    Serial.println(
      "!!! EMERGENCY STOP !!!"
    );
  }
}

// ============================================================================
// 28. EMERGENCY RESET
// ============================================================================

void checkEmergencyReset()
{
  if (
    emergencyStop &&
    digitalRead(PIN_ESTOP) == HIGH
  )
  {
    emergencyStop =
      false;

    digitalWrite(
      PIN_RELAY,
      HIGH
    );

    setLeds(
      true,
      false,
      false
    );

    lcdMessage(
      "System Reset",
      "Ready to Scan"
    );

    beepSuccess();

    Serial.println(
      "Emergency Stop Released"
    );

    delay(1000);
  }
}

// ============================================================================
// 29. SETUP
// ============================================================================

void setup()
{
  Serial.begin(
    115200
  );

  delay(1000);

  Serial.println();
  Serial.println();
  Serial.println(
    "=============================================="
  );

  Serial.println(
    " EQUIPMENT TRACKING SYSTEM"
  );

  Serial.println(
    " ESP32-S3 + SUPABASE"
  );

  Serial.println(
    "=============================================="
  );

  // ==========================================================================
  // OUTPUTS
  // ==========================================================================

  pinMode(
    PIN_BUZZER,
    OUTPUT
  );

  pinMode(
    PIN_LED_GREEN,
    OUTPUT
  );

  pinMode(
    PIN_LED_YELLOW,
    OUTPUT
  );

  pinMode(
    PIN_LED_RED,
    OUTPUT
  );

  pinMode(
    PIN_RELAY,
    OUTPUT
  );

  // ==========================================================================
  // ESTOP
  // ==========================================================================

  pinMode(
    PIN_ESTOP,
    INPUT_PULLUP
  );

  // ==========================================================================
  // RELAY
  // ==========================================================================

  digitalWrite(
    PIN_RELAY,
    HIGH
  );

  // ==========================================================================
  // RED LED DURING BOOT
  // ==========================================================================

  setLeds(
    false,
    false,
    true
  );

  // ==========================================================================
  // I2C
  // ==========================================================================

  Serial.println(
    "Starting I2C..."
  );

  Wire.begin(
    PIN_I2C_SDA,
    PIN_I2C_SCL
  );

  // ==========================================================================
  // LCD
  // ==========================================================================

  lcd.init();

  lcd.backlight();

  lcdMessage(
    "Equipment Tracker",
    "Booting..."
  );

  Serial.println(
    "LCD OK"
  );

  // ==========================================================================
  // RTC
  // ==========================================================================

  Serial.println(
    "Starting DS3231..."
  );

  if (
    rtc.begin()
  )
  {
    rtcReady =
      true;

    Serial.println(
      "RTC OK"
    );

    if (
      rtc.lostPower()
    )
    {
      Serial.println(
        "RTC lost power."
      );

      rtc.adjust(
        DateTime(
          F(__DATE__),
          F(__TIME__)
        )
      );
    }

    Serial.print(
      "RTC: "
    );

    Serial.println(
      getTimestamp()
    );
  }
  else
  {
    rtcReady =
      false;

    Serial.println(
      "RTC NOT FOUND"
    );
  }

  // ==========================================================================
  // SPI
  // ==========================================================================

  Serial.println(
    "Starting SPI..."
  );

  SPI.begin(
    PIN_SPI_SCK,
    PIN_SPI_MISO,
    PIN_SPI_MOSI,
    PIN_RFID_SS
  );

  Serial.println(
    "SPI OK"
  );

  // ==========================================================================
  // RFID
  // ==========================================================================

  Serial.println(
    "Starting RFID..."
  );

  rfid.PCD_Init();

  delay(100);

  Serial.println(
    "MFRC522 OK"
  );

  // ==========================================================================
  // SD
  // ==========================================================================

  Serial.println(
    "Starting SD..."
  );

  if (
    SD.begin(
      PIN_SD_CS
    )
  )
  {
    sdReady =
      true;

    Serial.println(
      "SD OK"
    );

    if (
      !SD.exists(
        "/scans.csv"
      )
    )
    {
      File file =
        SD.open(
          "/scans.csv",
          FILE_WRITE
        );

      if (file)
      {
        file.println(
          "timestamp,uid,action,equipment"
        );

        file.close();
      }
    }
  }
  else
  {
    sdReady =
      false;

    Serial.println(
      "SD not detected."
    );

    Serial.println(
      "Continuing without SD."
    );
  }

  // ==========================================================================
  // WIFI
  // ==========================================================================

  bool wifiConnected =
    connectWiFi();

  // ==========================================================================
  // SUPABASE
  // ==========================================================================

  if (
    wifiConnected
  )
  {
    // ------------------------------------------------------------------------
    // Test database
    // ------------------------------------------------------------------------

    lcdMessage(
      "Testing Database",
      "Please wait..."
    );

    bool databaseOK =
      testSupabase();

    if (
      !databaseOK
    )
    {
      Serial.println();
      Serial.println(
        "DATABASE TEST FAILED"
      );

      lcdMessage(
        "Database Error",
        "Check Serial"
      );

      delay(2500);
    }

    // ------------------------------------------------------------------------
    // Register device
    // ------------------------------------------------------------------------

    lcdMessage(
      "Connecting DB",
      "Registering..."
    );

    bool registered =
      registerDevice();

    if (
      registered
    )
    {
      Serial.println();
      Serial.println(
        "========================================"
      );

      Serial.println(
        "SUPABASE CONNECTED"
      );

      Serial.print(
        "DEVICE ID: "
      );

      Serial.println(
        deviceId
      );

      Serial.println(
        "========================================"
      );
    }
    else
    {
      Serial.println();
      Serial.println(
        "DEVICE REGISTRATION FAILED"
      );

      lcdMessage(
        "DB Registration",
        "FAILED"
      );

      delay(2500);
    }
  }

  // ==========================================================================
  // READY
  // ==========================================================================

  setLeds(
    true,
    false,
    false
  );

  showBorrowWaiting();

  Serial.println();
  Serial.println(
    "=============================================="
  );

  Serial.println(
    "SYSTEM READY"
  );

  Serial.println(
    "=============================================="
  );

  Serial.print(
    "WiFi: "
  );

  Serial.println(
    WiFi.status() ==
    WL_CONNECTED
      ? "CONNECTED"
      : "DISCONNECTED"
  );

  Serial.print(
    "Supabase Device ID: "
  );

  if (
    deviceId.length() > 0
  )
  {
    Serial.println(
      deviceId
    );
  }
  else
  {
    Serial.println(
      "NONE"
    );
  }

  Serial.print(
    "RTC: "
  );

  Serial.println(
    rtcReady
      ? "OK"
      : "NOT FOUND"
  );

  Serial.print(
    "SD: "
  );

  Serial.println(
    sdReady
      ? "OK"
      : "NOT FOUND"
  );

  Serial.println();
}

// ============================================================================
// 30. LOOP
// ============================================================================

void loop()
{
  // ==========================================================================
  // EMERGENCY STOP
  // ==========================================================================

  checkEmergencyStop();

  if (
    emergencyStop
  )
  {
    checkEmergencyReset();

    delay(50);

    return;
  }

  // ==========================================================================
  // WIFI
  // ==========================================================================

  if (
    WiFi.status() != WL_CONNECTED
  )
  {
    reconnectWiFi();

    delay(50);

    return;
  }

  // ==========================================================================
  // HEARTBEAT
  // ==========================================================================

  if (
    millis() - lastHeartbeat >
    HEARTBEAT_INTERVAL
  )
  {
    Serial.println(
      "Sending heartbeat..."
    );

    sendHeartbeat();

    lastHeartbeat =
      millis();
  }

  // ==========================================================================
  // RFID
  // ==========================================================================

  if (
    !rfid.PICC_IsNewCardPresent()
  )
  {
    delay(50);

    return;
  }

  if (
    !rfid.PICC_ReadCardSerial()
  )
  {
    delay(50);

    return;
  }

  digitalWrite(
    PIN_LED_YELLOW,
    HIGH
  );

  // ==========================================================================
  // READ UID
  // ==========================================================================

  String uid =
    uidToString(
      rfid.uid
    );

  Serial.println();
  Serial.print(
    "RFID UID: "
  );

  Serial.println(
    uid
  );

  // ==========================================================================
  // STOP RFID
  // ==========================================================================

  rfid.PICC_HaltA();

  rfid.PCD_StopCrypto1();

  // ==========================================================================
  // DUPLICATE SCAN PROTECTION
  // ==========================================================================

  if (
    uid == lastUID &&
    millis() - lastScanTime <
    RFID_COOLDOWN
  )
  {
    Serial.println(
      "Duplicate RFID ignored."
    );

    digitalWrite(
      PIN_LED_YELLOW,
      LOW
    );

    return;
  }

  lastUID =
    uid;

  lastScanTime =
    millis();

  // ==========================================================================
  // PROCESS
  // ==========================================================================

  beepScan();

  delay(50);

  processScan(
    uid
  );

  // ==========================================================================
  // READY
  // ==========================================================================

  showBorrowWaiting();

  setLeds(
    true,
    false,
    false
  );

  delay(500);
}