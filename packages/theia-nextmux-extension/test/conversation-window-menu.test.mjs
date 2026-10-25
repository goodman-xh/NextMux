import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
import ts from 'typescript';
const require=createRequire(import.meta.url), core=createRequire(require.resolve('@theia/core/package.json'));
const React=core('react');
const {conversationWindowText}=require('../lib/browser/nextmux-conversation-window-locale.js');
const source=readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx',import.meta.url),'utf8');
const file=ts.createSourceFile('widget.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const owner=file.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text==='NextMuxDesktopWidget');
const method=owner.members.find(node=>ts.isMethodDeclaration(node)&&node.name.getText(file)==='renderConversationWindowMenu');
const Widget=Function('React','conversationWindowText',ts.transpile(`class Widget { ${method.getText(file)} } return Widget;`,
    {target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}))(React,conversationWindowText);
const walk=value=>!value||typeof value!=='object'?[]:[value,...React.Children.toArray(value.props?.children).flatMap(walk)];
const widget=()=>Object.assign(new Widget(),{desktopLocale:'zh-CN',tiledCodingSessionIds:new Set(),conversationWindowMenuOpen:false,
    conversationWindowsReclaiming:false,detachedConversationId:'',update(){}});
test('return control appears only in the primary while windows are detached',()=>{
    const instance=widget();assert.equal(instance.renderConversationWindowMenu(),undefined);
    instance.tiledCodingSessionIds.add('one');assert.ok(instance.renderConversationWindowMenu());
    instance.detachedConversationId='one';assert.equal(instance.renderConversationWindowMenu(),undefined);
});
test('menu returns every detached window through one action and keeps the animation anchor until completion',()=>{
    const instance=widget();instance.tiledCodingSessionIds.add('one');instance.conversationWindowMenuOpen=true;
    let calls=0;instance.reclaimConversationWindows=()=>calls++;
    const action=walk(instance.renderConversationWindowMenu()).find(node=>node.props.role==='menuitem');
    assert.equal(walk(action).find(node=>node.type==='span').props.children,'收回所有小窗');action.props.onClick();assert.equal(calls,1);
    instance.tiledCodingSessionIds.clear();instance.conversationWindowMenuOpen=false;instance.conversationWindowsReclaiming=true;
    assert.ok(instance.renderConversationWindowMenu());instance.conversationWindowsReclaiming=false;assert.equal(instance.renderConversationWindowMenu(),undefined);
});
test('return controls have labels in every supported language',()=>{
    for(const locale of ['zh-CN','zh-TW','en','ja','ko','es','fr','de','pt-BR','ru','ar','hi']) {
        for(const key of ['windows','returnAll','failed']) assert.ok(conversationWindowText(locale,key)?.length>2);
        if(!['zh-CN','zh-TW','ja'].includes(locale)) assert.doesNotMatch(conversationWindowText(locale,'returnAll'),/[\u3400-\u9fff]/u);
    }
});
