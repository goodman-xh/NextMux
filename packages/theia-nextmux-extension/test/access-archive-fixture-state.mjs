/** In-memory UI fixture only. Never opens files, starts processes or contacts a service. */
export function createAccessArchiveFixture(onChange = () => {}) {
    const clone = value => structuredClone(value);
    const counts = { refresh: 0, review: 0, start: 0, tools: 0, revoke: 0, preview: 0, import: 0, export: 0, picker: 0, recovery: 0, saveMedia: 0, openMedia: 0 };
    let servers = [{ name: 'fixture-mcp', fingerprint: 'fixture-server-v1', connection: 'Local — simulated only',
        details: 'fixture-command --never-executed', local: true, approved: false, running: false, needsReview: true,
        tools: [
            { name: 'read_sample', description: 'Read a synthetic sample. No filesystem access.', fingerprint: 'read-v1', supported: true, approved: false },
            { name: 'write_sample', description: 'Modify synthetic state only. لا ملفات حقيقية — keine echten Dateien.', fingerprint: 'write-v1', supported: true, approved: false },
            { name: 'unsupported_sample', description: 'Unsupported input schema.', fingerprint: 'unsupported-v1', supported: false, approved: false }
        ] }];
    let generation = 0;
    let holdNext = false;
    let pending;
    let preview;
    let previewSequence = 0;
    let choice = 'good';
    let recovery = 'recovered';
    const changed = () => onChange();
    const request = async (kind, action) => {
        counts[kind]++;
        if (holdNext) {
            holdNext = false;
            if (pending) throw new Error('FIXTURE_ALREADY_HELD');
            const expected = generation;
            await new Promise((resolve, reject) => { pending = { kind, expected, resolve, reject }; changed(); });
            if (expected !== generation) throw new Error('FIXTURE_STALE_OPERATION');
        }
        const result = action(); changed(); return clone(result);
    };
    const service = {
        recoverManagedReceipt: id => request('recovery', () => {
            if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error('FIXTURE_BAD_REQUEST_ID');
            if (recovery === 'media') return { requestId: id, status: 'recovered', result: { model: 'fixture/image', content: '', toolCallCount: 0, currency: 'USD', chargedMicros: 123,
                media: { kind: 'image', requestId: id, downloadPath: `/api/gateway/media/${id}/result`, extension: 'png', mimeType: 'image/png', sizeBytes: 102400, sha256: '0'.repeat(64), expiresAt: Date.now() + 60000, model: 'fixture/image', provider: 'Fixture only' } } };
            return { requestId: id, status: recovery, ...(recovery === 'pending' ? { retryAfterMs: 1000 } : {}),
                ...(recovery === 'recovered' ? { result: { model: 'fixture-only', content: '<script>never execute</script>\nSaved synthetic result — 原结果', toolCallCount: 1, currency: 'USD', chargedMicros: 123 } } : {}) };
        }),
        saveManagedReceiptMedia: (id, ownerId) => request('saveMedia', () => {
            if (ownerId !== 'fixture-owner' || !/^[a-f0-9-]{36}$/i.test(id)) throw new Error('FIXTURE_OWNER_REQUIRED');
            return `file:///fixture-not-a-real-file/recovered-media/${id}.png`;
        }),
        getMcpAccess: () => request('refresh', () => servers),
        reviewMcpAccess: name => request('review', () => {
            const server = servers.find(item => item.name === name);
            if (!server) throw new Error('FIXTURE_UNKNOWN_SERVER');
            server.needsReview = false; return servers;
        }),
        changeMcpAccess: change => request(change.action, () => {
            const server = servers.find(item => item.name === change.serverName);
            if (!server || change.fingerprint !== server.fingerprint || server.needsReview) throw new Error('FIXTURE_REVIEW_REQUIRED');
            if (change.action === 'start') { server.running = true; server.approved = true; server.tools.forEach(tool => { tool.approved = false; }); }
            else if (change.action === 'revoke') { server.running = false; server.approved = false; server.tools.forEach(tool => { tool.approved = false; }); generation++; }
            else if (change.action === 'tools') {
                if (!server.running || !server.approved) throw new Error('FIXTURE_SERVER_NOT_APPROVED');
                if (!Array.isArray(change.tools) || change.tools.some(item => !server.tools.some(tool => tool.name === item.name && tool.fingerprint === item.fingerprint && tool.supported))) throw new Error('FIXTURE_BAD_TOOL');
                server.tools.forEach(tool => { tool.approved = change.tools.some(item => item.name === tool.name); });
            } else throw new Error('FIXTURE_BAD_ACTION');
            return servers;
        }),
        previewConversationArchive: uri => {
            preview = undefined; changed();
            return request('preview', () => {
                if (uri !== 'fixture://archive/good') throw new Error('FIXTURE_INVALID_ARCHIVE — 旧预览不可导入');
                preview = { previewId: `fixture-preview-${++previewSequence}`, sha256: 'fixture-only-not-a-file', bytes: 12345, attachments: 2, attachmentBytes: 50,
                    warnings: ['conversation_text_and_attachments_may_contain_secrets', 'runtime_credentials_workspaces_permissions_and_pending_queue_not_imported'],
                    conversations: Array.from({ length: 16 }, (_, index) => ({ id: `fixture-${index}`, title: index === 0 ? 'LongConversationWithoutSpaces'.repeat(8) : `迁移会话 ${index} — محادثة محفوظة — Gesprächsübertragungsprüfung`, turns: 10, attachments: 1, conflict: index < 2, copyId: `copy-${index}`, copyConflict: index === 1 })) };
                return preview;
            });
        },
        importConversationArchive: (id, policy) => request('import', () => {
            if (!preview || preview.previewId !== id || !['skip', 'copy'].includes(policy)) throw new Error('FIXTURE_PREVIEW_EXPIRED');
            preview = undefined; return { imported: policy === 'copy' ? 15 : 14, skipped: policy === 'copy' ? 1 : 2 };
        }),
        exportConversationArchive: (_uri, ids) => request('export', () => ({ conversations: ids?.length || 3, attachments: 2 }))
    };
    return {
        service,
        snapshot: () => clone({ counts, servers, holdNext, pending: pending?.kind, previewId: preview?.previewId, choice, recovery }),
        setRecovery(value) { if (!['recovered', 'pending', 'review', 'expired', 'media'].includes(value)) throw new Error('FIXTURE_BAD_RECOVERY'); recovery = value; changed(); },
        openSavedFile() { counts.openMedia++; changed(); },
        setChoice(value) { if (!['good', 'bad', 'cancel'].includes(value)) throw new Error('FIXTURE_BAD_CHOICE'); choice = value; changed(); },
        setHold(value) { holdNext = Boolean(value); changed(); },
        settleHeld(success) {
            if (!pending) return;
            const held = pending; pending = undefined;
            if (success) held.resolve(); else held.reject(new Error('FIXTURE_LATE_FAILURE'));
            changed();
        },
        externalRevoke() { generation++; servers.forEach(server => { server.running = false; server.approved = false; server.tools.forEach(tool => { tool.approved = false; }); }); changed(); },
        chooseFile: async kind => { counts.picker++; changed(); return kind === 'save' ? 'fixture://archive/export' : choice === 'cancel' ? undefined : `fixture://archive/${choice}`; },
        addServer: async name => {
            if (!name || servers.some(server => server.name === name)) throw new Error('FIXTURE_INVALID_SERVER_NAME');
            servers = [...servers, { name, fingerprint: `fixture-added-${servers.length}`, connection: 'Simulated configuration only', details: 'Not executed, not persisted', local: false, running: false, approved: false, needsReview: true, tools: [] }]; changed();
        }
    };
}
