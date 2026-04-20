// ============================================================
// Pentabyte AI Coach - ESP32 Hardware Client
// Hold button to record, release to send, then play AI response.
// ============================================================

#include <Arduino.h>
#include <SPI.h>
#include <SD.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1351.h>
#include <Audio.h>
#include <driver/i2s.h>

// ============================================================
// CHANGE THESE FOR YOUR WIFI + SERVER
// ============================================================
const char* WIFI_SSID = "Minerva Schools 2.4GHz - SLOW";
const char* WIFI_PASS = "Extraordinary2014!";
// Optional backup network (leave empty to disable).
const char* WIFI_SSID_BACKUP = "";
const char* WIFI_PASS_BACKUP = "";
const char* SERVER_URL = "http://10.112.18.17:3000";

// Default coaching personality traits for ESP32-created sessions.
const char* SESSION_TRAITS = "{\"traits\":[\"empathetic\",\"encouraging\"]}";

// ============================================================
// Hardware pin map (matches your BOM)
// ============================================================

// OLED (SSD1351 on VSPI)
#define OLED_WIDTH 128
#define OLED_HEIGHT 128
#define OLED_CS 5
#define OLED_DC 21
#define OLED_RST 22

// SD card (HSPI)
#define SD_MISO 19
#define SD_MOSI 13
#define SD_SCK 14
#define SD_CS 15

// I2S microphone (I2S1 RX)
#define MIC_I2S_PORT I2S_NUM_1
#define MIC_I2S_SCK 16
#define MIC_I2S_WS 17
#define MIC_I2S_SD 34

// I2S speaker DAC (Audio library uses its own I2S output setup)
#define SPK_I2S_DOUT 25
#define SPK_I2S_BCLK 26
#define SPK_I2S_LRC 27

// Push button (active low)
#define BUTTON_PIN 4

Adafruit_SSD1351 tft = Adafruit_SSD1351(OLED_WIDTH, OLED_HEIGHT, &SPI, OLED_CS, OLED_DC, OLED_RST);
SPIClass sdSPI(HSPI);
Audio audio;

// ============================================================
// Audio format: 16 kHz, 16-bit, mono WAV
// ============================================================
static const uint32_t SAMPLE_RATE = 16000;
static const uint16_t BITS_PER_SAMPLE = 16;
static const uint16_t CHANNELS = 1;
static const size_t I2S_SAMPLES_PER_READ = 256;
static const int32_t MIC_SHIFT = 14;
static bool micI2sInstalled = false;
static int buttonIdleLevel = HIGH;
static int buttonPressedLevel = LOW;
static bool lastButtonPressed = false;
static unsigned long lastHandledPressMs = 0;
static unsigned long lastWiFiRetryMs = 0;
static unsigned long lastSessionRetryMs = 0;
static const unsigned long WIFI_RETRY_INTERVAL_MS = 12000;
static const unsigned long WIFI_AUTH_RETRY_COOLDOWN_MS = 45000;
static const unsigned long SESSION_RETRY_INTERVAL_MS = 5000;
static unsigned long wifiAuthBackoffUntilMs = 0;

String sessionId = "";
bool sessionEnded = false;
bool isPlaying = false;

void showScreen(uint16_t bg, uint16_t fg, uint8_t sz,
                int x, int y, const char* l1, const char* l2 = nullptr) {
  tft.fillScreen(bg);
  tft.setTextColor(fg);
  tft.setTextSize(sz);
  tft.setCursor(x, y);
  tft.println(l1);
  if (l2) {
    tft.setCursor(x, y + sz * 12);
    tft.println(l2);
  }
}

void defaultScreen() { showScreen(0x0000, 0xFFFF, 1, 18, 45, "HOLD BUTTON", "TO SPEAK"); }
void recordingScreen() { showScreen(0xF800, 0xFFFF, 2, 10, 54, "REC"); }
void thinkingScreen() { showScreen(0xFD20, 0x0000, 1, 17, 55, "THINKING..."); }
void speakingScreen() { showScreen(0x001F, 0xFFFF, 1, 17, 55, "SPEAKING..."); }
void sessionEndScreen() { showScreen(0x07E0, 0x0000, 1, 10, 45, "SESSION", "COMPLETE"); }
void errorScreen(const char* line2) { showScreen(0xF800, 0xFFFF, 1, 6, 52, "ERROR", line2); }

void logVisibleNetworks() {
  Serial.println("Scanning nearby WiFi networks...");
  int networkCount = WiFi.scanNetworks(false, true);

  if (networkCount <= 0) {
    Serial.println("No WiFi networks found in scan");
    return;
  }

  Serial.printf("Found %d network(s):\n", networkCount);
  for (int i = 0; i < networkCount; i++) {
    String ssid = WiFi.SSID(i);
    int rssi = WiFi.RSSI(i);
    bool encrypted = WiFi.encryptionType(i) != WIFI_AUTH_OPEN;
    Serial.printf("  %2d) %s  RSSI=%d  %s\n", i + 1, ssid.c_str(), rssi, encrypted ? "secured" : "open");
  }

  WiFi.scanDelete();
}

bool isButtonPressed() {
  return digitalRead(BUTTON_PIN) == buttonPressedLevel;
}

void detectButtonPolarity() {
  int highCount = 0;
  int lowCount = 0;

  for (int i = 0; i < 120; i++) {
    int state = digitalRead(BUTTON_PIN);
    if (state == HIGH) {
      highCount++;
    } else {
      lowCount++;
    }
    delay(5);
  }

  buttonIdleLevel = (highCount >= lowCount) ? HIGH : LOW;
  buttonPressedLevel = (buttonIdleLevel == HIGH) ? LOW : HIGH;
  lastButtonPressed = isButtonPressed();

  Serial.printf(
    "Button polarity detected. idle=%s pressed=%s\n",
    buttonIdleLevel == HIGH ? "HIGH" : "LOW",
    buttonPressedLevel == HIGH ? "HIGH" : "LOW"
  );
}

void writeWavHeader(File& file) {
  uint32_t byteRate = SAMPLE_RATE * CHANNELS * (BITS_PER_SAMPLE / 8);
  uint16_t blockAlign = CHANNELS * (BITS_PER_SAMPLE / 8);

  uint8_t header[44] = {
    'R', 'I', 'F', 'F',
    0, 0, 0, 0,
    'W', 'A', 'V', 'E',
    'f', 'm', 't', ' ',
    16, 0, 0, 0,
    1, 0,
    (uint8_t)CHANNELS, (uint8_t)(CHANNELS >> 8),
    (uint8_t)(SAMPLE_RATE & 0xFF), (uint8_t)((SAMPLE_RATE >> 8) & 0xFF),
    (uint8_t)((SAMPLE_RATE >> 16) & 0xFF), (uint8_t)((SAMPLE_RATE >> 24) & 0xFF),
    (uint8_t)(byteRate & 0xFF), (uint8_t)((byteRate >> 8) & 0xFF),
    (uint8_t)((byteRate >> 16) & 0xFF), (uint8_t)((byteRate >> 24) & 0xFF),
    (uint8_t)(blockAlign & 0xFF), (uint8_t)((blockAlign >> 8) & 0xFF),
    (uint8_t)(BITS_PER_SAMPLE & 0xFF), (uint8_t)((BITS_PER_SAMPLE >> 8) & 0xFF),
    'd', 'a', 't', 'a',
    0, 0, 0, 0
  };
  file.write(header, sizeof(header));
}

void finalizeWavHeader(File& file) {
  uint32_t dataSize = file.size() >= 44 ? file.size() - 44 : 0;
  uint32_t riffSize = dataSize + 36;

  file.seek(4);
  file.write((uint8_t)(riffSize & 0xFF));
  file.write((uint8_t)((riffSize >> 8) & 0xFF));
  file.write((uint8_t)((riffSize >> 16) & 0xFF));
  file.write((uint8_t)((riffSize >> 24) & 0xFF));

  file.seek(40);
  file.write((uint8_t)(dataSize & 0xFF));
  file.write((uint8_t)((dataSize >> 8) & 0xFF));
  file.write((uint8_t)((dataSize >> 16) & 0xFF));
  file.write((uint8_t)((dataSize >> 24) & 0xFF));
  file.close();
}

bool tryConnectToCredential(const char* ssid, const char* pass) {
  if (ssid == nullptr || ssid[0] == '\0') {
    return false;
  }

  showScreen(0x0000, 0xFFFF, 1, 10, 45, "WIFI", "CONNECTING...");
  Serial.printf("Connecting to WiFi SSID: %s\n", ssid);

  // Keep WiFi stack stable between retries to avoid OLED/UI glitching.
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  delay(80);
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);
  WiFi.begin(ssid, pass);

  wl_status_t lastStatus = WL_IDLE_STATUS;
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 40) {
    wl_status_t current = WiFi.status();
    if (current != lastStatus) {
      Serial.printf("\nWiFi status changed: %d\n", static_cast<int>(current));
      lastStatus = current;
    }
    if (current == WL_NO_SSID_AVAIL || current == WL_CONNECT_FAILED) {
      break;
    }
    delay(250);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    String ip = WiFi.localIP().toString();
    Serial.printf("\nWiFi connected to %s. IP=%s\n", ssid, ip.c_str());
    showScreen(0x0000, 0xFFFF, 1, 10, 45, "WIFI READY", ip.c_str());
    delay(500);
    return true;
  }

  wl_status_t finalStatus = WiFi.status();
  Serial.printf("\nWiFi connection failed for %s. status=%d\n", ssid, static_cast<int>(finalStatus));
  return false;
}

bool connectWiFi() {
  static uint8_t failCount = 0;

  if (wifiAuthBackoffUntilMs != 0 && millis() < wifiAuthBackoffUntilMs) {
    return false;
  }

  if (WiFi.status() == WL_CONNECTED) return true;

  if (tryConnectToCredential(WIFI_SSID, WIFI_PASS)) {
    failCount = 0;
    return true;
  }

  if (tryConnectToCredential(WIFI_SSID_BACKUP, WIFI_PASS_BACKUP)) {
    failCount = 0;
    return true;
  }

  failCount++;

  wl_status_t finalStatus = WiFi.status();
  if (finalStatus == WL_NO_SSID_AVAIL) {
    if (failCount % 3 == 1) {
      logVisibleNetworks();
    }
    errorScreen("SSID NOT FOUND");
  } else if (finalStatus == WL_CONNECT_FAILED) {
    wifiAuthBackoffUntilMs = millis() + WIFI_AUTH_RETRY_COOLDOWN_MS;
    errorScreen("CHECK WIFI PASS");
  } else if (finalStatus == WL_DISCONNECTED) {
    errorScreen("WIFI RETRY");
  } else {
    errorScreen("WIFI RETRY");
  }

  return false;
}

bool initMicrophoneI2S() {
  if (micI2sInstalled) {
    i2s_driver_uninstall(MIC_I2S_PORT);
    micI2sInstalled = false;
  }

  i2s_config_t i2sConfig;
  i2sConfig.mode = static_cast<i2s_mode_t>(I2S_MODE_MASTER | I2S_MODE_RX);
  i2sConfig.sample_rate = static_cast<int>(SAMPLE_RATE);
  i2sConfig.bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT;
  i2sConfig.channel_format = I2S_CHANNEL_FMT_ONLY_LEFT;
  i2sConfig.communication_format = I2S_COMM_FORMAT_STAND_I2S;
  i2sConfig.intr_alloc_flags = ESP_INTR_FLAG_LEVEL1;
  i2sConfig.dma_buf_count = 8;
  i2sConfig.dma_buf_len = 256;
  i2sConfig.use_apll = false;
  i2sConfig.tx_desc_auto_clear = false;
  i2sConfig.fixed_mclk = 0;

  i2s_pin_config_t pinConfig;
  memset(&pinConfig, 0xFF, sizeof(pinConfig));
#if defined(ESP_ARDUINO_VERSION_MAJOR) && (ESP_ARDUINO_VERSION_MAJOR >= 2)
  pinConfig.mck_io_num = I2S_PIN_NO_CHANGE;
#endif
  pinConfig.bck_io_num = MIC_I2S_SCK;
  pinConfig.ws_io_num = MIC_I2S_WS;
  pinConfig.data_out_num = I2S_PIN_NO_CHANGE;
  pinConfig.data_in_num = MIC_I2S_SD;

  if (i2s_driver_install(MIC_I2S_PORT, &i2sConfig, 0, nullptr) != ESP_OK) {
    Serial.println("I2S driver install failed");
    return false;
  }
  micI2sInstalled = true;

  if (i2s_set_pin(MIC_I2S_PORT, &pinConfig) != ESP_OK) {
    Serial.println("I2S pin config failed");
    i2s_driver_uninstall(MIC_I2S_PORT);
    micI2sInstalled = false;
    return false;
  }

  if (i2s_set_clk(MIC_I2S_PORT, SAMPLE_RATE, I2S_BITS_PER_SAMPLE_32BIT, I2S_CHANNEL_MONO) != ESP_OK) {
    Serial.println("I2S clock setup failed");
    i2s_driver_uninstall(MIC_I2S_PORT);
    micI2sInstalled = false;
    return false;
  }

  // Clear stale DMA data so recordings start clean.
  i2s_zero_dma_buffer(MIC_I2S_PORT);
  return true;
}

bool startSession() {
  if (!connectWiFi()) return false;

  for (int attempt = 1; attempt <= 3; attempt++) {
    showScreen(0x0000, 0xFFFF, 1, 10, 55, "STARTING", "SESSION...");

    HTTPClient http;
    String url = String(SERVER_URL) + "/api/esp32/start";
    http.begin(url);
    http.addHeader("Content-Type", "application/json");
    http.setTimeout(15000);

    const int httpCode = http.POST(SESSION_TRAITS);
    String responseBody = http.getString();

    if (httpCode == HTTP_CODE_OK) {
      const int marker = responseBody.indexOf("\"sessionId\":\"");
      if (marker >= 0) {
        const int start = marker + 13;
        const int end = responseBody.indexOf('"', start);
        if (end > start) {
          sessionId = responseBody.substring(start, end);
          sessionEnded = false;
          Serial.printf("Session started: %s\n", sessionId.c_str());
          http.end();
          return true;
        }
      }
    }

    Serial.printf(
      "Session start attempt %d failed. HTTP=%d body=%s\n",
      attempt,
      httpCode,
      responseBody.c_str()
    );
    http.end();

    if (attempt < 3) {
      delay(700);
    }
  }

  errorScreen("SESSION FAIL");
  return false;
}

bool recordAudioToSd() {
  if (!initMicrophoneI2S()) {
    errorScreen("MIC INIT FAIL");
    return false;
  }

  SD.remove("/rec.wav");
  File wavFile = SD.open("/rec.wav", FILE_WRITE);
  if (!wavFile) {
    errorScreen("SD WRITE FAIL");
    return false;
  }

  recordingScreen();
  writeWavHeader(wavFile);

  int32_t rawSamples[I2S_SAMPLES_PER_READ];
  int16_t pcmSamples[I2S_SAMPLES_PER_READ];

  while (isButtonPressed()) {
    size_t bytesRead = 0;
    esp_err_t err = i2s_read(
      MIC_I2S_PORT,
      rawSamples,
      sizeof(rawSamples),
      &bytesRead,
      portMAX_DELAY
    );

    if (err != ESP_OK || bytesRead == 0) {
      continue;
    }

    const size_t sampleCount = bytesRead / sizeof(int32_t);
    for (size_t i = 0; i < sampleCount; i++) {
      int32_t scaled = rawSamples[i] >> MIC_SHIFT;
      if (scaled > 32767) scaled = 32767;
      if (scaled < -32768) scaled = -32768;
      pcmSamples[i] = static_cast<int16_t>(scaled);
    }

    wavFile.write(reinterpret_cast<const uint8_t*>(pcmSamples), sampleCount * sizeof(int16_t));
  }

  finalizeWavHeader(wavFile);
  Serial.println("Recorded /rec.wav");
  return true;
}

bool postTurnAndSaveMp3(int& outHttpCode) {
  outHttpCode = -1;

  File wavFile = SD.open("/rec.wav", FILE_READ);
  if (!wavFile) {
    errorScreen("WAV OPEN FAIL");
    return false;
  }

  const int wavSize = wavFile.size();
  if (wavSize < 100) {
    wavFile.close();
    errorScreen("AUDIO TOO SHORT");
    return false;
  }

  HTTPClient http;
  String url = String(SERVER_URL) + "/api/esp32/turn";
  http.begin(url);
  http.addHeader("Content-Type", "audio/wav");
  http.addHeader("X-Session-Id", sessionId);
  // HTTPClient timeout is uint16_t in this core; keep <= 65535 ms.
  http.setTimeout(65500);

  const char* headerKeys[] = { "X-Session-Ended" };
  http.collectHeaders(headerKeys, 1);

  Serial.printf("Sending turn: %d bytes\n", wavSize);
  outHttpCode = http.sendRequest("POST", &wavFile, wavSize);
  wavFile.close();

  if (outHttpCode != HTTP_CODE_OK) {
    String body = http.getString();
    Serial.printf("Turn failed. HTTP=%d body=%s\n", outHttpCode, body.c_str());
    String lowerBody = body;
    lowerBody.toLowerCase();

    if (outHttpCode == HTTP_CODE_GATEWAY_TIMEOUT) {
      errorScreen("BRIDGE TIMEOUT");
    } else if (outHttpCode == HTTP_CODE_BAD_REQUEST) {
      if (lowerBody.indexOf("voice") >= 0 || lowerBody.indexOf("audio") >= 0) {
        errorScreen("VOICE/AUDIO ERR");
      }
    } else if (outHttpCode == HTTP_CODE_TOO_MANY_REQUESTS) {
      errorScreen("AI RATE LIMIT");
    } else if (outHttpCode == HTTP_CODE_SERVICE_UNAVAILABLE) {
      if (lowerBody.indexOf("elevenlabs") >= 0 || lowerBody.indexOf("voice") >= 0) {
        errorScreen("ELEVENLABS ERR");
      } else if (lowerBody.indexOf("bridge") >= 0 || lowerBody.indexOf("puter") >= 0) {
        errorScreen("BRIDGE OFFLINE");
      } else {
        errorScreen("AI BUSY");
      }
    } else if (outHttpCode < 0) {
      errorScreen("NET TIMEOUT");
    } else if (outHttpCode >= 500) {
      errorScreen("AI SERVER ERR");
    }

    http.end();
    return false;
  }

  sessionEnded = http.header("X-Session-Ended") == "true";

  SD.remove("/response.mp3");
  File mp3File = SD.open("/response.mp3", FILE_WRITE);
  if (!mp3File) {
    http.end();
    errorScreen("MP3 OPEN FAIL");
    return false;
  }

  WiFiClient* stream = http.getStreamPtr();
  int remaining = http.getSize();
  uint8_t chunk[512];
  int totalBytes = 0;
  unsigned long lastDataMs = millis();

  while (http.connected() && (remaining > 0 || remaining == -1)) {
    size_t availableBytes = stream->available();
    if (availableBytes > 0) {
      int toRead = static_cast<int>(availableBytes);
      if (toRead > static_cast<int>(sizeof(chunk))) {
        toRead = sizeof(chunk);
      }
      int readNow = stream->readBytes(chunk, toRead);
      if (readNow > 0) {
        mp3File.write(chunk, readNow);
        totalBytes += readNow;
        lastDataMs = millis();
        if (remaining > 0) remaining -= readNow;
      }
    } else {
      if (millis() - lastDataMs > 4000) {
        break;
      }
      delay(1);
    }
  }

  mp3File.close();
  http.end();

  Serial.printf("Received /response.mp3: %d bytes\n", totalBytes);
  if (totalBytes < 200) {
    errorScreen("EMPTY MP3");
    return false;
  }

  return true;
}

bool sendTurnAndStartPlayback() {
  thinkingScreen();

  if (sessionId.isEmpty() && !startSession()) {
    return false;
  }

  int httpCode = -1;
  if (!postTurnAndSaveMp3(httpCode)) {
    // Session may have expired on server; retry once with a new session.
    if (httpCode == HTTP_CODE_NOT_FOUND || httpCode == HTTP_CODE_BAD_REQUEST) {
      Serial.println("Retrying turn with a fresh session...");
      if (startSession() && postTurnAndSaveMp3(httpCode)) {
        speakingScreen();
        if (audio.connecttoFS(SD, "/response.mp3")) {
          isPlaying = true;
          return true;
        }
      }
    }

    const bool transientFailure =
      httpCode == HTTP_CODE_GATEWAY_TIMEOUT ||
      httpCode == HTTP_CODE_TOO_MANY_REQUESTS ||
      httpCode == HTTP_CODE_SERVICE_UNAVAILABLE ||
      httpCode < 0 ||
      httpCode >= 500;

    if (transientFailure) {
      Serial.println("Retrying turn after transient failure...");
      delay(1000);
      thinkingScreen();

      if (postTurnAndSaveMp3(httpCode)) {
        speakingScreen();
        if (audio.connecttoFS(SD, "/response.mp3")) {
          isPlaying = true;
          return true;
        }
      }
    }

    if (transientFailure) {
      delay(1500);
      defaultScreen();
      return false;
    }

    errorScreen("TURN FAILED");
    return false;
  }

  speakingScreen();
  if (audio.connecttoFS(SD, "/response.mp3")) {
    isPlaying = true;
    return true;
  }

  errorScreen("PLAY FAIL");
  return false;
}

void setup() {
  Serial.begin(115200);
  Serial.println("\n=== Pentabyte AI Coach (ESP32) ===");

  tft.begin();
  tft.fillScreen(0x001F);
  delay(300);

  pinMode(BUTTON_PIN, INPUT_PULLUP);
  detectButtonPolarity();

  Serial.println("Mounting SD card...");
  sdSPI.begin(SD_SCK, SD_MISO, SD_MOSI, SD_CS);
  if (!SD.begin(SD_CS, sdSPI)) {
    Serial.println("SD mount failed");
    errorScreen("SD FAIL");
    while (true) {
      delay(1000);
    }
  }

  audio.setPinout(SPK_I2S_BCLK, SPK_I2S_LRC, SPK_I2S_DOUT);
  audio.setVolume(21);

  if (!connectWiFi()) {
    Serial.println("WiFi unavailable at boot, will keep retrying in loop.");
  }

  if (WiFi.status() == WL_CONNECTED && !startSession()) {
    Serial.println("Session start failed at boot, will retry in loop.");
  }

  Serial.println("System ready.");
  defaultScreen();
}

void loop() {
  audio.loop();

  if (WiFi.status() != WL_CONNECTED) {
    if (millis() - lastWiFiRetryMs > WIFI_RETRY_INTERVAL_MS) {
      lastWiFiRetryMs = millis();
      connectWiFi();
    }
  } else if (sessionId.isEmpty() && millis() - lastSessionRetryMs > SESSION_RETRY_INTERVAL_MS) {
    lastSessionRetryMs = millis();
    startSession();
  }

  if (isPlaying && !audio.isRunning()) {
    isPlaying = false;

    if (sessionEnded) {
      sessionEndScreen();
      delay(3000);
      sessionEnded = false;
      startSession();
    }

    defaultScreen();
  }

  bool pressedNow = isButtonPressed();

  if (
    !isPlaying &&
    pressedNow &&
    !lastButtonPressed &&
    millis() - lastHandledPressMs > 250
  ) {
    delay(35);
    if (isButtonPressed()) {
      lastHandledPressMs = millis();
      if (recordAudioToSd()) {
        sendTurnAndStartPlayback();
      }
      delay(120);
    }
  }

  lastButtonPressed = pressedNow;
}


// ===========================================================
//  AUDIO CALLBACKS (called automatically by ESP32-audioI2S)
// ===========================================================
void audio_info(const char *info) {
  Serial.printf("audio_info: %s\n", info);
}

void audio_eof_mp3(const char *info) {
  Serial.printf("Playback done: %s\n", info);
}