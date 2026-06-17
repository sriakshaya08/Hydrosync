const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name:  { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },

  profile: {
    age:           { type: Number, default: 25 },
    gender:        { type: String, enum: ['male','female','other'], default: 'male' },
    weight:        { type: Number, default: 70 },
    height:        { type: Number, default: 170 },
    activityLevel: { type: String, enum: ['sedentary','light','moderate','active','very_active'], default: 'moderate' }
  },

  healthConditions: {
    kidneyStones:  { type: Boolean, default: false },
    diabetes:      { type: Boolean, default: false },
    hypertension:  { type: Boolean, default: false },
    uti:           { type: Boolean, default: false },
    heartDisease:  { type: Boolean, default: false },
    pregnant:      { type: Boolean, default: false },
    breastfeeding: { type: Boolean, default: false }
  },

  location: {
    city:    { type: String, default: 'Chennai' },
    country: { type: String, default: 'IN' }
  },

  todayGoal:      { type: Number, default: 2000 },
  todayConsumed:  { type: Number, default: 0 },
  lastGoalReset:  { type: Date,   default: Date.now },

  bottleCapacity:   { type: Number, default: 1000 },
  lastBottleWeight: { type: Number, default: 0 },
  bottleCalibration: {
    emptyWeight:  { type: Number,  default: 0 },
    fullWeight:   { type: Number,  default: 0 },
    isCalibrated: { type: Boolean, default: false }
  },

  notificationPrefs: {
    reminderEnabled:    { type: Boolean, default: true },
    reminderInterval:   { type: Number,  default: 60 },
    achievementAlerts:  { type: Boolean, default: true },
    weatherAlerts:      { type: Boolean, default: true },
    activityAlerts:     { type: Boolean, default: true }
  },

  // ── Google Fit OAuth tokens & cached data ────────────────────────────────
  googleFit: {
    connected:     { type: Boolean, default: false },
    accessToken:   { type: String },
    refreshToken:  { type: String },
    expiresAt:     { type: Number },
    todayFitBonus: { type: Number, default: 0 },
    lastSynced:    { type: Date }
  },

  stats: {
    streak:         { type: Number, default: 0 },
    totalLiters:    { type: Number, default: 0 },
    goalsMetCount:  { type: Number, default: 0 },
    longestStreak:  { type: Number, default: 0 }
  },

  createdAt: { type: Date, default: Date.now }
});

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.matchPassword = async function (entered) {
  return await bcrypt.compare(entered, this.password);
};

userSchema.methods.getBMI = function () {
  const h = this.profile.height / 100;
  return this.profile.weight / (h * h);
};

module.exports = mongoose.model('User', userSchema);
