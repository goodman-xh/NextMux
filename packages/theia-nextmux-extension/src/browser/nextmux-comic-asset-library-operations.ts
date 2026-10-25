/** Keep an in-flight local import owned by its destination when its progress dialog is closed/reopened. */
export interface AssetLibraryOperations {
    busy:string;
    readonly requests:Map<string,string>;
    readonly listeners:Set<()=>void>;
}
const scopes=new Map<string,AssetLibraryOperations>();
const callbacks=new WeakMap<object,AssetLibraryOperations>();
export function assetLibraryOperations(scope:string|undefined,owner:object):AssetLibraryOperations{
    const existing=scope?scopes.get(scope):callbacks.get(owner);if(existing)return existing;
    const value:AssetLibraryOperations={busy:'',requests:new Map(),listeners:new Set()};
    if(scope)scopes.set(scope,value);else callbacks.set(owner,value);
    return value;
}
export async function runAssetLibraryOperation(state:AssetLibraryOperations,key:string,run:(requestId:string)=>Promise<void>):Promise<boolean>{
    if(state.busy)return false;
    const requestId=state.requests.get(key)??crypto.randomUUID();state.requests.set(key,requestId);state.busy=key;
    for(const notify of state.listeners)notify();
    try{await run(requestId);state.requests.delete(key);return true;}
    finally{state.busy='';for(const notify of state.listeners)notify();}
}
