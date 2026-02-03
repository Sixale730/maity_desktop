const fs = require('fs');
const path = require('path');

const dirsToClean = ['.next', 'out'];

dirsToClean.forEach(dir => {
  const fullPath = path.join(__dirname, '..', dir);
  try {
    fs.rmSync(fullPath, { recursive: true, force: true });
    console.log(`Cleaned ${dir}/`);
  } catch (e) {
    // Directory may not exist, that's fine
  }
});
