import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = parsed.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const names = ['chooseRelayMerchant', 'selectModelCenterView', 'selectModelCapabilityFilter', 'loadModelCenterMerchantCount'];
const methods = names.map(name => { const method = widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(parsed) === name); assert.ok(method); return method.getText(parsed); });
const Harness = new Function('managedRelayKey', ts.transpile(`class Harness { ${methods.join('\n')} }; return Harness;`, { target: ts.ScriptTarget.ES2022 }))
    (id => `managed:${id}`);
const harness = () => Object.assign(new Harness(), { activeSection:'models', modelCenterView:'all', modelCapabilityFilter:'all', modelSearchQuery:'preserved search',
    modelCenterMerchantCountRequest:0, calls:[], platformCatalog:{offerings:[]}, globalModels:[], platformService:{getPublicMerchantDirectory:async()=>({totalCount:2,merchants:[]})},
    update(){this.calls.push(['update']);}, persistDesktopRestoreState(){}, rememberNavigation(){},
    constrainPaneSizes(){}, loadGlobalModels(){this.calls.push(['globalModels']);},
    selectSection(section){this.calls.push(['section',section]);this.activeSection=section;},
    selectRelay(key,option){this.calls.push(['source',key,option]);return true;}, focusModelPickerFirstOption(){this.calls.push(['focus']);} });

test('Model Center chooses a public merchant absent from the global offerings and enters the existing source picker flow',()=>{
    const value=harness(); value.chooseRelayMerchant('merchant-beyond-first-500','Synthetic Long Name','RLY-A1B2C3D4E5F60718');
    assert.deepEqual(value.calls[0],['section','coding']);
    assert.equal(value.calls[1][1],'managed:merchant-beyond-first-500');
    assert.equal(value.calls[1][2].label,'Synthetic Long Name');
    assert.equal(value.calls[1][2].publicCode,'RLY-A1B2C3D4E5F60718');
    assert.equal(value.codingPopover,'routes');assert.equal(value.modelPickerRelayOpen,false);assert.deepEqual(value.calls.at(-1),['focus']);
});
test('a source-switch confirmation is not bypassed, and invalid merchant IDs never mutate navigation',()=>{
    const value=harness();value.selectRelay=()=>false;value.chooseRelayMerchant('merchant-id','Synthetic');assert.equal(value.codingPopover,undefined);
    assert.equal(value.calls.some(call=>call[0]==='focus'),false);
    const invalid=harness(); invalid.chooseRelayMerchant('../not-an-identity','Unsafe');assert.deepEqual(invalid.calls,[]);
});
test('browse, records, and capability destinations keep independent filtering and exactly one active view',()=>{
    const value=harness();value.modelCenterView='usage';value.selectModelCapabilityFilter('image');
    assert.equal(value.modelCenterView,'capability');assert.equal(value.modelCapabilityFilter,'image');
    value.selectModelCenterView('official');assert.equal(value.modelCenterView,'official');assert.equal(value.modelCapabilityFilter,'image');
    value.selectModelCenterView('favorites');assert.equal(value.modelCenterView,'favorites');assert.equal(value.modelSearchQuery,'preserved search');
    value.selectModelCapabilityFilter('image');assert.equal(value.modelCenterView,'capability');
});
test('merchant navigation count uses the unfiltered total and rejects a late stale count response',async()=>{
    const value=harness(), pending=[];value.platformService.getPublicMerchantDirectory=(...args)=>{assert.deepEqual(args,[]);return new Promise(resolve=>pending.push(resolve));};
    const old=value.loadModelCenterMerchantCount(), current=value.loadModelCenterMerchantCount();
    pending[1]({totalCount:2,merchants:[]});await current;pending[0]({totalCount:7,merchants:[]});await old;
    assert.equal(value.modelCenterMerchantCount,2);
    value.platformService.getPublicMerchantDirectory=async()=>{throw Error('offline');};await value.loadModelCenterMerchantCount();assert.equal(value.modelCenterMerchantCount,2);
});
