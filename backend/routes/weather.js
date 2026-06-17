const express = require('express');
const router = express.Router();
const axios = require('axios');
const { protect } = require('../middleware/auth');
const { createNotification } = require('../services/notificationService');
const User = require('../models/User');

// ─── GET /api/weather ────────────────────────────────────────────────────────
router.get('/', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    const city = req.query.city || user.location?.city || 'Chennai';
    const country = req.query.country || user.location?.country || 'IN';

    const apiKey = process.env.WEATHER_API_KEY;

    // ✅ FIX 1: Ensure API key exists
    if (!apiKey) {
      return res.status(500).json({ message: 'Missing WEATHER_API_KEY in .env' });
    }

    let w;

    // ✅ FIX 2: Safe API call with error handling
    try {
      const resp = await axios.get(
        `https://api.openweathermap.org/data/2.5/weather?q=${city},${country}&appid=${apiKey}&units=metric`
      );
      w = resp.data;
    } catch (apiErr) {
      console.error("OpenWeather error:", apiErr.response?.data || apiErr.message);
      return res.status(400).json({
        message: 'Weather API error',
        error: apiErr.response?.data?.message || apiErr.message
      });
    }

    // ✅ FIX 3: Validate response structure
    if (!w || !w.main || !w.weather || !Array.isArray(w.weather)) {
      return res.status(500).json({ message: 'Invalid weather data received' });
    }

    const temperature = w.main.temp;
    const humidity = w.main.humidity;
    const feelsLike = w.main.feels_like;
    const description = w.weather[0]?.description || '';
    const icon = w.weather[0]?.icon || '01d';

    // ─── Hydration advisory ────────────────────────────────────────────────
    let advisory = '';
    let urgency = 'normal';

    if (temperature >= 40) {
      advisory = `🔥 Extreme heat (${Math.round(temperature)}°C)! Drink at least 500ml extra today and avoid outdoor activity during peak hours.`;
      urgency = 'critical';
    } else if (temperature >= 35) {
      advisory = `☀️ Very hot day (${Math.round(temperature)}°C). Add 400ml extra water and take breaks in shade.`;
      urgency = 'high';
    } else if (temperature >= 30) {
      advisory = `🌤️ Hot weather (${Math.round(temperature)}°C). Add 200-300ml extra to your goal.`;
      urgency = 'moderate';
    } else if (humidity > 85) {
      advisory = `💦 High humidity (${humidity}%). You may sweat more — stay hydrated!`;
      urgency = 'moderate';
    } else {
      advisory = `✅ Comfortable conditions. Stick to your ${user.todayGoal}ml goal.`;
      urgency = 'normal';
    }

    // ─── Notification trigger (safe) ────────────────────────────────────────
    if (urgency !== 'normal' && user.notificationPrefs?.weatherAlerts) {
      const Notification = require('../models/Notification');

      const lastWeatherNotif = await Notification.findOne({
        user: user._id,
        type: 'weather',
        createdAt: { $gte: new Date(Date.now() - 3 * 60 * 60 * 1000) } // 3-hour cooldown
      });

      if (!lastWeatherNotif) {
        await createNotification(
          user._id,
          'weather',
          `Weather Alert: ${Math.round(temperature)}°C`,
          advisory,
          { temperature, humidity, urgency },
          urgency === 'critical' ? 'high' : 'normal'
        );
      }
    }

    // ─── Final response ─────────────────────────────────────────────────────
    res.json({
      city,
      country,
      temperature: Math.round(temperature * 10) / 10,
      feelsLike: Math.round(feelsLike * 10) / 10,
      humidity,
      description,
      icon: `https://openweathermap.org/img/wn/${icon}@2x.png`,
      advisory,
      urgency
    });

  } catch (err) {
    console.error("Weather route error:", err.message);

    res.status(500).json({
      message: 'Weather fetch failed',
      error: err.message
    });
  }
});

module.exports = router;