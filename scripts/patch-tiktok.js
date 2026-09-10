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

  // Fix 4: Preserve user attributes in WebcastLikeMessage / Webcast messages where displayId might be missing or numeric id
  if (content.includes('uniqueId: webcastUser.displayId !== "" ? webcastUser.displayId : void 0,')) {
    content = content.replace(
      'userId: webcastUser.idStr?.toString(),',
      'userId: (webcastUser.idStr || webcastUser.id)?.toString(),'
    ).replace(
      'uniqueId: webcastUser.displayId !== "" ? webcastUser.displayId : void 0,',
      'uniqueId: (webcastUser.displayId && webcastUser.displayId !== "") ? webcastUser.displayId : (webcastUser.uniqueId || (webcastUser.idStr || webcastUser.id)?.toString() || void 0),'
    ).replace(
      'nickname: webcastUser.nickname !== "" ? webcastUser.nickname : void 0,',
      'nickname: (webcastUser.nickname && webcastUser.nickname !== "") ? webcastUser.nickname : (webcastUser.displayId || webcastUser.uniqueId || "Người xem"),'
    );
    console.log('[Patch] Fixed getUserAttributes in tiktok-live-connector');
  }

  // Fix 5: Keep rawUser reference instead of deleting originalObject.user completely
  if (content.includes('delete webcastObject.user;')) {
    content = content.replace(
      'delete webcastObject.user;',
      'webcastObject.rawUser = webcastObject.user;'
    );
    console.log('[Patch] Preserved rawUser in simplifyObject');
  }

  // Fix 6: Fix avatar profilePictureUrl to use avatarThumb / avatarMedium / avatarLarge urlList
  if (content.includes('profilePictureUrl: getPreferredPictureFormat(webcastUser.avatarLarge),')) {
    content = content.replace(
      'profilePictureUrl: getPreferredPictureFormat(webcastUser.avatarLarge),',
      'profilePictureUrl: getPreferredPictureFormat(webcastUser.avatarThumb?.urlList || webcastUser.avatarMedium?.urlList || webcastUser.avatarLarge?.urlList || webcastUser.avatarThumb || webcastUser.avatarLarge),'
    );
    console.log('[Patch] Fixed profilePictureUrl in getUserAttributes');
  }

  // Fix 7: Support object with urlList in getPreferredPictureFormat
  if (content.includes('function getPreferredPictureFormat(pictureUrls) {')) {
    content = content.replace(
      'function getPreferredPictureFormat(pictureUrls) {',
      'function getPreferredPictureFormat(pictureUrls) {\n\tif (pictureUrls && !Array.isArray(pictureUrls) && Array.isArray(pictureUrls.urlList)) pictureUrls = pictureUrls.urlList;'
    );
    console.log('[Patch] Fixed getPreferredPictureFormat');
  }

  fs.writeFileSync(legacyPath, content, 'utf8');
}
