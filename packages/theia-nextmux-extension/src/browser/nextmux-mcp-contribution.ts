import { injectable } from '@theia/core/shared/inversify';
import { McpFrontendApplicationContribution } from '@theia/ai-mcp/lib/browser/mcp-frontend-application-contribution';
import type { MCPServersPreference } from '@theia/ai-mcp/lib/common/mcp-server-preference-validator';
import type { MCPServerDescription } from '@theia/ai-mcp/lib/common/mcp-server-manager';
import { isHiddenPresetConfiguration } from './nextmux-open-source-mcp-presets';

@injectable()
export class NextMuxMcpContribution extends McpFrontendApplicationContribution {
    /** Node restores saved enablement. Discovery itself cannot grant access or trigger an unsolicited OAuth prompt. */
    protected override async attemptSilentStartOrPromptForOAuth(): Promise<void> { /* No autostart or unsolicited native sign-in prompt. */ }

    protected override convertToMap(servers: MCPServersPreference): Map<string, MCPServerDescription> {
        const result = super.convertToMap(servers);
        for (const [name, configured] of Object.entries(servers)) {
            // App-owned templates and presets that duplicate built-in browser/computer control are hidden;
            // services the user added keep their own approval lifecycle and start/stop controls.
            if (isHiddenPresetConfiguration(name, configured)) { result.delete(name); continue; }
            const raw = configured as unknown as Record<string, unknown>;
            const current = result.get(name);
            if (!current) continue;
            // Do not silently drop an invalid locator: Node must reject it,
            // including local-server refs, instead of reconnecting anonymously.
            const safeMetadata: Record<string, unknown> = {};
            if ('command' in current && Object.prototype.hasOwnProperty.call(raw, 'cwd')) safeMetadata.cwd = raw.cwd;
            for (const key of ['nextmuxAddedAt', 'nextmuxCredential', 'nextmuxFallbackGroup', 'nextmuxFallbackPriority', 'nextmuxRetrySafeTools', 'nextmuxRuntimePreset', 'nextmuxSource']) {
                if (Object.prototype.hasOwnProperty.call(raw, key)) safeMetadata[key] = raw[key];
            }
            if (Object.keys(safeMetadata).length) {
                result.set(name, { ...current, ...safeMetadata } as MCPServerDescription & Record<string, unknown>);
            }
        }
        return result;
    }
}
