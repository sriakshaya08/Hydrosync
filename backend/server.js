require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const express = require('express');
const cors    = require('cors');
const cron    = require('node-cron');
const connectDB = require('./db');

const app = express();
connectDB();
app.use(cors());
app.use(express.json());

const path = require('path');
app.use(express.static(path.join(__dirname, '../frontend')));

// ✅ ROUTES
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/hydration',     require('./routes/hydration'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/googlefit',     require('./routes/googleFit'));

// 🔥 WEATHER ROUTE (your addition)
app.use('/api/weather',       require('./routes/weather'));
app.use('/api/bot',           require('./routes/bot'));


// Daily reset at midnight
cron.schedule('0 0 * * *', async () => {
  try {
    const User = require('./models/User');
    const Notification = require('./models/Notification');
    const { calculateDailyGoal } = require('./services/goalService');
    const users = await User.find({});
    for (const user of users) {
      if (user.todayConsumed >= user.todayGoal * 0.9 && user.todayConsumed > 0) {
        user.stats.streak      += 1;
        user.stats.goalsMetCount += 1;
        if (user.stats.streak > user.stats.longestStreak) user.stats.longestStreak = user.stats.longestStreak;
        await Notification.create({
          user: user._id,
          type: 'streak',
          title: `${user.stats.streak}-Day Streak!`,
          message: `You hit your goal ${user.stats.streak} days in a row!`,
          icon: '🔥',
          priority: 'high'
        });
      } else if (user.todayConsumed > 0) {
        user.stats.streak = 0;
      }

      user.todayConsumed = 0;
      user.lastGoalReset = new Date();

      if (user.googleFit) user.googleFit.todayFitBonus = 0;

      const goalData = await calculateDailyGoal(user);
      user.todayGoal = goalData.total;

      await user.save();
    }
  } catch(e) {
    console.error('Cron reset error:', e.message);
  }
});


// Hourly reminders 7AM-10PM
cron.schedule('0 * * * *', async () => {
  const hour = new Date().getHours();
  if (hour < 7 || hour > 22) return;

  try {
    const User = require('./models/User');
    const Notification = require('./models/Notification');
    const users = await User.find({ 'notificationPrefs.reminderEnabled': true });

    for (const user of users) {
      const pct = Math.round((user.todayConsumed / user.todayGoal) * 100);

      if (pct < 100) {
        const remaining = Math.max(0, user.todayGoal - user.todayConsumed);

        await Notification.create({
          user: user._id,
          type: 'reminder',
          title: 'Hydration Reminder',
          message: `Stay on track! ${remaining}ml remaining today (${pct}% done).`,
          icon: '💧',
          priority: pct < 30 ? 'high' : 'normal'
        });
      }
    }
  } catch(e) {
    console.error('Reminder cron error:', e.message);
  }
});


// 🔥 ONLY IMPORTANT FIX (DO NOT REMOVE)
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Smart Bottle server on port ${PORT}`);
});