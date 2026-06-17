const mongoose = require('mongoose');

const logSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true },     // ml consumed in this log
  bottleLevel: { type: Number, default: 0 },   // ml remaining in bottle after reading
  source: {
    type: String,
    enum: ['sensor', 'manual', 'system'],
    default: 'sensor'
  },
  temperature: { type: Number },               // ambient temperature at time of log (°C)
  note: { type: String, default: '' },
  timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Log', logSchema);
