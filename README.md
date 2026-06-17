# 💧 HydroSync — Smart Water Bottle v2.0

AI-powered hydration tracking with live weather, activity intelligence, BMI-based goals, and a full notification system.

---

## Features

| Feature | Details |
|---|---|
| **Smart Goal** | Calculated daily from weight, BMI, activity level, health conditions + live OpenWeather temp |
| **Sensor Integration** | Arduino HX711 → WiFi POST every 10s → auto-tracks consumption |
| **Activity Logging** | Log exercise type/intensity/duration → goal auto-increases + push notification |
| **Notifications Page** | All alerts stored: reminders, milestones (25/50/75/100%), streaks, weather, activity |
| **Streak Tracking** | Daily streak resets at midnight via cron job |
| **Goal Breakdown** | Transparent display of how your goal was calculated |
| **Weather Integration** | OpenWeatherMap API adjusts goal based on real-time temp + humidity |
| **Health Conditions** | Kidney stones, diabetes, UTI, pregnancy etc. bump goal accordingly |

---

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env:
#   MONGO_URI=mongodb://localhost:27017/smartbottle
#   JWT_SECRET=any_random_string
#   WEATHER_API_KEY=b382c18c13081f0c88cb40b169b31101
#   DEFAULT_CITY=Chennai
```

### 3. Start the server
```bash
npm run dev   # development with nodemon
npm start     # production
```

### 4. Open the frontend
Open `frontend/index.html` in your browser, or serve via:
```bash
# From project root:
node -e "require('http').createServer(require('fs').readFileSync.bind(null)).listen(3000)"
```

---

## Arduino Setup

1. Open `arduino/smart_bottle/smart_bottle.ino` in Arduino IDE
2. Install libraries: **HX711 by bogde**, **ESP8266WiFi**, **ArduinoJson**
3. Set your WiFi credentials, server IP, and MongoDB user ID
4. Run calibration (see comments at bottom of sketch)
5. Upload to ESP8266/ESP32

### Calibration steps
1. Empty the scale, power on → scale auto-tares
2. Place a known weight (e.g. 500g)
3. Read the raw value from Serial Monitor
4. `CALIBRATION_FACTOR = rawValue / knownGrams`
5. Weigh empty bottle → set `EMPTY_BOTTLE_GRAMS`
6. Fill with exactly 1000ml → set `FULL_BOTTLE_GRAMS`

---

## API Reference

| Endpoint | Method | Auth | Description |
|---|---|---|---|
| `/api/auth/register` | POST | No | Register + calculate initial goal |
| `/api/auth/login` | POST | No | Login |
| `/api/auth/me` | GET | JWT | Get current user |
| `/api/auth/profile` | PUT | JWT | Update profile + recalculate goal |
| `/api/hydration/sensor` | POST | No | Arduino sensor reading |
| `/api/hydration/log` | POST | JWT | Manual water log |
| `/api/hydration/activity` | POST | JWT | Log exercise → bump goal |
| `/api/hydration/today` | GET | JWT | Today's summary + weather |
| `/api/hydration/history` | GET | JWT | Historical logs |
| `/api/hydration/recalculate` | POST | JWT | Force goal recalculation |
| `/api/hydration/calibrate` | POST | JWT | Set bottle calibration data |
| `/api/notifications` | GET | JWT | List notifications |
| `/api/notifications/:id/read` | PUT | JWT | Mark single as read |
| `/api/notifications/read-all` | PUT | JWT | Mark all as read |
| `/api/notifications/:id` | DELETE | JWT | Delete notification |
| `/api/notifications/clear-all` | DELETE | JWT | Clear all |

---

## Goal Calculation Formula

```
base = weight_kg × 35ml
if BMI > 30  → +500ml
if BMI > 25  → +250ml
base × activityMultiplier (1.0–1.5)
if female    → ×0.9
if pregnant  → +300ml
if breastfeeding → +700ml
if kidneyStones  → +500ml
if UTI           → +300ml
if diabetes      → +200ml
weather (temp 25–40°C) → +100–600ml
humidity > 80%   → +150ml
cap: 1500ml – 5000ml
```

---

## Cron Jobs

- **Midnight**: Reset `todayConsumed`, update streak, recalculate goal from weather
- **Every hour (7AM–10PM)**: Send hydration reminder if goal < 100%
