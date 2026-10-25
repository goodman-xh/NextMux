import { parseMcpCredentialReference } from '../common/nextmux-mcp-access';
import type { McpCredentialChange, McpCredentialChangeResult, McpServerAccess } from '../common/nextmux-mcp-access';

export interface McpCredentialSettingsPorts {
    readUser(): Record<string, unknown>;
    readEffective(): Record<string, unknown>;
    writeCredential(name: string, expected: string, value: Record<string, unknown>): Promise<void>;
    change(change: McpCredentialChange): Promise<McpCredentialChangeResult>;
}

export function mcpUserCredentialConfigurable(name: string, user: Record<string, unknown>, effective: Record<string, unknown>): boolean {
    const value = user[name];
    return Boolean(value && typeof value === 'object' && !Array.isArray(value) && 'serverUrl' in value
        && JSON.stringify(value) === JSON.stringify(effective[name]));
}

/** Only a non-secret locator enters preferences. Never copy a workspace/server
 * override into user settings or roll a rotated credential back on save failure. */
export async function saveMcpCredentialSettings(change: McpCredentialChange, ports: McpCredentialSettingsPorts): Promise<readonly McpServerAccess[]> {
    const name = change.serverName;
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(name) || ['__proto__', 'constructor', 'prototype'].includes(name)) throw new Error('MCP_NAME_INVALID');
    const original = ports.readUser()[name];
    const snapshot = JSON.stringify(original);
    if (!mcpUserCredentialConfigurable(name, ports.readUser(), ports.readEffective())) throw new Error('MCP_USER_CONFIGURATION_REQUIRED');
    const result = await ports.change(change);
    const credential = parseMcpCredentialReference(result.credential);
    if ((change.action === 'set' && (!credential || credential.kind !== change.kind)) || (change.action === 'clear' && credential)) throw new Error('MCP_CREDENTIAL_RESULT_INVALID');
    const current = ports.readUser();
    if (JSON.stringify(current[name]) !== snapshot || JSON.stringify(ports.readEffective()[name]) !== snapshot) throw new Error('MCP_CONFIGURATION_CHANGED');
    const { nextmuxCredential: _previous, ...configuration } = original as Record<string, unknown>;
    await ports.writeCredential(name, snapshot, { ...configuration, autostart: false, ...(credential ? { nextmuxCredential: credential } : {}) });
    const saved = ports.readEffective()[name] as Record<string, unknown> | undefined;
    if (JSON.stringify(parseMcpCredentialReference(saved?.nextmuxCredential)) !== JSON.stringify(credential)) throw new Error('MCP_CONFIGURATION_SAVE_FAILED');
    return result.servers;
}
