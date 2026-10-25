import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codingGoalFileObjective, readCodingGoalFileObjective } from '../lib/node/nextmux-goal-file.js';

test('codingGoalFileObjective strips frontmatter and the goal heading while retaining active status', () => {
    assert.deepEqual(codingGoalFileObjective('---\nstatus: active\n---\n\n# 目标\n\n完成回归测试。\n'), {
        objective: '完成回归测试。', status: 'active'
    });
});

test('codingGoalFileObjective reads the legacy continuous-goal and prompt headings', () => {
    assert.deepEqual(codingGoalFileObjective('---\nstatus: active\n---\n\n# 持续目标\n\n## 提示词\n\n修复目标恢复。\n'), {
        objective: '修复目标恢复。', status: 'active'
    });
});

test('codingGoalFileObjective normalizes CRLF and BOM input', () => {
    for (const bom of ['', '\uFEFF']) {
        for (const newline of ['\n', '\r\n']) {
            const content = ['---', 'status: active', '---', '# 目标', '', 'First step.', '', 'Second step.', ''].join(newline);
            assert.deepEqual(codingGoalFileObjective(bom + content), {
                objective: 'First step.\n\nSecond step.', status: 'active'
            }, JSON.stringify({ bom, newline }));
        }
    }
});

test('codingGoalFileObjective requires complete frontmatter', () => {
    for (const content of ['# 目标\n\nAn objective.', 'An objective.', '---\nstatus: active\n# 目标\n\nAn objective.']) {
        assert.equal(codingGoalFileObjective(content), undefined, content);
    }
});

test('codingGoalFileObjective rejects empty objectives in current and legacy layouts', () => {
    for (const body of ['', ' \n\t\n', '# 目标\n\n', '# 持续目标\n\n## 提示词\n \t\n']) {
        assert.equal(codingGoalFileObjective(`---\nstatus: active\n---\n${body}`), undefined, JSON.stringify(body));
    }
});

test('codingGoalFileObjective rejects non-string inputs', () => {
    for (const content of [undefined, null, 42, {}, [], Buffer.from('---\nstatus: active\n---\nObjective')]) {
        assert.equal(codingGoalFileObjective(content), undefined);
    }
});

test('codingGoalFileObjective preserves objective Markdown and a later prompt section', () => {
    const objective = 'Keep the recovery file.\n\n## 提示词\nThis section belongs to the objective.\n\n- Verify saved content.';
    assert.deepEqual(codingGoalFileObjective(`---\nstatus: paused\n---\n# 目标\n\n${objective}\n`), {
        objective, status: 'paused'
    });
});

async function workspace(t) {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'nextmux-goal-objective-'));
    t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
    const goalId = randomUUID();
    return { workspaceRoot, conversationId: randomUUID(), path: `.nextmux/goals/${goalId}.md` };
}

test('readCodingGoalFileObjective reads the saved objective from a real workspace without changing it', async t => {
    const request = await workspace(t);
    const goalId = request.path.split('/').at(-1).slice(0, -3);
    const objective = 'Read the saved target.\n\n## Validation\nKeep all objective Markdown.';
    const content = `---\nconversationId: ${request.conversationId}\ngoalId: ${goalId}\nstatus: active\n---\n# 目标\n\n${objective}\n`;
    await mkdir(join(request.workspaceRoot, '.nextmux', 'goals'), { recursive: true });
    const file = join(request.workspaceRoot, request.path);
    await writeFile(file, content, 'utf8');
    assert.equal(await readCodingGoalFileObjective(request), objective);
    assert.equal(await readFile(file, 'utf8'), content);
});

test('readCodingGoalFileObjective returns undefined for missing goal directories and files', async t => {
    const request = await workspace(t);
    assert.equal(await readCodingGoalFileObjective(request), undefined);
    await assert.rejects(stat(join(request.workspaceRoot, '.nextmux')), { code: 'ENOENT' });
    await mkdir(join(request.workspaceRoot, '.nextmux', 'goals'), { recursive: true });
    assert.equal(await readCodingGoalFileObjective(request), undefined);
    await assert.rejects(stat(join(request.workspaceRoot, request.path)), { code: 'ENOENT' });
});
