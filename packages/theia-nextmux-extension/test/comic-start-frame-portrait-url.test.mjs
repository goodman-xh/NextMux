import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {runInNewContext} from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript');
const source=readFileSync(new URL('../src/browser/nextmux-comic-start-frame-panel.tsx',import.meta.url),'utf8');
const tree=ts.createSourceFile('portrait.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const helper=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='comicStartFramePortraitMediaUrl');assert(helper);
const compiled=ts.transpileModule("import URI from '@theia/core/lib/common/uri';\n"+helper.getText(tree),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
const theiaModule=require('@theia/core/lib/common/uri'),URI=theiaModule.default;
function load(uri=theiaModule){const m={exports:{}};new Function('require','module','exports',compiled)(()=>uri,m,m.exports);return m.exports.comicStartFramePortraitMediaUrl;}
const url=load();

test('library absolute path becomes the same encoded file URI as the existing library picker',()=>{
 const path='/Users/QA/Library/Application Support/NextMux/comic-character-library/bundle-owned/media/角色 #1.png';
 const actual=url(path,true,()=>{throw Error('project resolver must not receive library paths');});
 assert.equal(actual,URI.fromFilePath(path).toString());assert.equal(new URI(actual).scheme,'file');assert.equal(new URI(actual).path.toString(),path);
 assert(actual.includes('%20')&&actual.includes('%23')&&actual.includes('%E8%A7%92'));
});
test('canvas relative media remains owned by the project callback',()=>{
 const calls=[];assert.equal(url('nextmux.media/imports/portrait.png',false,uri=>{calls.push(uri);return 'project-guarded:'+uri;}),'project-guarded:nextmux.media/imports/portrait.png');
 assert.deepEqual(calls,['nextmux.media/imports/portrait.png']);
});
test('canvas keeps its exact existing project resolution instead of becoming a library converter',()=>{
 const root=URI.fromFilePath('/Users/QA/Documents/Comic');const resolve=path=>{const resource=root.resolve(path);return root.isEqualOrParent(resource)?resource.toString():'';};
 assert.equal(url('/Users/QA/Library/portrait.png',false,resolve),resolve('/Users/QA/Library/portrait.png'));
 assert.notEqual(resolve('/Users/QA/Library/portrait.png'),URI.fromFilePath('/Users/QA/Library/portrait.png').toString(),'old project callback is not a library URL converter');
 assert.equal(url('../../Library/portrait.png',false,resolve),resolve('../../Library/portrait.png'));
 assert.equal(url('nextmux.media/portrait.png',false,resolve),root.resolve('nextmux.media/portrait.png').toString());
 assert.equal(url('rejected-by-caller',false,()=> ''),'','the helper preserves a caller rejection');
});
test('library empty image is not made to use the project resolver',()=>{
 const actual=url('/Users/QA/library/portrait.png',true,()=> '');assert.notEqual(actual,'');assert.equal(new URI(actual).scheme,'file');
});
test('Windows drive and UNC paths follow the unchanged real Theia/vscode-uri Windows implementation',()=>{
 const vscodePath=require.resolve('vscode-uri',{paths:[dirname(require.resolve('@theia/core/lib/common/uri'))]});
 const vscode={exports:{}};runInNewContext(readFileSync(vscodePath,'utf8'),{module:vscode,exports:vscode.exports,process:{platform:'win32',cwd:()=> 'C:\\QA'},console},{filename:vscodePath});
 const theiaPath=require.resolve('@theia/core/lib/common/uri'),theiaRequire=createRequire(theiaPath),theia={exports:{}};
 new Function('require','module','exports',readFileSync(theiaPath,'utf8'))(id=>id==='vscode-uri'?vscode.exports:theiaRequire(id),theia,theia.exports);
 const win=load(theia.exports),winUri=theia.exports.default;
 for(const path of ['C:\\Users\\QA\\Library\\角色 #1.png','\\\\qa-server\\portraits\\蓝衣.png']){
  const actual=win(path,true,()=>{throw Error('project resolver must not receive Windows library paths');});
  assert.equal(actual,winUri.fromFilePath(path).toString());assert.equal(new winUri(actual).scheme,'file');assert(!actual.includes('%5C'));
 }
});
test('the actual panel sends separate library and canvas provenance to the tested helper',()=>{
 assert.match(source,/key: `canvas:\$\{version\.id\}`[^\n]+fromLibrary: false/);
 assert.match(source,/key: `library:\$\{entry\.assetId\}`[^\n]+fromLibrary: true/);
 assert.match(source,/<img src=\{comicStartFramePortraitMediaUrl\(p\.uri, p\.fromLibrary, props\.mediaUrl\)\}/);
 assert.match(source,/characterLibraryAssetIds: \[\.\.\.selected\]\.filter/);
});
