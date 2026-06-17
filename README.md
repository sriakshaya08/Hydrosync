# 💧 HydroSync — AI-Powered Smart Hydration Tracking System

🌐 **Live Application:** https://hydrosync.onrender.com

HydroSync is a full-stack smart hydration management platform that helps users maintain healthy water intake through personalized hydration goals, real-time tracking, weather-aware recommendations, activity monitoring, and AI-powered assistance.

The system combines **IoT hardware, cloud services, weather intelligence, health analytics, and AI** to create a smart hydration experience tailored to each user.

## Key Highlights

### 🧠 Intelligent Hydration Goals

HydroSync calculates a personalized daily water intake goal based on:

* Weight and BMI
* Activity level
* Gender
* Health conditions
* Local weather conditions
* Exercise intensity and duration
* Google Fit activity data (for Personalization)

Users can view a detailed goal breakdown to understand exactly how their hydration target is calculated.

### 🌤️ Weather-Aware Recommendations

The application integrates with real-time weather services to dynamically adjust hydration goals based on:

* Temperature
* Humidity
* Environmental conditions

Hotter weather automatically increases hydration recommendations to help prevent dehydration.

### 🏃 Activity-Based Goal Adjustment

Users can log physical activities such as:

* Walking
* Running
* Cycling
* Gym workouts
* Sports activities

HydroSync automatically increases daily hydration goals based on activity intensity and duration.

### 🤖 AI Hydration Assistant

An integrated AI assistant provides:

* Hydration guidance
* Water intake recommendations
* Goal explanations
* Personalized hydration insights

### 🔔 Smart Notification System

The application continuously tracks hydration progress and generates notifications for:

* Water intake reminders
* Goal milestones (25%, 50%, 75%, 100%)
* Daily streak achievements
* Weather-based alerts
* Activity-based hydration recommendations

### 📈 Progress & Streak Tracking

Users can monitor:

* Daily water consumption
* Hydration history
* Achievement streaks
* Goal completion percentages
* Historical intake trends

---

## 🍼 Smart Bottle Integration (IoT Mode)

HydroSync supports integration with a physical smart water bottle using an **ESP8266/ESP32 microcontroller** and **HX711 load cell sensor**.

### How It Works

1. A load cell continuously measures the bottle's weight.
2. The HX711 module converts sensor readings into digital values.
3. The ESP8266/ESP32 sends readings to HydroSync every few seconds through Wi-Fi.
4. HydroSync calculates water consumption automatically.
5. The dashboard updates in real time without requiring manual input.

### Sensor Status Indicator

The dashboard includes a dedicated **Bottle Monitoring Section** that displays:

* Current bottle water level
* Sensor connection status
* Remaining water in the bottle
* Real-time consumption updates

When no physical sensor is connected, users can still use HydroSync normally by manually logging water intake.

This allows the platform to operate in both:

* **Software-Only Mode** (manual tracking)
* **Smart Bottle Mode** (automatic sensor-based tracking)

making the system suitable for both everyday users and IoT-enabled smart bottle deployments.

---

## Technology Stack

**Frontend**

* HTML
* CSS
* JavaScript

**Backend**

* Node.js
* Express.js

**Database**

* MongoDB Atlas

**Cloud & APIs**

* Render
* OpenWeather API
* Google Fit API
* Anthropic AI API

**IoT Hardware**

* ESP8266 / ESP32
* HX711 Load Cell Amplifier
* Load Cell Sensor

---

## Academic Integrity Notice

This project was developed as part of academic learning and portfolio development.

Students may view this project for learning and reference purposes; however, submitting this work, in whole or in part, as one's own academic work without proper attribution may constitute academic misconduct.

Please use the project responsibly and provide appropriate credit where applicable.

---

## Copyright Notice

© 2026 Sri Akshaya S.

HydroSync is an academic and personal development project created and implemented by Sri Akshaya S.

While the project incorporates publicly available technologies, APIs, frameworks, and AI-assisted development tools, the source code organization, implementation, integration, user interface design, documentation, and project-specific features represent the author's original work.

Unauthorized copying, submission, redistribution, or representation of this implementation as another person's original work is prohibited.

This repository is intended for demonstration, learning, portfolio, and evaluation purposes only.
