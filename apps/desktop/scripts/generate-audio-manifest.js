// Generate public/audio/manifest.json by scanning the audio folder
// Usage: node scripts/generate-audio-manifest.js

const fs = require('fs');
const path = require('path');

function walk(dir, exts) {
    let results = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results = results.concat(walk(p, exts));
        } else if (exts.includes(path.extname(entry.name).toLowerCase())) {
            results.push(p);
        }
    }
    return results;
}

function main() {
    const root = path.resolve(__dirname, '..');
    const publicDir = path.join(root, 'renderer', 'public');
    const audioDir = path.join(publicDir, 'audio');
    const manifestPath = path.join(publicDir, 'audio', 'manifest.json');

    if (!fs.existsSync(audioDir)) {
        console.log(`[audio manifest] No audio folder found at ${audioDir}, skipping.`);
        return;
    }

    const files = walk(audioDir, ['.mp3', '.wav', '.ogg']).map(p => {
        // Convert absolute path to public-relative (prefix with ./audio for renderer usage)
        const rel = path.relative(publicDir, p).replace(/\\/g, '/');
        return `./${rel}`;
    });

    // Ensure directory exists
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify(files, null, 2));
    console.log(`[audio manifest] Generated ${manifestPath} with ${files.length} items.`);
}

main();
