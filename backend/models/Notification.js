const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: {
    type: String,
    enum: ['reminder', 'goal_increased', 'goal_met', 'streak', 'weather', 'activity', 'achievement', 'system'],
    required: true
  },
  title: { type: String, required: true },
  message: { type: String, required: true },
  icon: { type: String, default: '💧' },
  isRead: { type: Boolean, default: false },
  priority: { type: String, enum: ['low', 'normal', 'high'], default: 'normal' },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },   // extra data like goalDelta, temp, etc.
  createdAt: { type: Date, default: Date.now }
});

// Index for fast unread count
notificationSchema.index({ user: 1, isRead: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
