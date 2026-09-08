import fs from 'fs';
import path from 'path';

const legacyPath = path.resolve('node_modules/tiktok-live-connector/dist/legacy.js');

if (fs.existsSync(legacyPath)) {
  let content = fs.readFileSync(legacyPath, 'utf8');

  // Fix 1: getTopViewerAttributes
  if (content.includes('return topViewers.map((viewer) => {')) {
    content = content.replace(
      'function getTopViewerAttributes(topViewers) {\n\treturn topViewers.map((viewer) => {',
      'function getTopViewerAttributes(topViewers) {\n\tif (!Array.isArray(topViewers)) return [];\n\treturn topViewers.map((viewer) => {'
    );
    console.log('[Patch] Fixed getTopViewerAttributes in tiktok-live-connector');
  }

  // Fix 2: emotes map
  if (content.includes('webcastObject.emotes = webcastObject.emotes.map((emote) => ({')) {
    content = content.replace(
      'webcastObject.emotes = webcastObject.emotes.map((emote) => ({',
      'webcastObject.emotes = Array.isArray(webcastObject.emotes) ? webcastObject.emotes.map((emote) => ({'
    ).replace(
      'placeInComment: emote.placeInComment\n\t\t\t\t}));',
      'placeInComment: emote.placeInComment\n\t\t\t\t})) : [];'
    );
    console.log('[Patch] Fixed emotes in tiktok-live-connector');
  }

  // Fix 3: emoteList map
  if (content.includes('webcastObject.emotes = webcastObject.emoteList.map((emote) => ({')) {
    content = content.replace(
      'webcastObject.emotes = webcastObject.emoteList.map((emote) => ({',
      'webcastObject.emotes = Array.isArray(webcastObject.emoteList) ? webcastObject.emoteList.map((emote) => ({'
    ).replace(
      'emoteImageUrl: emote.image?.urlList[0]\n\t\t\t\t}));',
      'emoteImageUrl: emote.image?.urlList?.[0]\n\t\t\t\t})) : [];'
    );
    console.log('[Patch] Fixed emoteList in tiktok-live-connector');
  }

  fs.writeFileSync(legacyPath, content, 'utf8');
}
