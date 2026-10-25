import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const widgetUrl = new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url);
const source = await readFile(widgetUrl, 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = file.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'NextMuxDesktopWidget');
const methods = ['setPrivacyDraft', 'savePrivacySettings', 'loadPrivacySettings', 'applyPrivacySettings', 'loadPrivacyMirror', 'persistPrivacyMirror']
    .map(name => { const node = widget.members.find(n => ts.isMethodDeclaration(n) && n.name.getText(file) === name); assert.ok(node, name); return node.getText(file); }).join('\n');
const defaults = file.statements.find(n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(file) === 'DEFAULT_PRIVACY_SETTINGS')).getText(file);
const { outputFiles } = await desktop('esbuild').build({ stdin: { contents: `
import { privacyText, PRIVACY_TEXT_LOCALES } from './nextmux-privacy-text';
${defaults}
const data=new Map();const window={localStorage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)},clearTimeout(){}};
export { privacyText, PRIVACY_TEXT_LOCALES };
export class Fixture {
 desktopLocale='en'; privacySettings={...DEFAULT_PRIVACY_SETTINGS,saveFileEditorRecovery:true,fileEditorRecoveryRevision:0}; privacyDraft=this.privacySettings;
 privacyStage='idle';privacyError='';privacyMessage='';calls=[];updates=[];persisted=0;restored=0;conversationHistoryLoadGeneration=0;
 platformService={savePrivacySettings:snapshot=>new Promise((resolve,reject)=>this.calls.push({snapshot,resolve,reject})),getPrivacySettings:()=>Promise.resolve(this.privacySettings)};
 update(){this.updates.push({draft:{...this.privacyDraft},stage:this.privacyStage,error:this.privacyError});}
 persistCodingSessions(){this.persisted++;} restoreDurableCodingSessions(){this.restored++;}discardInitialConversationMirror(){}
 seedMirror(value){window.localStorage.setItem('nextmux.desktop.privacy.v1',JSON.stringify(value));}
 ${methods}
}
`, loader: 'ts', resolveDir: dirname(fileURLToPath(widgetUrl)) }, bundle: true, write: false, platform: 'node', format: 'cjs' });
const module = { exports: {} }; new Function('module', 'exports', 'require', outputFiles[0].text)(module, module.exports, require);
const { Fixture, privacyText, PRIVACY_TEXT_LOCALES } = module.exports;
const settle = () => new Promise(resolve => setImmediate(resolve));
const confirm = (call, extra={}) => call.resolve({...call.snapshot,...extra});

test('new defaults are off; persisted on and off choices remain authoritative', async()=>{
 const fixture=new Fixture();assert.equal(fixture.privacySettings.requireZeroDataRetention,false);assert.equal(fixture.privacySettings.denyDataCollection,false);
 for(const enabled of [false,true]) { fixture.seedMirror({requireZeroDataRetention:enabled,denyDataCollection:enabled,saveConversationHistory:true});fixture.loadPrivacyMirror();assert.equal(fixture.privacyDraft.denyDataCollection,enabled);assert.equal(fixture.privacyDraft.requireZeroDataRetention,enabled); }
 assert.equal(fixture.calls.length,0,'reading existing settings never silently migrates or writes them');
});
test('switches save immediately and serialize the latest choices behind a slow response',async()=>{
 const fixture=new Fixture();fixture.setPrivacyDraft({denyDataCollection:true});assert.equal(fixture.calls.length,1);assert.equal(fixture.privacyStage,'saving');
 fixture.setPrivacyDraft({denyDataCollection:false});fixture.setPrivacyDraft({requireZeroDataRetention:true,saveFileEditorRecovery:false});
 assert.equal(fixture.calls.length,1,'only one save may be in flight');
 confirm(fixture.calls[0],{fileEditorRecoveryRevision:4});await settle();
 assert.equal(fixture.calls.length,2);assert.equal(fixture.privacyDraft.denyDataCollection,true);assert.equal(fixture.privacyDraft.requireZeroDataRetention,true);assert.equal(fixture.privacyDraft.saveFileEditorRecovery,false);
 assert.equal(fixture.calls[1].snapshot.fileEditorRecoveryRevision,4,'the next write carries the confirmed recovery revision');
 assert.ok(fixture.updates.slice(3).every(item=>item.draft.saveFileEditorRecovery===false),'an old response does not repaint a newer choice');
 confirm(fixture.calls[1],{fileEditorRecoveryRevision:5});await settle();assert.equal(fixture.privacyStage,'idle');assert.equal(fixture.privacySettings.denyDataCollection,true);assert.equal(fixture.privacySettings.requireZeroDataRetention,true);assert.equal(fixture.privacyError,'');
});
test('the latest failed save restores the last confirmed settings; a later edit can retry',async()=>{
 const fixture=new Fixture();fixture.setPrivacyDraft({denyDataCollection:true});confirm(fixture.calls[0]);await settle();
 fixture.setPrivacyDraft({requireZeroDataRetention:true});fixture.calls[1].reject(new Error('disk unavailable'));await settle();
 assert.equal(fixture.privacyStage,'idle');assert.equal(fixture.privacyDraft,fixture.privacySettings);assert.equal(fixture.privacyDraft.denyDataCollection,true);assert.equal(fixture.privacyDraft.saveConversationHistory,true);assert.match(fixture.privacyError,/restored.*disk unavailable/);
 fixture.setPrivacyDraft({requireZeroDataRetention:true});confirm(fixture.calls[2]);await settle();assert.equal(fixture.privacySettings.saveConversationHistory,true);assert.equal(fixture.privacySettings.requireZeroDataRetention,true);assert.equal(fixture.privacyError,'');
});
test('a failed earlier request still drains a newer pending change without parallel writes',async()=>{
 const fixture=new Fixture();fixture.setPrivacyDraft({denyDataCollection:true});fixture.setPrivacyDraft({denyDataCollection:false,requireZeroDataRetention:true});
 fixture.calls[0].reject(new Error('first failed'));await settle();assert.equal(fixture.calls.length,2);assert.equal(fixture.privacyDraft.requireZeroDataRetention,true);
 confirm(fixture.calls[1]);await settle();assert.equal(fixture.privacySettings.requireZeroDataRetention,true);assert.equal(fixture.privacyError,'');assert.equal(fixture.privacyStage,'idle');
});
test('loading disables edits and the UI provides translated automatic save states',async()=>{
 const fixture=new Fixture();fixture.privacyStage='loading';fixture.setPrivacyDraft({denyDataCollection:true});assert.equal(fixture.calls.length,0);assert.equal(fixture.privacyDraft.denyDataCollection,false);
 for(const locale of PRIVACY_TEXT_LOCALES)for(const key of ['saving','saved','saveFailed','autoSave','retentionLabel','collectionLabel','retentionOn','retentionOff','collectionOn','collectionOff','advisoryScope'])assert.notEqual(privacyText(locale,key),key);
 const start=source.indexOf("} else if (this.settingsPanel === 'privacy') {");const section=source.slice(start,source.indexOf("} else if (this.settingsPanel === 'data') {",start));
 assert.doesNotMatch(section,/nmx-settings-actions|撤销更改|保存隐私设置/);assert.match(section,/this\.privacyStage === 'loading'/);assert.match(section,/privacyText\(locale, 'saving'\)/);
 assert.doesNotMatch(section,/privacyText\(locale, 'advisoryScope'\)/);assert.doesNotMatch(section,/privacyHidden|collectionHidden|retentionHidden/);
 assert.doesNotMatch(section,/collectionLabel|renderEditorRecoveryPanel|editorRecoveryText|privacyText\(locale, 'autoSave'\)/);
 assert.match(section,/requireZeroDataRetention: event\.currentTarget\.checked, denyDataCollection: event\.currentTarget\.checked/);
});

test('normal history is always on in saved and restored UI settings', async()=> {
 const f=new Fixture(); f.seedMirror({requireZeroDataRetention:false,denyDataCollection:false,saveConversationHistory:false});f.loadPrivacyMirror();
 assert.equal(f.privacySettings.saveConversationHistory,true);
 f.applyPrivacySettings({...f.privacySettings,saveConversationHistory:false});assert.equal(f.privacyDraft.saveConversationHistory,true);
 f.setPrivacyDraft({saveConversationHistory:false});assert.equal(f.privacyDraft.saveConversationHistory,true);
 const start=source.indexOf("} else if (this.settingsPanel === 'privacy') {");const section=source.slice(start,source.indexOf("} else if (this.settingsPanel === 'data') {",start));
 assert.match(section,/incognitoText\(locale, 'historyLabel'\)/);assert.match(section, /type='checkbox' disabled checked/);
});
