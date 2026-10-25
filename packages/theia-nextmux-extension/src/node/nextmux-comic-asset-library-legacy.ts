import type { DesktopComicCharacterLibraryEntry } from '../common/nextmux-platform-protocol';
import type { ComicAssetLibraryEntry } from '../common/nextmux-comic-asset-library';

/** A read-through view of one existing bundle. No provider identity or second copy is fabricated. */
export function characterLibraryAsset(entry:DesktopComicCharacterLibraryEntry):ComicAssetLibraryEntry {
    return {assetId:`character-library:${entry.bundleId}`,assetName:entry.name,assetCategory:'character',
        assetType:'image',remark:entry.description??'',createdAt:entry.createdAt,
        source:{origin:'character',projectId:entry.sourceProjectId,nodeId:entry.sourceCharacterId},
        ...(entry.thumbnailPath?{mediaPath:entry.thumbnailPath}:{textContent:[entry.name,entry.appearance,entry.description].filter(Boolean).join('\n').slice(0,1000)}),
        characterBundleId:entry.bundleId,character:{appearance:entry.appearance,description:entry.description,
            identityVersion:entry.identityVersion,referenceCount:entry.referenceCount,authorizationRef:entry.authorizationRef,sourceCharacterId:entry.sourceCharacterId}};
}
export const libraryLocalMediaTypes:Readonly<Record<string,{kind:'image'|'video'|'music';mimeType:string}>>={
    png:{kind:'image',mimeType:'image/png'},jpg:{kind:'image',mimeType:'image/jpeg'},jpeg:{kind:'image',mimeType:'image/jpeg'},
    webp:{kind:'image',mimeType:'image/webp'},bmp:{kind:'image',mimeType:'image/bmp'},
    mp4:{kind:'video',mimeType:'video/mp4'},m4v:{kind:'video',mimeType:'video/mp4'},mov:{kind:'video',mimeType:'video/quicktime'},webm:{kind:'video',mimeType:'video/webm'},
    mp3:{kind:'music',mimeType:'audio/mpeg'},wav:{kind:'music',mimeType:'audio/wav'},m4a:{kind:'music',mimeType:'audio/mp4'},
    aac:{kind:'music',mimeType:'audio/aac'},ogg:{kind:'music',mimeType:'audio/ogg'},opus:{kind:'music',mimeType:'audio/ogg'},flac:{kind:'music',mimeType:'audio/flac'}
};
