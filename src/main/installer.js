const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { shell } = require('electron');

class ExplorerModule {
  openFolder(targetPath) {
    if (!targetPath || typeof targetPath !== 'string') return;

    try {
      let resolved = targetPath.replace(/["']/g, '').trim();
      resolved = path.normalize(resolved);

      if (fs.existsSync(resolved)) {
        const stat = fs.statSync(resolved);
        if (stat.isDirectory()) {
          exec(`explorer.exe "${resolved}"`);
        } else {
          shell.showItemInFolder(resolved);
        }
        return;
      }

      const parent = path.dirname(resolved);
      if (fs.existsSync(parent)) {
        exec(`explorer.exe "${parent}"`);
        return;
      }

      exec(`explorer.exe "${resolved}"`);
    } catch (err) {
      console.error('Error in openFolder:', err);
      try {
        exec(`explorer.exe "${targetPath}"`);
      } catch (e) {}
    }
  }
}

module.exports = new ExplorerModule();
