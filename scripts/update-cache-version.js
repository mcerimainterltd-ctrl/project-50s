const fs = require('fs');
const path = require('path');

const swPath = path.join(__dirname, '..', 'service-worker.js');
let code = fs.readFileSync(swPath, 'utf8');

const version = Date.now();

code = code.replace(
  /const CACHE_NAME = "xamepage-v[\d.]+-v\d+"/,
  `const CACHE_NAME = "xamepage-v2.1-v${version}"`
);

code = code.replace(
  /const IMAGE_CACHE = 'xamepage-images-v\d+'/,
  `const IMAGE_CACHE = 'xamepage-images-v${version}'`
);

fs.writeFileSync(swPath, code);
console.log(`Cache version updated to: ${version}`);
