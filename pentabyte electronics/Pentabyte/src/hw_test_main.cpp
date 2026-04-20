#include <Arduino.h>
#include <driver/i2s.h>
#include <math.h>

// I2S mic (RX)
#define MIC_I2S_PORT I2S_NUM_1
#define MIC_I2S_SCK 16
#define MIC_I2S_WS 17
#define MIC_I2S_SD 34

// I2S speaker DAC (TX)
#define SPK_I2S_PORT I2S_NUM_0
#define SPK_I2S_DOUT 25
#define SPK_I2S_BCLK 26
#define SPK_I2S_LRC 27

// Push button (active low)
#define BUTTON_PIN 4

static const uint32_t SAMPLE_RATE = 16000;
static const size_t FRAME_SAMPLES = 256;
static const int32_t MIC_SHIFT = 14;
static const size_t MAX_RECORD_SECONDS = 2;
static const size_t MAX_RECORD_SAMPLES = SAMPLE_RATE * MAX_RECORD_SECONDS;

static int16_t gRecorded[MAX_RECORD_SAMPLES];
static size_t gRecordedSamples = 0;

bool setupMicI2S() {
  i2s_config_t cfg;
  memset(&cfg, 0, sizeof(cfg));
  cfg.mode = static_cast<i2s_mode_t>(I2S_MODE_MASTER | I2S_MODE_RX);
  cfg.sample_rate = SAMPLE_RATE;
  cfg.bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT;
  // Read both channels so we can diagnose left/right selection issues.
  cfg.channel_format = I2S_CHANNEL_FMT_RIGHT_LEFT;
  cfg.communication_format = I2S_COMM_FORMAT_STAND_I2S;
  cfg.intr_alloc_flags = ESP_INTR_FLAG_LEVEL1;
  cfg.dma_buf_count = 8;
  cfg.dma_buf_len = 256;
  cfg.use_apll = false;
  cfg.tx_desc_auto_clear = false;
  cfg.fixed_mclk = 0;

  i2s_pin_config_t pins;
  memset(&pins, 0xFF, sizeof(pins));
#if defined(ESP_ARDUINO_VERSION_MAJOR) && (ESP_ARDUINO_VERSION_MAJOR >= 2)
  pins.mck_io_num = I2S_PIN_NO_CHANGE;
#endif
  pins.bck_io_num = MIC_I2S_SCK;
  pins.ws_io_num = MIC_I2S_WS;
  pins.data_out_num = I2S_PIN_NO_CHANGE;
  pins.data_in_num = MIC_I2S_SD;

  if (i2s_driver_install(MIC_I2S_PORT, &cfg, 0, nullptr) != ESP_OK) {
    return false;
  }
  if (i2s_set_pin(MIC_I2S_PORT, &pins) != ESP_OK) {
    i2s_driver_uninstall(MIC_I2S_PORT);
    return false;
  }
  if (i2s_set_clk(MIC_I2S_PORT, SAMPLE_RATE, I2S_BITS_PER_SAMPLE_32BIT, I2S_CHANNEL_STEREO) != ESP_OK) {
    i2s_driver_uninstall(MIC_I2S_PORT);
    return false;
  }

  i2s_zero_dma_buffer(MIC_I2S_PORT);
  return true;
}

bool setupSpeakerI2S() {
  i2s_config_t cfg;
  memset(&cfg, 0, sizeof(cfg));
  cfg.mode = static_cast<i2s_mode_t>(I2S_MODE_MASTER | I2S_MODE_TX);
  cfg.sample_rate = SAMPLE_RATE;
  cfg.bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT;
  cfg.channel_format = I2S_CHANNEL_FMT_RIGHT_LEFT;
  cfg.communication_format = I2S_COMM_FORMAT_STAND_I2S;
  cfg.intr_alloc_flags = ESP_INTR_FLAG_LEVEL1;
  cfg.dma_buf_count = 8;
  cfg.dma_buf_len = 256;
  cfg.use_apll = false;
  cfg.tx_desc_auto_clear = true;
  cfg.fixed_mclk = 0;

  i2s_pin_config_t pins;
  memset(&pins, 0xFF, sizeof(pins));
#if defined(ESP_ARDUINO_VERSION_MAJOR) && (ESP_ARDUINO_VERSION_MAJOR >= 2)
  pins.mck_io_num = I2S_PIN_NO_CHANGE;
#endif
  pins.bck_io_num = SPK_I2S_BCLK;
  pins.ws_io_num = SPK_I2S_LRC;
  pins.data_out_num = SPK_I2S_DOUT;
  pins.data_in_num = I2S_PIN_NO_CHANGE;

  if (i2s_driver_install(SPK_I2S_PORT, &cfg, 0, nullptr) != ESP_OK) {
    return false;
  }
  if (i2s_set_pin(SPK_I2S_PORT, &pins) != ESP_OK) {
    i2s_driver_uninstall(SPK_I2S_PORT);
    return false;
  }
  if (i2s_set_clk(SPK_I2S_PORT, SAMPLE_RATE, I2S_BITS_PER_SAMPLE_16BIT, I2S_CHANNEL_STEREO) != ESP_OK) {
    i2s_driver_uninstall(SPK_I2S_PORT);
    return false;
  }

  i2s_zero_dma_buffer(SPK_I2S_PORT);
  return true;
}

void playStartupBeep() {
  static int16_t out[FRAME_SAMPLES * 2];
  const float freq = 660.0f;
  float phase = 0.0f;
  const float step = 2.0f * PI * freq / static_cast<float>(SAMPLE_RATE);

  for (int block = 0; block < 30; block++) {
    for (size_t i = 0; i < FRAME_SAMPLES; i++) {
      float env = 1.0f;
      if (block < 3) env = (block + 1) / 3.0f;
      if (block > 24) env = (30 - block) / 6.0f;

      int16_t s = static_cast<int16_t>(sinf(phase) * 6500.0f * env);
      phase += step;
      if (phase > 2.0f * PI) phase -= 2.0f * PI;

      out[i * 2] = s;
      out[i * 2 + 1] = s;
    }

    size_t written = 0;
    i2s_write(SPK_I2S_PORT, out, sizeof(out), &written, portMAX_DELAY);
  }

  memset(out, 0, sizeof(out));
  size_t written = 0;
  i2s_write(SPK_I2S_PORT, out, sizeof(out), &written, portMAX_DELAY);
}

void playRecordingAtFullVolume() {
  if (gRecordedSamples == 0) {
    Serial.println("No recording to play.");
    return;
  }

  int peak = 0;
  for (size_t i = 0; i < gRecordedSamples; i++) {
    int v = gRecorded[i];
    int a = v >= 0 ? v : -v;
    if (a > peak) peak = a;
  }

  if (peak < 100) {
    Serial.println("Recording too quiet or mic signal missing.");
    return;
  }

  // Normalize near full scale so playback is as loud as possible.
  float gain = 30000.0f / static_cast<float>(peak);
  if (gain > 8.0f) gain = 8.0f;
  if (gain < 1.0f) gain = 1.0f;

  Serial.printf("Playback %u ms, peak=%d, gain=%.2f\n",
                static_cast<unsigned>((gRecordedSamples * 1000) / SAMPLE_RATE),
                peak,
                gain);

  static int16_t outStereo[FRAME_SAMPLES * 2];
  size_t idx = 0;
  while (idx < gRecordedSamples) {
    size_t block = FRAME_SAMPLES;
    if (idx + block > gRecordedSamples) {
      block = gRecordedSamples - idx;
    }

    for (size_t i = 0; i < block; i++) {
      int32_t v = static_cast<int32_t>(gRecorded[idx + i] * gain);
      if (v > 32767) v = 32767;
      if (v < -32768) v = -32768;
      int16_t s = static_cast<int16_t>(v);
      outStereo[i * 2] = s;
      outStereo[i * 2 + 1] = s;
    }

    size_t written = 0;
    i2s_write(SPK_I2S_PORT, outStereo, block * sizeof(int16_t) * 2, &written, portMAX_DELAY);
    idx += block;
  }

  memset(outStereo, 0, sizeof(outStereo));
  size_t written = 0;
  i2s_write(SPK_I2S_PORT, outStereo, sizeof(outStereo), &written, portMAX_DELAY);
}

void setup() {
  Serial.begin(115200);
  delay(300);

  pinMode(BUTTON_PIN, INPUT_PULLUP);

  Serial.println("\\n=== ESP32 MIC/SPEAKER TEST ===");
  Serial.println("1) You should hear a startup beep.");
  Serial.println("2) Hold button to record your voice.");
  Serial.println("3) Release button to play it back at full volume.");

  if (!setupSpeakerI2S()) {
    Serial.println("Speaker I2S init failed");
    while (true) delay(1000);
  }

  if (!setupMicI2S()) {
    Serial.println("Mic I2S init failed");
    while (true) delay(1000);
  }

  playStartupBeep();
  Serial.println("Ready.");
}

void loop() {
  static int32_t micRaw[FRAME_SAMPLES * 2];
  static unsigned long lastMeterMs = 0;
  static bool wasPressed = false;

  const bool pressed = digitalRead(BUTTON_PIN) == LOW;

  if (pressed != wasPressed) {
    wasPressed = pressed;
    if (pressed) {
      gRecordedSamples = 0;
      Serial.println("Recording... hold button and speak");
    } else {
      Serial.printf("Recording stopped. Captured %u ms\n",
                    static_cast<unsigned>((gRecordedSamples * 1000) / SAMPLE_RATE));
      playRecordingAtFullVolume();
    }
  }

  if (!pressed) {
    delay(5);
    return;
  }

  size_t bytesRead = 0;
  esp_err_t err = i2s_read(MIC_I2S_PORT, micRaw, sizeof(micRaw), &bytesRead, portMAX_DELAY);
  if (err != ESP_OK || bytesRead == 0) {
    return;
  }

  const size_t wordsRead = bytesRead / sizeof(int32_t);
  const size_t frames = wordsRead / 2;
  int peak = 0;
  int peakLeftRaw = 0;
  int peakRightRaw = 0;

  for (size_t i = 0; i < frames; i++) {
    int32_t leftRaw = micRaw[i * 2];
    int32_t rightRaw = micRaw[i * 2 + 1];

    int leftAbsRaw = static_cast<int>(leftRaw >= 0 ? leftRaw : -leftRaw);
    int rightAbsRaw = static_cast<int>(rightRaw >= 0 ? rightRaw : -rightRaw);
    if (leftAbsRaw > peakLeftRaw) peakLeftRaw = leftAbsRaw;
    if (rightAbsRaw > peakRightRaw) peakRightRaw = rightAbsRaw;

    // Many MEMS mics only drive one channel depending on L/R strap.
    int32_t chosenRaw = (rightAbsRaw > leftAbsRaw) ? rightRaw : leftRaw;
    int32_t v = chosenRaw >> MIC_SHIFT;
    if (v > 32767) v = 32767;
    if (v < -32768) v = -32768;

    int16_t s = static_cast<int16_t>(v);
    int absVal = s >= 0 ? s : -s;
    if (absVal > peak) peak = absVal;

    if (gRecordedSamples < MAX_RECORD_SAMPLES) {
      gRecorded[gRecordedSamples++] = s;
    }
  }

  if (millis() - lastMeterMs > 250) {
    lastMeterMs = millis();
    Serial.printf(
      "Rec peak(out): %d | Lraw: %d | Rraw: %d | ms: %u%s\n",
      peak,
      peakLeftRaw,
      peakRightRaw,
      static_cast<unsigned>((gRecordedSamples * 1000) / SAMPLE_RATE),
      (gRecordedSamples >= MAX_RECORD_SAMPLES) ? " (buffer full)" : ""
    );
  }
}
