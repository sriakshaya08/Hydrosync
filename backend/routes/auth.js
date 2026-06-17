const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const { calculateDailyGoal } = require('../services/goalService');

// Generate JWT
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });
};

// @POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, profile, healthConditions, location } = req.body;
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ message: 'Email already registered' });

    const user = await User.create({ name, email, password, profile, healthConditions, location });

    // Calculate initial goal
    const goalData = await calculateDailyGoal(user);
    user.todayGoal = goalData.total;
    await user.save();

    res.status(201).json({
      token: generateToken(user._id),
      user: sanitize(user)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// @POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !(await user.matchPassword(password))) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Reset goal if new day
    await checkAndResetDailyGoal(user);

    res.json({
      token: generateToken(user._id),
      user: sanitize(user)
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @GET /api/auth/me
router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    await checkAndResetDailyGoal(user);
    res.json(sanitize(user));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @PUT /api/auth/profile
router.put('/profile', protect, async (req, res) => {
  try {
    const { profile, healthConditions, location, notificationPrefs, bottleCapacity } = req.body;
    const user = await User.findById(req.user.id);

    if (profile) user.profile = { ...user.profile.toObject(), ...profile };
    if (healthConditions) user.healthConditions = { ...user.healthConditions.toObject(), ...healthConditions };
    if (location) user.location = { ...user.location.toObject(), ...location };
    if (notificationPrefs) user.notificationPrefs = { ...user.notificationPrefs.toObject(), ...notificationPrefs };
    
    // ✅ FIX 4: Support bottleCapacity update from profile page
    if (bottleCapacity && bottleCapacity > 0 && bottleCapacity < 10000) {
      user.bottleCapacity = parseInt(bottleCapacity);
    }

    // Recalculate goal with new profile
    const { calculateDailyGoal } = require('../services/goalService');
    const goalData = await calculateDailyGoal(user);
    user.todayGoal = goalData.total;

    await user.save();
    res.json({ user: sanitize(user), goalData });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Helper: check if new day and reset
async function checkAndResetDailyGoal(user) {
  const now = new Date();
  const lastReset = new Date(user.lastGoalReset);
  const isNewDay = now.toDateString() !== lastReset.toDateString();

  if (isNewDay) {
    // Check if yesterday's goal was met → update streak
    if (user.todayConsumed >= user.todayGoal * 0.9) {
      user.stats.streak += 1;
      user.stats.goalsMetCount += 1;
      if (user.stats.streak > user.stats.longestStreak) {
        user.stats.longestStreak = user.stats.streak;
      }
    } else if (user.todayConsumed > 0) {
      user.stats.streak = 0;
    }

    user.todayConsumed = 0;
    user.lastGoalReset = now;

    const { calculateDailyGoal } = require('../services/goalService');
    const goalData = await calculateDailyGoal(user);
    user.todayGoal = goalData.total;
    await user.save();
  }
  return user;
}

function sanitize(user) {
  const u = user.toObject();
  delete u.password;
  return u;
}

module.exports = router;
