/**
 * Clear MongoDB generated users and Cloudinary uploaded images
 * Usage: node scripts/clear-db-and-cloudinary.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function clearDatabase() {
  try {
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI, {
      dbName: process.env.MONGO_DB,
    });

    const db = mongoose.connection.db;

    // Collections to clear
    const collectionsToClear = [
      'generation_stats',
      'generated_voters',
      'otp_sessions',
      'verified_mobiles',
      'outbound_messages',
    ];

    for (const collName of collectionsToClear) {
      try {
        const result = await db.collection(collName).deleteMany({});
        console.log(`✓ Cleared ${collName}: ${result.deletedCount} documents removed`);
      } catch (err) {
        console.log(`⚠ ${collName} not found or error:`, err.message);
      }
    }

    console.log('\n✅ MongoDB cleanup complete');
  } catch (err) {
    console.error('❌ MongoDB error:', err.message);
  } finally {
    await mongoose.connection.close();
  }
}

async function clearCloudinary() {
  try {
    console.log('\n☁️  Clearing Cloudinary images...');

    const folders = [
      process.env.CLOUDINARY_PHOTO_FOLDER || 'member_photos',
      process.env.CLOUDINARY_CARDS_FOLDER || 'generated_cards',
    ];

    for (const folder of folders) {
      try {
        console.log(`\n📁 Processing folder: ${folder}`);
        
        // List all resources in the folder
        let nextCursor = null;
        let totalDeleted = 0;

        do {
          const result = await cloudinary.api.resources({
            type: 'upload',
            prefix: folder,
            max_results: 500,
            next_cursor: nextCursor,
          });

          for (const resource of result.resources) {
            try {
              await cloudinary.uploader.destroy(resource.public_id);
              totalDeleted++;
            } catch (err) {
              console.warn(`⚠ Failed to delete ${resource.public_id}:`, err.message);
            }
          }

          nextCursor = result.next_cursor;
        } while (nextCursor);

        console.log(`✓ Deleted ${totalDeleted} images from ${folder}`);
      } catch (err) {
        console.log(`⚠ Folder ${folder} error:`, err.message);
      }
    }

    console.log('\n✅ Cloudinary cleanup complete');
  } catch (err) {
    console.error('❌ Cloudinary error:', err.message);
  }
}

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  WTL: Database & Cloudinary Cleanup');
  console.log('═══════════════════════════════════════════\n');

  await clearDatabase();
  await clearCloudinary();

  console.log('\n═══════════════════════════════════════════');
  console.log('  ✅ All cleanup operations completed');
  console.log('═══════════════════════════════════════════');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
