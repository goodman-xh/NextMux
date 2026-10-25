import { FrontendApplicationContribution, WidgetFactory, bindViewContribution } from '@theia/core/lib/browser';
import { WebSocketConnectionProvider } from '@theia/core/lib/browser/messaging/ws-connection-provider';
import { PreferenceContribution, PreferenceSchemaService } from '@theia/core/lib/common/preferences';
import { ContainerModule } from '@theia/core/shared/inversify';
import { WORKSPACE_TRUST_ENABLED } from '@theia/workspace/lib/common/workspace-trust-preferences';
import {
    NextMuxPlatformService,
    NextMuxPlatformServicePath
} from '../common/nextmux-platform-protocol';
import { NextMuxDesktopContribution } from './nextmux-desktop-contribution';
import { keepRpcErrorCodes } from './nextmux-rpc-error-codes';
import { NextMuxPlatformRpcProxyFactory } from '../common/nextmux-platform-rpc-errors';
import { NextMuxDesktopWidget } from './nextmux-desktop-widget';
import { McpFrontendApplicationContribution } from '@theia/ai-mcp/lib/browser/mcp-frontend-application-contribution';
import { NextMuxMcpContribution } from './nextmux-mcp-contribution';
import { FileResourceResolver } from '@theia/filesystem/lib/browser/file-resource';
import { NextMuxMcpPreferenceResourceResolver } from './nextmux-mcp-preference-resource-resolver';
import { DefaultSkillService } from '@theia/ai-core/lib/browser/skill-service';
import { SkillPromptCoordinator } from '@theia/ai-core/lib/browser/skill-prompt-coordinator';
import { NextMuxSkillService, NextMuxSkillPromptCoordinator } from './nextmux-skill-service';
import { MessageClient } from '@theia/core/lib/common/message-service-protocol';
import { FileSystemWatcherErrorHandler } from '@theia/filesystem/lib/browser/filesystem-watcher-error-handler';
import {
    NextMuxFileSystemWatcherErrorHandler,
    NextMuxMessageClient
} from './nextmux-filesystem-watcher-error-handler';
import { DefaultFileDialogService, FileDialogService } from '@theia/filesystem/lib/browser/file-dialog';
import { ElectronFileDialogService } from '@theia/filesystem/lib/electron-browser/file-dialog/electron-file-dialog-service';
import { UserWorkingDirectoryProvider } from '@theia/core/lib/browser/user-working-directory-provider';
import { WorkspaceUserWorkingDirectoryProvider } from '@theia/workspace/lib/browser/workspace-user-working-directory-provider';
import { NextMuxFileDialogService, NextMuxUserWorkingDirectoryProvider } from './nextmux-file-dialog-service';

import '../../src/browser/style/nextmux.css';
import '../../src/browser/style/nextmux-desktop-production.css';
import '../../src/browser/style/nextmux-comic-studio.css';
import '../../src/browser/style/nextmux-pickers-settings.css';
import '../../src/browser/style/nextmux-conversation-stream.css';
import '../../src/browser/style/nextmux-markdown.css';
import '../../src/browser/style/nextmux-coding-workspace.css';
import '../../src/browser/style/nextmux-settings-polish.css';
import '../../src/browser/style/nextmux-shell-polish.css';
import '../../src/browser/style/nextmux-conversation-core.css';
import '../../src/browser/style/nextmux-composer-attachments.css';
import '../../src/browser/style/nextmux-comic-workshop.css';
import '../../src/browser/style/nextmux-comic-desk.css';
import '../../src/browser/style/nextmux-comic-cut-layout.css';
import '../../src/browser/style/nextmux-comic-multitrack.css';
import '../../src/browser/style/nextmux-comic-chat.css';
import '../../src/browser/style/nextmux-model-taxonomy.css';
// Light-theme hover contrast guard; after the component sheets so no hover rule can hide a label.
import '../../src/browser/style/nextmux-light-contrast.css';
// Design tokens (Codex desktop typography and syntax colours) and the final component layer.
import '../../src/browser/style/nextmux-Variables.css';
// Motion presets load last so dialog/sheet animations win over component styles.
import '../../src/browser/style/nextmux-motion.css';

keepRpcErrorCodes();

export default new ContainerModule((bind, _unbind, isBound, rebind) => {
    (isBound(DefaultSkillService) ? rebind(DefaultSkillService) : bind(DefaultSkillService))
        .to(NextMuxSkillService).inSingletonScope();
    (isBound(SkillPromptCoordinator) ? rebind(SkillPromptCoordinator) : bind(SkillPromptCoordinator))
        .to(NextMuxSkillPromptCoordinator).inSingletonScope();
    (isBound(FileResourceResolver) ? rebind(FileResourceResolver) : bind(FileResourceResolver))
        .to(NextMuxMcpPreferenceResourceResolver).inSingletonScope();
    (isBound(McpFrontendApplicationContribution) ? rebind(McpFrontendApplicationContribution) : bind(McpFrontendApplicationContribution))
        .to(NextMuxMcpContribution).inSingletonScope();
    (isBound(FileSystemWatcherErrorHandler) ? rebind(FileSystemWatcherErrorHandler) : bind(FileSystemWatcherErrorHandler))
        .to(NextMuxFileSystemWatcherErrorHandler).inSingletonScope();
    (isBound(MessageClient) ? rebind(MessageClient) : bind(MessageClient))
        .to(NextMuxMessageClient).inSingletonScope();
    (isBound(WorkspaceUserWorkingDirectoryProvider) ? rebind(WorkspaceUserWorkingDirectoryProvider) : bind(WorkspaceUserWorkingDirectoryProvider))
        .to(NextMuxUserWorkingDirectoryProvider).inSingletonScope();
    (isBound(UserWorkingDirectoryProvider) ? rebind(UserWorkingDirectoryProvider) : bind(UserWorkingDirectoryProvider))
        .toService(WorkspaceUserWorkingDirectoryProvider);
    bind(NextMuxFileDialogService).toSelf().inSingletonScope();
    (isBound(ElectronFileDialogService) ? rebind(ElectronFileDialogService) : bind(ElectronFileDialogService))
        .toService(NextMuxFileDialogService);
    (isBound(DefaultFileDialogService) ? rebind(DefaultFileDialogService) : bind(DefaultFileDialogService))
        .toService(NextMuxFileDialogService);
    (isBound(FileDialogService) ? rebind(FileDialogService) : bind(FileDialogService))
        .toService(NextMuxFileDialogService);
    bind(PreferenceContribution).toConstantValue({
        initSchema: (schema: PreferenceSchemaService) => {
            schema.registerOverride(WORKSPACE_TRUST_ENABLED, undefined, false);
        }
    });
    bindViewContribution(bind, NextMuxDesktopContribution);
    bind(FrontendApplicationContribution).toService(NextMuxDesktopContribution);
    bind(NextMuxDesktopWidget).toSelf();
    bind(NextMuxPlatformService).toDynamicValue(context =>
        context.container.get(WebSocketConnectionProvider).createProxy(
            NextMuxPlatformServicePath, new NextMuxPlatformRpcProxyFactory<NextMuxPlatformService>()
        )
    ).inSingletonScope();
    bind(WidgetFactory).toDynamicValue(context => ({
        id: NextMuxDesktopWidget.ID,
        createWidget: () => context.container.get<NextMuxDesktopWidget>(NextMuxDesktopWidget)
    })).inSingletonScope();
});
