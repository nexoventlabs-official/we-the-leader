const { mongoose } = require('../db');
const volunteerRequestSchema = new mongoose.Schema({
  wtl_code:     { type: String, index: true },
  epic_no:      { type: String },
  name:         { type: String },
  mobile:       { type: String },
  assembly:     { type: String },
  district:     { type: String },
  status:       { type: String, enum: ['pending','confirmed','rejected'], default: 'pending' },
  requested_at: { type: Date },
  reviewed_at:  { type: Date },
  reviewed_by:  { type: String },
}, { collection: 'volunteer_requests' });
module.exports = mongoose.model('VolunteerRequest', volunteerRequestSchema);
