import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const sourcePath = fileURLToPath(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url));
const source = readFileSync(sourcePath, 'utf8');
const style = readFileSync(fileURLToPath(new URL('../src/browser/style/nextmux.css', import.meta.url)), 'utf8');
const attachmentStyle = readFileSync(fileURLToPath(new URL('../src/browser/style/nextmux-composer-attachments.css', import.meta.url)), 'utf8');
const attachmentsModule = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-composer-attachments.tsx', import.meta.url)), 'utf8');
const streamModel = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-conversation-stream-model.ts', import.meta.url)), 'utf8');
const streamView = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-conversation-stream.tsx', import.meta.url)), 'utf8');
const streamStyle = readFileSync(fileURLToPath(new URL('../src/browser/style/nextmux-conversation-stream.css', import.meta.url)), 'utf8');
const contribution = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-desktop-contribution.ts', import.meta.url)), 'utf8');
const productMenuLocale = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-product-menu-locale.ts', import.meta.url)), 'utf8');
const terminalLocale = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-terminal-locale.ts', import.meta.url)), 'utf8');
const platformService = readFileSync(fileURLToPath(new URL('../src/node/nextmux-platform-service.ts', import.meta.url)), 'utf8');
const terminalProfileResolver = readFileSync(fileURLToPath(new URL('../src/node/nextmux-terminal-profile-resolver.ts', import.meta.url)), 'utf8');
const paneResizeQa = readFileSync(fileURLToPath(new URL('../../../scripts/desktop-pane-resize-qa.mjs', import.meta.url)), 'utf8');
const extensionPackage = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
const file = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

test('desktop workbench is restored for both fresh and persisted layouts', () => {
    assert.match(contribution, /async initializeLayout\(\): Promise<void>[\s\S]*?openView\(\{ activate: false, reveal: true \}\)/);
    assert.match(contribution, /onDidInitializeLayout\(\): void[\s\S]*?restoreWorkbenchAfterStartup\(\)/);
    assert.match(contribution, /restoreWorkbenchAfterStartup\(\): Promise<void>[\s\S]*?reachedState\('ready'\)[\s\S]*?openView\(\{ activate: false, reveal: true \}\)/);
});

test('every rendered button has an interaction handler', () => {
    const failures = [];
    let buttonCount = 0;
    const visit = node => {
        const opening = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : undefined;
        if (opening?.tagName.getText(file) === 'button') {
            buttonCount += 1;
            const attributes = opening.attributes.properties.filter(ts.isJsxAttribute);
            const handler = attributes.find(attribute => attribute.name.getText(file) === 'onClick');
            if (!handler?.initializer || !ts.isJsxExpression(handler.initializer) || !handler.initializer.expression) {
                const line = file.getLineAndCharacterOfPosition(opening.getStart(file)).line + 1;
                failures.push(`line ${line}: ${opening.getText(file)}`);
            } else {
                const expression = handler.initializer.expression;
                if ((ts.isArrowFunction(expression) || ts.isFunctionExpression(expression))
                    && ts.isBlock(expression.body) && expression.body.statements.length === 0) {
                    const line = file.getLineAndCharacterOfPosition(opening.getStart(file)).line + 1;
                    failures.push(`line ${line}: empty interaction handler`);
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(file);
    assert.ok(buttonCount >= 200, `expected the complete desktop surface, found ${buttonCount} buttons`);
    assert.deepEqual(failures, []);
});

test('page and dialog entry points participate in navigation history', () => {
    const methodSource = name => {
        let found = '';
        const visit = node => {
            if ((ts.isMethodDeclaration(node) || ts.isPropertyDeclaration(node))
                && node.name.getText(file) === name) found = node.getText(file);
            ts.forEachChild(node, visit);
        };
        visit(file);
        assert.ok(found, `missing ${name}`);
        return found;
    };
    for (const name of [
        'selectSection', 'selectModelCenterView', 'selectModelCapabilityFilter', 'selectCodingPanel',
        'openSettingsPanel', 'setComicView', 'selectWorkspaceRoot',
        'openScheduledTask', 'openComicCreateSheet', 'openComicCharacterSheet', 'openComicExportSheet',
        'openMediaSheet', 'openScheduleDialog', 'openOffering', 'openOfficialProvider',
        'openCheckpointDiffById'
    ]) {
        assert.match(methodSource(name), /rememberNavigation\(\)/, `${name} must record the current destination`);
    }
    assert.doesNotMatch(methodSource('selectBillingTab'), /rememberNavigation\(\)/, 'settings tabs must not replace the page-level return destination');
    assert.match(methodSource('navigationSnapshot'), /workspaceRoot:/);
    assert.match(methodSource('navigationSnapshot'), /surface:/);
    assert.match(methodSource('navigateBack'), /navigationForwardStack/);
    assert.match(methodSource('navigateForward'), /navigationBackStack/);
    assert.match(methodSource('hasDismissibleSurface'), /comicExportSheetOpen/);
    assert.match(methodSource('hasTransientNavigationSurface'), /comicExportSheetOpen/);
    assert.match(methodSource('openCheckpointDiff'), /await this\.openCheckpointDiffById\(change\.checkpointId \|\| '', 'diff', change\)/);
});

test('floating surfaces are mutually exclusive across navigation entry points', () => {
    const methodSource = name => {
        let found = '';
        const visit = node => {
            if ((ts.isMethodDeclaration(node) || ts.isPropertyDeclaration(node)) && node.name.getText(file) === name) found = node.getText(file);
            ts.forEachChild(node, visit);
        };
        visit(file);
        assert.ok(found, `missing ${name}`);
        return found;
    };
    const clear = methodSource('clearNavigationSurfaces');
    for (const state of ['accountMenuOpen', 'codingPopover', 'codingSearchOpen', 'codingSessionMenuId', 'selectedOffering', 'scheduleDialogOpen', 'fullAccessConfirmationOpen', 'pendingRelaySwitch', 'comicCreateSheetOpen', 'comicCharacterSheetOpen', 'comicExportSheetOpen', 'mediaSheetOpen', 'codingSessionRenameId', 'codingSessionDeleteId', 'pendingTurnEdit', 'turnCopyMenuId', 'followUpTaskMenuId', 'agentProgressPopoverOpen']) {
        assert.match(clear, new RegExp(`${state}\\s*=`), `${state} must be cleared before another surface opens`);
    }
    assert.match(clear, /clearOfficialProviderSurface\(\)/);
    assert.match(clear, /closeModelEffortPickerImmediately\(\)/);
    for (const name of ['openSettingsPanel', 'toggleAccountMenu', 'toggleCodingPopover', 'openCodingSearch', 'toggleCodingSessionMenu', 'openScheduledTask', 'openComicCreateSheet', 'openComicCharacterSheet', 'openComicExportSheet', 'openMediaSheet', 'openScheduleDialog', 'openOffering', 'openOfficialProvider']) {
        assert.match(methodSource(name), /clearNavigationSurfaces\(\)/, `${name} must close the previous surface`);
    }
    // Checkpoints now open a guarded file tab rather than a competing floating diff sheet.
    assert.match(methodSource('openCheckpointDiffById'), /beginContextFileOpen\(/);
    assert.match(methodSource('beginContextFileOpen'), /contextFileReturnOpen = this\.workContextOpen;[\s\S]*?contextFileReturnMode = this\.workContextMode;[\s\S]*?this\.workContextMode = 'file'/);
    assert.match(methodSource('openModelEffortPicker'), /cancelModelEffortPickerClose\(\)/,
        'entering a reasoning submenu must cancel the pending portal close without closing the parent model picker');
});

test('titlebar navigation receives the physical click before global surface dismissal', () => {
    assert.match(source, /className='nmx-titlebar-actions'[^>]*onMouseDown=\{event => event\.stopPropagation\(\)\}/);
    assert.match(source, /className='nmx-titlebar-primary-nav'[^>]*onMouseDown=\{event => event\.stopPropagation\(\)\}/);
    assert.match(source, /item\('models',[\s\S]*?item\('coding',[\s\S]*?item\('comic'/);
    assert.doesNotMatch(source, /className=\{`nmx-rail-button/);
    assert.doesNotMatch(source, /renderGlobalRail/);
    assert.match(source, /<footer className=\{`nmx-context-account-dock\$\{/,
        'the account dock remains mounted when its optional update-state class changes');
    assert.match(style, /\.nmx-titlebar-actions[\s\S]*?-webkit-app-region:\s*no-drag/);
    assert.match(style, /\.nmx-titlebar-primary-nav[\s\S]*?left:\s*50%/);
    assert.match(style, /\.nmx-titlebar-actions \*,[\s\S]*?\.nmx-titlebar-primary-nav \*[\s\S]*?-webkit-app-region:\s*no-drag !important/);
    assert.match(style, /\.nmx-shell,[\s\S]*?\.nmx-shell\.is-work-context-open \{[\s\S]*?grid-template-columns:\s*var\(--nmx-context-panel-width, 276px\) minmax\(0, 1fr\)/);
});

test('project conversation toggles remain flex rows with bounded labels', () => {
    const toggleMarker = "className='nmx-project-conversation-toggle'";
    const toggles = source.split(toggleMarker).slice(1);
    assert.equal(toggles.length, 2);
    for (const toggle of toggles) {
        const closing = toggle.indexOf('</button>');
        assert.notEqual(closing, -1);
        const markup = toggle.slice(0, closing);
        assert.ok(markup.includes('<span>'));
        assert.ok(markup.includes('</span><i className='));
    }
    const cssRule = selector => {
        const rule = [...style.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
            .find(match => match[1].split(',').map(value => value.trim()).includes(selector));
        assert.ok(rule, `missing CSS selector ${selector}`);
        return rule[2];
    };
    const rule = cssRule('.nmx-coding-context .nmx-context-nav button.nmx-project-conversation-toggle');
    for (const declaration of ['display: flex;', 'grid-template-columns: none;', 'min-width: 0;', 'box-sizing: border-box;', 'white-space: nowrap;', 'overflow: hidden;', 'max-width: calc(100% - 28px);']) {
        assert.ok(rule.includes(declaration), `missing toggle declaration ${declaration}`);
    }
    assert.equal(cssRule('.nmx-coding-context .nmx-context-nav button.nmx-project-pagination-control'), rule,
        'pagination and expand controls share one bounded row layout');
    const labelRule = cssRule('.nmx-project-conversation-toggle > span');
    for (const declaration of ['flex: 1;', 'min-width: 0;', 'overflow: hidden;', 'text-overflow: ellipsis;', 'white-space: nowrap;']) {
        assert.ok(labelRule.includes(declaration), `missing label declaration ${declaration}`);
    }
    const iconRule = cssRule('.nmx-project-conversation-toggle > i');
    assert.ok(iconRule.includes('flex: none;'));
});

test('conversation hover actions never cover the title and settings tabs remain rounded', () => {
    assert.match(style, /\.nmx-coding-context \.nmx-context-nav button\.nmx-session-more \{[\s\S]*?width:\s*26px;[\s\S]*?max-width:\s*26px;/);
    assert.match(style, /\.nmx-coding-context \.nmx-context-nav button\.nmx-session-more \{[\s\S]*?grid-template-columns:\s*1fr !important;[\s\S]*?place-items:\s*center !important;/);
    assert.doesNotMatch(source, /<button className='nmx-session-branch'/);
    assert.match(source, /className='nmx-session-menu'[\s\S]*?branchCodingSession\(session\.id\)[\s\S]*?createBranch/);
    assert.match(style, /\.nmx-session-more \{[\s\S]*?pointer-events:\s*none;/);
    assert.match(style, /\.nmx-session-row:hover \.nmx-session-more,[\s\S]*?pointer-events:\s*auto;/);
    assert.match(style, /\.nmx-session-row:hover \.nmx-session-open,[\s\S]*?padding-right:\s*32px !important;/);
    assert.doesNotMatch(source, /className=\{`nmx-project-header \$\{workspace\.path === this\.activeWorkspaceRoot \? 'is-active' : ''\}`\}/);
    assert.doesNotMatch(style, /\.nmx-project-header\.is-active\s*\{/);
    assert.match(style, /\.nmx-session-row\.is-current\s*\{[\s\S]*?background:/);
    assert.match(style, /\.nmx-settings-nav \{[\s\S]*?gap:\s*5px;[\s\S]*?padding:\s*0 8px 14px;/);
    assert.match(style, /\.nmx-context-nav\.nmx-settings-nav > button \{[\s\S]*?min-height:\s*40px;[\s\S]*?margin:\s*0 2px;[\s\S]*?padding:\s*0 14px;[\s\S]*?border-radius:\s*10px;[\s\S]*?background:\s*#343033;/);
    // Selected and unselected fills were swapped at the user's request (2026-09-25).
    assert.match(style, /\.nmx-theme-light \.nmx-context-nav\.nmx-settings-nav > button \{[\s\S]*?background:\s*#e2dedb !important;/);
    assert.match(style, /\.nmx-session-row \{[\s\S]*?anchor-name:\s*--nmx-session-hover-anchor;[\s\S]*?anchor-scope:\s*--nmx-session-hover-anchor;/);
    assert.match(style, /\.nmx-session-time-tooltip \{[\s\S]*?position:\s*fixed;[\s\S]*?position-anchor:\s*--nmx-session-hover-anchor;[\s\S]*?top:\s*calc\(anchor\(bottom\) \+ 5px\);[\s\S]*?width:\s*min\(calc\(var\(--nmx-context-panel-width, 276px\) - 16px\), calc\(100vw - 16px\)\);[\s\S]*?min-width:\s*0;[\s\S]*?max-width:\s*calc\(100vw - 16px\);/);
    assert.match(style, /\.nmx-session-time-tooltip > strong \{[\s\S]*?overflow-wrap:\s*anywhere;[\s\S]*?white-space:\s*normal;/);
    assert.match(style, /\.nmx-theme-light \.nmx-session-time-tooltip \{[\s\S]*?background:\s*#f8f7f5 !important;/);
    assert.match(style, /\.nmx-theme-light \*::\-webkit-scrollbar-thumb \{[\s\S]*?background:\s*#cfc9c5 !important;/);
    assert.match(style, /\.nmx-desktop-widget :is\(input, textarea, select\):focus,[\s\S]*?outline:\s*none !important;[\s\S]*?box-shadow:\s*none !important;/);
    assert.doesNotMatch(style, /\.nmx-desktop-widget :is\(input, textarea, select\):focus,[\s\S]{0,220}?border-color:\s*#777174 !important;/);
    assert.match(style, /\.nmx-model-settings-toolbar > label \{[\s\S]*?margin:\s*0;[\s\S]*?overflow:\s*hidden;/);
    assert.match(style, /\.nmx-desktop-widget \.nmx-model-settings-toolbar > label > input \{[\s\S]*?height:\s*100%;[\s\S]*?padding:\s*0;[\s\S]*?background:\s*transparent !important;[\s\S]*?box-shadow:\s*none !important;/);
});

test('notification counters and header actions stay bounded and single-line', () => {
    assert.match(source, /filter\(item => !item\.read\)\.length > 99 \? '99\+' : this\.notifications\.filter\(item => !item\.read\)\.length/);
    const ruleFor = selector => {
        const start = style.indexOf(selector);
        assert.notEqual(start, -1, `missing CSS selector ${selector}`);
        const end = style.indexOf('\n}', start);
        assert.notEqual(end, -1, `unterminated CSS selector ${selector}`);
        return style.slice(start, end + 2);
    };
    const badge = ruleFor('.nmx-notification-trigger > span {');
    for (const declaration of [
        'box-sizing: border-box;', 'max-width: calc(100% - 2px);',
        'display: inline-flex;', 'white-space: nowrap;', 'pointer-events: none;'
    ]) assert.ok(badge.includes(declaration), `missing notification badge declaration ${declaration}`);
    const actions = ruleFor('.nmx-notification-popover > header > span {');
    for (const declaration of ['min-width: max-content;', 'flex: 0 0 auto;', 'white-space: nowrap;']) {
        assert.ok(actions.includes(declaration), `missing notification header declaration ${declaration}`);
    }
    const title = ruleFor('.nmx-notification-popover > header > strong {');
    for (const declaration of ['min-width: 0;', 'text-overflow: ellipsis;', 'white-space: nowrap;']) {
        assert.ok(title.includes(declaration), `missing notification title declaration ${declaration}`);
    }
    assert.match(source, /const routineTitles = new Set\(\[[\s\S]*?'模型用量已记录'[\s\S]*?'对话内容已复制'/);
    assert.doesNotMatch(source, /this\.addNotification\('info', '模型用量已记录'/);
    assert.doesNotMatch(source, /this\.addNotification\('success', successMessage, '已复制到剪贴板。'\)/);
    assert.match(style, /\.nmx-theme-light \.nmx-notification-list > article strong \{[\s\S]*?color:\s*#302c2f !important;/);
});

test('agent tasks stream observable progress and expose a real cancel action', () => {
    assert.match(source, /this\.platformService\.startAgentRun\(/);
    assert.match(source, /this\.platformService\.getAgentRunSnapshot\(runId, cursor, 1_000\)/);
    assert.match(source, /this\.platformService\.cancelAgentRun\(runId\)/);
    assert.match(source, /className='nmx-send-button is-stop'/);
    assert.match(source, /aria-label=\{this\.agentStopping \? '正在停止任务' : '停止任务'\}/);
    assert.match(source, /renderAgentActivity\(activityEvents, true, false, turn\.id, undefined, turn\.steeringMessages, liveResult\?\.changes \|\| turn\.changes[,)]/);
    assert.match(streamModel, /case 'tool_started':/);
    assert.match(streamModel, /case 'tool_completed':/);
    assert.match(streamModel, /case 'model_retry_scheduled':/);
    assert.match(streamModel, /case 'context_compaction_started':/);
    assert.doesNotMatch(source, /<span>模型路由<\/span>/);
    assert.doesNotMatch(source, /<span>权限<\/span><b>/);
    assert.match(style, /\.nmx-desktop-widget \.nmx-send-button\.is-stop:not\(:disabled\)/);
    assert.match(source, /if \(snapshot\.status === 'cancelled'\) \{[\s\S]*?this\.update\(\);\s*return;/);
    assert.match(source, /const current = this\.codingSessions\.find\(candidate => candidate\.id === session\.id\);[\s\S]*?if \(!current \|\| currentTask\?\.id !== task\.id\) return;[\s\S]*?this\.submitPrompt\(task\.workbench, \{ task, session: current, route, attachments, acceptedRunId \}\)/,
        'dispatch revalidates the current conversation and queue item after attachment preparation');
    assert.match(source, /const followUpDrainTargets = followUpDrainSessionIds\(\{[\s\S]*?finished: generation === run\.agentPollGeneration\s*&& run\.agentStage !== 'running'\s*&& run\.agentResult\?\.stopReason === 'completed'\s*&& !agentPauseBlocksAutomaticDispatch\(run\.agentResult\?\.stopReason\)[\s\S]*?directSessionIds: \[\.\.\.this\.directFollowUpDrainTaskIds\.keys\(\)\]/,
        'only normal successful completion may automatically dispatch the next item; cancellation is not success');
    assert.match(source, /for \(const sessionId of followUpDrainTargets\) this\.requestFollowUpQueueDrain\(sessionId\)/);
    assert.match(style, /\.nmx-follow-up-queue \{[\s\S]*?overflow:\s*auto;[\s\S]*?scrollbar-width:\s*none;/);
    assert.match(style, /\.nmx-follow-up-queue::\-webkit-scrollbar \{[\s\S]*?display:\s*none;/);
    assert.match(style, /\.nmx-follow-up-menu \{[\s\S]*?position:\s*fixed;[\s\S]*?position-anchor:\s*--nmx-follow-up-menu-anchor;[\s\S]*?transform:\s*translateY\(calc\(-100% - 4px\)\);/);
});

test('manual surface dismissal updates browser-style navigation stacks', () => {
    const methodSource = name => {
        let found = '';
        const visit = node => {
            if (ts.isMethodDeclaration(node) && node.name.getText(file) === name) found = node.getText(file);
            ts.forEachChild(node, visit);
        };
        visit(file);
        assert.ok(found, `missing ${name}`);
        return found;
    };
    assert.match(methodSource('closeNavigationSurface'), /navigateBack\(\)/);
    assert.match(methodSource('closeNavigationSurface'), /navigationForwardStack/);
    assert.match(methodSource('completeNavigationSurface'), /navigationBackStack\.slice\(0, -1\)/);
    for (const name of [
        'renderScheduleDialog', 'renderCodingSessionDialogs',
        'renderFullAccessConfirmation', 'renderComicCreateSheet', 'renderComicCharacterSheet',
        'renderComicExportSheet', 'renderMediaSheet', 'renderCheckpointDiffSheet'
    ]) {
        assert.match(methodSource(name), /closeNavigationSurface\(\)|closeVoiceInput\(/, `${name} must close through navigation history`);
    }
    assert.match(methodSource('openVoiceInput'), /stopVoiceInput\(false\)[\s\S]*?focusSystemDictationDraft\(this\.node\)[\s\S]*?new NativeDictationAdapter\(window\.nextmuxDesktop,[\s\S]*?await adapter\.start\(\)/);
    assert.doesNotMatch(methodSource('openVoiceInput'), /getCloudSpeechSettings|startCloudVoiceInput|MediaRecorder|SpeechRecognition|transcribe/);
    assert.doesNotMatch(source, /voiceSheetOpen|renderVoiceInput/);
});

test('conversation navigation tracks the real message scroller and supports local find', () => {
    const methodSource = name => {
        let found = '';
        const visit = node => {
            if (ts.isMethodDeclaration(node) && node.name.getText(file) === name) found = node.getText(file);
            ts.forEachChild(node, visit);
        };
        visit(file);
        assert.ok(found, `missing ${name}`);
        return found;
    };
    assert.match(source, /className='nmx-thread-timeline'/);
    assert.match(methodSource('renderThreadNavigator'), /<Virtuoso[\s\S]*?className='nmx-thread-timeline-list'[\s\S]*?data=\{\[\.\.\.turns\]\}/);
    assert.doesNotMatch(methodSource('renderThreadNavigator'), /turns\.map\(/);
    assert.match(source, /<Virtuoso[\s\S]*?className='nmx-task-view'[\s\S]*?onScroll=\{this\.onCodingStageScroll\}/);
    assert.match(source, /data=\{\[\.\.\.visibleTurns\]\}/);
    assert.match(source, /computeItemKey=\{\(_index, turn\) => turn\.id\}/);
    assert.match(source, /increaseViewportBy=\{\{ top: 900, bottom: 1_200 \}\}/);
    assert.match(source, /minOverscanItemCount=\{\{ top: 3, bottom: 3 \}\}/,
        'rich turns around the viewport stay mounted while a drawer changes the conversation width');
    assert.doesNotMatch(source, /skipAnimationFrameInResizeObserver/,
        'synchronous ResizeObserver measurement caused long drawer-opening frames in the real Electron regression');
    assert.match(source, /threadVirtuosoRef\.current\.scrollToIndex/);
    assert.match(source, /threadVirtuosoRef\.current\?\.autoscrollToBottom\(\)/);
    assert.match(methodSource('scrollThreadTurn'), /querySelector<HTMLElement>\('\.nmx-task-view'\)/);
    assert.match(source, /onCodingStageScroll = \(\): void => \{[\s\S]*?querySelector<HTMLElement>\('\.nmx-task-view'\)/);
    assert.match(source, /handleThreadFindShortcut = \(event: KeyboardEvent\): void => \{[\s\S]*?event\.ctrlKey \|\| event\.metaKey/);
    assert.match(methodSource('threadSearchMatches'), /matches\.length < 500/);
    assert.match(methodSource('revealActiveThreadMarker'), /threadTimelineVirtuosoRef\.current\?\.scrollToIndex/);
    assert.match(methodSource('scrollThreadBottom'), /scheduleThreadBottomFollow\(this\.activeCodingSessionId, 'smooth', latest\.id\)/);
    assert.match(methodSource('scheduleThreadBottomFollow'), /stage\.scrollHeight/);
    assert.match(methodSource('scheduleThreadBottomFollow'), /const settleAuto = \(\): void =>/);
    assert.match(methodSource('scheduleThreadBottomFollow'), /targetMountedAsLast/);
    assert.match(methodSource('scheduleThreadBottomFollow'), /const settleDeadline = behavior === 'smooth' \? 2_500 : 1_500/);
    assert.match(methodSource('scheduleThreadBottomFollow'), /if \(behavior === 'smooth'\)[\s\S]*?window\.setTimeout\(\(\) => requestAnimationFrame\(settleAuto\), 420\)/);
    assert.match(methodSource('scheduleThreadBottomFollow'), /if \(this\.threadVirtuosoRef\.current\)[\s\S]*?else \{[\s\S]*?stage\.scrollTo/);
    assert.equal((methodSource('scheduleThreadBottomFollow').match(/stage\.scrollTo\(/g) || []).length, 1,
        'native scrollTo is only the no-Virtuoso fallback');
    assert.doesNotMatch(methodSource('scheduleThreadBottomFollow'), /setTimeout\(finish, 820\)/);
    assert.match(source, /nmx-thread-to-bottom/);
    assert.match(methodSource('notifyThreadContentChanged'), /scrollHeight - stage\.scrollTop - stage\.clientHeight > 96/);
    // Geometry alone is not a user scroll: a large block that grows the transcript keeps auto-follow (use-stick-to-bottom).
    assert.match(methodSource('notifyThreadContentChanged'), /if \(this\.threadAwayFromBottom \|\| away && this\.threadUserScrolledRecently\(\)\)[\s\S]*?threadUnseenUpdates = 1[\s\S]*?return/);
    assert.match(methodSource('notifyThreadContentChanged'), /scheduleThreadBottomFollow\(sessionId, 'auto'\)/);
    assert.match(methodSource('restoreThreadScroll'), /scheduleThreadBottomFollow\(this\.activeCodingSessionId, 'auto', latest\.id\)/);
    assert.match(source, /readonly threadAnchorTurnId\?: string;/);
    assert.match(source, /readonly threadAnchorOffset\?: number;/);
    assert.match(methodSource('currentCodingSessionViewState'), /\{ threadAnchorTurnId, threadAnchorOffset \}/);
    assert.match(methodSource('restoreThreadScroll'), /threadScrollRestoreToken[\s\S]*?scrollToIndex\(\{ index: anchorIndex, align: 'start', offset: anchorOffset, behavior: 'auto' \}\)/);
    assert.match(methodSource('restoreThreadScroll'), /const anchorDelta = mountedAnchor\.getBoundingClientRect\(\)\.top[\s\S]*?stage\.scrollTo\(\{ top: stage\.scrollTop \+ anchorDelta, behavior: 'auto' \}\)/);
    assert.match(methodSource('restoreThreadScroll'), /performance\.now\(\) - startedAt[\s\S]*?requestAnimationFrame\(restore\)/);
    assert.doesNotMatch(methodSource('restoreThreadScroll'), /const top = Math\.min\(viewState\?\.threadScrollTop/);
    assert.match(source, /onCodingStageScroll = \(\): void => \{[\s\S]*?threadScrollRestoreActive/);
    assert.match(source, /onWheelCapture=\{event => \{[\s\S]*?cancelThreadScrollRestore\(\)/);
    assert.match(source, /className=\{`nmx-task-turn \$\{_index === 0 \? 'is-first' : ''\} \$\{_index === visibleTurns\.length - 1 \? 'is-last' : ''\}`\}/);
    assert.match(style, /\.nmx-task-view\s*\{[\s\S]*?padding:\s*0;/);
    assert.match(style, /\.nmx-task-view\s*\{[\s\S]*?scroll-behavior:\s*auto;/);
    assert.match(style, /\.nmx-task-turn\.is-last\s*\{[\s\S]*?padding-bottom:\s*var\(--nmx-dictation-composer-clearance, 190px\);/);
    assert.match(methodSource('executePromptSubmission'), /scheduleThreadBottomFollow\(codingSession\.id, 'auto', codingTurn\.id\)/);
    assert.match(methodSource('pollAgentRun'), /notifyThreadContentChanged\(run\.activeAgentSessionId\)/);
    assert.match(source, /onThreadAtBottomStateChange = \(atBottom: boolean\): void => \{[\s\S]*?threadBottomStateUpdateScheduled[\s\S]*?queueMicrotask\(\(\) => \{/);
    assert.doesNotMatch(source, /onThreadAtBottomStateChange = \(atBottom: boolean\): void => \{[\s\S]{0,600}?this\.update\(\);\s*\};/);
    assert.doesNotMatch(style, /\.nmx-task-turn\s*\{[^}]*content-visibility:\s*auto;/,
        'Virtuoso already virtualizes turns; content-visibility makes its measured height oscillate while scrolling');
    assert.match(style, /\.nmx-thread-timeline[\s\S]*?left:\s*10px/);
    assert.match(style, /\.nmx-theme-light \.nmx-thread-to-bottom \{[\s\S]*?background:\s*#f8f6f3 !important;/);
});

test('conversation scrolling avoids localization and render feedback loops', () => {
    const methodSource = name => {
        let found = '';
        const visit = node => {
            if (ts.isMethodDeclaration(node) && node.name.getText(file) === name) found = node.getText(file);
            ts.forEachChild(node, visit);
        };
        visit(file);
        assert.ok(found, `missing ${name}`);
        return found;
    };
    assert.match(source, /localizationMutationSuppressed/);
    assert.match(source, /\.nmx-task-view, \.nmx-thread-timeline, \.nmx-thread-files/);
    assert.match(methodSource('localizeRenderedSurface'), /localizationMutationSuppressed = true[\s\S]*?queueMicrotask/);
    assert.match(methodSource('onUpdateRequest'), /super\.onUpdateRequest\(message\);[\s\S]*?localizeRenderedSurface\(\)/);
    assert.match(methodSource('renderThreadNavigator'), /<nav data-nmx-literal className='nmx-thread-timeline'/);
    assert.match(methodSource('renderThreadNavigator'), /data-turn-id=\{turn\.id\}/);
    assert.match(methodSource('renderThreadNavigator'), /onWheel=\{event => this\.onThreadNavigatorWheel\(event\)\}/,
        'the compact conversation timeline should own wheel input inside the marker rail');
    assert.match(methodSource('onThreadNavigatorWheel'), /event\.preventDefault\(\)[\s\S]*?event\.stopPropagation\(\)[\s\S]*?\.nmx-thread-timeline-list/,
        'timeline wheel input must not bubble into the real conversation scroller');
    assert.doesNotMatch(methodSource('onThreadNavigatorWheel'), /\.nmx-task-view|stage\.scrollTo/,
        'timeline wheel input must never move the conversation itself');
    assert.match(methodSource('syncActiveThreadMarker'), /querySelectorAll<HTMLElement>[\s\S]*?data-turn-id/);
    assert.match(methodSource('setActiveThreadMarker'), /this\.syncActiveThreadMarker\(previousTurnId, nextTurnId\)/);
    assert.match(source, /onCodingStageScroll = \(\): void => \{[\s\S]*?selectActiveThreadMarker\([\s\S]*?!awayFromBottom[\s\S]*?this\.latestThreadTurnId\(\)/);
    const scrollSource = source.match(/protected onCodingStageScroll = \(\): void => \{[\s\S]*?\r?\n\s*\};\r?\n\r?\n\s*protected renderThreadText/)?.[0] || '';
    assert.ok(scrollSource, 'missing onCodingStageScroll');
    assert.match(scrollSource, /if \(bottomChanged \|\| unseenChanged\) \{[\s\S]*?this\.update\(\);[\s\S]*?\}/,
        'only bottom-button state changes should request a React render while scrolling');
    assert.doesNotMatch(scrollSource, /if \(turnChanged \|\| bottomChanged \|\| unseenChanged\)[\s\S]*?this\.update\(\);/,
        'moving the compact rail marker must not rerender the virtualized conversation');
    // The stream itself lives in focused modules; the widget method only projects and mounts it.
    assert.match(methodSource('renderAgentActivity'), /projectConversationStream\(\{[\s\S]*?<ConversationStream /);
    assert.match(streamView, /className=\{`nmx-agent-activity nmx-stream/);
    assert.match(streamView, /nmx-agent-narration nmx-stream-text/,
        'streamed model narration should render as conversation prose, not as a boxed tool row');
    assert.doesNotMatch(streamView + methodSource('renderAgentActivity'), /nmx-agent-progress-copy/,
        'the legacy boxed streaming card must not return');
    assert.match(streamModel, /activity: `file-\$\{resource\.action\}`/,
        'file tools should render as compact semantic activity rows instead of raw tool output');
    assert.match(streamModel, /const completedNarration = completedNarrationSourceIndexes\(events\);[\s\S]*?completedNarration\.has\(sourceIndex\)/,
        'intermediate model narration should remain visible after a fast task completes');
    assert.match(streamModel, /isVisibleAssistantProgress\(\{\s*\.\.\.event,\s*previousEventType: events\[sourceIndex - 1\]\?\.type\s*\}\)/,
        'runtime status sentences must use the same compatibility filter as legacy progress');
    assert.match(methodSource('runningAgentTitle'), /isVisibleAssistantProgress\(latest\)/,
        'a legacy low-level progress label must not become the running task title');
    assert.match(methodSource('renderAgentActivity'), /openToolFileActivity/,
        'file activity rows should open their file or checkpoint diff');
    assert.match(streamModel, /title: verb\(locale, kind, 'completed'\), target: shortFileActivityName\(resource\.path\)/,
        'create, read, and edit file rows share localized verbs and show only the short file name');
    assert.doesNotMatch(streamModel, /target: resource\.path/, 'full paths must not render inline');
    assert.match(methodSource('openCheckpointDiffById'), /previewContextFile/,
        'checkpoint activities should reuse the standard project-file preview path');
    assert.match(methodSource('renderAgentTaskProgress'), /summarizeAgentTaskProgress/,
        'the composer progress pill must use observed model and tool events');
    assert.match(source, /revealRangeInEditor/,
        'opening an edited file should reveal the changed code range');
    assert.match(streamView, /codicon-chevron-right nmx-stream-chevron/,
        'expandable activity rows keep an explicit right-arrow affordance');
    assert.match(streamStyle, /\n\.nmx-stream-row \{[\s\S]*?max-width:\s*100%;/,
        'activity rows cannot widen the conversation');
    assert.match(streamStyle, /\n\.nmx-stream-label \{[\s\S]*?overflow:\s*hidden;[\s\S]*?white-space:\s*nowrap;/,
        'activity rows remain one line');
    assert.match(style, /\.nmx-agent-narration\s*\{[\s\S]*?background:\s*transparent/,
        'assistant streaming narration belongs directly on the conversation canvas');
    assert.match(style, /\.nmx-agent-task-progress\s*\{[\s\S]*?font-variant-numeric:\s*tabular-nums/,
        'step progress should remain stable while counts change');
    assert.doesNotMatch(style, /\.nmx-task-view \[data-item-index\] \+ \[data-item-index\]\s*\{[^}]*margin-top:/,
        'margins are outside Virtuoso item measurements and make the total height jump as items mount');
    assert.match(style, /\.nmx-task-view \[data-item-index\]:not\(\[data-item-index=['"]0['"]\]\)\s*\{[^}]*padding-top:\s*54px;/);
});

test('conversation virtualization uses a React 18 compatible Virtuoso release', () => {
    const version = extensionPackage.dependencies?.['react-virtuoso'];
    assert.match(version || '', /^4\./, 'react-virtuoso 2.x calls flushSync during programmatic scroll correction');
});

test('terminal and work-context controls are backed by live services', () => {
    assert.match(source, /onClick=\{\(\) => this\.toggleTerminalDrawer\(\)\}/);
    assert.match(source, /onClick=\{\(\) => this\.toggleWorkContext\(\)\}/);
    assert.match(source, /this\.terminalService\.newTerminal\(/);
    assert.match(source, /this\.platformService\.getTerminalRuntime\(refresh\)/);
    assert.match(source, /const terminalProfile = this\.selectedTerminalProfile\(\)/);
    assert.match(source, /shellPath: terminalProfile\.shellPath/);
    assert.match(source, /shellArgs: \[\.\.\.terminalProfile\.shellArgs\]/);
    assert.match(source, /nextmux\.desktop\.terminalProfile\.v1/);
    assert.match(source, /terminalProfileId: this\.selectedTerminalProfile\(\)\?\.id/);
    assert.match(source, /className='nmx-terminal-profile-select'/);
    assert.match(platformService, /resolveTerminalProfiles\(\{/);
    assert.match(terminalProfileResolver, /located\(options, 'pwsh\.exe'\)/);
    assert.match(terminalProfileResolver, /System32', 'WindowsPowerShell', 'v1\.0', 'powershell\.exe'/);
    assert.match(terminalProfileResolver, /ProgramW6432/);
    assert.match(terminalProfileResolver, /loginShells/);
    assert.match(source, /new ResizeObserver\(\(\) => \{/);
    assert.match(source, /classList\.contains\('nmx-pane-resizing-x'\)/);
    assert.match(source, /classList\.contains\('nmx-pane-resizing-y'\)/);
    assert.match(source, /this\.scheduleTerminalFit\(\)/);
    assert.match(source, /resizeTerminal\?\.call\(terminal\)/);
    assert.match(source, /records\.splice\(targetIndex, 0, record\)/);
    assert.match(source, /protected closeCurrentConversationTerminals\(\): void \{[\s\S]*?filter\(record => record\.sessionId === this\.activeCodingSessionId\)/);
    assert.match(source, /terminateTerminalProcessTree\(widget\.terminalId\)[\s\S]*?widget\.dispose\(\)/,
        'terminal closure kills the complete PTY process tree before disposing its UI handle');
    assert.match(source, /className='nmx-terminal-close-all'[\s\S]*?title=\{closeCurrentConversationTerminalsLabel\}[\s\S]*?<i className='codicon codicon-close-all'><\/i><\/button>/);
    assert.doesNotMatch(source, /className='nmx-terminal-close-all'[\s\S]{0,500}<span>/);
    assert.match(source, /this\.fileService\.resolve\(/);
    assert.match(source, /this\.fileService\.readFile\(/);
    assert.match(source, /<NextMuxTerminalHost terminal=\{record\.widget\} theme=\{this\.resolvedDesktopTheme\(\)\} clipboardService=\{this\.clipboardService\} \/>/);
    assert.match(source, /getTerminal\?\.\(\)/);
    assert.match(source, /xterm\.options\.theme = \{ \.\.\.NEXTMUX_TERMINAL_THEMES\[this\.props\.theme\] \}/);
    assert.match(source, /terminal\.hasSelection\(\)[\s\S]*?const selection = terminal\.getSelection\(\)[\s\S]*?nativeClipboard\.writeClipboard\(selection\)[\s\S]*?clipboardService\.writeText\(selection\)/,
        'Enter on a selected xterm range copies it without sending a newline');
    assert.match(source, /getTerminal\?\.\(\)[\s\S]*?clearSelection\?\.\(\)/,
        'copying a terminal selection clears it so the next Enter reaches the PTY');
    assert.match(source, /onContextMenuCapture=\{this\.handleTerminalContextMenu\}/);
    assert.match(source, /nativeClipboard\.readClipboard\(\)[\s\S]*?clipboardService\.readText\(\)[\s\S]*?terminal\.paste\(text\)/,
        'right click pastes clipboard text into the live PTY');
    assert.match(source, /React\.createElement\('webview'/);
});

test('scroll-to-bottom follows the complete composer stack and never overlaps the follow-up queue', () => {
    const methodSource = name => {
        let found = '';
        const visit = node => {
            if (ts.isMethodDeclaration(node) && node.name.getText(file) === name) found = node.getText(file);
            ts.forEachChild(node, visit);
        };
        visit(file);
        assert.ok(found, `missing ${name}`);
        return found;
    };
    const render = methodSource('renderCodingWorkbench');
    const composerStart = render.indexOf("className={`nmx-composer-wrap");
    const bottomButton = render.indexOf('nmx-thread-to-bottom');
    const queue = render.indexOf('nmx-follow-up-queue');
    assert.ok(composerStart >= 0 && bottomButton > composerStart && queue > bottomButton,
        'the bottom affordance must be inside the composer wrapper and before the variable-height queue');
    assert.match(style, /\.nmx-thread-to-bottom\s*\{[^}]*top:\s*-\d+px;[^}]*bottom:\s*auto;/s,
        'the bottom affordance must anchor above the complete composer wrapper instead of using a fixed viewport bottom');
});

test('terminal scope and list labels stay compact and single-line in every locale', () => {
    assert.match(style, /\.nmx-terminal-drawer > header nav button\s*\{[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s);
    const listHeader = style.match(/\.nmx-terminal-list > header\s*\{([^}]*)\}/s)?.[1] || '';
    assert.match(listHeader, /font-size:\s*12px;/);
    assert.match(listHeader, /white-space:\s*nowrap;/);
    assert.match(listHeader, /overflow:\s*hidden;/);
    assert.match(style, /\.nmx-terminal-select strong\s*\{[^}]*font-size:\s*13px;/s);
    assert.match(style, /\.nmx-terminal-select small\s*\{[^}]*font-size:\s*12px;/s);
});

test('file drawer edits text directly, keeps binary detection, and reports stale files precisely', () => {
    const methodSource = name => {
        let found = '';
        const visit = node => {
            if (ts.isMethodDeclaration(node) && node.name.getText(file) === name) found = node.getText(file);
            ts.forEachChild(node, visit);
        };
        visit(file);
        assert.ok(found, `missing ${name}`);
        return found;
    };
    const preview = methodSource('previewContextFile');
    assert.match(preview, /fileService\.readFile\(resource, \{ limits: \{ size: IMAGE_PREVIEW_MAX_BYTES \} \}\)/, 'image files still use their original bytes, within a bound');
    assert.match(preview, /fileService\.read\(resource,[\s\S]*?acceptTextOnly:\s*true/,
        'all text extensions use Theia streaming text decoding in the drawer editor');
    // Not the former 512 KB preview cap: a generous bound the window can hold (audit DS-10).
    assert.match(preview, /limits:\s*\{ size: FILE_DRAWER_TEXT_MAX_BYTES, memory: FILE_DRAWER_TEXT_MAX_BYTES \* 4 \}/,
        'the former preview-size cap must not block the drawer editor');
    assert.doesNotMatch(preview, /512 \* 1024/);
    assert.match(preview, /not\[ -\]\?found[\s\S]*?\? 'missing'[\s\S]*?filePreviewErrorText\(this\.desktopLocale, errorKind\)/);
    assert.match(preview, /\? 'binary' : 'unavailable'/);
    assert.doesNotMatch(source, /preview\.error \? <div className='nmx-file-preview-state'><span>\{preview\.error\}<\/span><button/);
});

test('terminal drawer keeps interactive shells live-only and removes exited PTYs immediately', () => {
    const methodSource = name => {
        let found = '';
        const visit = node => {
            if (ts.isMethodDeclaration(node) && node.name.getText(file) === name) found = node.getText(file);
            ts.forEachChild(node, visit);
        };
        visit(file);
        assert.ok(found, `missing ${name}`);
        return found;
    };
    assert.match(methodSource('createConversationTerminal'),
        /createTerminalForSession\(session, 'user', true, true, true\)/,
        'new terminal action must reuse an idle conversation shell before allocating another PTY');
    assert.match(methodSource('loadTerminalRecords'), /localStorage\.removeItem\('nextmux\.desktop\.terminalRecords\.v1'\)/);
    assert.doesNotMatch(methodSource('loadTerminalRecords'), /JSON\.parse|nextmux-agent-history/,
        'terminal processes cannot be restored after their widgets have gone away');
    assert.match(methodSource('persistTerminalRecords'), /localStorage\.removeItem\('nextmux\.desktop\.terminalRecords\.v1'\)/);
    assert.match(source, /this\.terminalService\.all/);
    assert.match(methodSource('captureExternalTerminal'), /terminalProfileForWidget\(widget\)[\s\S]*?return/,
        'an unknown Theia terminal must not be relabelled as the selected NextMux shell');
    assert.match(methodSource('terminalProfileForWidget'), /nextmux\.profileId[\s\S]*?options\?\.shellPath[\s\S]*?profile\.shellPath/,
        'external terminals are reusable only when metadata or the executable matches a discovered profile');
    assert.match(source, /isTransient:\s*false/);
    assert.match(source, /destroyTermOnClose:\s*true/);
    assert.match(methodSource('visibleTerminalRecords'), /record\.widget && !record\.widget\.isDisposed && !record\.widget\.exitStatus/);
    assert.match(methodSource('markConversationTerminalExited'), /removeConversationTerminal\(recordId\)/);
    assert.doesNotMatch(methodSource('renderTerminalSurface'), /nmx-terminal-restored|processExited|restartConversationTerminal/);
    assert.match(methodSource('closeConversationTerminal'), /terminateAndDisposeConversationTerminal\(record\)[\s\S]*?if \(terminated\) this\.removeConversationTerminal\(recordId\)/,
        'a failed kill must keep the live terminal visible instead of removing its UI first');
    assert.match(methodSource('deleteCodingSession'), /terminateAndDisposeConversationTerminal\(terminal\)/,
        'deleting a conversation must terminate its PTY process trees instead of only removing widgets');
    assert.match(methodSource('reusableTerminalForSession'), /record\.profileId === this\.selectedTerminalProfile\(\)\?\.id/);
    assert.doesNotMatch(methodSource('reusableTerminalForSession'), /record\.source === source/,
        'user and agent callers share the same idle PTY instead of creating source-specific terminal pools');
    assert.match(methodSource('shutdownForApplicationExit'), /Promise\.allSettled\(records\.map\(record => this\.terminateAndDisposeConversationTerminal\(record\)\)\)/,
        'closing or restarting the UI must terminate every attached terminal process tree');
    assert.match(contribution, /async onStop\(\): Promise<void> \{[\s\S]*?await this\.tryGetWidget\(\)\?\.shutdownForApplicationExit\(\)/,
        'the frontend lifecycle must terminate terminals before the window is destroyed');
    assert.match(platformService, /@preDestroy\(\)[\s\S]*?disposeConnectionResources\(\): Promise<void>/,
        'disconnecting or restarting the backend connection must cancel active child work');
    assert.doesNotMatch(source, /nextmux-agent-history-/,
        'process.run activity belongs in the conversation and must not create a fake terminal');
});

test('terminal cleanup is capability-scoped and keeps failed shutdowns visible', () => {
    assert.match(platformService, /@inject\(IShellTerminalServer\)[\s\S]*?shellTerminalServer/,
        'the backend must resolve operating-system PIDs from Theia-owned terminal IDs');
    assert.match(platformService, /shellTerminalServer\.getProcessId\(terminalId\)/,
        'a renderer-supplied raw PID must never be trusted as a kill capability');
    assert.doesNotMatch(platformService, /terminateTerminalProcessTree\(processId:/,
        'the public RPC must not expose arbitrary same-user process termination');
    assert.match(platformService, /result\.exitCode !== 0[\s\S]*?terminated:\s*false/,
        'taskkill failure must be reported instead of silently hiding a live process');
    assert.match(source, /let widget: TerminalWidget \| undefined;[\s\S]*?widget = await this\.terminalService\.newTerminal[\s\S]*?catch \(error\)[\s\S]*?widget\.dispose\(\)/,
        'a TerminalWidget created before start() fails must always be disposed');
    assert.match(source, /terminateTerminalProcessTree\(widget\.terminalId\)/,
        'the frontend should terminate only the registered terminal capability');
});

test('agent process events remain in conversation activity without creating a duplicate task terminal', () => {
    const methodSource = name => {
        let found = '';
        const visit = node => {
            if (ts.isMethodDeclaration(node) && node.name.getText(file) === name) found = node.getText(file);
            ts.forEachChild(node, visit);
        };
        visit(file);
        assert.ok(found, `missing ${name}`);
        return found;
    };
    assert.doesNotMatch(source, /syncAgentTerminalEvents|finishAgentTerminal|appendAgentTerminalEvents|agentTerminalHistory/);
    assert.match(methodSource('pollAgentRun'), /mergeAgentEventPollSnapshot\(run\.liveAgentEvents, cursor, snapshot, this\.desktopLocale\)/);
    assert.match(streamModel, /case 'tool_started':/);
    assert.match(streamModel, /case 'tool_completed':/);
    assert.doesNotMatch(source, /nextmux-terminal-task-history|TaskTerminalRecord|NextMuxTaskTerminalHost|taskTerminalRecords|renderTaskTerminalSurface/);
    assert.match(methodSource('visibleTerminalRecords'), /this\.terminalRecords\.filter/,
        'the drawer is derived only from Theia-owned integrated terminal records');
    assert.match(methodSource('renderTerminalSurface'), /<NextMuxTerminalHost terminal=\{record\.widget\}/,
        'every visible terminal attaches the mature Theia\/xterm terminal widget');
    assert.match(methodSource('renderTerminalDrawer'), /className='nmx-terminal-close'/,
        'every visible terminal exposes the normal close-and-terminate action');
    assert.doesNotMatch(methodSource('renderTerminalDrawer'), /taskRecord|is-readonly|aria-readonly/);
});

test('workspace panes have bounded persistent drag and keyboard resize controls', () => {
    const methodSource = name => {
        let found = '';
        const visit = node => {
            if (ts.isMethodDeclaration(node) && node.name.getText(file) === name) found = node.getText(file);
            ts.forEachChild(node, visit);
        };
        visit(file);
        assert.ok(found, `missing ${name}`);
        return found;
    };
    for (const name of [
        'beginContextPanelResize', 'beginWorkContextResize',
        'beginTerminalResize', 'beginTerminalListResize'
    ]) {
        assert.match(source, new RegExp(`protected ${name}\\([\\s\\S]*?beginPaneDrag\\(`), `${name} must start a live pointer drag`);
    }
    assert.match(source, /className='nmx-context-panel-resize'[\s\S]*?onPointerDown=\{event => this\.beginContextPanelResize\(event\)\}[\s\S]*?onKeyDown=\{event => this\.handlePaneResizeKey\(event, 'context'\)\}/);
    assert.match(source, /className='nmx-work-context-resize'[\s\S]*?onPointerDown=\{event => this\.beginWorkContextResize\(event\)\}[\s\S]*?onKeyDown=\{event => this\.handlePaneResizeKey\(event, 'work-context'\)\}/);
    assert.match(source, /className='nmx-terminal-resize'[\s\S]*?onPointerDown=\{event => this\.beginTerminalResize\(event\)\}[\s\S]*?onKeyDown=\{event => this\.handlePaneResizeKey\(event, 'terminal-height'\)\}/);
    assert.match(source, /className='nmx-terminal-list-resize'[\s\S]*?onPointerDown=\{event => this\.beginTerminalListResize\(event\)\}[\s\S]*?onKeyDown=\{event => this\.handlePaneResizeKey\(event, 'terminal-list'\)\}/);
    assert.match(source, /nextmux\.desktop\.pane\.contextWidth\.v1/);
    assert.match(source, /nextmux\.desktop\.pane\.workContextWidth\.v1/);
    assert.match(source, /nextmux\.desktop\.pane\.terminalHeight\.v1/);
    assert.match(source, /nextmux\.desktop\.pane\.terminalListWidth\.v1/);
    assert.match(source, /protected terminalAvailableWidth\(\): number \{[\s\S]*?\.nmx-terminal-drawer[\s\S]*?if \(rendered > 0\) return rendered;[\s\S]*?\.nmx-workspace[\s\S]*?if \(workspace > 0\) return workspace;/);
    assert.match(source, /const paneObserver = new ResizeObserver\(\(\) => this\.schedulePaneResizeUpdate\(\)\)/);
    assert.match(methodSource('schedulePaneResizeUpdate'), /requestAnimationFrame\(\(\) => \{[\s\S]*?this\.syncPaneCssVariables\(\);[\s\S]*?this\.update\(\);/);
    assert.doesNotMatch(methodSource('constrainPaneSizes'), /persistPaneSize|localStorage/,
        'automatic viewport constraints must never overwrite a user preference');
    assert.match(source, /protected preferredContextPanelWidth = 276;[\s\S]*?protected preferredWorkContextWidth = 358;[\s\S]*?protected preferredContextFileListWidth = 218;[\s\S]*?protected preferredTerminalDrawerHeight = 264;[\s\S]*?protected preferredTerminalListWidth = 218;/);
    assert.match(methodSource('restoreCodingViewState'), /this\.preferredWorkContextWidth = this\.clampPaneSize\(viewState\.workContextWidth,[\s\S]*?WORK_CONTEXT_MIN_WIDTH, NextMuxDesktopWidget\.WORK_CONTEXT_MAX_WIDTH\)[\s\S]*?this\.schedulePaneResizeUpdate\(\)/,
        'session restore must preserve the preferred drawer width until the rendered layout can constrain it');
    assert.doesNotMatch(methodSource('restoreCodingViewState'), /viewState\.workContextWidth,[\s\S]{0,160}?this\.workContextMaximumWidth\(\)/,
        'session restore must not use stale pre-render dynamic bounds');
    assert.match(methodSource('applyNavigationSnapshot'), /if \(!snapshot\.viewState\) this\.constrainPaneSizes\(\)/,
        'navigation snapshots with view state must defer dynamic constraints until after render');
    assert.match(methodSource('currentCodingSessionViewState'), /workContextWidth:\s*this\.preferredWorkContextWidth[\s\S]*?contextFileListWidth:\s*this\.preferredContextFileListWidth[\s\S]*?terminalDrawerHeight:\s*this\.preferredTerminalDrawerHeight[\s\S]*?terminalListWidth:\s*this\.preferredTerminalListWidth/,
        'conversation view state stores user preferences rather than temporary narrow-window sizes');
    assert.match(methodSource('workContextInlineMaximumWidth'), /CONVERSATION_MIN_WIDTH/);
    assert.match(methodSource('workContextMaximumWidth'), /this\.paneShellWidth\(\) - contextWidth/);
    assert.match(source, /protected terminalListMinimumWidth\(\): number \{[\s\S]*?TERMINAL_LIST_TIGHT_MIN_WIDTH[\s\S]*?TERMINAL_LIST_COMPACT_MIN_WIDTH/);
    assert.match(source, /protected terminalSurfaceMinimumWidth\(\): number \{[\s\S]*?TERMINAL_SURFACE_TIGHT_MIN_WIDTH[\s\S]*?TERMINAL_SURFACE_COMPACT_MIN_WIDTH/);
    assert.match(source, /protected terminalListMaximumWidth\(\): number \{[\s\S]*?available < 560 \? \.46 : \.55/);
    assert.match(source, /protected effectiveTerminalListWidth\(\): number \{[\s\S]*?this\.terminalListMaximumWidth\(\)/);
    assert.match(source, /'--nmx-terminal-list-width': `\$\{this\.effectiveTerminalListWidth\(\)\}px`/);
    assert.match(style, /\.nmx-terminal-layout \{\s*grid-template-columns:\s*minmax\(0, 1fr\) 6px var\(--nmx-terminal-list-width, 218px\)/);
    assert.match(style, /\.nmx-terminal-list \{[\s\S]*?min-width:\s*0;[\s\S]*?container-type:\s*inline-size;/);
    assert.match(style, /\.nmx-terminal-list > header > span \{[\s\S]*?overflow:\s*hidden;[\s\S]*?text-overflow:\s*ellipsis;[\s\S]*?white-space:\s*nowrap;/);
    assert.match(style, /\.nmx-work-context \{[\s\S]*?max-width:\s*calc\(100% - var\(--nmx-context-panel-width, 276px\) - 400px\)/);
    assert.match(style, /\.nmx-shell:has\(\.nmx-terminal-drawer\.is-open\) \.nmx-work-context \{\s*bottom:\s*var\(--nmx-terminal-drawer-height, 264px\)/);
    assert.doesNotMatch(methodSource('renderTerminalDrawer'), /if \(!this\.terminalDrawerOpen\) return undefined/);
    assert.match(methodSource('renderTerminalDrawer'), /is-open'[\s\S]*?'is-closed'/);
    assert.match(methodSource('renderTerminalDrawer'), /node\.inert = !this\.terminalDrawerOpen/);
    assert.match(style, /\.nmx-terminal-drawer \{[\s\S]*?transition:\s*height 170ms/);
    assert.match(style, /\.nmx-terminal-drawer\.is-closed \{[\s\S]*?pointer-events:\s*none;[\s\S]*?opacity:\s*0;/);
    assert.match(style, /#theia-left-right-split-panel > \.lm-SplitPanel-handle \{[\s\S]*?display:\s*none !important;[\s\S]*?pointer-events:\s*none !important;/);
    assert.match(source, /const coalescedEvents = nextEvent\.getCoalescedEvents\?\.\(\)/);
    assert.match(source, /protected setPaneCssVariable\(name: string, value: string\): void \{[\s\S]*?document\.documentElement\.style\.setProperty\(name, value\);[\s\S]*?querySelector<HTMLElement>\('\.nmx-shell'\)\?\.style\.setProperty\(name, value\)/);
    assert.match(source, /protected beginTerminalResize\([\s\S]*?if \(nextHeight === this\.terminalDrawerHeight\) return;[\s\S]*?this\.beginPaneDrag/);
    assert.match(source, /protected beginTerminalListResize\([\s\S]*?if \(nextWidth === this\.terminalListWidth\) return;[\s\S]*?this\.beginPaneDrag/);
    assert.match(source, /className=\{`nmx-session-row[\s\S]*?data-session-id=\{session\.id\}/,
        'session rows expose an exact opaque identifier for safe automation and cleanup');
    assert.match(methodSource('beginTerminalResize'), /setPaneCssVariable\('--nmx-terminal-drawer-height'/);
    assert.match(methodSource('beginTerminalListResize'), /setPaneCssVariable\('--nmx-terminal-list-width'/);
    assert.match(methodSource('beginTerminalResize'), /fitActiveTerminalDuringDrag\(\)/);
    assert.match(methodSource('beginTerminalListResize'), /fitActiveTerminalDuringDrag\(\)/);
    assert.match(methodSource('beginTerminalResize'), /persistPaneSize\('nextmux\.desktop\.pane\.terminalHeight\.v1'[^;]*;\s*this\.persistActiveCodingSessionState\(\)/);
    assert.match(methodSource('beginTerminalListResize'), /persistPaneSize\('nextmux\.desktop\.pane\.terminalListWidth\.v1'[^;]*;\s*this\.persistActiveCodingSessionState\(\)/);
    assert.doesNotMatch(methodSource('beginContextPanelResize'), /persistPaneSize\('nextmux\.desktop\.pane\.(?:workContextWidth|terminalListWidth)\.v1'/,
        'dragging the left pane must not persist passive constraints applied to other panes');
    assert.match(methodSource('handlePaneResizeKey'), /persistActiveCodingSessionState\(\);\s*this\.update\(\)/);
    assert.doesNotMatch(methodSource('fitActiveTerminalDuringDrag'), /doResizeTerminal/,
        'drag resize must not bypass Theia terminal lifecycle guards');
    assert.match(methodSource('fitActiveTerminalDuringDrag'), /terminal\.update\(\)/);
    assert.match(methodSource('fitActiveTerminalDuringDrag'), /xterm\?\.element\?\.isConnected/);
    assert.match(methodSource('fitActiveTerminalDuringDrag'), /resizeTerminal\?\.call\(terminal\)/);
    assert.doesNotMatch(methodSource('beginTerminalResize').split('this.beginPaneDrag')[0], /refreshActiveTerminalLayout\(\)/);
    assert.doesNotMatch(methodSource('beginTerminalListResize').split('this.beginPaneDrag')[0], /refreshActiveTerminalLayout\(\)/);
    assert.match(paneResizeQa, /automatic compact constraints never overwrite local preferred pane sizes/);
    assert.match(paneResizeQa, /returns to its preferred width after the viewport expands/);
    assert.match(paneResizeQa, /expanding the viewport leaves conversation preferred pane sizes unchanged/);
});

test('optional skill hydration can never block a model run indefinitely', () => {
    let method = '';
    const visit = node => {
        if (ts.isMethodDeclaration(node) && node.name.getText(file) === 'prepareAgentSkills') method = node.getText(file);
        ts.forEachChild(node, visit);
    };
    visit(file);
    assert.ok(method, 'missing prepareAgentSkills');
    assert.match(method, /Promise\.race\(\[\s*Promise\.all\(reads\),/,
        'the complete optional-skill batch needs a hard deadline');
    assert.match(method, /window\.setTimeout\(resolve, 3_000\)/,
        'a hung file provider must fail open before the model request starts');
    assert.match(method, /catch \(error\) \{[\s\S]*?settledCandidates\[index\] = undefined;[\s\S]*?\.reportSkillError\?\.\(skill\.name, skill\.location, error\)/,
        'one malformed or unavailable skill must not fail the task');
});

test('async file preview and view restore results stay owned by their originating conversation', () => {
    const methodSource = name => {
        let found = '';
        const visit = node => {
            if (ts.isMethodDeclaration(node) && node.name.getText(file) === name) found = node.getText(file);
            ts.forEachChild(node, visit);
        };
        visit(file);
        assert.ok(found, `missing ${name}`);
        return found;
    };
    assert.match(source, /protected codingViewRestoreToken = 0;[\s\S]*?protected contextFilePreviewRequestToken = 0;/);
    assert.match(methodSource('restoreCodingViewState'), /const restoreSessionId = this\.activeCodingSessionId;[\s\S]*?const restoreToken = \+\+this\.codingViewRestoreToken;[\s\S]*?filePreviewRequestIsCurrent\(this\.codingViewRestoreToken, restoreToken, this\.activeCodingSessionId, restoreSessionId\)/);
    assert.match(methodSource('previewContextFile'), /const requestSessionId = this\.activeCodingSessionId;[\s\S]*?const requestToken = \+\+this\.contextFilePreviewRequestToken;[\s\S]*?const requestIsCurrent = \(\): boolean => filePreviewRequestIsCurrent/);
    assert.match(methodSource('previewContextFile'), /finally \{[\s\S]*?if \(!requestIsCurrent\(\)\) return;[\s\S]*?persistActiveCodingSessionState\(\)/,
        'an obsolete read must not clear loading or persist into the newly active conversation');
});

test('file activity opens through the drawer without destroying the previous drawer view', () => {
    const methodSource = name => {
        let found = '';
        const visit = node => {
            if (ts.isMethodDeclaration(node) && node.name.getText(file) === name) found = node.getText(file);
            ts.forEachChild(node, visit);
        };
        visit(file);
        assert.ok(found, `missing ${name}`);
        return found;
    };
    const activity = methodSource('openToolFileActivity');
    const preview = methodSource('previewContextFile');
    const begin = methodSource('beginContextFileOpen');
    const close = methodSource('closeContextFilePreview');
    const beginIndex = activity.indexOf('this.beginContextFileOpen(');
    assert.ok(beginIndex >= 0, 'file activity must begin through the shared drawer opening path');
    assert.doesNotMatch(activity.slice(0, beginIndex), /this\.workContextOpen\s*=\s*true/,
        'file activity must capture the previous drawer before opening it');
    assert.match(activity, /if \(isDirectoryTarget\) \{[\s\S]*?this\.workContextMode = 'file';[\s\S]*?this\.workContextOpen = true;[\s\S]*?this\.finishContextFileOpen\(\);/,
        'directory activity can reveal the file tree after the shared opening path');
    assert.match(activity, /await this\.previewContextFile\(/,
        'file activity must use the standard guarded preview path');
    assert.match(preview, /this\.beginContextFileOpen\(node\)/,
        'preview must use the same return-surface capture as other entry points');
    assert.doesNotMatch(preview, /this\.contextFileReturn(?:Pending|Open|Mode)\s*=/,
        'an async preview must not overwrite the prior drawer after opening it');
    assert.match(begin, /!this\.contextFileReturnPending[\s\S]*?this\.contextFileReturnPending\s*=\s*true;[\s\S]*?this\.contextFileReturnOpen\s*=\s*this\.workContextOpen;[\s\S]*?this\.contextFileReturnMode\s*=\s*this\.workContextMode;[\s\S]*?this\.workContextOpen = true;/,
        'the shared opener must capture the prior drawer once before changing its visibility');
    assert.match(close, /const restorePreviousView = this\.contextFileReturnPending;[\s\S]*?const nextWorkContextOpen = restorePreviousView \? this\.contextFileReturnOpen : true;[\s\S]*?const nextWorkContextMode = restorePreviousView \? this\.contextFileReturnMode : 'file'/,
        'closing a preview must restore the prior drawer surface instead of always leaving an open file drawer');
    // (and while an AI window tab covers the conversation, which has no file rail of its own)
    assert.match(source, /this\.codingPanel === 'thread' && !visualTab && !activeCouncilChild && \(!this\.workContextOpen \|\| Boolean\(this\.detachedConversationId\)\) && this\.renderThreadFileNavigator\(\)/,
        'the legacy file rail must stay hidden while any right-side drawer tab owns the right side; a detached window shows no drawer');
});

test('a detached window, which has no file drawer, opens files from its floats in the main window', () => {
    const method = name => source.match(new RegExp(`\\n    protected (?:async )?${name}\\([\\s\\S]*?\\n    }\\n`))?.[0] || '';
    const rows = method('renderThreadFileRows'), open = method('openContextFile'), handOff = method('openFileInMainWindow');
    const receive = method('receiveConversationWindowEvent'), reveal = method('openRevealedConversationFile');
    assert.match(rows, /onClick=\{\(\) => void \(this\.detachedConversationId && !node\.directory \? this\.openFileInMainWindow\(node\.uri\) : this\.previewContextFile\(node\)\)\}/,
        'a file row hands its file to the main window; a folder still opens in place');
    assert.match(open, /isCodingGoalFileUri\(uri, goalOwner\)\) \{ await this\.openGoalDialog\(\); return; \}\s*\/\/[^\n]*\n\s*if \(this\.detachedConversationId\) \{ this\.openFileInMainWindow\(uri\); return; \}\s*const notificationSessionId/,
        'AGENTS.md and every other file a detached window opens go to the main window before any drawer state changes');
    assert.doesNotMatch(handOff, /workContextOpen|beginContextFileOpen|previewContextFile/, 'the hand-off never opens the hidden drawer of the detached window');
    assert.match(handOff, /revealConversationInMain\?: \(sessionId: string, fileUri\?: string\)[\s\S]*?closest\('\.nmx-thread-files, \.nmx-thread-notes-float, \.nmx-thread-agents-float'\)\) focused\.blur\(\);[\s\S]*?revealConversationInMain\(sessionId, uri\)\)\.catch/);
    assert.match(receive, /type === 'reveal' && !this\.detachedConversationId\) \{[\s\S]*?const file = typeof fileUri === 'string' && \/\^file:\\\/\\\/\/i\.test\(fileUri\) \? fileUri : '';[\s\S]*?if \(file && switching\) \{ this\.flushComposerDraft\?\.\(\); this\.persistActiveCodingSessionState\?\.\(\); \}[\s\S]*?this\.activeCodingSessionId = targetId;[\s\S]*?if \(file\) void this\.openRevealedConversationFile\(targetId, file, opening, switching\);/,
        'the main window keeps the conversation it showed, then opens the handed-off file in the revealed conversation');
    assert.match(reveal, /if \(opening\) await opening[\s\S]*?else if \(switching\) \{\s*await this\.restoreCodingViewState\([\s\S]*?if \(this\.isDisposed \|\| this\.activeSection !== 'coding' \|\| this\.activeCodingSessionId !== sessionId\) return;\s*await this\.openContextFile\(fileUri\);/,
        'the revealed conversation\'s own drawer returns before the file joins its tabs');
});

test('light relay hover and narrow composer controls remain visible and bounded', () => {
    assert.match(style, /\.nmx-composer-wrap \{[\s\S]*?container-name:\s*nmx-composer-width;[\s\S]*?container-type:\s*inline-size;/);
    assert.match(style, /\.nmx-composer \.nmx-permission-button,[\s\S]*?\.nmx-composer \.nmx-composer-relay-button,[\s\S]*?\.nmx-composer \.nmx-route-button \{[\s\S]*?min-width:\s*0;[\s\S]*?max-width:\s*min\(240px, 52cqw\);[\s\S]*?overflow:\s*hidden;/);
    assert.match(style, /@container nmx-composer-width \(max-width: 390px\) \{[\s\S]*?\.nmx-composer \.nmx-permission-button > span \{[\s\S]*?display:\s*none;/);
    assert.match(style, /@container nmx-composer-width \(max-width: 440px\) \{[\s\S]*?\.nmx-composer \.nmx-composer-relay-button > span,[\s\S]*?display:\s*none;/);
    assert.match(style, /\.nmx-theme-light :is\([\s\S]*?\.nmx-composer-relay-button,[\s\S]*?\):hover:not\(:disabled\)/);
    assert.match(style, /html\.nmx-pane-resizing-x :is\(\.nmx-terminal-layout,[\s\S]*?transition:\s*none !important;/);
    const modelPickerStyle = [...style.matchAll(/\.nmx-model-picker-popover\s*\{[\s\S]*?\n\}/g)]
        .map(match => match[0]).find(block => block.includes('position: fixed')) ?? '';
    assert.match(modelPickerStyle, /position:\s*fixed;[\s\S]*?inset:\s*auto;[\s\S]*?overflow:\s*hidden;/);
    assert.doesNotMatch(modelPickerStyle, /position-anchor|anchor\(top\)|anchor\(right\)/);
    assert.match(source, /protected renderRelayPickerPortal\(\): React\.ReactNode[\s\S]*?const rows = Math\.max\(2, this\.relayPickerOptions\(\)\.length\);[\s\S]*?const chromeHeight = this\.relaySourceTab === 'merchant' \? 132 : 91;[\s\S]*?this\.calculateModelPickerPlacement\(Math\.max\(300, chromeHeight \+ rows \* 32 \+ footerHeight\), 264\);[\s\S]*?height: `\$\{placement\.height\}px`,[\s\S]*?maxHeight: `\$\{placement\.maxHeight\}px`/,
        'the source drawer matches the original narrow model picker width and bounded minimum height');
    assert.match(source, /const modelPickerDesiredHeight = modelPickerChromeHeight \+ Math\.max\(48, pickerRows\.length \* 32\);/,
        'model rows and catalog status determine model drawer height without an obsolete footer');
    assert.doesNotMatch(source, /modelPickerSwitchFooter|modelPickerSwitchMaxHeight|modelPickerListReserve/);
    assert.match(source, /const modelPickerPlacement = this\.calculateModelPickerPlacement\(modelPickerDesiredHeight\);/);
    assert.match(source, /top: `\$\{modelPickerPlacement\.top\}px`,[\s\S]*?left: `\$\{modelPickerPlacement\.left\}px`/);
    assert.match(style, /\.nmx-model-picker-popover \{[\s\S]*?max-height:\s*var\(--nmx-model-picker-max-height, 440px\);/);
    assert.match(style, /\.nmx-model-picker-popover \{[\s\S]*?width:\s*min\(264px, calc\(100vw - 42px\)\);/);
    assert.match(source, /scheduleModelEffortPickerClose/);
    assert.match(source, /modelPickerEffortCloseTimer/);
    // The depth caption and row, the window tiers' caption and grid, the window fact, and the measured-limit note.
    assert.match(source, /const settingsRowCount = \(depth\.options\.length \? 2 : 0\) \+ \(contextChoices\.length > 1 \? 1 \+ Math\.ceil\(contextChoices\.length \/ 5\) : 0\)\s*\+ \(contextMaximum === undefined \? 0 : 1\) \+ \(contextCapped \? 2 : 0\);/,
        'placement counts the thinking-depth row and the route context fact');
    assert.match(source, /protected fitModelEffortMenu\(menu: HTMLElement\): void \{[\s\S]*?menu\.scrollHeight[\s\S]*?this\.modelPickerEffortPlacement = \{ \.\.\.placement, \.\.\.detail, top, maxHeight \};/,
        'a rendered card is measured and moved up so a row near the bottom never gets a clipped card');
    assert.match(source, /onPointerEnter=\{event => this\.openModelEffortPicker\(model\.id, event\.currentTarget, settingsRowCount\)\}/,
        'hovering each model opens its own evidence panel, including models with no reasoning levels');
    assert.match(source, /protected openModelEffortPicker\(modelId: string,[\s\S]*?this\.cancelModelEffortPickerClose\(\);[\s\S]*?this\.modelPickerEffortModelId = modelId;[\s\S]*?this\.modelPickerEffortLevelCount = levelCount;/,
        'the evidence panel must replace the previous model and its reasoning levels');
    assert.match(source, /onPointerLeave=\{\(\) => this\.scheduleModelEffortPickerClose\(\)\}/,
        'leaving a model must defer dismissal long enough to enter its portal');
    assert.match(source, /<Virtuoso[\s\S]*?className='nmx-model-picker-list'[\s\S]*?onMouseDown=\{event => \{ if \(event\.target === event\.currentTarget\) this\.closeNavigationSurface\(\); \}\}/);
  assert.match(source, /protected calculateModelPickerPlacement\(panelHeight: number, panelWidth = 264, triggerSelector\?: string, surfaceSelector\?: string\): AnchoredFloatingPanelPlacement/);
    assert.match(source, /placeAnchoredFloatingPanel\(anchor, viewport, panelWidth, panelHeight,[\s\S]*?safeTop:/);
    assert.match(source, /import \* as ReactDOM from '@theia\/core\/shared\/react-dom';/);
    assert.match(source, /ReactDOM\.createPortal\([\s\S]*?nmx-model-effort-portal nmx-theme-\$\{this\.resolvedDesktopTheme\(\)\}[\s\S]*?document\.body/);
    assert.match(source, /closest\('\.nmx-model-picker-popover, \.nmx-model-effort-menu, \.nmx-composer-relay-button, \.nmx-route-button'\)/);
    assert.match(source, /dismissPopover[\s\S]*?closest\('[^']*\.nmx-model-effort-menu[^']*'\)/);
    assert.match(source, /className=\{`nmx-model-effort-menu nmx-model-evidence-menu is-\$\{placement\.side\}`\}[\s\S]*?style=\{\{ top: `\$\{placement\.top\}px`, left: `\$\{placement\.left\}px`, width: placement\.width === undefined \? undefined : `\$\{placement\.width\}px`, maxHeight: `\$\{placement\.maxHeight\}px` \}\}/);
    assert.doesNotMatch(style, /position-anchor:\s*--nmx-model-effort-anchor/);
    const effortStyle = style.match(/\.nmx-model-effort-menu \{[\s\S]*?\n\}/)?.[0] ?? '';
    assert.doesNotMatch(effortStyle, /anchor\(top\)/);
    assert.match(style, /\.nmx-model-effort-menu \{[\s\S]*?overflow:\s*hidden;[\s\S]*?scrollbar-width:\s*none;/);
    assert.match(style, /\.nmx-model-effort-menu::\-webkit-scrollbar \{[\s\S]*?display:\s*none;/);
    assert.match(style, /\.nmx-model-effort-menu > button \{[\s\S]*?max-width:\s*100%;[\s\S]*?box-sizing:\s*border-box;/);
    assert.match(style, /\.nmx-model-effort-portal \{[\s\S]*?display:\s*contents;/);
    assert.match(style, /\.nmx-model-picker-popover > \.nmx-model-picker-list \{[\s\S]*?min-height:\s*0;[\s\S]*?max-height:\s*none;[\s\S]*?flex:\s*1 1 auto;[\s\S]*?overflow:\s*auto;/);
    assert.match(style, /\.nmx-model-picker-popover > footer \{[\s\S]*?flex:\s*0 0 auto;/);
    assert.match(source, /aria-label=\{optionTitle\}><span><strong>\{model\.label\}<\/strong>/,
        'model names retain full accessible details while the custom evidence panel replaces the native title tooltip');
    assert.match(style, /\.nmx-model-option > button \{[\s\S]*?min-width:\s*0;[\s\S]*?max-width:\s*100%;[\s\S]*?overflow:\s*hidden;[\s\S]*?box-sizing:\s*border-box;/);
    assert.match(style, /\.nmx-model-option > button \{[\s\S]*?height:\s*32px;[\s\S]*?min-height:\s*32px;[\s\S]*?max-height:\s*32px;/);
    assert.match(style, /\.nmx-model-option > button > span \{[\s\S]*?max-width:\s*100%;[\s\S]*?display:\s*grid;[\s\S]*?overflow:\s*hidden;[\s\S]*?white-space:\s*nowrap;/);
    assert.match(style, /\.nmx-model-option > button strong \{[\s\S]*?max-width:\s*100%;[\s\S]*?overflow:\s*hidden;[\s\S]*?text-overflow:\s*ellipsis;[\s\S]*?white-space:\s*nowrap;/);
    assert.match(style, /\.nmx-model-effort-menu \{[\s\S]*?z-index:\s*530;[\s\S]*?box-sizing:\s*border-box;/);
});

test('locale changes affect interface chrome but preserve conversation and browser content', () => {
    assert.match(source, /dispatchEvent\(new CustomEvent\('nextmux:desktop-locale-changed', \{ detail: this\.desktopLocale \}\)\)/);
    assert.match(contribution, /addEventListener\('nextmux:desktop-locale-changed', this\.handleProductMenuLocaleChange\)/);
    assert.match(contribution, /handleProductMenuLocaleChange[\s\S]*?configureProductMenus\(locale, true\)/);
    assert.match(source, /className='nmx-literal-content' data-nmx-literal/);
    assert.match(source, /className='nmx-gateway-content' data-nmx-literal/);
    assert.match(streamView, /<section data-nmx-literal className=\{`nmx-agent-activity nmx-stream/);
    assert.match(streamView, /className=\{`nmx-stream-target[^`]*`\} data-nmx-literal onClick=\{openFileTarget\}>\{labelText\('target'\)\}<\/span>/);
    // The queued prompt (with its pasted-text chips) stays literal content.
    assert.match(source, /parsedPrompt\.text\.trim\(\) \? <strong data-nmx-literal>\{promptSegments\.map\(/);
    assert.match(source, /const browserTitle = browser\.url \? browser\.title : workbenchText\(this\.desktopLocale, 'newTab'\)/);
    assert.match(source, /<span data-nmx-literal=\{browser\.url \? true : undefined\}>\{browserTitle\}<\/span>/);
});

test('terminal chrome is explicitly localized while runtime titles remain literal', () => {
    const methodSource = name => {
        let found = '';
        const visit = node => {
            if (ts.isMethodDeclaration(node) && node.name.getText(file) === name) found = node.getText(file);
            ts.forEachChild(node, visit);
        };
        visit(file);
        assert.ok(found, `missing ${name}`);
        return found;
    };
    for (const key of ['terminalPanel', 'resizeHeight', 'terminalScope', 'currentConversation', 'allConversations', 'allTerminals', 'newTerminal', 'collapseTerminal', 'resizeList', 'terminalList', 'terminalName', 'doubleClickRename', 'closeAndTerminate', 'emptyCurrent', 'emptyAll', 'emptyBody', 'deletedConversation']) {
        assert.match(terminalLocale, new RegExp(`${key}:`));
    }
    for (const locale of ['zh-CN', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi']) {
        assert.match(terminalLocale, new RegExp(`(?:'${locale}'|\\b${locale}):\\s*\\{`));
    }
    const drawer = methodSource('renderTerminalDrawer');
    assert.match(drawer, /<section data-nmx-literal id='nmx-terminal-panel'/);
    assert.match(drawer, /<button data-nmx-literal className='nmx-terminal-select'/);
    assert.match(drawer, /this\.terminalScope === 'all' && <small data-nmx-literal>\{sessionTitle\(record\)\}<\/small>/,
        'conversation names are useful in the all-conversations scope but must not repeat in the current scope');
    assert.match(drawer, /terminalSurfaceText\(this\.desktopLocale, 'doubleClickRename'\)/);
    assert.match(methodSource('renderTerminalSurface'), /record\?\.widget && !record\.widget\.isDisposed && !record\.widget\.exitStatus/);
    assert.doesNotMatch(drawer, /双击重命名|调整终端列表宽度|收起终端|新建终端/);
    assert.match(style, /\.nmx-terminal-list > header \{[\s\S]*?min-width:\s*0;[\s\S]*?white-space:\s*nowrap;[\s\S]*?overflow:\s*hidden;/);
});

test('settings tabs use rounded padded surfaces and inset rows', () => {
    assert.match(source, /data-settings-panel=\{panel\}/);
    assert.match(style, /\.nmx-settings-page > \.nmx-settings-panel \{[\s\S]*?padding:\s*16px;[\s\S]*?border-radius:\s*14px;/);
    assert.match(style, /\.nmx-settings-panel \.nmx-setting-row \{[\s\S]*?padding:\s*11px 14px;[\s\S]*?border-radius:\s*10px;/);
    assert.match(style, /\.nmx-theme-light \.nmx-settings-page > \.nmx-settings-panel \{[\s\S]*?background:\s*#f8f7f5 !important;/);
});

test('assistant replies render without a leading avatar column', () => {
    assert.doesNotMatch(source, /<span className='nmx-agent-mark'>/);
    assert.match(style, /\.nmx-agent-message \{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);[\s\S]*?gap:\s*0;/);
    assert.match(style, /\.nmx-agent-message,[\s\S]*?\.nmx-theme-light \.nmx-agent-message \{[\s\S]*?border:\s*0 !important;[\s\S]*?background:\s*transparent !important;[\s\S]*?box-shadow:\s*none !important;/);
    assert.match(style, /\.nmx-agent-message > div,[\s\S]*?background:\s*transparent !important;/);
    const lightCardRule = style.match(/\.nmx-theme-light :is\(([^)]*)\) \{\s*color:\s*#393336;\s*background-color:\s*#f4f2f3 !important;/);
    assert.ok(lightCardRule, 'light-theme card surface rule is missing');
    assert.doesNotMatch(lightCardRule[1], /\.nmx-agent-message/, 'assistant replies must not be included in the light-theme card surface rule');
    assert.match(style, /\.nmx-theme-light \.nmx-workspace-controls button,[\s\S]*?color:\s*#5b5559 !important;/);
    assert.match(style, /\.nmx-theme-light \.nmx-workspace-controls button\.is-active,[\s\S]*?background:\s*#ddd9d6 !important;/);
});

test('product menus replace stale Theia entries and open NextMux surfaces', () => {
    assert.match(contribution, /import \{ MAIN_MENU_BAR,[^}]*MenuModelRegistry, MutableCompoundMenuNode \} from '@theia\/core\/lib\/common\/menu';/);
    assert.match(contribution, /configureProductMenus\(locale = readDesktopLocale\(\), force = false\): void[\s\S]*?if \(this\.productMenusConfigured && !force\) return[\s\S]*?getMenu\(MAIN_MENU_BAR\)[\s\S]*?for \(const child of \[\.\.\.menuBar\.children\]\) menuBar\.removeNode\(child\)[\s\S]*?registerProductMenuActions\(this\.menuRegistry, locale\)[\s\S]*?registerProductMenuLabels\(this\.menuRegistry, locale\)/);
    assert.match(contribution, /queueMicrotask\(\(\) => this\.configureProductMenus\(\)\)/);
    assert.match(contribution, /registerCommand\(\{ \.\.\.NextMuxCommands\.settings, label: productMenuText\(locale, 'preferences'\) \}/);
    assert.match(contribution, /registerProductMenuLabels\(menus: MenuModelRegistry, locale: NextMuxDesktopLocale\): void[\s\S]*?CommonMenus\.FILE, 'file'[\s\S]*?CommonMenus\.HELP, 'help'[\s\S]*?registerSubmenu\(\[\.\.\.path\], productMenuText\(locale, key\)\)/);
    assert.match(contribution, /registerProductMenuActions\(menus: MenuModelRegistry, locale: NextMuxDesktopLocale\): void[\s\S]*?commandId: NextMuxCommands\.newConversation\.id, label: desktopText\(locale, 'newTask'\)[\s\S]*?commandId: NextMuxCommands\.website\.id, label: productMenuText\(locale, 'website'\)/);
    assert.doesNotMatch(contribution, /nls\.localizeByDefault/);
    assert.match(productMenuLocale, /const translations:[\s\S]*?=\s*\{\s*en,/);
    for (const locale of ['zh-CN', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi']) {
        assert.match(productMenuLocale, new RegExp(`(?:'${locale}'|\\b${locale}):\\s*\\{`));
    }
    assert.match(contribution, /NextMuxCommands\.settings[\s\S]*?widget\.commandOpenSettings\(\)/);
    assert.match(contribution, /CommonMenus\.VIEW_PRIMARY[\s\S]*?NextMuxCommands\.modelCenter[\s\S]*?NextMuxCommands\.coding[\s\S]*?NextMuxCommands\.comic/);
    assert.match(style, /body:has\(#nextmux\\\.desktop\\\.widget:not\(\.lm-mod-hidden\) \.nmx-theme-light\) \.lm-Menu \{[\s\S]*?background:\s*#f8f6f3 !important;/);
    assert.match(style, /body:has\(#nextmux\\\.desktop\\\.widget:not\(\.lm-mod-hidden\) \.nmx-theme-light\) \.lm-Menu-content \{[\s\S]*?max-height:\s*min\(420px, calc\(100dvh - 56px\)\);/);
    assert.match(style, /@media \(max-width: 900px\) \{[\s\S]*?#theia\\:menubar \{[\s\S]*?max-width:\s*calc\(50vw - 146px\);/);
    assert.doesNotMatch(style, /#theia\\:menubar \.lm-MenuBar-item:nth-child\(3\)/);
    assert.match(style, /#theia-app-shell:has\(#nextmux\\\.desktop\\\.widget:not\(\.lm-mod-hidden\)\) #theia\\:menubar \{[\s\S]*?-webkit-app-region:\s*no-drag !important;/);
    assert.match(style, /#theia-app-shell:has\(#nextmux\\\.desktop\\\.widget:not\(\.lm-mod-hidden\)\) #theia-top-panel,[\s\S]*?#theia\\:menubar \{\s*direction:\s*ltr !important;/);
    assert.match(style, /#theia\\:menubar \.lm-MenuBar-itemLabel \{\s*unicode-bidi:\s*plaintext;/);
});

test('light composer, conversation actions, and relay popover use readable native surfaces', () => {
    assert.match(style, /\.nmx-theme-light :is\(\.nmx-composer-project-chip, \.nmx-composer-project-select\) \{[\s\S]*?color:\s*#4f494d !important;[\s\S]*?background:\s*#efedeb !important;/);
    assert.match(style, /\.nmx-theme-light \.nmx-coding-context \.nmx-context-nav button\.nmx-session-more \{[\s\S]*?color:\s*#686166 !important;[\s\S]*?background:\s*transparent !important;/);
    assert.match(style, /\.nmx-theme-light \.nmx-relay-popover > header strong,[\s\S]*?color:\s*#302b2e !important;/);
    assert.match(style, /\.nmx-media-runtime-card \{[\s\S]*?border-radius:\s*12px;[\s\S]*?background:\s*var\(--nmx-panel-2\);/);
});

test('model names are presented without provider prefixes', () => {
    assert.match(source, /import \{ modelDisplayNameOnly \} from '\.\/nextmux-model-display-name';/);
    assert.match(source, /protected modelOnlyDisplayName\(displayName: string, providerName = '', canonicalModel = '', fallback = ''\): string/);
    assert.match(source, /return modelDisplayNameOnly\(displayName, providerName, canonicalModel, this\.modelDisplayName\(canonicalModel, fallback\)\);/);
    assert.match(source, /label:\s*this\.modelOnlyDisplayName\(offering\.displayName, offering\.providerName, offering\.canonicalModel/);
    assert.doesNotMatch(source, /<option key=\{model\.id\} value=\{model\.id\}>\{model\.label\}\s*·\s*\{model\.providerName\}<\/option>/);
});

test('project files use the conversation rail and open previews in the browser drawer', () => {
    assert.match(source, /className='nmx-thread-files'/);
    assert.match(source, /protected renderThreadFileNavigator\(\): React\.ReactNode \{[\s\S]*?const session = this\.activeCodingSession\(\);[\s\S]*?if \(!session\) return undefined;[\s\S]*?const workspaceRoot = session\.workspacePath \? this\.codingSessionWorkspaceRoot\(session\) \|\| session\.workspacePath : '';[\s\S]*?if \(!workspaceRoot\) return notes;/,
        'a conversation without a project never borrows the global workspace: it shows only the notes icon');
    // Files, notes and the project's AGENTS.md are three separate floats, each only an icon tab until hovered or focused.
    assert.match(source, /const notes = <aside className=\{`nmx-thread-notes-float \$\{workspaceRoot \? '' : 'is-alone'\}`\}/);
    assert.match(source, /return <><aside className='nmx-thread-files'[\s\S]*?className='nmx-thread-float-tab' tabIndex=\{0\}[\s\S]*?<\/aside>\{notes\}<aside className='nmx-thread-agents-float'[\s\S]*?className='nmx-thread-float-tab' tabIndex=\{0\}[\s\S]*?<\/aside><\/>;/);
    assert.doesNotMatch(source, /nmx-thread-notes-marker|is-notes-only/);
    assert.doesNotMatch(source, /contextFilePrefix\(node\.name\)/);
    assert.doesNotMatch(source, /compactContextFileName\(node\.name, 10\)/);
    assert.match(source, /this\.workContextMode = 'file'/);
    assert.match(source, /className='nmx-context-file-preview'/);
    assert.doesNotMatch(source, /className='nmx-work-context-tabs'/);
    assert.doesNotMatch(source, /className='nmx-context-files'/);
    assert.match(style, /\.nmx-thread-files \{[\s\S]*?right:\s*10px/);
    assert.match(style, /\.nmx-thread-files:hover > div,[\s\S]*?width:\s*184px/);
    assert.doesNotMatch(style, /\.nmx-thread-file-compact/);
    assert.match(style, /\.nmx-thread-files:not\(:hover\):not\(:focus-within\) \.nmx-thread-file-row > i:first-of-type \{[\s\S]*?display:\s*grid !important/);
    const floats = readFileSync(fileURLToPath(new URL('../src/browser/style/nextmux-composer-attachments.css', import.meta.url)), 'utf8');
    // The three right-edge floats are centred vertically: the file card centres on its icon, never taller than the stage.
    assert.match(floats, /\.nmx-coding-stage > \.nmx-thread-files:is\(:hover, :focus-within\) > div \{[^}]*top:\s*50%;\s*translate:\s*0 -50%;[^}]*width:\s*224px;[^}]*max-height:\s*100%;/);
    assert.match(floats, /\.nmx-coding-stage > \.nmx-thread-files:not\(:hover\):not\(:focus-within\) > div \{ display: none; \}/, 'collapsed, the file float is only its icon');
    assert.match(floats, /\.nmx-thread-notes-float:is\(:hover, :focus-within\) > \.nmx-thread-notes \{ display: flex;/, 'the notes open from their own icon');
    assert.match(style, /\.nmx-work-context \{[\s\S]*?position:\s*absolute/);
    assert.match(style, /\.nmx-shell\.is-work-context-open \{[\s\S]*?grid-template-columns:\s*var\(--nmx-context-panel-width, 276px\) minmax\(0, 1fr\)/);
    assert.match(source, /contextFileVisible\(child\.name, child\.isDirectory\)/);
    assert.match(source, /\['png', 'jpg', 'jpeg', 'webp', 'gif'\]\.includes\(extension\)/);
    assert.match(source, /kind:\s*'image',[\s\S]*?imageDataUrl:/);
    assert.match(source, /className='nmx-context-image-canvas'[\s\S]*?attachmentLightbox/);
    assert.match(source, /protected async attachContextImage\(\): Promise<void>/);
    assert.match(style, /\.nmx-context-image-canvas \{[\s\S]*?cursor:\s*zoom-in;/);
    assert.match(source, /protected contextFilesRefreshPending = false;/);
    assert.match(source, /if \(this\.contextFilesLoading\) \{[\s\S]{0,240}?if \(force \|\| this\.contextFilesWorkspace !== workspaceRoot\) this\.contextFilesRefreshPending = true;\s*return;/,
        'a forced refresh or another directory arriving during an active read schedules a follow-up; a plain call for the same directory joins it');
    assert.match(source, /const incompleteForCurrent = [\s\S]*?this\.contextFilesWorkspace !== currentRoot \|\| !this\.contextFileChildren\.has\(currentRoot\)/,
        'an incomplete or newly selected directory also schedules a current-owner read');
    assert.match(source, /const refreshAgain = this\.contextFilesRefreshPending \|\| incompleteForCurrent;[\s\S]*?this\.contextFilesRefreshPending = false;[\s\S]*?if \(refreshAgain\) void this\.loadContextFiles\(true\);/);
});

test('pasted image attachments are previewable before and after sending', () => {
    assert.match(source, /platformService\.cacheDesktopAttachment\(\{/);
    assert.match(platformService, /async cacheDesktopAttachment\(request: DesktopAttachmentCacheRequest\)/);
    assert.match(platformService, /join\(this\.nextmuxDataRoot\(\), 'conversation-attachments'\)/);
    assert.match(platformService, /createHash\('sha256'\)\.update\(bytes\)\.digest\('hex'\)/);
    assert.match(source, /protected previewAttachmentImage\(record: DesktopAttachmentRecord\): void/);
    assert.match(source, /<AttachmentChip[\s\S]*?onPreview=\{item\.attachment\.kind === 'image' \? \(\) => this\.previewAttachmentImage\(item\) : undefined\}/);
    assert.match(attachmentsModule, /className='nmx-attachment-preview'[\s\S]*?onClick=\{props\.onPreview\}/);
    assert.match(source, /const ownerId = codingSession\?\.id \|\| this\.activeCodingSessionId;[\s\S]*?className=\{`nmx-turn-image[\s\S]*?onClick=\{\(\) => void this\.previewTurnImage\(ownerId, item\)\}/);
    assert.match(attachmentStyle, /\.nmx-attachment-preview \{[\s\S]*?cursor:\s*zoom-in;/);
    assert.match(attachmentStyle, /\.nmx-attachment-chip > \.nmx-attachment-remove \{[\s\S]*?position:\s*absolute;/);
});

test('attachment previews stay inside the application viewport', () => {
    assert.match(style, /\.nmx-attachment-lightbox\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?inset:\s*0;/);
    assert.match(style, /\.nmx-attachment-lightbox > section\s*\{[\s\S]*?width:\s*min\(980px, calc\(100vw - 56px\)\);[\s\S]*?max-width:\s*100%;/);
});

test('light theme keeps warm surfaces and readable neutral text', () => {
    assert.match(style, /\.nmx-shell\.nmx-theme-light \{[\s\S]*?--nmx-bg:\s*#f1efed;[\s\S]*?--nmx-panel:\s*#f8f7f5;[\s\S]*?--nmx-text:\s*#252225;/);
    assert.match(style, /\.nmx-shell\.nmx-theme-light \{[\s\S]*?--nmx-border:\s*#e4e0dd;[\s\S]*?--nmx-border-strong:\s*#d5cfcb;/);
    assert.match(style, /\.nmx-theme-light \* \{\s*border-color:\s*#e4e0dd !important;/);
    assert.match(style, /\.nmx-theme-light :is\(\.nmx-workspace,[\s\S]*?background:\s*#f1efed !important;/);
    assert.match(style, /\.nmx-theme-light :is\(\.nmx-session-open,[\s\S]*?color:\s*#302c2f !important;/);
    assert.match(style, /\.nmx-theme-light :is\(\.nmx-composer,[\s\S]*?background:\s*#f8f7f5 !important;/);
    assert.match(style, /\.nmx-theme-light \.nmx-session-open > span,[\s\S]*?color:\s*#302c2f !important;/);
    assert.match(style, /\.nmx-theme-light \.nmx-empty-task h2,[\s\S]*?color:\s*#302c2f !important;/);
    assert.match(style, /\.nmx-theme-light \.nmx-route-button > span,[\s\S]*?color:\s*#302c2f !important;/);
    assert.match(style, /\.theia-ApplicationShell:has\(\.nmx-theme-light\) \{[\s\S]*?--theia-titleBar-activeBackground:\s*#e9e6e3 !important;/);
    assert.match(style, /\.nmx-theme-light :is\(\.nmx-context-status, \.nmx-runtime-state, \.nmx-routing-control,[\s\S]*?background:\s*#f8f7f5 !important;/);
    assert.match(style, /\.nmx-theme-light \.nmx-context-nav button \{[\s\S]*?color:\s*#302c2f !important;/);
    assert.match(style, /\.nmx-theme-light \.nmx-coding-secondary-page h2,[\s\S]*?color:\s*#302c2f !important;/);
    assert.match(style, /#theia-app-shell:has\(#nextmux\\\.desktop\\\.widget:not\(\.lm-mod-hidden\)\):has\(\.nmx-theme-light\) #theia-top-panel \{[\s\S]*?background:\s*#e9e6e3 !important;/);
    assert.match(style, /\.nmx-theme-light \.nmx-thread-files > div,[\s\S]*?background:\s*rgba\(248, 247, 245, \.97\) !important;/);
    assert.match(style, /\.nmx-theme-light \.nmx-terminal-surface,[\s\S]*?background-color:\s*#f7f5f2 !important;/);
    assert.match(style, /\.nmx-theme-light \.nmx-terminal-drawer > header nav button\.is-active \{[\s\S]*?color:\s*#2e2a2d !important;[\s\S]*?background:\s*#ddd8d4 !important;/);
    assert.match(style, /\.nmx-theme-light \.nmx-browser-tabs > div:hover,[\s\S]*?\.nmx-theme-light \.nmx-browser-tabs > div\.is-active \{[\s\S]*?background:\s*#ddd9d5 !important;/);
    assert.match(style, /\.nmx-theme-light \.nmx-browser-tabs > div > button:first-child span \{[\s\S]*?color:\s*#302c2f !important;/);
    assert.match(style, /\.nmx-theme-light \.nmx-browser-view > form input,[\s\S]*?\.nmx-theme-light \.nmx-browser-view > form input:focus \{[\s\S]*?background:\s*#faf9f7 !important;[\s\S]*?box-shadow:\s*none !important;/);
    assert.match(style, /\.nmx-theme-light \.nmx-work-context :is\(button, button > i\)[\s\S]*?color:\s*#484246 !important;/);
    assert.match(style, /\.nmx-theme-light \.nmx-composer:focus-within \{[\s\S]*?border-color:\s*#e4e0dd !important;/);
    assert.match(style, /\.nmx-theme-light :is\([\s\S]*?\.nmx-model-settings-intro span,[\s\S]*?\.nmx-local-data-list > article > em,[\s\S]*?color:\s*#5c565a !important;/);
    assert.match(style, /\.nmx-theme-light \.nmx-session-row\.is-current \.nmx-session-open > span \{[\s\S]*?color:\s*#302c2f !important;/);
    assert.match(style, /\.nmx-theme-light \.nmx-agent-mark \{[\s\S]*?color:\s*#7c3152 !important;/);
    assert.match(streamStyle, /\.nmx-theme-light \.nmx-stream \{[\s\S]*?--nmx-stream-add:\s*#1a7f37;/);
    assert.match(style, /\.nmx-theme-light :is\([\s\S]*?\.nmx-model-toggle-list,[\s\S]*?\.nmx-secondary-page-grid > button,[\s\S]*?background:\s*#f8f7f5 !important;/);
    assert.match(style, /\.nmx-shell:not\(\.nmx-theme-light\) \{[\s\S]*?--nmx-muted:\s*#a19b9e;/);
    assert.match(style, /\.nmx-shell:not\(\.nmx-theme-light\) :is\([\s\S]*?\.nmx-settings-page,[\s\S]*?\.nmx-model-center,[\s\S]*?color:\s*#a19b9e !important;/);
});

test('account dock shows exactly one bounded identity and keeps settings visible', () => {
    const methodSource = name => {
        let found = '';
        const visit = node => {
            if (ts.isMethodDeclaration(node) && node.name.getText(file) === name) found = node.getText(file);
            ts.forEachChild(node, visit);
        };
        visit(file);
        assert.ok(found, `missing ${name}`);
        return found;
    };
    const dock = methodSource('renderContextAccountDock');
    assert.match(dock, /this\.platformSession\.linked[\s\S]*?localizeDesktopSurface\(this\.desktopLocale, '未登录'\)/);
    // The balance is shown in the account sheet only, not under the name (requirement 33).
    assert.match(dock, /<span className='nmx-account-trigger-copy'><strong>\{identity\}<\/strong><\/span>/);
    // The avatar opens the account sheet; the gear beside it opens settings directly.
    assert.match(dock, /className=\{`nmx-account-trigger [^`]*`\}[\s\S]*?onClick=\{\(\) => this\.toggleAccountMenu\(\)\}/);
    assert.match(dock, /onClick=\{\(\) => this\.toggleSettingsPanel\('profile'\)\}/);
    assert.doesNotMatch(dock, /onClick=\{\(\) => \{[\s\S]*?startDeviceLink\(\)/);
    assert.doesNotMatch(dock, /nmx-account-login|账户已连接/);
    assert.match(style, /\.nmx-context-account-dock \{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);/);
    assert.match(style, /\.nmx-account-trigger-copy strong \{[\s\S]*?overflow:\s*hidden;[\s\S]*?text-overflow:\s*ellipsis;[\s\S]*?white-space:\s*nowrap;/);
});
