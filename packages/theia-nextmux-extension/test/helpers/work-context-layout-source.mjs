import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
assert.ok(widget);
export const names = ['renderWorkContext', 'renderContextDrawerFileList', 'closeContextFilePreview', 'closeContextFileTab', 'workContextIsOverlay', 'effectiveWorkContextWidth', 'setWorkContextExpanded'];
export const methods = Object.fromEntries(names.map(name => {
    const method = widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === name);
    assert.ok(method, name); return [name, method.getText(file)];
}));

// Actual work-context renderer and close handler; only host services and the
// Monaco leaf are replaced. This fixture makes no filesystem/RPC/model calls.
export const fixtureEntry = `import * as React from 'react';
import {createRoot} from 'react-dom/client';
import {NextMuxFileTabButton} from './packages/theia-nextmux-extension/src/browser/nextmux-file-tab-button';
import {workbenchText} from './packages/theia-nextmux-extension/src/browser/nextmux-workbench-locale';
import {agentChildText} from './packages/theia-nextmux-extension/src/browser/nextmux-agent-child-locale';
import {editorRecoveryText} from './packages/theia-nextmux-extension/src/browser/nextmux-editor-recovery-locale';
import {fileDrawerText} from './packages/theia-nextmux-extension/src/browser/nextmux-file-drawer-locale';
import {isGoalFilePath} from './packages/theia-nextmux-extension/src/browser/nextmux-goal-file-format';
const params=new URL(location.href).searchParams, locale=params.get('locale')||'en';
const localizeDesktopSurface=(_locale,text)=>text;
const counts={mount:0,unmount:0,capture:0,detach:0};
class NextMuxFileEditor extends React.Component {
 state={text:this.props.initialDrafts.current??this.props.content};
 componentDidMount(){counts.mount++;} componentWillUnmount(){counts.unmount++;}
 render(){return <textarea aria-label='Synthetic editor leaf' className='fixture-editor' value={this.state.text}
 onChange={event=>{const text=event.currentTarget.value;this.setState({text});this.props.onDirty(true);this.props.onContentChange('current',text);}}/>;}
}
const preview=()=>({uri:'file:///synthetic-only/sample.txt',path:'/synthetic-only/sample.txt',name:'sample.txt',content:'original fixture text',kind:'text'});
class NextMuxDesktopWidget {
 static WORK_CONTEXT_MIN_WIDTH=240; static FILE_LIST_MIN_WIDTH=180;
 workContextOpen=true; activeSection='coding'; workContextMode='file'; desktopLocale=locale;
 contextFilePreview=params.has('history')?preview():undefined; contextFileMaximized=false; contextFileDirty=false; contextFileDrafts={}; contextFilePreviewRequestToken=1;
 contextFileTabs=new Map(); contextFileSavingUris=new Set(); contextFileHistoryOpen=params.has('history');
 contextFileHistoryLegacy=[]; contextFileHistorySources=[];
 contextFileHistoryLoading=false; contextFileHistorySelecting=false; contextFileHistoryError=''; contextFileMenuOpen=false;
 contextFileHistory=['current','restored','saved','after','before','original'].map((kind,index)=>({id:String(index),kind,uri:'file:///synthetic-only/sample.txt',label:fileDrawerText(locale,kind),current:kind==='current',timestamp:Date.UTC(2026,8,11,8,35-index*5)}));
 activeCodingSessionId='synthetic-session'; activeWorkspaceRoot='/synthetic-only'; contextFileSaveStatus='idle';
 contextFilesWorkspace='/synthetic-only'; contextFileChildren=new Map([['/synthetic-only',[]]]); contextFileListWidth=180;
 workspaceOptions=[]; contextFileReturnPending=false; contextFileReturnMode='file'; codingViewRestoreToken=1;
 activeCodingSession(){return {id:'synthetic-session',workspacePath:'/synthetic-only'};} currentCodingBrowsers(){return [];}
 codingSessionWorkspaceRoot(){return '/synthetic-only';} currentAgentChildren(){return [];}
 workContextWidth=358; workContextInlineMaximumWidth(){return 1000;} workContextMaximumWidth(){return 1000;} contextFileListMaximumWidth(){return 400;} resolvedDesktopTheme(){return params.get('theme')||'dark';}
 contextFileEditorScrollPosition(){return undefined;} onContextFileEditorScroll(){} captureContextEditorRecovery(){counts.capture++;}
 detachContextEditorRecovery(){counts.detach++;return true;} persistPaneSize(){} syncPaneCssVariables(){} clampPaneSize(value,min,max){return Math.min(max,Math.max(min,value));} persistActiveCodingSessionState(){} async loadContextFiles(){}
 rememberContextFileTab(){} preserveContextFileTabRecovery(){return true;} selectContextFileHistory(){} loadContextFileHistory(){} activateContextFileTab(){return false;} persistActiveCodingSessionState(){} addNotification(){}
 renderContextDrawerFileRows(){return <button className='nmx-context-file-row' onClick={()=>{this.contextFilePreview=preview();this.update();}}><span>sample.txt</span></button>;}
 ${names.map(name => methods[name]).join('\n')}
}
const widget=new NextMuxDesktopWidget();
function Fixture(){const [,update]=React.useReducer(value=>value+1,0); widget.update=update;
 return <main className={'nmx-shell fixture-shell nmx-theme-'+widget.resolvedDesktopTheme()} dir={locale==='ar'?'rtl':'ltr'}>
 {widget.renderWorkContext()}<nav className='fixture-controls'>
 <button data-fixture='open' onClick={()=>{const next=preview();widget.contextFilePreview=next;widget.contextFileTabs.set(next.uri,{preview:next,drafts:{},dirty:false,activeSide:'current'});widget.update();}}>Open synthetic file</button>
 <button data-fixture='maximize' onClick={()=>{widget.contextFileMaximized=!widget.contextFileMaximized;widget.update();}}>Toggle maximize</button>
 <button onClick={()=>{document.documentElement.style.setProperty('--fixture-width','297px');widget.update();}}>297 px</button>
 <button onClick={()=>{document.documentElement.style.setProperty('--fixture-width','497px');widget.update();}}>497 px</button>
 <output>Mounts {counts.mount}; unmounts {counts.unmount}; draft {widget.contextFileDrafts.current||'(empty)'}</output>
 </nav></main>;}
window.fixture={widget,counts};
createRoot(document.querySelector('#fixture')).render(<Fixture/>);`;
