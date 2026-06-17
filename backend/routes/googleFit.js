const express = require('express');
const router = express.Router();
const axios = require('axios');
const { protect } = require('../middleware/auth');
const User = require('../models/User');
const { calculateDailyGoal } = require('../services/goalService');

const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI         = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/api/googlefit/callback';

// ─── OAuth: generate auth URL ───────────────────────────────────────────────
router.get('/auth-url', protect, (req, res) => {
  const scopes = [
  'https://www.googleapis.com/auth/fitness.activity.read',
  'https://www.googleapis.com/auth/fitness.location.read',  // 🔥 ADD THIS
  'https://www.googleapis.com/auth/fitness.body.read'
].join(' ');

  const url =
    `https://accounts.google.com/o/oauth2/v2/auth` +
    `?client_id=${GOOGLE_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&access_type=offline` +
    `&prompt=consent` +
    `&state=${req.user.id}`;

  res.json({ url });
});

// ─── OAuth: exchange code for tokens ────────────────────────────────────────
router.get('/callback', async (req, res) => {
  const { code, state: userId } = req.query;
  if (!code || !userId) return res.status(400).send('Missing code or state');

  try {
    const { data } = await axios.post('https://oauth2.googleapis.com/token', {
      code,
      client_id:     GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri:  REDIRECT_URI,
      grant_type:    'authorization_code',
    });

    const user = await User.findById(userId);
    if (!user) return res.status(404).send('User not found');

    user.googleFit = {
      connected:    true,
      accessToken:  data.access_token,
      refreshToken: data.refresh_token,
      expiresAt:    Date.now() + data.expires_in * 1000,
    };
    await user.save();

    // Redirect back to dashboard with success flag
    res.redirect('/#fit-connected');
  } catch (err) {
    console.error('Google Fit callback error:', err.response?.data || err.message);
    res.redirect('/#fit-error');
  }
});

// ─── Refresh access token if expired ────────────────────────────────────────
async function ensureFreshToken(user) {
  if (!user.googleFit?.refreshToken) throw new Error('No refresh token');
  if (Date.now() < (user.googleFit.expiresAt || 0) - 60_000) return user.googleFit.accessToken;

  const { data } = await axios.post('https://oauth2.googleapis.com/token', {
    refresh_token: user.googleFit.refreshToken,
    client_id:     GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    grant_type:    'refresh_token',
  });

  user.googleFit.accessToken = data.access_token;
  user.googleFit.expiresAt   = Date.now() + data.expires_in * 1000;
  await user.save();
  return data.access_token;
}

// ─── Fetch today's Fit data ──────────────────────────────────────────────────
router.get('/today', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user.googleFit?.connected) return res.json({ connected: false });

    const token  = await ensureFreshToken(user);
    const now    = Date.now();
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);

    const body = {
      aggregateBy: [
        { dataTypeName: 'com.google.step_count.delta',    dataSourceId: 'derived:com.google.step_count.delta:com.google.android.gms:estimated_steps' },
        { dataTypeName: 'com.google.calories.expended',  dataSourceId: 'derived:com.google.calories.expended:com.google.android.gms:merge_calories_expended' },
         {
    dataTypeName: 'com.google.calories.expended',
    dataSourceId: 'derived:com.google.calories.expended:com.google.android.gms:merge_calories_expended'
  }
      ],
      bucketByTime: { durationMillis: 86400000 },
      startTimeMillis: dayStart.getTime(),
      endTimeMillis:   now,
    };

    const { data } = await axios.post(
      'https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate',
      body,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    const bucket = data.bucket?.[0]?.dataset || [];
    const extract = (typeIdx) => bucket[typeIdx]?.point?.[0]?.value?.[0]?.intVal
                              ?? bucket[typeIdx]?.point?.[0]?.value?.[0]?.fpVal
                              ?? 0;

    const steps          = Math.round(extract(0));
const caloriesBurned = Math.round(extract(1));
const activeMinutes  = 0;
const heartRate      = 0;

    // ── Calculate hydration bonus from Fit data ──────────────────────────────
    // Steps bonus: +80ml per 1 000 steps above 5 000 baseline
    const stepBonus = Math.max(0, Math.round(((steps - 5000) / 1000) * 80));
    // Active-minutes bonus: +150ml per 30 active minutes
    const activeBonus = Math.round((activeMinutes / 30) * 150);
    // Calories bonus: +100ml per 200 extra calories above 400 base
    const calBonus = Math.max(0, Math.round(((caloriesBurned - 400) / 200) * 100));

    const fitBonus = Math.min(stepBonus + activeBonus + calBonus, 1500); // cap at 1.5L

    // Persist the bonus so the goal uses it
    user.googleFit.todayFitBonus = fitBonus;
    user.googleFit.lastSynced    = new Date();
    await user.save();

    // Recalculate the full goal with Fit data
    const goalData = await calculateDailyGoal(user, { fitBonus });
    if (Math.abs(goalData.total - user.todayGoal) > 20) {
      user.todayGoal = goalData.total;
      await user.save();
    }

    res.json({
      connected: true,
      steps,
      caloriesBurned,
      activeMinutes,
      heartRate,
      fitBonus,
      breakdown: { stepBonus, activeBonus, calBonus },
      newGoal: goalData.total,
      lastSynced: user.googleFit.lastSynced,
    });
  } catch (err) {
    console.error('Fit today error:', err.response?.data || err.message);
    res.status(500).json({ message: err.message });
  }
});

// ─── Disconnect Google Fit ───────────────────────────────────────────────────
router.delete('/disconnect', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    // Revoke token with Google
    if (user.googleFit?.accessToken) {
      await axios.post(
        `https://oauth2.googleapis.com/revoke?token=${user.googleFit.accessToken}`
      ).catch(() => {}); // ignore revoke errors
    }
    user.googleFit = { connected: false };
    await user.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
