/**
 * Voter model — maps to DB1 (voter_db / DigitalOcean).
 * READ-ONLY. Never write to this collection.
 * Routes use getVoterDb().collection('voters') directly for flexibility.
 * This schema is kept as a reference for the data structure.
 */
const { mongoose } = require('../db'); // appConn — use voterConn if Mongoose model queries needed

const voterSchema = new mongoose.Schema({
  EPIC_NO:       { type: String, required: true, unique: true, index: true },
  FM_NAME_EN:    { type: String },
  LASTNAME_EN:   { type: String },
  VOTER_NAME:    { type: String },
  FM_NAME_V1:    { type: String },
  LASTNAME_V1:   { type: String },
  ASSEMBLY_NAME: { type: String },
  ASSEMBLY_NO:   { type: String },
  AC_NO:         { type: String },
  DISTRICT_NAME: { type: String },
  DISTRICT:      { type: String },
  DISTRICT_ID:   { type: String },
  PART_NO:       { type: mongoose.Schema.Types.Mixed },
  PART_NAME:     { type: String },
  SECTION_NO:    { type: mongoose.Schema.Types.Mixed },
  SLNOINPART:    { type: mongoose.Schema.Types.Mixed },
  AGE:           { type: mongoose.Schema.Types.Mixed },
  GENDER:        { type: String },
  DOB:           { type: String },
  RLN_TYPE:      { type: String },
  RLN_FM_NM_EN:  { type: String },
  RLN_L_NM_EN:   { type: String },
  RLN_FM_NM_V1:  { type: String },
  RLN_L_NM_V1:   { type: String },
  C_HOUSE_NO:    { type: String },
  C_HOUSE_NO_V1: { type: String },
  HOUSE_NO:      { type: String },
  MOBILE_NO:     { type: String },
  MOBILE_NUMBER: { type: String },
  ORG_LIST_NO:   { type: mongoose.Schema.Types.Mixed },
}, { strict: false, collection: 'voters' });

// NOTE: Do not export this as a writable model.
// All voter reads go through getVoterDb().collection('voters') in routes.
module.exports = voterSchema;
