// ============================================================
//  IR Entry/Exit Counter — ESP32 + SIM800L → HTTP Server
//  Sensor A (Pin 12) = Outer  |  Sensor B (Pin 13) = Inner
//  Entry:  A breaks first → then B
//  Exit:   B breaks first → then A
// ============================================================

#include <HardwareSerial.h>

// --- IR Sensor Pins ---
const int SENSOR_A_PIN = 12;
const int SENSOR_B_PIN = 13;

// --- SIM800L Serial (UART2) ---
HardwareSerial sim800(2);          // RX=GPIO16, TX=GPIO17
#define SIM_RX 16
#define SIM_TX 17
#define SIM_RST 5                  // Optional reset pin

// --- Replace with your Railway server URL ---
const char* SERVER_HOST = "your-app.up.railway.app";  // No https://
const int   SERVER_PORT = 80;
const char* SERVER_PATH = "/event";

// --- State machine ---
int firstBroken       = 0;
int prevA             = HIGH;
int prevB             = HIGH;
int peopleCount       = 0;

unsigned long lastEventTime     = 0;
unsigned long sequenceStartTime = 0;
const unsigned long DEBOUNCE_MS = 200;
const unsigned long TIMEOUT_MS  = 3000;

// ============================================================
void setup() {
  Serial.begin(115200);
  pinMode(SENSOR_A_PIN, INPUT);
  pinMode(SENSOR_B_PIN, INPUT);

  sim800.begin(9600, SERIAL_8N1, SIM_RX, SIM_TX);
  delay(3000);

  Serial.println("Initializing SIM800L...");
  simInit();
}

// ============================================================
void loop() {
  int currentA = digitalRead(SENSOR_A_PIN);
  int currentB = digitalRead(SENSOR_B_PIN);
  unsigned long now = millis();

  // Timeout reset
  if (firstBroken != 0 && (now - sequenceStartTime > TIMEOUT_MS)) {
    Serial.println("[TIMEOUT] Sequence reset");
    firstBroken = 0;
  }

  bool aJustBroken = (prevA == HIGH && currentA == LOW);
  bool bJustBroken = (prevB == HIGH && currentB == LOW);

  if (firstBroken == 0) {
    if (aJustBroken && (now - lastEventTime > DEBOUNCE_MS)) {
      firstBroken = 1;
      sequenceStartTime = now;
    } else if (bJustBroken && (now - lastEventTime > DEBOUNCE_MS)) {
      firstBroken = 2;
      sequenceStartTime = now;
    }
  }
  else if (firstBroken == 1 && bJustBroken) {
    peopleCount++;
    Serial.printf("ENTRY — Count: %d\n", peopleCount);
    sendEvent("entry", peopleCount);
    lastEventTime = now;
    firstBroken = 0;
  }
  else if (firstBroken == 2 && aJustBroken) {
    peopleCount = max(0, peopleCount - 1);
    Serial.printf("EXIT  — Count: %d\n", peopleCount);
    sendEvent("exit", peopleCount);
    lastEventTime = now;
    firstBroken = 0;
  }

  prevA = currentA;
  prevB = currentB;
  delay(10);
}

// ============================================================
//  SIM800L Helpers
// ============================================================
void simInit() {
  sendAT("AT", 1000);
  sendAT("AT+CPIN?", 2000);       // Check SIM card
  sendAT("AT+CSQ", 1000);         // Signal strength
  sendAT("AT+CGATT=1", 2000);     // Attach to GPRS
  sendAT("AT+SAPBR=3,1,\"Contype\",\"GPRS\"", 1000);
  sendAT("AT+SAPBR=3,1,\"APN\",\"hologram\"", 1000); // Change APN for your carrier
  sendAT("AT+SAPBR=1,1", 5000);   // Open bearer
  sendAT("AT+SAPBR=2,1", 2000);   // Check IP
  Serial.println("SIM800L ready.");
}

void sendEvent(const char* type, int count) {
  // Build JSON body
  char body[80];
  snprintf(body, sizeof(body), "{\"type\":\"%s\",\"count\":%d}", type, count);
  int bodyLen = strlen(body);

  // Build HTTP request string
  char request[300];
  snprintf(request, sizeof(request),
    "POST %s HTTP/1.1\r\n"
    "Host: %s\r\n"
    "Content-Type: application/json\r\n"
    "Content-Length: %d\r\n"
    "Connection: close\r\n"
    "\r\n"
    "%s",
    SERVER_PATH, SERVER_HOST, bodyLen, body
  );

  // Open TCP connection
  char tcpCmd[100];
  snprintf(tcpCmd, sizeof(tcpCmd),
    "AT+CIPSTART=\"TCP\",\"%s\",%d", SERVER_HOST, SERVER_PORT);

  sendAT("AT+CIPMUX=0", 1000);
  sendAT(tcpCmd, 5000);
  delay(2000);

  // Send data length
  char sendCmd[30];
  snprintf(sendCmd, sizeof(sendCmd), "AT+CIPSEND=%d", strlen(request));
  sim800.println(sendCmd);
  delay(1000);

  // Wait for '>' prompt then send
  if (sim800.find(">")) {
    sim800.print(request);
    delay(3000);
    Serial.println("Event sent.");
  } else {
    Serial.println("CIPSEND prompt not received.");
  }

  sendAT("AT+CIPCLOSE", 1000);
}

String sendAT(const char* cmd, int timeout) {
  sim800.println(cmd);
  long start = millis();
  String response = "";
  while (millis() - start < timeout) {
    while (sim800.available()) {
      response += (char)sim800.read();
    }
  }
  Serial.print("AT >> "); Serial.println(response);
  return response;
}
