import fs from 'fs';
import path from 'path';

const html = fs.readFileSync('public/index.html', 'utf8');
const css = fs.readFileSync('public/css/style.css', 'utf8');
const js = fs.readFileSync('public/js/app.js', 'utf8');

const content = `// Auto-generated. Do not edit manually.
export const embeddedAssets = {
  indexHtml: ${JSON.stringify(html)},
  styleCss: ${JSON.stringify(css)},
  appJs: ${JSON.stringify(js)}
};
`;

fs.writeFileSync('src/embeddedAssets.js', content, 'utf8');
console.log('[Assets] Embedded public assets into src/embeddedAssets.js');
