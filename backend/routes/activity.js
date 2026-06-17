const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const User = require('../models/User');
const Activity = require('../models/Activity');
const { calculateActivityWater } = require('../services/goalService');
const { createNotification } = require('../services/notificationService');

// ─── POST /api/activity ─────────────────────────────────────────────────────
router.post('/', protect, async (req, res) => {
  try {
    const { type, intensity, duration } = req.body;
    if (!type || !intensity || !duration) {
      return res.status(400).json({ message: 'type, intensity, duration required' });
    }

    const extraWater = calculateActivityWater(type, intensity, duration);
    const user = await User.findById(req.user.id);

    // Increase today's goal
    const oldGoal = user.todayGoal;
    user.todayGoal += extraWater;
    await user.save();

    await Activity.create({ user: user._id, type, intensity, duration, extraWaterNeeded: extraWater });

    // Notify
    await createNotification(
      user._id, 'goal_increased',
      '💪 Workout Logged!',
      `Your ${duration}min ${intensity} ${type} session added ${extraWater}ml to your goal. New goal: ${user.todayGoal}ml`,
      { type, intensity, duration, extraWater, oldGoal, newGoal: user.todayGoal },
      'high'
    );

    res.json({
      message: 'Activity logged',
      extraWaterNeeded: extraWater,
      oldGoal,
      newGoal: user.todayGoal,
      todayConsumed: user.todayConsumed,
      percentage: Math.min(100, Math.round((user.todayConsumed / user.todayGoal) * 100))
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── GET /api/activity ──────────────────────────────────────────────────────
router.get('/', protect, async (req, res) => {
  try {
    const since = new Date();
    since.setDate(since.getDate() - 7);
    const activities = await Activity.find({ user: req.user.id, timestamp: { $gte: since } })
      .sort({ timestamp: -1 });
    res.json(activities);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
