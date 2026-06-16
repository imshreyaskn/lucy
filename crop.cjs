const sharp = require('sharp');
sharp('public/icon.png')
  .resize(256, 256, { fit: 'cover', position: 'top' })
  .toFile('public/icon_square.png')
  .then(() => console.log('Done cropped'));
