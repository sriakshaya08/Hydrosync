const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const User = require('../models/User');
const Log = require('../models/Log');
const Activity = require('../models/Activity');
const Notification = require('../models/Notification');
const { calculateDailyGoal, calculateActivityBonus } = require('../services/goalService');

// ── POST /api/hydration/sensor ─────────────────────────────────────────────
// Called by ESP32 every 5 seconds with current bottle weight in ml.
// Backend computes consumed = prevLevel - currentLevel and logs it.
router.post('/sensor', async (req, res) => {
  try {
    const {
      userId,
      amount,        // current bottle level in ml  (sent by ESP32)
      calibratedMl,  // alternative key (legacy)
      bottleCap      // optional: bottle capacity sent by firmware
    } = req.body;
    
    // ✅ FIX: Define currentLevel BEFORE using it
    const currentLevel = Number(amount ?? calibratedMl ?? 0) || 0;
    const safeLevel = Math.max(0, currentLevel);
    
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Now that user is loaded, resolve bottle capacity
    const BOTTLE_CAP = parseInt(bottleCap ?? user.bottleCapacity ?? 1000);

    // Initialize or update bottle capacity from request
    if (!user.bottleCapacity || (bottleCap && BOTTLE_CAP !== user.bottleCapacity)) {
      user.bottleCapacity = BOTTLE_CAP;
    }

    // ✅ FIX 3: Check if it's a new day and reset daily consumption
    const now = new Date();
    const lastReset = new Date(user.lastGoalReset || new Date());
    const isNewDay = now.toDateString() !== lastReset.toDateString();

    if (isNewDay) {
      // Update streak based on yesterday's performance
      if (user.todayConsumed >= user.todayGoal * 0.9) {
        user.stats = user.stats || { streak: 0 };
        user.stats.streak = (user.stats.streak || 0) + 1;
        user.stats.goalsMetCount = (user.stats.goalsMetCount || 0) + 1;
        if (user.stats.streak > (user.stats.longestStreak || 0)) {
          user.stats.longestStreak = user.stats.streak;
        }
      } else if (user.todayConsumed > 0) {
        user.stats = user.stats || { streak: 0 };
        user.stats.streak = 0;
      }

      // Reset daily consumption
      user.todayConsumed = 0;
      user.lastGoalReset = now;

      // Recalculate daily goal
      const { calculateDailyGoal } = require('../services/goalService');
      const goalData = await calculateDailyGoal(user);
      user.todayGoal = goalData.total;
    }

    const prevLevel = user.lastBottleWeight ?? currentLevel;
    const diff      = prevLevel - currentLevel;  // positive = water drunk

    let consumed = 0;

    if (diff >= 15) {
      // Water was consumed - only when level DECREASES
      consumed = diff;
      user.todayConsumed = (user.todayConsumed || 0) + consumed;
      if (!user.stats) user.stats = {};
      user.stats.totalLiters =(user.stats.totalLiters || 0) + consumed / 1000;
      user.lastBottleWeight = currentLevel;
      await user.save();

      await Log.create({
        user:        userId,
        amount:      consumed,
        bottleLevel: currentLevel,
        source:      'sensor',
        note:        `Auto-logged: ${consumed}ml from sensor`
      });

      await checkMilestones(user);

    } else if (diff <= -(user.bottleCapacity * 0.2)) {
      // Weight increased significantly → bottle was refilled
      user.lastBottleWeight = currentLevel;
      await user.save();

    } else {
      // Small fluctuation — just update level
      user.lastBottleWeight = currentLevel;
      await user.save();
    }

    const percentage = Math.min(100, Math.round((user.todayConsumed / user.todayGoal) * 100));

    res.json({
      success:      true,
      consumed,
      bottleLevel:  currentLevel,
      bottleCap:    user.bottleCapacity,
      bottlePct:    Math.min(100, Math.round((currentLevel / user.bottleCapacity) * 100)),
      todayConsumed: user.todayConsumed,
      todayGoal:    user.todayGoal,
      percentage
    });

  } catch (err) {
    console.error('Sensor error:', err.message);
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/hydration/log ──────────────────────────────────────────────
router.post('/log', protect, async (req, res) => {
  try {
    const { amount, note } = req.body;
    const user = await User.findById(req.user.id);
    user.todayConsumed += Number(amount);
    user.stats.totalLiters = (user.stats.totalLiters || 0) + Number(amount) / 1000;
    await user.save();
    const log = await Log.create({ user: req.user.id, amount, source: 'manual', note: note || 'Manual entry' });
    await checkMilestones(user);
    res.json({ log, todayConsumed: user.todayConsumed, todayGoal: user.todayGoal,
      percentage: Math.min(100, Math.round((user.todayConsumed / user.todayGoal) * 100)) });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── POST /api/hydration/activity ─────────────────────────────────────────
router.post('/activity', protect, async (req, res) => {
  try {
    const { type, intensity, duration } = req.body;
    const extra = calculateActivityBonus(type, intensity, duration);
    const user = await User.findById(req.user.id);
    user.todayGoal += extra;
    await user.save();
    await Activity.create({ user: req.user.id, type, intensity, duration: Number(duration), extraWaterNeeded: extra });
    await Notification.create({
      user: req.user.id, type: 'goal_increased',
      title: 'Activity Detected! Goal Updated',
      message: `Your ${type} session (${duration} min, ${intensity}) added +${extra}ml to today's goal. Stay hydrated!`,
      icon: '🏋️', priority: 'high',
      metadata: { type, intensity, duration, extra, newGoal: user.todayGoal }
    });
    res.json({ extra, newGoal: user.todayGoal, message: `Goal increased by ${extra}ml` });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── GET /api/hydration/today ─────────────────────────────────────────────
router.get('/today', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const logs = await Log.find({ user: req.user.id, timestamp: { $gte: today } }).sort('-timestamp');
    const goalData = await calculateDailyGoal(user);
    if (Math.abs(goalData.total - user.todayGoal) > 50) { user.todayGoal = goalData.total; await user.save(); }
    const percentage = Math.min(100, Math.round((user.todayConsumed / user.todayGoal) * 100));

    // Calculate how much came from sensor today
    const sensorConsumed = logs.filter(l => l.source === 'sensor').reduce((s, l) => s + l.amount, 0);

    // Calculate hourly data
    const hourlyData = new Array(24).fill(0);
    logs.forEach(log => {
      const hour = new Date(log.timestamp).getHours();
      hourlyData[hour] += log.amount;
    });

    res.json({
      todayConsumed:  user.todayConsumed,
      todayGoal:      user.todayGoal,
      percentage,
      remaining:      Math.max(0, user.todayGoal - user.todayConsumed),
      logs,
      weather:        goalData.weather,
      goalBreakdown:  goalData.breakdown,
      stats:          user.stats,
      bottleLevelMl:  user.lastBottleWeight ?? 0,
      bottleCapacity: user.bottleCapacity ?? 1000,
      sensorConsumed,
      hourlyData
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── GET /api/hydration/history?days=7 ───────────────────────────────────
router.get('/history', protect, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const since = new Date(); since.setDate(since.getDate() - days); since.setHours(0, 0, 0, 0);
    const logs = await Log.find({ user: req.user.id, timestamp: { $gte: since } }).sort('timestamp');
    const byDay = {};
    logs.forEach(log => {
      const day = log.timestamp.toISOString().split('T')[0];
      if (!byDay[day]) byDay[day] = { date: day, total: 0, logs: [] };
      byDay[day].total += log.amount;
      byDay[day].logs.push(log);
    });
    for (let i = 0; i < days; i++) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      if (!byDay[key]) byDay[key] = { date: key, total: 0, logs: [] };
    }
    const sorted = Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date));
    res.json({ history: sorted, stats: req.user?.stats });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── POST /api/hydration/goal/increase ────────────────────────────────────
// Manually add ml to today's goal (e.g. "I need to drink more today")
router.post('/goal/increase', protect, async (req, res) => {
  try {
    const extra = parseInt(req.body.extraMl);
    if (!extra || extra <= 0 || extra > 5000)
      return res.status(400).json({ message: 'Amount must be 1–5000 ml' });
    const user = await User.findById(req.user.id);
    user.todayGoal += extra;
    await user.save();
    res.json({ newGoal: user.todayGoal, added: extra });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── POST /api/hydration/recalculate ─────────────────────────────────────
router.post('/recalculate', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const goalData = await calculateDailyGoal(user);
    user.todayGoal = goalData.total;
    await user.save();
    res.json({ newGoal: goalData.total, breakdown: goalData.breakdown, weather: goalData.weather });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── POST /api/hydration/calibrate ───────────────────────────────────────
router.post('/calibrate', protect, async (req, res) => {
  try {
    const { emptyWeight, fullWeight } = req.body;
    const user = await User.findById(req.user.id);
    user.bottleCalibration = { emptyWeight, fullWeight, isCalibrated: true };
    user.lastBottleWeight = fullWeight;
    await user.save();
    res.json({ success: true, calibration: user.bottleCalibration });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── GET /api/hydration/activities ───────────────────────────────────────
router.get('/activities', protect, async (req, res) => {
  try {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const activities = await Activity.find({ user: req.user.id, timestamp: { $gte: today } }).sort('-timestamp');
    res.json(activities);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── Milestone checker ────────────────────────────────────────────────────
async function checkMilestones(user) {
  const pct = Math.round((user.todayConsumed / user.todayGoal) * 100);
  const milestones = [25, 50, 75, 100];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (const m of milestones) {
    if (pct >= m) {
      const exists = await Notification.findOne({
        user: user._id,
        type: m === 100 ? 'goal_met' : 'achievement',
        createdAt: { $gte: today },
        'metadata.milestone': m
      });
      if (!exists) {
        const msgs = {
          25:  { title: '💧 Quarter Way There!', msg: `You've hit 25% of your ${user.todayGoal}ml goal!`, icon: '💧' },
          50:  { title: '⚡ Halfway Done!',       msg: `Halfway to your ${user.todayGoal}ml goal!`, icon: '⚡' },
          75:  { title: '🔥 Almost There!',       msg: `75% done! Just ${Math.round(user.todayGoal * 0.25)}ml more!`, icon: '🔥' },
          100: { title: '🎉 Goal Achieved!',      msg: `You've crushed your ${user.todayGoal}ml goal! Streak: ${user.stats?.streak || 0} days!`, icon: '🏆' }
        };
        const d = msgs[m];
        await Notification.create({
          user: user._id, type: m === 100 ? 'goal_met' : 'achievement',
          title: d.title, message: d.msg, icon: d.icon,
          priority: m === 100 ? 'high' : 'normal', metadata: { milestone: m }
        });
      }
    }
  }
}

module.exports = router;
