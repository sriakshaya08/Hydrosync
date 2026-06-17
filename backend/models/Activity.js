const mongoose = require('mongoose');

const activitySchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: {
    type: String,
    enum: ['running', 'cycling', 'swimming', 'gym', 'yoga', 'walking', 'hiit', 'sports', 'other'],
    required: true
  },
  intensity: {
    type: String,
    enum: ['light', 'moderate', 'intense'],
    required: true
  },
  duration: { type: Number, required: true },     // minutes
  extraWaterNeeded: { type: Number, default: 0 }, // ml added to goal
  timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Activity', activitySchema);
