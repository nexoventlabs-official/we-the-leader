const { mongoose } = require('../db');
const boothAgentRequestSchema = new mongoose.Schema({
  wtl_code:     { type: String, index: true },
  epic_no:      { type: String },
  name:         { type: String },
  mobile:       { type: String },
  booth_no:     { type: String },
  assembly:     { type: String },
  district:     { type: String },
  status:       { type: String, enum: ['pending','confirmed','rejected'], default: 'pending' },
  requested_at: { type: Date },
  reviewed_at:  { type: Date },
  reviewed_by:  { type: String },
}, { collection: 'booth_agent_requests' });
module.exports = mongoose.model('BoothAgentRequest', boothAgentRequestSchema);
