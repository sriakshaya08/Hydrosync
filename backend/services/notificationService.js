const Notification = require('../models/Notification');

const ICONS = {
  reminder: '⏰',
  goal_increased: '📈',
  goal_met: '🏆',
  streak: '🔥',
  weather: '🌡️',
  activity: '💪',
  achievement: '⭐',
  system: '🔔'
};

async function createNotification(userId, type, title, message, metadata = {}, priority = 'normal') {
  try {
    const notif = await Notification.create({
      user: userId,
      type,
      title,
      message,
      icon: ICONS[type] || '💧',
      priority,
      metadata
    });
    return notif;
  } catch (err) {
    console.error('Notification creation error:', err.message);
    return null;
  }
}

async function getUnreadCount(userId) {
  return await Notification.countDocuments({ user: userId, isRead: false });
}

module.exports = { createNotification, getUnreadCount, ICONS };
