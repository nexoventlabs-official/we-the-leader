/**
 * Tiny helper to read/update key=value lines in backend/.env
 * without disturbing comments or unrelated keys.
 */
const fs   = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '..', '.env');

function read() {
  if (!fs.existsSync(ENV_PATH)) return '';
  return fs.readFileSync(ENV_PATH, 'utf8');
}

function setKeys(updates) {
  let content = read();
  const lines = content.split(/\r?\n/);
  const keys  = Object.keys(updates);
  const seen  = new Set();

  const out = lines.map((line) => {
    const m = line.match(/^([A-Z0-9_]+)=/);
    if (!m) return line;
    const key = m[1];
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      seen.add(key);
      const v = updates[key];
      const needsQuote = /[\s"=#]/.test(v) || v.includes('\\n');
      return `${key}=${needsQuote ? `"${v.replace(/"/g, '\\"')}"` : v}`;
    }
    return line;
  });

  for (const k of keys) {
    if (seen.has(k)) continue;
    const v = updates[k];
    const needsQuote = /[\s"=#]/.test(v) || v.includes('\\n');
    out.push(`${k}=${needsQuote ? `"${v.replace(/"/g, '\\"')}"` : v}`);
  }

  fs.writeFileSync(ENV_PATH, out.join('\n'));
}

module.exports = { ENV_PATH, read, setKeys };
