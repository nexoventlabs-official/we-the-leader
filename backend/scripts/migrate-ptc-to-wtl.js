/**
 * Migration Script: PTC Code to WTL Code
 * =======================================
 * Copies existing ptc_code -> wtl_code and referred_by_ptc -> referred_by_wtl
 * across generated_voters, volunteer_requests, and booth_agent_requests.
 * 
 * Run using: node scripts/migrate-ptc-to-wtl.js
 */
require('dotenv').config();
const { appConn } = require('../src/db');
const mongoose = require('mongoose');

async function migrate() {
  try {
    console.log('Connecting to database...');
    // Setup mongoose connection using environment variables
    const mongoUri = process.env.MONGO_URI;
    const mongoDbName = process.env.MONGO_DB || 'wetheleaders';
    
    if (!mongoUri) {
      throw new Error('MONGO_URI env variable is missing.');
    }

    const conn = await mongoose.createConnection(mongoUri, {
      dbName: mongoDbName
    }).asPromise();

    console.log(`Connected to database: ${mongoDbName}`);

    const db = conn.db;

    // 1. Migrate generated_voters ptc_code -> wtl_code
    console.log('Migrating generated_voters...');
    const voterResult1 = await db.collection('generated_voters').updateMany(
      { ptc_code: { $exists: true }, wtl_code: { $exists: false } },
      [
        { $set: { wtl_code: "$ptc_code" } }
      ]
    );
    console.log(`- Copied ptc_code -> wtl_code for ${voterResult1.modifiedCount} voters.`);

    // 2. Migrate generated_voters referred_by_ptc -> referred_by_wtl
    const voterResult2 = await db.collection('generated_voters').updateMany(
      { referred_by_ptc: { $exists: true }, referred_by_wtl: { $exists: false } },
      [
        { $set: { referred_by_wtl: "$referred_by_ptc" } }
      ]
    );
    console.log(`- Copied referred_by_ptc -> referred_by_wtl for ${voterResult2.modifiedCount} voters.`);

    // 3. Migrate volunteer_requests ptc_code -> wtl_code
    console.log('Migrating volunteer_requests...');
    const volunteerResult = await db.collection('volunteer_requests').updateMany(
      { ptc_code: { $exists: true }, wtl_code: { $exists: false } },
      [
        { $set: { wtl_code: "$ptc_code" } }
      ]
    );
    console.log(`- Copied ptc_code -> wtl_code for ${volunteerResult.modifiedCount} volunteers.`);

    // 4. Migrate booth_agent_requests ptc_code -> wtl_code
    console.log('Migrating booth_agent_requests...');
    const boothResult = await db.collection('booth_agent_requests').updateMany(
      { ptc_code: { $exists: true }, wtl_code: { $exists: false } },
      [
        { $set: { wtl_code: "$ptc_code" } }
      ]
    );
    console.log(`- Copied ptc_code -> wtl_code for ${boothResult.modifiedCount} booth agents.`);

    console.log('Migration completed successfully!');
    await conn.close();
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

migrate();
