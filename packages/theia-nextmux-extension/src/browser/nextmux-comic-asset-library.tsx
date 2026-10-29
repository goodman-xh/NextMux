import * as React from '@theia/core/shared/react';
import URI from '@theia/core/lib/common/uri';
import { comicAssetLibraryMatches, sortComicAssetLibrary, type ComicAssetCategory, type ComicAssetLibraryFilter, type ComicAssetLibraryEntry } from '../common/nextmux-comic-asset-library';
import { comicAssetLibraryText } from './nextmux-comic-asset-library-text';
import { assetLibraryOperations, runAssetLibraryOperation } from './nextmux-comic-asset-library-operations';
import { ImeInput } from './nextmux-ime-field';
import '../../src/browser/style/nextmux-comic-asset-library.css';

export interface CanvasAssetLibraryDialogProps {
    readonly locale:string;readonly load:()=>Promise<readonly ComicAssetLibraryEntry[]>;
    readonly onUse?:(assetId:string,requestId:string,entry:ComicAssetLibraryEntry)=>Promise<void>;readonly onClose:()=>void;
    readonly useLabel?:string;readonly onManageCharacters?:()=>void;
    readonly operationScope?:string;readonly initialFilter?:ComicAssetLibraryFilter;
    readonly selectTypes?:readonly ('image'|'video'|'audio'|'text')[];
    readonly onUpload?:(defaultCategory?:ComicAssetCategory,retryFailed?:boolean)=>Promise<readonly ComicAssetLibraryEntry[]>;
    readonly onPin?:(assetId:string,pinned:boolean)=>Promise<void>;
    readonly onCategoryChange?:(assetId:string,category:ComicAssetCategory)=>Promise<void>;
    readonly onRename?:(item:ComicAssetLibraryEntry,name:string)=>Promise<void>|void;
    readonly onDelete?:(assetId:string)=>Promise<void>;
    readonly onCharacter?:(entry:ComicAssetLibraryEntry)=>void;
    readonly revision?:number;
    /** Shared widget snapshot; the drawer and dialog consume the same immutable list. */
    readonly entries?:readonly ComicAssetLibraryEntry[];
    /** Resolves in-app Opus-audio playback copies for local .mp4/.m4v/.mov videos whose AAC audio Chromium cannot decode. */
    readonly preparePlaybackFiles?:(filePaths:readonly string[])=>Promise<Record<string,string>>;
}
export function CanvasAssetLibraryDialog(props:CanvasAssetLibraryDialogProps):React.ReactElement {
    const t=(key:Parameters<typeof comicAssetLibraryText>[1])=>comicAssetLibraryText(props.locale,key);
    const [loadedEntries,setEntries]=React.useState<readonly ComicAssetLibraryEntry[]>(props.entries??[]),[category,setCategory]=React.useState<ComicAssetLibraryFilter>(props.initialFilter??'all');
    const syncedPropEntries=React.useRef(props.entries);
    let entries=loadedEntries;
    if(props.entries!==undefined&&syncedPropEntries.current!==props.entries){
        syncedPropEntries.current=props.entries;
        entries=props.entries;
        setEntries(props.entries);
    }
    const [loading,setLoading]=React.useState(props.entries===undefined),[error,setError]=React.useState(''),[reload,setReload]=React.useState(0),[oldest,setOldest]=React.useState(false);
    const [search,setSearch]=React.useState('');
    const [pendingDelete,setPendingDelete]=React.useState<{readonly entry:ComicAssetLibraryEntry;readonly x:number;readonly y:number}|undefined>();
    const [zoomedEntry,setZoomedEntry]=React.useState<ComicAssetLibraryEntry|undefined>();
    const [playbackUrls,setPlaybackUrls]=React.useState<Readonly<Record<string,string>>>({});
    const [failedUpload,setFailedUpload]=React.useState(false);
    const [contextMenu,setContextMenu]=React.useState<{readonly entry:ComicAssetLibraryEntry;readonly x:number;readonly y:number}|undefined>();
    const [renaming,setRenaming]=React.useState<{readonly entry:ComicAssetLibraryEntry;readonly value:string}|undefined>();
    const menuRef=React.useRef<HTMLDivElement|null>(null);
    const deletePopoverRef=React.useRef<HTMLDivElement|null>(null);
    const gridRef=React.useRef<HTMLDivElement|null>(null);
    const probedPathsRef=React.useRef(new Set<string>());
    const dismissedOverlayOnDownRef=React.useRef(false);
    const [operations]=React.useState(()=>assetLibraryOperations(props.operationScope,props.onUse??props.load));
    const [,render]=React.useReducer(value=>value+1,0),cardLocks=React.useRef(new Set<string>()),mounted=React.useRef(true),preserveError=React.useRef(false);
    React.useEffect(()=>{mounted.current=true;const notify=()=>render();operations.listeners.add(notify);return()=>{operations.listeners.delete(notify);mounted.current=false;};},[operations]);
    React.useEffect(()=>{if(props.entries!==undefined)setEntries(props.entries);},[props.entries,props.revision]);
    React.useEffect(()=>{if(props.entries!==undefined&&reload===0){setLoading(false);return;}let active=true;setLoading(true);if(preserveError.current)preserveError.current=false;else{setError('');setFailedUpload(false);}void Promise.resolve().then(props.load).then(value=>{if(active)setEntries(value);},()=>{if(active){setFailedUpload(false);setError(t('loadFailed'));}}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[reload,props.entries===undefined?props.revision:undefined]);
    React.useEffect(()=>{
        const prepare=props.preparePlaybackFiles;
        if(!prepare)return;
        const missing=entries
            .filter(item=>item.assetType==='video'&&Boolean(item.mediaPath)&&/\.(?:mp4|m4v|mov)$/i.test(item.mediaPath!)&&!probedPathsRef.current.has(item.mediaPath!))
            .map(item=>item.mediaPath!);
        if(!missing.length)return;
        const unique=[...new Set(missing)].slice(0,64);
        let active=true;
        void Promise.resolve(prepare(unique)).then(mapped=>{
            for(const p of unique)probedPathsRef.current.add(p);
            if(!active||!mapped)return;
            const nextPatch:Record<string,string>={};
            let hasNew=false;
            for(const [srcPath,outPath] of Object.entries(mapped)){
                if(typeof outPath!=='string'||!outPath)continue;
                nextPatch[srcPath]=/^(?:file:|https?:|data:|blob:)/i.test(outPath)?outPath:URI.fromFilePath(outPath).toString();
                hasNew=true;
            }
            if(hasNew)setPlaybackUrls(prev=>({...prev,...nextPatch}));
        },()=>{/* play original mediaUrl on probe failure */});
        return()=>{active=false;};
    },[entries,props.preparePlaybackFiles]);
    React.useEffect(()=>{
        const onKeyDown=(event:KeyboardEvent):void=>{
            if(event.key!=='Escape'||event.isComposing||operations.busy)return;
            event.preventDefault();event.stopPropagation();event.stopImmediatePropagation?.();
            if(zoomedEntry)setZoomedEntry(undefined);
            else if(pendingDelete)setPendingDelete(undefined);
            else if(contextMenu)setContextMenu(undefined);
            else if(renaming)setRenaming(undefined);
            else props.onClose();
        };
        window.addEventListener('keydown',onKeyDown,true);
        return()=>window.removeEventListener('keydown',onKeyDown,true);
    },[zoomedEntry,pendingDelete,contextMenu,renaming,operations,props.onClose]);
    const markDismissedOnDown=():void=>{
        dismissedOverlayOnDownRef.current=true;
        if(typeof setTimeout==='function'){
            setTimeout(()=>{dismissedOverlayOnDownRef.current=false;},0);
        }
    };
    React.useEffect(()=>{
        if(!contextMenu)return;
        const closeMenu=()=>setContextMenu(undefined);
        const onOutsidePointerDown=(event:Event):void=>{
            if(menuRef.current&&event.target instanceof Node&&menuRef.current.contains(event.target))return;
            markDismissedOnDown();
            setContextMenu(undefined);
        };
        const onOutsideContextMenu=(event:Event):void=>{
            if(menuRef.current&&event.target instanceof Node&&menuRef.current.contains(event.target))return;
            setContextMenu(undefined);
        };
        window.addEventListener('pointerdown',onOutsidePointerDown,true);
        window.addEventListener('mousedown',onOutsidePointerDown,true);
        window.addEventListener('contextmenu',onOutsideContextMenu,true);
        window.addEventListener('blur',closeMenu);
        return()=>{
            window.removeEventListener('pointerdown',onOutsidePointerDown,true);
            window.removeEventListener('mousedown',onOutsidePointerDown,true);
            window.removeEventListener('contextmenu',onOutsideContextMenu,true);
            window.removeEventListener('blur',closeMenu);
        };
    },[contextMenu]);
    React.useEffect(()=>{
        if(!pendingDelete)return;
        const onOutsideDown=(event:Event):void=>{
            if(deletePopoverRef.current&&event.target instanceof Node&&deletePopoverRef.current.contains(event.target))return;
            if(typeof Element!=='undefined'&&event.target instanceof Element&&event.target.closest('[data-library-delete-trigger]'))return;
            markDismissedOnDown();
            setPendingDelete(undefined);
        };
        window.addEventListener('pointerdown',onOutsideDown,true);
        window.addEventListener('mousedown',onOutsideDown,true);
        window.addEventListener('contextmenu',onOutsideDown,true);
        return()=>{
            window.removeEventListener('pointerdown',onOutsideDown,true);
            window.removeEventListener('mousedown',onOutsideDown,true);
            window.removeEventListener('contextmenu',onOutsideDown,true);
        };
    },[pendingDelete]);
    const useLayoutEffectSafe=typeof window!=='undefined'&&React.useLayoutEffect?React.useLayoutEffect:React.useEffect;
    useLayoutEffectSafe(()=>{
        if(!pendingDelete||!deletePopoverRef.current||typeof window==='undefined')return;
        const rect=deletePopoverRef.current.getBoundingClientRect();
        if(!(rect.width>0&&rect.height>0))return;
        const vw=window.innerWidth||1280;
        const vh=window.innerHeight||800;
        const nextX=Math.max(12,Math.min(pendingDelete.x,vw-rect.width-12));
        const nextY=Math.max(12,Math.min(pendingDelete.y,vh-rect.height-12));
        if(Math.abs(nextX-pendingDelete.x)>1||Math.abs(nextY-pendingDelete.y)>1){
            setPendingDelete(prev=>prev?{...prev,x:nextX,y:nextY}:undefined);
        }
    },[pendingDelete]);
    const openZoom=(entry:ComicAssetLibraryEntry):void=>{
        setContextMenu(undefined);
        setPendingDelete(undefined);
        gridRef.current?.querySelectorAll('video,audio').forEach(node=>{
            try{(node as HTMLMediaElement).pause();}catch{/* noop */}
        });
        setZoomedEntry(entry);
    };
    const openDeletePopover=(entry:ComicAssetLibraryEntry,event:React.MouseEvent<HTMLElement>,fallback?:{readonly x:number;readonly y:number}):void=>{
        event.preventDefault?.();
        event.stopPropagation?.();
        const vw=typeof window!=='undefined'&&window.innerWidth?window.innerWidth:1280;
        const vh=typeof window!=='undefined'&&window.innerHeight?window.innerHeight:800;
        let rawX=typeof event.clientX==='number'?event.clientX:0;
        let rawY=typeof event.clientY==='number'?event.clientY:0;
        if(!(rawX>0&&rawY>0)){
            if(fallback&&(fallback.x>0||fallback.y>0)){
                rawX=fallback.x;
                rawY=fallback.y;
            }else if(event.currentTarget?.getBoundingClientRect){
                const rect=event.currentTarget.getBoundingClientRect();
                rawX=rect.left+rect.width/2-128;
                rawY=rect.bottom+6;
            }else{
                rawX=Math.round(vw/2-128);
                rawY=Math.round(vh/2-60);
            }
        }
        const x=Math.max(12,Math.min(rawX,vw-256-12));
        const y=Math.max(12,Math.min(rawY,vh-120-12));
        setContextMenu(undefined);
        setPendingDelete({entry,x,y});
    };
    const use=async(entry:ComicAssetLibraryEntry):Promise<void>=>{
        if(!props.onUse||props.selectTypes&&!props.selectTypes.includes(entry.assetType))return;
        setError('');setFailedUpload(false);try{const used=await runAssetLibraryOperation(operations,entry.assetId,id=>props.onUse!(entry.assetId,id,entry));if(used&&mounted.current)props.onClose();}
        catch(error){if(mounted.current){setFailedUpload(false);setError(error instanceof Error?error.message:String(error));}}
    };
    const upload=async(retryFailed=false):Promise<void>=>{if(!props.onUpload)return;setError('');setFailedUpload(false);const targetCat=category==='character'?'character':undefined;try{await runAssetLibraryOperation(operations,'upload',async()=>{await props.onUpload!(targetCat,retryFailed);});}
        catch(error){if(mounted.current){preserveError.current=true;setFailedUpload(true);setError(error instanceof Error?error.message:String(error));}}finally{if(mounted.current)setReload(value=>value+1);}};
    const mutate=async(entry:ComicAssetLibraryEntry,remove:boolean):Promise<void>=>{
        if(cardLocks.current.has(entry.assetId)||operations.busy===entry.assetId)return;
        cardLocks.current.add(entry.assetId);render();setError('');setFailedUpload(false);
        try{if(remove){await props.onDelete?.(entry.assetId);if(mounted.current){setEntries(current=>current.filter(item=>item.assetId!==entry.assetId));setPendingDelete(undefined);setZoomedEntry(prev=>prev?.assetId===entry.assetId?undefined:prev);}}
            else{await props.onPin?.(entry.assetId,!entry.pinnedAt);if(mounted.current)setEntries(current=>current.map(item=>item.assetId===entry.assetId?{...item,pinnedAt:entry.pinnedAt?undefined:new Date().toISOString()}:item));}}
        catch(error){if(mounted.current){setFailedUpload(false);setError(error instanceof Error?error.message:String(error));}}
        finally{cardLocks.current.delete(entry.assetId);if(mounted.current)render();}
    };
    const changeCategory=async(entry:ComicAssetLibraryEntry,nextCategory:ComicAssetCategory):Promise<void>=>{
        if(!props.onCategoryChange||cardLocks.current.has(entry.assetId)||operations.busy===entry.assetId)return;
        cardLocks.current.add(entry.assetId);render();setError('');setFailedUpload(false);
        try{
            await props.onCategoryChange(entry.assetId,nextCategory);
            if(mounted.current){
                setEntries(current=>current.map(item=>item.assetId===entry.assetId?{
                    ...item,
                    assetType:item.source.origin==='character'||item.characterBundleId?'image':item.assetType,
                    assetCategory:nextCategory,
                    ...(nextCategory!=='character'?{characterBundleId:undefined}:{})
                }:item));
            }
        }catch(error){if(mounted.current){setFailedUpload(false);setError(error instanceof Error?error.message:String(error));}}
        finally{cardLocks.current.delete(entry.assetId);if(mounted.current)render();}
    };
    const renameAsset=async(entry:ComicAssetLibraryEntry,rawName:string):Promise<void>=>{
        const nextName=rawName.trim().slice(0,120);
        if(!nextName||cardLocks.current.has(entry.assetId)||operations.busy===entry.assetId)return;
        cardLocks.current.add(entry.assetId);render();setError('');setFailedUpload(false);
        try{
            if(props.onRename){
                const itemWithId=Object.assign({},entry,{id:entry.assetId,title:entry.assetName});
                await props.onRename(itemWithId,nextName);
            }
            if(mounted.current){
                setEntries(current=>current.map(item=>item.assetId===entry.assetId?{...item,assetName:nextName}:item));
                setRenaming(undefined);
            }
        }catch(error){if(mounted.current){setFailedUpload(false);setError(error instanceof Error?error.message:String(error));}}
        finally{cardLocks.current.delete(entry.assetId);if(mounted.current)render();}
    };
    const query=search.trim().toLowerCase();
    const matchesSearch=(entry:ComicAssetLibraryEntry):boolean=>!query
        ||entry.assetName.toLowerCase().includes(query)
        ||(entry.remark&&entry.remark.toLowerCase().includes(query))
        ||Boolean(entry.textContent&&entry.textContent.toLowerCase().includes(query));
    const visible=sortComicAssetLibrary(entries.filter(entry=>comicAssetLibraryMatches(entry,category)&&matchesSearch(entry)),oldest);
    const countFor=(filter:ComicAssetLibraryFilter):number=>entries.filter(entry=>comicAssetLibraryMatches(entry,filter)).length;
    const isCharacterEntry=(entry:ComicAssetLibraryEntry):boolean=>entry.assetCategory==='character'||Boolean(entry.characterBundleId);
    const canReclassify=(entry:ComicAssetLibraryEntry):boolean=>Boolean(props.onCategoryChange&&entry.assetType==='image'&&entry.mediaPath);
    const resolveMediaUrl=(entry:ComicAssetLibraryEntry|undefined):string|undefined=>{
        if(!entry?.mediaPath)return undefined;
        return playbackUrls[entry.mediaPath]||URI.fromFilePath(entry.mediaPath).toString();
    };
    const zoomedMedia=resolveMediaUrl(zoomedEntry);
    return <div className='nmx-board-tool-backdrop nmx-library-backdrop' onMouseDown={event=>{
        event.stopPropagation();
        if(dismissedOverlayOnDownRef.current){dismissedOverlayOnDownRef.current=false;return;}
        if(zoomedEntry){setZoomedEntry(undefined);return;}
        if(pendingDelete){setPendingDelete(undefined);return;}
        if(contextMenu){setContextMenu(undefined);return;}
        if(event.target===event.currentTarget&&!operations.busy)props.onClose();
    }}>
        <section className='nmx-board-tool-dialog nmx-board-asset-library nmx-unified-asset-library' role='dialog' aria-modal='true' aria-label={t('library')}
            onKeyDown={event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();if(zoomedEntry)setZoomedEntry(undefined);else if(pendingDelete)setPendingDelete(undefined);else if(contextMenu)setContextMenu(undefined);else if(renaming)setRenaming(undefined);else props.onClose();}}}>
            <header>
                <div className='nmx-library-header-title'>
                    <strong>{t('library')}</strong>
                    <span className='nmx-library-count-badge'>{entries.length}</span>
                </div>
                <div className='nmx-library-header-actions'>
                    {props.onUpload&&<button type='button' className='nmx-library-upload-btn' title={t('upload')} aria-label={t('upload')} disabled={Boolean(operations.busy)} onClick={()=>void upload(false)}>
                        <i className='codicon codicon-cloud-upload' aria-hidden='true'/>
                        <span>{t('upload')}</span>
                    </button>}
                    <button type='button' className='nmx-library-close-btn' data-nmx-layer-close title={t('close')} aria-label={t('close')} onClick={props.onClose}>×</button>
                </div>
            </header>
            <div className='nmx-library-toolbar'>
                <nav aria-label={t('category')}>{(['all','image','character','video','audio'] as const).map(value=>{
                    const label=t(value==='audio'?'audioMedia':value);
                    const count=countFor(value);
                    return <button key={value} type='button' title={label} aria-pressed={category===value} onClick={()=>{setCategory(value);setContextMenu(undefined);setPendingDelete(undefined);}}>
                        <span>{label}</span>
                        <small className='nmx-library-tab-count'>{count}</small>
                    </button>;
                })}</nav>
                <div className='nmx-library-toolbar-controls'>
                    <div className='nmx-library-search-box'>
                        <i className='codicon codicon-search' aria-hidden='true'/>
                        <input type='search' value={search} placeholder={t('searchPlaceholder')} aria-label={t('searchPlaceholder')} onChange={event=>{setSearch(event.currentTarget.value);setContextMenu(undefined);setPendingDelete(undefined);}}/>
                    </div>
                    <select aria-label={t('sort')} title={t('sort')} value={oldest?'oldest':'newest'} onChange={event=>{setOldest(event.currentTarget.value==='oldest');setContextMenu(undefined);setPendingDelete(undefined);}}>
                        <option value='newest'>{t('newest')}</option>
                        <option value='oldest'>{t('oldest')}</option>
                    </select>
                </div>
            </div>
            {operations.busy&&<p className='nmx-library-progress' role='status'>{t('workingClose')}</p>}
            <div ref={gridRef} className='nmx-board-asset-library-body nmx-library-grid' onScroll={()=>{if(contextMenu)setContextMenu(undefined);if(pendingDelete)setPendingDelete(undefined);}}>
                {loading?<p role='status' className='nmx-library-empty-state'>{t('loading')}</p>:!visible.length?<p className='nmx-library-empty-state'>{t('empty')}</p>:visible.map(entry=>{
                    const unavailable=Boolean(props.selectTypes&&!props.selectTypes.includes(entry.assetType)),busy=cardLocks.current.has(entry.assetId)||operations.busy===entry.assetId;
                    const media=resolveMediaUrl(entry);
                    const isChar=isCharacterEntry(entry);
                    const badgeLabel=isChar?t('character'):t(entry.assetType==='audio'?'audioMedia':entry.assetType);
                    const isZoomableImage=entry.assetType==='image'&&Boolean(media);
                    const isZoomableVideo=entry.assetType==='video'&&Boolean(media);
                    return <article key={entry.assetId} data-library-asset={entry.assetId} className={entry.pinnedAt?'is-pinned':''}
                        onContextMenu={event=>{
                            event.preventDefault();event.stopPropagation();
                            setPendingDelete(undefined);
                            setContextMenu({entry,x:event.clientX,y:event.clientY});
                        }}>
                        <div className={`nmx-library-preview${isZoomableImage?' is-zoomable-image':''}`} onClick={isZoomableImage?()=>openZoom(entry):undefined}>
                            {isZoomableImage?<img src={media} alt='' loading='lazy'/>:isZoomableVideo?<video src={media} controls preload='metadata'/>:entry.assetType==='audio'&&media?<audio src={media} controls preload='metadata'/>:<span>{entry.textContent?.slice(0,160)||t(entry.assetType==='text'?'text':entry.assetType)}</span>}
                            {isZoomableVideo&&<button type='button' className='nmx-library-video-zoom-hit' title={t('zoomPreview')} aria-label={t('zoomPreview')} onClick={event=>{event.stopPropagation();openZoom(entry);}}/>}
                            {(isZoomableImage||isZoomableVideo)&&<button type='button' className='nmx-library-zoom-btn' title={t('zoomPreview')} aria-label={t('zoomPreview')} onClick={event=>{event.stopPropagation();openZoom(entry);}}><i className='codicon codicon-screen-full' aria-hidden='true'/></button>}
                            <span className={`nmx-library-type-badge is-${isChar?'character':entry.assetType}`}>{badgeLabel}</span>
                        </div>
                        <div className='nmx-library-card-meta'>
                            <strong data-nmx-literal title={entry.assetName}>{entry.pinnedAt?'★ ':''}{entry.assetName}</strong>
                            <small>{badgeLabel} · {new Intl.DateTimeFormat(props.locale,{dateStyle:'short',timeStyle:'short'}).format(new Date(entry.createdAt))}{entry.durationMs!==undefined?` · ${(entry.durationMs/1000).toFixed(1)}s`:''}</small>
                        </div>
                        <div className='nmx-library-card-actions'>
                            {props.onUse&&<button type='button' className='nmx-library-use-btn' title={unavailable?t('notAllowed'):props.useLabel??t('use')} aria-label={props.useLabel??t('use')} disabled={Boolean(operations.busy)||busy||unavailable} onClick={()=>void use(entry)}>{operations.busy===entry.assetId?t('loading'):props.useLabel??t('use')}</button>}
                            {canReclassify(entry)&&<button type='button' className='nmx-library-reclassify-btn' title={t(isChar?'moveToImage':'moveToCharacter')} aria-label={t(isChar?'moveToImage':'moveToCharacter')} disabled={busy} onClick={()=>void changeCategory(entry,isChar?'other':'character')}>{t(isChar?'moveToImage':'moveToCharacter')}</button>}
                            {props.onPin&&<button type='button' className='nmx-library-icon-btn' title={t(entry.pinnedAt?'unpin':'pin')} aria-label={t(entry.pinnedAt?'unpin':'pin')} disabled={busy} onClick={()=>void mutate(entry,false)}>{entry.pinnedAt?'☆':'★'}</button>}
                            {props.onDelete&&<button type='button' className='nmx-library-icon-btn is-danger' data-library-delete-trigger='true' title={t('delete')} aria-label={t('delete')} disabled={busy} onClick={event=>openDeletePopover(entry,event)}>×</button>}
                        </div>
                    </article>;
                })}
                {error&&<p role='alert'>{error} <button type='button' title={t('retry')} onClick={()=>{if(failedUpload&&props.onUpload)void upload(true);else setReload(value=>value+1);}}>{t('retry')}</button></p>}
            </div>
            {contextMenu&&(()=>{
                const entry=contextMenu.entry;
                const isChar=isCharacterEntry(entry);
                const unavailable=Boolean(props.selectTypes&&!props.selectTypes.includes(entry.assetType));
                const busy=cardLocks.current.has(entry.assetId)||operations.busy===entry.assetId;
                return <div ref={menuRef} className='nmx-library-context-menu' role='menu' style={{left:Math.min(contextMenu.x,window.innerWidth-200),top:Math.min(contextMenu.y,window.innerHeight-210)}}
                    onPointerDown={event=>event.stopPropagation()} onMouseDown={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()} onContextMenu={event=>event.stopPropagation()}>
                    {props.onUse&&<button type='button' role='menuitem' disabled={Boolean(operations.busy)||busy||unavailable} onClick={()=>{setContextMenu(undefined);void use(entry);}}>{props.useLabel??t('use')}</button>}
                    {props.onRename&&<button type='button' role='menuitem' disabled={busy} onClick={()=>{setRenaming({entry,value:entry.assetName});setContextMenu(undefined);}}><i className='codicon codicon-edit' aria-hidden='true'/><span>{t('rename')}</span></button>}
                    {canReclassify(entry)&&<button type='button' role='menuitem' disabled={busy} onClick={()=>{const target=isChar?'other':'character';setContextMenu(undefined);void changeCategory(entry,target);}}>{t(isChar?'moveToImage':'moveToCharacter')}</button>}
                    {props.onPin&&<button type='button' role='menuitem' disabled={busy} onClick={()=>{setContextMenu(undefined);void mutate(entry,false);}}>{t(entry.pinnedAt?'unpin':'pin')}</button>}
                    {props.onDelete&&<button type='button' role='menuitem' className='is-danger' data-library-delete-trigger='true' disabled={busy} onClick={event=>openDeletePopover(entry,event,{x:contextMenu.x,y:contextMenu.y})}>{t('delete')}</button>}
                </div>;
            })()}
            {pendingDelete&&(()=>{
                const busy=cardLocks.current.has(pendingDelete.entry.assetId)||operations.busy===pendingDelete.entry.assetId;
                return <div ref={deletePopoverRef} className='nmx-library-delete-popover' role='alertdialog' aria-label={t('delete')}
                    style={{left:pendingDelete.x,top:pendingDelete.y}}
                    onPointerDown={event=>event.stopPropagation()} onMouseDown={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()}>
                    <p>{t('deleteHint')}</p>
                    <div className='nmx-library-delete-popover-actions'>
                        <button type='button' className='nmx-library-delete-cancel' title={t('cancel')} onClick={()=>setPendingDelete(undefined)}>{t('cancel')}</button>
                        <button type='button' className='nmx-library-delete-ok' title={t('confirm')} disabled={busy} onClick={()=>void mutate(pendingDelete.entry,true)}>{t('confirm')}</button>
                    </div>
                </div>;
            })()}
            {zoomedEntry&&zoomedMedia&&<div className='nmx-library-lightbox' role='dialog' aria-modal='true' aria-label={zoomedEntry.assetName}
                onMouseDown={event=>event.stopPropagation()}
                onClick={event=>{event.stopPropagation();if(event.target===event.currentTarget)setZoomedEntry(undefined);}}>
                <button type='button' className='nmx-library-lightbox-close' title={t('close')} aria-label={t('close')}
                    onMouseDown={event=>event.stopPropagation()}
                    onClick={event=>{event.stopPropagation();setZoomedEntry(undefined);}}>×</button>
                {zoomedEntry.assetType==='video'
                    ?<video key={zoomedEntry.assetId} className='nmx-library-lightbox-media' src={zoomedMedia} controls autoPlay playsInline onMouseDown={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()}/>
                    :<img key={zoomedEntry.assetId} className='nmx-library-lightbox-media' src={zoomedMedia} alt={zoomedEntry.assetName} onMouseDown={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()}/>}
                <div className='nmx-library-lightbox-caption' data-nmx-literal>{zoomedEntry.assetName}</div>
            </div>}
            {renaming&&(()=>{
                const busy=cardLocks.current.has(renaming.entry.assetId)||operations.busy===renaming.entry.assetId;
                return <div className='nmx-library-backdrop nmx-library-rename-backdrop' role='dialog' aria-modal='true' aria-label={t('renameTitle')}
                    style={{position:'absolute',inset:0,zIndex:1460}}
                    onMouseDown={event=>{event.stopPropagation();if(event.target===event.currentTarget&&!busy)setRenaming(undefined);}}>
                    <div className='nmx-board-tool-dialog nmx-library-rename-dialog' style={{width:'min(380px, calc(100% - 32px))',padding:'16px 18px',display:'flex',flexDirection:'column',gap:'12px',background:'var(--nmx-panel, #18181b)',border:'1px solid var(--nmx-border, #343439)',borderRadius:'12px',boxShadow:'0 18px 48px rgb(0 0 0 / 45%)'}}
                        onMouseDown={event=>event.stopPropagation()}>
                        <strong style={{fontSize:'14px',fontWeight:650}}>{t('renameTitle')}</strong>
                        <ImeInput autoFocus maxLength={120} value={renaming.value} placeholder={t('renamePlaceholder')} aria-label={t('renamePlaceholder')} disabled={busy}
                            style={{height:'34px',padding:'0 10px',borderRadius:'8px',border:'1px solid var(--nmx-border, #343439)',background:'var(--nmx-panel-2, #232329)',color:'var(--nmx-text, #f4f4f6)',font:'inherit',fontSize:'13px',outline:'none'}}
                            onChange={event=>setRenaming({...renaming,value:event.currentTarget.value})}
                            onKeyDown={event=>{
                                if(event.key==='Enter'&&!event.nativeEvent.isComposing&&event.keyCode!==229){
                                    event.preventDefault();event.stopPropagation();
                                    if(renaming.value.trim())void renameAsset(renaming.entry,renaming.value);
                                }else if(event.key==='Escape'&&!event.nativeEvent.isComposing){
                                    event.preventDefault();event.stopPropagation();
                                    if(!busy)setRenaming(undefined);
                                }
                            }}/>
                        <div className='nmx-library-card-actions' style={{justifyContent:'flex-end',marginTop:0}}>
                            <button type='button' title={t('cancel')} disabled={busy} onClick={()=>setRenaming(undefined)}>{t('cancel')}</button>
                            <button type='button' className='nmx-library-use-btn' style={{flex:'none'}} title={t('renameSave')} disabled={busy||!renaming.value.trim()} onClick={()=>void renameAsset(renaming.entry,renaming.value)}>{t('renameSave')}</button>
                        </div>
                    </div>
                </div>;
            })()}
        </section>
    </div>;
}
