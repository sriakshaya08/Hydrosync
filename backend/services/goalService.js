const axios = require('axios');

/**
 * Calculate daily hydration goal (ml).
 */
async function calculateDailyGoal(user, opts = {}) {
  const { profile, healthConditions, location } = user;
  const breakdown = {};

  let base = profile.weight * 35;
  breakdown.base = base;

  const bmi = profile.weight / Math.pow(profile.height / 100, 2);
  if (bmi > 30)      { base += 500; breakdown.bmiBonus = 500; }
  else if (bmi > 25) { base += 250; breakdown.bmiBonus = 250; }

  const activityMultipliers = {
    sedentary:1.0, light:1.1, moderate:1.2,
    active:1.35, very_active:1.5
  };

  const mult = activityMultipliers[profile.activityLevel] || 1.2;
  base = Math.round(base * mult);
  breakdown.activityMultiplier = mult;

  if (profile.gender === 'female' && !healthConditions.pregnant && !healthConditions.breastfeeding) {
    base = Math.round(base * 0.9);
  }

  if (healthConditions.pregnant)     { base += 300; breakdown.pregnantBonus = 300; }
  if (healthConditions.breastfeeding){ base += 700; breakdown.breastfeedingBonus = 700; }
  if (healthConditions.kidneyStones) { base += 500; breakdown.kidneyBonus = 500; }
  if (healthConditions.uti)          { base += 300; breakdown.utiBonus = 300; }
  if (healthConditions.diabetes)     { base += 200; breakdown.diabetesBonus = 200; }

  let weatherData = null;
  let weatherBonus = 0;

  try {
    const city    = location?.city || 'Chennai';
    const country = location?.country || 'IN';
    const apiKey  = process.env.WEATHER_API_KEY;

    const url = `https://api.openweathermap.org/data/2.5/weather?q=${city},${country}&appid=${apiKey}&units=metric`;

    const res = await axios.get(url, { timeout: 5000 });

    // ✅ FIX: include BOTH temp + temperature
    weatherData = {
      temp: res.data.main.temp,                 // keep old (for logic)
      temperature: res.data.main.temp,          // 🔥 NEW (for frontend)
      feelsLike: res.data.main.feels_like,
      humidity: res.data.main.humidity,
      condition: res.data.weather[0].main,
      icon: res.data.weather[0].icon,
      city: res.data.name
    };

    // 🔥 EXISTING LOGIC (UNCHANGED)
    if (weatherData.temp >= 40) weatherBonus = 600;
    else if (weatherData.temp >= 35) weatherBonus = 400;
    else if (weatherData.temp >= 30) weatherBonus = 250;
    else if (weatherData.temp >= 25) weatherBonus = 100;

    if (weatherData.humidity > 80) weatherBonus += 150;

    base += weatherBonus;
    breakdown.weatherBonus = weatherBonus;
    breakdown.weather = weatherData;

  } catch (e) {
    breakdown.weatherNote = 'Weather data unavailable';

    // ✅ fallback so frontend NEVER breaks
    weatherData = {
      temp: 30,
      temperature: 30,
      feelsLike: 30,
      humidity: 60,
      condition: 'Clear',
      icon: '01d',
      city: location?.city || 'Chennai'
    };
    // Also set breakdown.weather so goal line renders correctly
    breakdown.weather = weatherData;
    breakdown.weatherBonus = 0;
  }

  // ── Google Fit bonus (UNCHANGED) ─────────────────────
  const fitBonus = opts.fitBonus ?? user.googleFit?.todayFitBonus ?? 0;

  if (fitBonus > 0) {
    base += fitBonus;
    breakdown.googleFitBonus = fitBonus;
  }

  base = Math.min(Math.max(base, 1500), 6000);

  return {
    total: Math.round(base),
    breakdown,
    weather: weatherData   // ✅ now safe for frontend
  };
}


// ── Activity bonus (UNCHANGED) ─────────────────────────
function calculateActivityBonus(type, intensity, durationMinutes) {
  const basePerHour = {
    running:  { light:400, moderate:600, intense:900 },
    cycling:  { light:350, moderate:500, intense:750 },
    swimming: { light:200, moderate:400, intense:600 },
    gym:      { light:300, moderate:500, intense:700 },
    yoga:     { light:150, moderate:250, intense:350 },
    walking:  { light:200, moderate:300, intense:400 },
    hiit:     { light:500, moderate:700, intense:1000 },
    sports:   { light:400, moderate:600, intense:900 },
    other:    { light:300, moderate:450, intense:650 }
  };

  const rates = basePerHour[type] || basePerHour.other;
  const ratePerMin = (rates[intensity] || rates.moderate) / 60;

  return Math.round(ratePerMin * durationMinutes);
}

module.exports = { calculateDailyGoal, calculateActivityBonus };