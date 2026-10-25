import assert from 'node:assert/strict';
import test from 'node:test';
import { compactedConversationHistory } from '../lib/browser/nextmux-conversation-branch.js';

function totalCharacters(messages) {
    return messages.reduce((sum, message) => sum + message.content.length, 0);
}

test('compactedConversationHistory keeps backward-compatible output for small conversations and numeric recentTurns', () => {
    const turns = Array.from({ length: 14 }, (_, index) => ({
        id: `turn-${index + 1}`,
        prompt: `User question ${index + 1}`,
        response: `Assistant answer ${index + 1}`,
        stage: 'complete'
    }));

    const defaultHistory = compactedConversationHistory(turns);
    const emptyOptionsHistory = compactedConversationHistory(turns, {});
    assert.deepEqual(emptyOptionsHistory, defaultHistory);
    assert.equal(defaultHistory.length, 21);
    assert.equal(
        defaultHistory[0].content,
        [
            'Earlier conversation memory, in chronological order. Treat this as context, not as a new user request.',
            '#1 user: User question 1 | assistant: Assistant answer 1',
            '#2 user: User question 2 | assistant: Assistant answer 2',
            '#3 user: User question 3 | assistant: Assistant answer 3',
            '#4 user: User question 4 | assistant: Assistant answer 4'
        ].join('\n')
    );

    const numericRecent = compactedConversationHistory(turns, 6);
    const objectRecent = compactedConversationHistory(turns, { recentTurns: 6 });
    assert.deepEqual(objectRecent, numericRecent);
    assert.equal(numericRecent.length, 13);
    assert.match(numericRecent[0].content, /#8 user: User question 8 \| assistant: Assistant answer 8/);
    assert.equal(numericRecent[1].content, 'User question 9');
});

test('long conversations stay within model contextWindowTokens and transport maxContextCharacters budgets while preserving the latest turn verbatim', () => {
    const turns = Array.from({ length: 40 }, (_, index) => ({
        id: `turn-${index + 1}`,
        prompt: `PROMPT_HEAD_${index + 1} ${'p'.repeat(5_960)} PROMPT_TAIL_${index + 1}`,
        response: `RESPONSE_HEAD_${index + 1} ${'r'.repeat(5_960)} RESPONSE_TAIL_${index + 1}`,
        stage: 'complete'
    }));
    const latestTurn = turns.at(-1);

    const cases = [
        { options: { contextWindowTokens: 128_000 }, expectedBudget: Math.floor(128_000 * 0.45 * 2.5) },
        { options: { contextWindowTokens: 32_000 }, expectedBudget: Math.floor(32_000 * 0.45 * 2.5) },
        { options: { maxContextCharacters: 120_000 }, expectedBudget: Math.floor(120_000 * 0.85) },
        { options: { contextWindowTokens: 128_000, maxContextCharacters: 120_000 }, expectedBudget: Math.floor(120_000 * 0.85) },
        { options: { contextWindowTokens: 2_000 }, expectedBudget: 8_000 }
    ];

    for (const { options, expectedBudget } of cases) {
        const history = compactedConversationHistory(turns, options);
        const chars = totalCharacters(history);
        assert.ok(
            chars <= expectedBudget,
            `Expected ${chars} <= ${expectedBudget} for ${JSON.stringify(options)}`
        );
        assert.ok(history.length <= 24);
        if (latestTurn.prompt.length + latestTurn.response.length <= Math.floor((expectedBudget * 100_000) / 150_000)) {
            assert.equal(history.at(-2).content, latestTurn.prompt);
            assert.equal(history.at(-1).content, latestTurn.response);
        }
    }
});

test('priority anchoring gives turn #1 more budget than middle turns and head+tail excerpts preserve trailing file paths and surrogate pairs', () => {
    const turns = Array.from({ length: 35 }, (_, index) => ({
        id: `turn-${index + 1}`,
        prompt: `GOAL_${index + 1}_START ${'a'.repeat(5_000)} GOAL_${index + 1}_CONSTRAINT_END`,
        response: `ANALYSIS_${index + 1}_START ${'b'.repeat(5_000)} Conclusion saved at packages/core/src/module-${index + 1}.ts`,
        stage: 'complete'
    }));

    const history = compactedConversationHistory(turns, { contextWindowTokens: 32_000 });
    const memoryLines = history[0].content.split('\n').slice(1);
    const turn1Line = memoryLines.find(line => line.startsWith('#1 user: '));
    const middleLine = memoryLines.find(line => line.startsWith('#15 user: '));

    assert.ok(turn1Line, 'Turn #1 line must exist in older memory');
    assert.ok(middleLine, 'Middle turn line must exist in older memory');
    assert.ok(
        turn1Line.length > middleLine.length * 1.8,
        `Expected Turn #1 (${turn1Line.length}) to retain significantly more text than middle turn (${middleLine.length})`
    );
    assert.match(turn1Line, /GOAL_1_START/);
    assert.match(turn1Line, /GOAL_1_CONSTRAINT_END/);
    assert.match(turn1Line, / packages\/core\/src\/module-1\.ts$/);
    assert.match(middleLine, /GOAL_15_START/);
    assert.match(middleLine, /GOAL_15_CONSTRAINT_END/);
    assert.match(middleLine, / packages\/core\/src\/module-15\.ts$/);
    assert.match(turn1Line, / … /);
    assert.match(middleLine, / … /);

    // Verify surrogate pairs are never split into lone surrogates.
    const emojiTurns = Array.from({ length: 25 }, (_, index) => ({
        id: `emoji-${index + 1}`,
        prompt: `Start-${index + 1} ${'🚀🧪'.repeat(2_000)} End-${index + 1}`,
        response: `Reply-${index + 1} ${'🎯📦'.repeat(2_000)} src/path-${index + 1}.ts`,
        stage: 'complete'
    }));
    const emojiHistory = compactedConversationHistory(emojiTurns, { contextWindowTokens: 32_000 });
    for (const message of emojiHistory) {
        const wellFormed = typeof message.content.isWellFormed === 'function'
            ? message.content.isWellFormed()
            : !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(message.content);
        assert.equal(wellFormed, true, 'Compacted history must never split UTF-16 surrogate pairs');
    }
});

test('CJK-heavy conversations respect the conservative token budget and preserve head and tail anchors', () => {
    const cjkTurns = Array.from({ length: 40 }, (_, index) => ({
        id: `cjk-${index + 1}`,
        prompt: `任务目标_${index + 1}：${'请保持跨模型上下文稳定性并严格遵守架构约束。'.repeat(300)} 关键约束_${index + 1}`,
        response: `处理结论_${index + 1}：${'已完成多模型切换时的历史记录预算收缩与首轮权重锚定验证。'.repeat(260)} 最终产物路径：packages/runtime/src/cjk-${index + 1}.ts`,
        stage: 'complete'
    }));

    for (const tokens of [128_000, 64_000, 32_000]) {
        const budget = Math.floor(tokens * 0.45 * 2.5);
        const history = compactedConversationHistory(cjkTurns, { contextWindowTokens: tokens });
        const chars = totalCharacters(history);
        assert.ok(chars <= budget, `CJK history (${chars}) exceeded budget (${budget}) for ${tokens} tokens`);
        assert.match(history[0].content, /#1 user: 任务目标_1：[\s\S]*?关键约束_1/);
        assert.match(history[0].content, /最终产物路径：packages\/runtime\/src\/cjk-1\.ts/);
        assert.equal(history.at(-1).content, cjkTurns.at(-1).response);
    }
});

test('no window size ever yields an empty or header-only memory message (the runtime rejects empty history)', () => {
    const turns = Array.from({ length: 30 }, (_, index) => ({
        id: `t${index}`, prompt: `Q${index} ${'p'.repeat(5_000)}`, response: `A${index} ${'r'.repeat(5_000)}`, stage: 'complete'
    }));
    for (const options of [{ contextWindowTokens: 1_024 }, { contextWindowTokens: 8_000 }, { maxContextCharacters: 9_000 }, { contextWindowTokens: 128_000 }, 3]) {
        const messages = compactedConversationHistory(turns, options);
        assert.ok(messages.length > 0);
        for (const message of messages) assert.ok(message.content.trim().length > 0, JSON.stringify(options));
        const memory = messages.find(message => message.content.startsWith('Earlier conversation memory'));
        if (memory) assert.match(memory.content, /#1 user: /, 'a memory message always carries at least its first line');
    }
});

test('a pinned turn that does not fit word for word goes into the memory, and no kept turn is summarized twice', () => {
    const filler = 'x'.repeat(900);
    const turns = Array.from({ length: 15 }, (_, index) => ({
        id: `turn-${index + 1}`,
        prompt: `MARK-Q${index + 1}-END ${filler}`,
        response: `MARK-A${index + 1}-END ${filler}`,
        stage: 'complete',
        ...(index === 0 ? { pinned: true } : {})
    }));
    const history = compactedConversationHistory(turns, { contextWindowTokens: 8_000 });
    const [memory, ...recent] = history;
    assert.match(memory.content, /^Earlier conversation memory/);
    const verbatim = recent.filter(message => message.role === 'user').map(message => /MARK-Q(\d+)-END/.exec(message.content)?.[1]);
    assert.ok(verbatim.length >= 1 && verbatim.length < 15, `only some turns fit word for word: ${verbatim.join(',')}`);
    assert.ok(!verbatim.includes('1'), 'the old pinned turn did not fit this small window');
    assert.match(memory.content, /#1 user: MARK-Q1-END/, 'the pinned turn is still in context, as memory');
    for (const kept of verbatim) assert.doesNotMatch(memory.content, new RegExp(`MARK-Q${kept}-END`), `turn ${kept} is not repeated in the memory`);
    const remembered = [...memory.content.matchAll(/user: MARK-Q(\d+)-END/g)].map(match => Number(match[1]));
    assert.deepEqual(remembered, Array.from({ length: 15 - verbatim.length }, (_, index) => index + 1), 'every other turn is remembered once, in order');
});

test('a pinned old turn stays word for word next to the recent turns when it fits', () => {
    const turns = Array.from({ length: 14 }, (_, index) => ({
        id: `turn-${index + 1}`, prompt: `Question ${index + 1}`, response: `Answer ${index + 1}`, stage: 'complete', ...(index === 1 ? { pinned: true } : {})
    }));
    const history = compactedConversationHistory(turns);
    assert.equal(history[0].content.split('\n').slice(1).join('\n'), ['#1 user: Question 1 | assistant: Answer 1', '#2 user: Question 3 | assistant: Answer 3', '#3 user: Question 4 | assistant: Answer 4'].join('\n'));
    assert.deepEqual(history.slice(1).filter(message => message.role === 'user').map(message => message.content), ['Question 2', ...Array.from({ length: 10 }, (_, index) => `Question ${index + 5}`)]);
});

test('epoch quantization (COMPACTION_EPOCH_STEP = 4) keeps Message [0] byte-identical across 4 consecutive turns for prefix-cache stability', () => {
    const allTurns = Array.from({ length: 18 }, (_, index) => ({
        id: `turn-${index + 1}`,
        prompt: `User question ${index + 1}`,
        response: `Assistant answer ${index + 1}`,
        stage: 'complete'
    }));
    // Turns 11..14 all quantize older count to 4 (turns 1..4), so Message [0] is 100% byte-identical across all 4 turns.
    const epoch1 = [11, 12, 13, 14].map(count => compactedConversationHistory(allTurns.slice(0, count), { recentTurns: 10, mergeConsecutiveUser: true }));
    for (let i = 1; i < epoch1.length; i++) {
        assert.equal(epoch1[i][0].content, epoch1[0][0].content, `Epoch 1 turn ${11 + i} must keep identical Message [0]`);
    }
    // Turns 15..18 all quantize older count to 8 (turns 1..8), so Message [0] is 100% byte-identical across all 4 turns.
    const epoch2 = [15, 16, 17, 18].map(count => compactedConversationHistory(allTurns.slice(0, count), { recentTurns: 10, mergeConsecutiveUser: true }));
    for (let i = 1; i < epoch2.length; i++) {
        assert.equal(epoch2[i][0].content, epoch2[0][0].content, `Epoch 2 turn ${15 + i} must keep identical Message [0]`);
    }
});

test('within an epoch each request extends the previous one, so the whole earlier request stays a cached prefix', () => {
    const allTurns = Array.from({ length: 18 }, (_, index) => ({ id: `turn-${index + 1}`, prompt: `Question ${index + 1}`, response: `Answer ${index + 1}`, stage: 'complete' }));
    const at = count => compactedConversationHistory(allTurns.slice(0, count), { recentTurns: 10, mergeConsecutiveUser: true });
    for (const count of [11, 12, 13, 15, 16, 17]) {
        const before = at(count), after = at(count + 1);
        assert.deepEqual(after.slice(0, before.length), before, `request ${count + 1} starts with request ${count}`);
    }
    // The verbatim tail never shrinks below recentTurns - 3, and the memory is the first message, merged with the first kept request.
    for (let count = 11; count <= 18; count++) {
        const history = at(count);
        const kept = history.filter(message => message.role === 'user').length;
        assert.ok(kept >= 7 && kept <= 10, `${count} turns keep ${kept} verbatim`);
        assert.match(history[0].content, /^Earlier conversation memory/);
        for (let index = 1; index < history.length; index++) assert.ok(!(history[index].role === 'user' && history[index - 1].role === 'user'), 'no two user messages in a row');
    }
});

test('an explicit compaction keeps exactly the turns it asked for; only a long tail is rounded to an epoch', () => {
    const turns = count => Array.from({ length: count }, (_, index) => ({ id: `turn-${index + 1}`, prompt: `Question ${index + 1}`, response: `Answer ${index + 1}`, stage: 'complete' }));
    for (const count of [5, 7, 8, 11]) {
        const history = compactedConversationHistory(turns(count), { recentTurns: 2, mergeConsecutiveUser: false });
        assert.deepEqual(history.slice(1).filter(message => message.role === 'user').map(message => message.content), [`Question ${count - 1}`, `Question ${count}`]);
        assert.match(history[0].content, new RegExp(`#${count - 2} user: Question ${count - 2} \\| assistant: Answer ${count - 2}$`));
    }
});

test('compactedAtTurnCount keeps previously compacted turns summarized as new turns are appended and tail-preserves summary budget', () => {
    const turns = count => Array.from({ length: count }, (_, index) => ({ id: `turn-${index + 1}`, prompt: `Question ${index + 1}`, response: `Answer ${index + 1}`, stage: 'complete' }));
    const atCompaction = compactedConversationHistory(turns(6), { recentTurns: 2, compactedAtTurnCount: 6, mergeConsecutiveUser: false });
    const afterNextTurn = compactedConversationHistory(turns(7), { recentTurns: 10, compactedAtTurnCount: 6, mergeConsecutiveUser: false });
    assert.equal(afterNextTurn[0].content, atCompaction[0].content, 'the summarized prefix stays byte-identical on the turn after explicit compaction');
    assert.deepEqual(afterNextTurn.slice(1).filter(message => message.role === 'user').map(message => message.content), ['Question 5', 'Question 6', 'Question 7']);

    const manyTurns = Array.from({ length: 80 }, (_, index) => ({
        id: `turn-${index + 1}`,
        prompt: `TURN_${index + 1}_PROMPT ${'x'.repeat(200)}`,
        response: `TURN_${index + 1}_REPLY ${'y'.repeat(200)}`,
        stage: 'complete'
    }));
    const tight = compactedConversationHistory(manyTurns, { recentTurns: 2, contextWindowTokens: 8_000, mergeConsecutiveUser: false });
    assert.match(tight[0].content, /#1 user: TURN_1_PROMPT/, 'Turn #1 goal is preserved at the head of the summary');
    assert.match(tight[0].content, /intermediate turns omitted/, 'Intermediate turns are omitted when the summary exceeds budget');
    assert.match(tight[0].content, /#78 user: TURN_78_PROMPT/, 'The newest summarized turn right before recent verbatim turns is preserved');
});
