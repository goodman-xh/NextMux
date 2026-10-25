import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
// The draft factory and the reuse predicate it consults (both real).
const methods = ['createCodingSessionForWorkspace', 'emptyCodingDraftCandidate'].map(name => {
    const method = widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === name);
    assert.ok(method, name);
    return method.getText(file);
});
const code = ts.transpileModule(`return class Fixture { ${methods.join('\n')} };`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const Factory = new Function('normalizeAgentChildScrollStates','requestAnimationFrame','crypto',code)(value=>value,()=>{}, {randomUUID:()=>`new-${Math.random()}`});
const draft = (id, draftPrompt) => ({id,workspacePath:'/fixture/project',turns:[],titleOrigin:'default',...(draftPrompt ? {draftPrompt} : {})});
function fixture(sessions, tiled) {
    const f=new Factory();
    Object.assign(f,{activeWorkspaceRoot:'/fixture/project',activeCodingSessionId:'current',codingSessionNavigationGeneration:1,agentStage:'idle',codingSessions:sessions,tiledCodingSessionIds:new Set(tiled),expandedCodingProjects:new Set(),restored:[],
        workspaceRootIsOpen:()=>true,flushComposerDraft:()=>{},rememberNavigation:()=>{},setComposerPrompt:()=>{},
        restoreComposerDraft:function(session){this.restored.push(session.id);},persistDesktopRestoreState:()=>{},restoreCodingSessionState:()=>{},update:()=>{},
        recentCodingSource:()=>undefined,reasoningSettingsForRoute:()=>({}),activeModelRoute:()=>undefined,currentCodingSessionViewState:()=>undefined,
        restoreCodingSourceSelection:()=>{},persistCodingSessions:()=>{},loadContextFiles:()=>{},
        // Nothing else holds the fixture conversations: no goal drafts, apps, tabs, terminals or pending imports.
        prompt:'',attachments:[],pastedTextReferences:[],goalDraftsBySession:new Map(),composerApps:new Map(),conversationTabs:{tabs:{}},terminalRecords:[],
        incognitoModeIsBusy:()=>false,hasPendingAttachmentImports:()=>false,hasPendingDraftAttachments:()=>false});
    return f;
}
test('opening a project reuses a main-window draft instead of an earlier independent-window draft',()=>{
    const independent=draft('independent'), local=draft('local');
    const f=fixture([independent,local],[independent.id]);
    assert.equal(f.createCodingSessionForWorkspace('/fixture/project'),local);
    assert.equal(f.activeCodingSessionId,local.id);assert.deepEqual(f.restored,[local.id]);
    assert.deepEqual([...f.tiledCodingSessionIds],[independent.id]);assert.equal(f.codingSessions[0],independent);
});
test('opening a project with only an independent draft creates a local draft and preserves the independent one',()=>{
    const independent=draft('independent');const before=JSON.stringify(independent);
    const f=fixture([independent],[independent.id]);
    const created=f.createCodingSessionForWorkspace('/fixture/project');
    assert.notEqual(created.id,independent.id);assert.equal(f.activeCodingSessionId,created.id);
    assert.equal(created.workspacePath,'/fixture/project');assert.equal(f.codingSessions.length,2);
    assert.equal(JSON.stringify(independent),before);assert.deepEqual([...f.tiledCodingSessionIds],[independent.id]);
});
// Only a fully empty draft is reusable (nextmux-desktop-widget.tsx:22739 excludes
// `session.draftPrompt`); a draft that holds unsent text keeps it in its own conversation.
test('opening a project again never discards a draft\'s unsent text by reusing it as the new draft',()=>{
    const unsent=draft('local','unsent-local');const before=JSON.stringify(unsent);
    const f=fixture([unsent],[]);
    const created=f.createCodingSessionForWorkspace('/fixture/project');
    assert.notEqual(created.id,unsent.id);assert.equal(f.activeCodingSessionId,created.id);
    assert.equal(created.workspacePath,'/fixture/project');assert.equal(f.codingSessions.length,2);
    assert.equal(JSON.stringify(unsent),before);assert.equal(unsent.draftPrompt,'unsent-local');
});
