import * as React from '@theia/core/shared/react';
import URI from '@theia/core/lib/common/uri';
import { comicAssetLibraryMatches, sortComicAssetLibrary, type ComicAssetCategory, type ComicAssetLibraryFilter, type ComicAssetLibraryEntry } from '../common/nextmux-comic-asset-library';
import { comicAssetLibraryText } from './nextmux-comic-asset-library-text';
import { assetLibraryOperations, runAssetLibraryOperation } from './nextmux-comic-asset-library-operations';
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
    readonly onDelete?:(assetId:string)=>Promise<void>;
    readonly onCharacter?:(entry:ComicAssetLibraryEntry)=>void;
    readonly revision?:number;
    /** Shared widget snapshot; the drawer and dialog consume the same immutable list. */
    readonly entries?:readonly ComicAssetLibraryEntry[];
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
    const [pendingDelete,setPendingDelete]=React.useState('');
    const [failedUpload,setFailedUpload]=React.useState(false);
    const [contextMenu,setContextMenu]=React.useState<{readonly entry:ComicAssetLibraryEntry;readonly x:number;readonly y:number}|undefined>();
    const [operations]=React.useState(()=>assetLibraryOperations(props.operationScope,props.onUse??props.load));
    const [,render]=React.useReducer(value=>value+1,0),cardLocks=React.useRef(new Set<string>()),mounted=React.useRef(true),preserveError=React.useRef(false);
    React.useEffect(()=>{mounted.current=true;const notify=()=>render();operations.listeners.add(notify);return()=>{operations.listeners.delete(notify);mounted.current=false;};},[operations]);
    React.useEffect(()=>{if(props.entries!==undefined)setEntries(props.entries);},[props.entries,props.revision]);
    React.useEffect(()=>{if(props.entries!==undefined&&reload===0){setLoading(false);return;}let active=true;setLoading(true);if(preserveError.current)preserveError.current=false;else{setError('');setFailedUpload(false);}void Promise.resolve().then(props.load).then(value=>{if(active)setEntries(value);},()=>{if(active){setFailedUpload(false);setError(t('loadFailed'));}}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[reload,props.entries===undefined?props.revision:undefined]);
    React.useEffect(()=>{
        const onKeyDown=(event:KeyboardEvent):void=>{
            if(event.key!=='Escape'||event.isComposing||operations.busy)return;
            event.preventDefault();event.stopPropagation();
            if(contextMenu)setContextMenu(undefined);
            else props.onClose();
        };
        window.addEventListener('keydown',onKeyDown);
        return()=>window.removeEventListener('keydown',onKeyDown);
    },[contextMenu,operations,props.onClose]);
    React.useEffect(()=>{
        if(!contextMenu)return;
        const closeMenu=()=>setContextMenu(undefined);
        window.addEventListener('pointerdown',closeMenu);
        return()=>{window.removeEventListener('pointerdown',closeMenu);};
    },[contextMenu]);
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
        try{if(remove){await props.onDelete?.(entry.assetId);if(mounted.current){setEntries(current=>current.filter(item=>item.assetId!==entry.assetId));setPendingDelete('');}}
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
    const query=search.trim().toLowerCase();
    const matchesSearch=(entry:ComicAssetLibraryEntry):boolean=>!query
        ||entry.assetName.toLowerCase().includes(query)
        ||(entry.remark&&entry.remark.toLowerCase().includes(query))
        ||Boolean(entry.textContent&&entry.textContent.toLowerCase().includes(query));
    const visible=sortComicAssetLibrary(entries.filter(entry=>comicAssetLibraryMatches(entry,category)&&matchesSearch(entry)),oldest);
    const countFor=(filter:ComicAssetLibraryFilter):number=>entries.filter(entry=>comicAssetLibraryMatches(entry,filter)).length;
    const isCharacterEntry=(entry:ComicAssetLibraryEntry):boolean=>entry.assetCategory==='character'||Boolean(entry.characterBundleId);
    const canReclassify=(entry:ComicAssetLibraryEntry):boolean=>Boolean(props.onCategoryChange&&entry.assetType==='image'&&entry.mediaPath);
    return <div className='nmx-board-tool-backdrop nmx-library-backdrop' onMouseDown={event=>{event.stopPropagation();if(event.target===event.currentTarget&&!operations.busy)props.onClose();}}>
        <section className='nmx-board-tool-dialog nmx-board-asset-library nmx-unified-asset-library' role='dialog' aria-modal='true' aria-label={t('library')}
            onKeyDown={event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();if(contextMenu)setContextMenu(undefined);else props.onClose();}}}>
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
                    return <button key={value} type='button' title={label} aria-pressed={category===value} onClick={()=>setCategory(value)}>
                        <span>{label}</span>
                        <small className='nmx-library-tab-count'>{count}</small>
                    </button>;
                })}</nav>
                <div className='nmx-library-toolbar-controls'>
                    <div className='nmx-library-search-box'>
                        <i className='codicon codicon-search' aria-hidden='true'/>
                        <input type='search' value={search} placeholder={t('searchPlaceholder')} aria-label={t('searchPlaceholder')} onChange={event=>setSearch(event.currentTarget.value)}/>
                    </div>
                    <select aria-label={t('sort')} title={t('sort')} value={oldest?'oldest':'newest'} onChange={event=>setOldest(event.currentTarget.value==='oldest')}>
                        <option value='newest'>{t('newest')}</option>
                        <option value='oldest'>{t('oldest')}</option>
                    </select>
                </div>
            </div>
            {operations.busy&&<p className='nmx-library-progress' role='status'>{t('workingClose')}</p>}
            <div className='nmx-board-asset-library-body nmx-library-grid'>
                {loading?<p role='status' className='nmx-library-empty-state'>{t('loading')}</p>:!visible.length?<p className='nmx-library-empty-state'>{t('empty')}</p>:visible.map(entry=>{
                    const unavailable=Boolean(props.selectTypes&&!props.selectTypes.includes(entry.assetType)),busy=cardLocks.current.has(entry.assetId)||operations.busy===entry.assetId;
                    const media=entry.mediaPath?URI.fromFilePath(entry.mediaPath).toString():undefined;
                    const isChar=isCharacterEntry(entry);
                    const badgeLabel=isChar?t('character'):t(entry.assetType==='audio'?'audioMedia':entry.assetType);
                    return <article key={entry.assetId} data-library-asset={entry.assetId} className={entry.pinnedAt?'is-pinned':''}
                        onContextMenu={event=>{
                            event.preventDefault();event.stopPropagation();
                            setContextMenu({entry,x:event.clientX,y:event.clientY});
                        }}>
                        <div className='nmx-library-preview'>
                            {entry.assetType==='image'&&media?<img src={media} alt='' loading='lazy'/>:entry.assetType==='video'&&media?<video src={media} controls preload='metadata'/>:entry.assetType==='audio'&&media?<audio src={media} controls preload='metadata'/>:<span>{entry.textContent?.slice(0,160)||t(entry.assetType==='text'?'text':entry.assetType)}</span>}
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
                            {props.onDelete&&<button type='button' className='nmx-library-icon-btn is-danger' title={t('delete')} aria-label={t('delete')} disabled={busy} onClick={()=>setPendingDelete(entry.assetId)}>×</button>}
                        </div>
                        {pendingDelete===entry.assetId&&<div className='nmx-library-delete-confirm'><p>{t('deleteHint')}</p><button type='button' title={t('delete')} disabled={busy} onClick={()=>void mutate(entry,true)}>{t('delete')}</button><button type='button' title={t('cancel')} onClick={()=>setPendingDelete('')}>{t('cancel')}</button></div>}
                    </article>;
                })}
                {error&&<p role='alert'>{error} <button type='button' title={t('retry')} onClick={()=>{if(failedUpload&&props.onUpload)void upload(true);else setReload(value=>value+1);}}>{t('retry')}</button></p>}
            </div>
            {contextMenu&&(()=>{
                const entry=contextMenu.entry;
                const isChar=isCharacterEntry(entry);
                const unavailable=Boolean(props.selectTypes&&!props.selectTypes.includes(entry.assetType));
                const busy=cardLocks.current.has(entry.assetId)||operations.busy===entry.assetId;
                return <div className='nmx-library-context-menu' role='menu' style={{left:Math.min(contextMenu.x,window.innerWidth-200),top:Math.min(contextMenu.y,window.innerHeight-180)}}
                    onPointerDown={event=>event.stopPropagation()}>
                    {props.onUse&&<button type='button' role='menuitem' disabled={Boolean(operations.busy)||busy||unavailable} onClick={()=>{setContextMenu(undefined);void use(entry);}}>{props.useLabel??t('use')}</button>}
                    {canReclassify(entry)&&<button type='button' role='menuitem' disabled={busy} onClick={()=>{const target=isChar?'other':'character';setContextMenu(undefined);void changeCategory(entry,target);}}>{t(isChar?'moveToImage':'moveToCharacter')}</button>}
                    {props.onPin&&<button type='button' role='menuitem' disabled={busy} onClick={()=>{setContextMenu(undefined);void mutate(entry,false);}}>{t(entry.pinnedAt?'unpin':'pin')}</button>}
                    {props.onDelete&&<button type='button' role='menuitem' className='is-danger' disabled={busy} onClick={()=>{setContextMenu(undefined);setPendingDelete(entry.assetId);}}>{t('delete')}</button>}
                </div>;
            })()}
        </section>
    </div>;
}
