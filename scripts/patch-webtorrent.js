const fs = require('fs');
const path = require('path');

// 1. Patch uint8-util arr2hex
const uint8File = path.join(__dirname, '..', 'node_modules', 'uint8-util', 'dist', 'src', 'node.js');
if (fs.existsSync(uint8File)) {
  let content = fs.readFileSync(uint8File, 'utf8');
  if (!content.includes('typeof data === \'string\'')) {
    content = content.replace(
      'export const arr2hex = (data) => Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString(\'hex\');',
      'export const arr2hex = (data) => typeof data === \'string\' ? data : (data && data.buffer ? Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString(\'hex\') : Buffer.from(data || \'\').toString(\'hex\'));'
    );
    fs.writeFileSync(uint8File, content);
    console.log('Patched uint8-util successfully');
  }
}

// 2. Patch webtorrent/lib/torrent.js
const torrentFile = path.join(__dirname, '..', 'node_modules', 'webtorrent', 'lib', 'torrent.js');
if (fs.existsSync(torrentFile)) {
  let content = fs.readFileSync(torrentFile, 'utf8');
  if (content.includes('this._debugId = arr2hex(parsedTorrent.infoHash).substring(0, 7)')) {
    content = content.replace(
      /this\._debugId = arr2hex\(parsedTorrent\.infoHash\)\.substring\(0, 7\)/g,
      'this._debugId = (typeof parsedTorrent.infoHash === \'string\' ? parsedTorrent.infoHash : arr2hex(parsedTorrent.infoHash)).substring(0, 7)'
    );
    fs.writeFileSync(torrentFile, content);
    console.log('Patched webtorrent successfully');
  }
}
