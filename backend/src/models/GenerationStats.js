const { mongoose } = require('../db');
const generationStatsSchema = new mongoose.Schema({
  epic_no:      { type: String, required: true, unique: true, index: true },
  auth_mobile:  { type: String, index: true },
  card_url:     { type: String },
  back_url:     { type: String },
  combined_url: { type: String },
  photo_url:    { type: String },
  count:        { type: Number, default: 0 },
  last_generated: { type: Date },
  secret_pin:   { type: String },
}, { collection: 'generation_stats' });
module.exports = mongoose.model('GenerationStats', generationStatsSchema);
