const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const output = path.join(root, 'public');
const files = [
  'index.html',
  'styles.css',
  'client.js',
  'manifest.json',
  'sw.js',
  'default-plan.svg',
  'favicon.svg',
  'vercel.json'
];
const assetDirectory = path.join(root, 'assets');
const outputAssetDirectory = path.join(output, 'assets');

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
for (const file of files) {
  const source = path.join(root, file);
  if (fs.existsSync(source)) fs.copyFileSync(source, path.join(output, file));
}
if (fs.existsSync(assetDirectory)) {
  fs.cpSync(assetDirectory, outputAssetDirectory, { recursive: true });
}
console.log(`Vercel static build tayyor: ${files.length} fayl va assets papkasi public papkasiga chiqarildi.`);
