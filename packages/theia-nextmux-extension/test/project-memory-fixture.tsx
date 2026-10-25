import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { ProjectMemoryPanel } from '../src/browser/nextmux-project-memory-panel';
import type { ProjectMemoryDocument, ProjectMemoryDraft } from '../src/common/nextmux-project-memory';

let memory: ProjectMemoryDocument = { schemaVersion: 1, revision: 1, entries: [{ id: 'checked-workflow', kind: 'experience', title: '组件截图验收',
    content: '在提交界面改动前，检查窄屏布局、键盘焦点和保存后的状态。通过当前项目的浏览器回归后再复用。',
    sources: [{ kind: 'conversation', reference: '设计面板验证对话' }], revision: 1, updatedAt: '2026-09-19T10:00:00Z' }] };
const api = {
    async getProjectKnowledge() { return { memory, memoryPath: '.nextmux/project-memory.json' }; },
    async saveProjectMemory(_root: string, draft: ProjectMemoryDraft, revision: number) {
        if (revision !== memory.revision) throw new Error('版本冲突，请刷新');
        const previous = memory.entries.find(entry => entry.id === draft.id);
        const entry = { ...draft, id: draft.id || 'new-entry', revision: (previous?.revision || 0) + 1, updatedAt: new Date().toISOString() };
        memory = { ...memory, revision: memory.revision + 1, entries: previous ? memory.entries.map(item => item.id === entry.id ? entry : item) : [...memory.entries, entry] };
        return memory;
    },
    async removeProjectMemory(_root: string, id: string) { memory = { ...memory, revision: memory.revision + 1, entries: memory.entries.filter(entry => entry.id !== id) }; return memory; },
    async adoptProjectExperience(_root: string, id: string, revision: number, verification: string) {
        if (revision !== memory.revision || !verification.trim()) throw new Error('需要核实当前版本');
        memory = { ...memory, revision: memory.revision + 1, entries: memory.entries.map(entry => entry.id === id ? { ...entry,
            adoption: { skillPath: '.agents/skills/learned-checked-workflow/SKILL.md', sourceSha256: 'a'.repeat(64), verifiedByUser: verification, adoptedAt: new Date().toISOString() } } : entry) };
        return memory;
    }
};
createRoot(document.getElementById('fixture')!).render(<ProjectMemoryPanel workspaceRoot='/Projects/NextMux' locale='zh-CN' api={api} onClose={() => { document.getElementById('status')!.textContent = 'closed'; }} onOpenFile={path => { document.getElementById('status')!.textContent = path; }} onOpenDesign={async () => { document.getElementById('status')!.textContent = 'DESIGN.md'; }} />);
