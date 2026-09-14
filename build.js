const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const output = path.join(root, 'public');
const files = [
  'index.html',
  'styles.css',
  'app.js',
  'manifest.json',
  'sw.js',
  'default-plan.svg',
  'favicon.svg'
];

fs.mkdirSync(output, { recursive: true });
for (const file of files) {
  const source = path.join(root, file);
  if (fs.existsSync(source)) fs.copyFileSync(source, path.join(output, file));
}
console.log(`Vercel static build tayyor: ${files.length} fayl public papkasiga chiqarildi.`);
