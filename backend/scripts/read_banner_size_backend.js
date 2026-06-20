const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const bannerPath = path.join(__dirname, '..', '..', 'frontend', 'public', 'banner.png');
console.log('Path:', bannerPath);

sharp(bannerPath)
  .metadata()
  .then(metadata => {
    console.log(`Width: ${metadata.width}, Height: ${metadata.height}`);
    console.log(`Aspect ratio: ${metadata.width / metadata.height}`);
  })
  .catch(err => {
    console.error(err);
  });
