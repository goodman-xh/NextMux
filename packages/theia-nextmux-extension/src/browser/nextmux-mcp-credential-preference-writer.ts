import { MCP_SERVERS_PREF } from '@theia/ai-mcp/lib/common/mcp-preferences';
import { PreferenceScope, type PreferenceService } from '@theia/core/lib/common/preferences';
import { parse, type ParseError } from '@theia/monaco-editor-core/esm/vs/base/common/json';
import type { MonacoTextModelService } from '@theia/monaco/lib/browser/monaco-text-model-service';
import type { MonacoJSONCEditor } from '@theia/preferences/lib/browser/monaco-jsonc-editor';
import { guardMcpPreferenceSave } from './nextmux-mcp-preference-save-guard';

function serverFromDocument(content: string, name: string): unknown {
    if (content.length > 1024 * 1024) throw new Error('MCP_CONFIGURATION_TOO_LARGE');
    const errors: ParseError[] = [];
    const document = parse(content, errors, { allowTrailingComma: true });
    if (errors.length || !document || typeof document !== 'object' || Array.isArray(document)) throw new Error('MCP_CONFIGURATION_INVALID');
    return document[MCP_SERVERS_PREF]?.[name];
}

/** Edit one entry in the existing shared JSONC model, never a captured whole preference map.
 * Loading/sync may await; the comparison and JSONC edit must then occur in the same JS turn.
 * Persistence uses Theia's existing resource-version conflict handling, not a new file store. */
export async function writeMcpCredentialPreference(name: string, expected: string, value: Record<string, unknown>, ports: {
    preferences: PreferenceService; models: Pick<MonacoTextModelService, 'createModelReference'>; editor: Pick<MonacoJSONCEditor, 'setValue'>;
}): Promise<void> {
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(name) || ['__proto__', 'constructor', 'prototype'].includes(name)) throw new Error('MCP_NAME_INVALID');
    const uri = ports.preferences.getConfigUri(PreferenceScope.User);
    if (!uri) throw new Error('MCP_USER_CONFIGURATION_REQUIRED');
    const reference = await ports.models.createModelReference(uri);
    let subscription: { dispose(): void } | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let releaseSaveGuard: (() => void) | undefined;
    try {
        const model = reference.object;
        if (model.dirty || model.readOnly || !model.valid) throw new Error('MCP_CONFIGURATION_BUSY');
        await model.sync();
        if (model.dirty || model.readOnly || !model.valid) throw new Error('MCP_CONFIGURATION_BUSY');
        if (ports.preferences.getConfigUri(PreferenceScope.User)?.toString() !== uri.toString()
            || JSON.stringify(serverFromDocument(model.getText(), name)) !== expected
            || JSON.stringify(ports.preferences.get<Record<string, unknown>>(MCP_SERVERS_PREF, {})[name]) !== expected) throw new Error('MCP_CONFIGURATION_CHANGED');
        const savedValue = JSON.stringify(value);
        let accept!: (value: boolean) => void;
        const reflected = new Promise<boolean>(resolve => { accept = resolve; });
        const check = (): void => { if (JSON.stringify(ports.preferences.get<Record<string, unknown>>(MCP_SERVERS_PREF, {})[name]) === savedValue) accept(true); };
        subscription = ports.preferences.onPreferenceChanged(check);
        timer = setTimeout(() => accept(false), 2000);
        // Resource.save can fall back to a full write after an incremental-write conflict.
        // Refuse that overwrite without prompting, only for this URI and this save scope.
        releaseSaveGuard = guardMcpPreferenceSave(uri.toString());
        // The installed MonacoJSONCEditor applies to the current shared model synchronously,
        // before its first await. Only this server path is replaced; comments/other entries survive.
        await ports.editor.setValue(model, [MCP_SERVERS_PREF, name], value, false);
        await model.save();
        if (model.dirty || JSON.stringify(serverFromDocument(model.getText(), name)) !== savedValue) throw new Error('MCP_CONFIGURATION_SAVE_FAILED');
        check();
        if (!await reflected) throw new Error('MCP_CONFIGURATION_SAVE_FAILED');
    } finally {
        releaseSaveGuard?.();
        if (timer) clearTimeout(timer);
        subscription?.dispose();
        reference.dispose();
    }
}
