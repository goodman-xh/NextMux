import { ConnectionContainerModule } from '@theia/core/lib/node/messaging/connection-container-module';
import { ContainerModule } from '@theia/core/shared/inversify';
import { MCPServerManager } from '@theia/ai-mcp/lib/common/mcp-server-manager';
import { NextMuxMcpServerManager } from './nextmux-mcp-server-manager';
import { persistentMcpAccessStore } from './nextmux-mcp-access-store';
import {
    NextMuxPlatformServicePath
} from '../common/nextmux-platform-protocol';
import { NextMuxPlatformServiceImpl, serializePlatformRequestError } from './nextmux-platform-service';
import { ConnectionHandler, RpcConnectionHandler, RpcProxyFactory } from '@theia/core/lib/common/messaging';
import type { NextMuxPlatformService } from '../common/nextmux-platform-protocol';
import { DiskFileSystemProvider } from '@theia/filesystem/lib/node/disk-file-system-provider';
import { NextMuxDiskFileSystemProvider } from './nextmux-host-file-writes';
import { ShellProcess } from '@theia/terminal/lib/node/shell-process';
import { NextMuxWindowsShellProcess } from './nextmux-windows-shell-process';

class NextMuxPlatformBackendRpcProxyFactory extends RpcProxyFactory<NextMuxPlatformService> {
    protected override serializeError(error: unknown): unknown {
        const safe = serializePlatformRequestError(error);
        const represented = super.serializeError(safe);
        if (safe !== error && represented instanceof Error) represented.stack = undefined;
        return represented;
    }
}

const nextmuxConnectionModule = ConnectionContainerModule.create(({ bind, rebind, isBound }) => {
    (isBound(MCPServerManager) ? rebind(MCPServerManager) : bind(MCPServerManager)).to(NextMuxMcpServerManager).inSingletonScope()
        .onActivation((_context, manager) => {
            (manager as NextMuxMcpServerManager).configureAccessStore(persistentMcpAccessStore());
            return manager;
        });
    bind(NextMuxPlatformServiceImpl).toSelf().inSingletonScope();
    bind(ConnectionHandler).toDynamicValue(context => new RpcConnectionHandler<NextMuxPlatformService>(
        NextMuxPlatformServicePath, () => context.container.get(NextMuxPlatformServiceImpl), NextMuxPlatformBackendRpcProxyFactory
    )).inSingletonScope();
});

export default new ContainerModule((bind, _unbind, isBound, rebind) => {
    bind(ConnectionContainerModule).toConstantValue(nextmuxConnectionModule);
    if (process.platform === 'win32') {
        // Keep Theia's existing ShellProcessFactory and shell-integration options.
        (isBound(ShellProcess) ? rebind(ShellProcess) : bind(ShellProcess)).to(NextMuxWindowsShellProcess).inTransientScope();
    }
    // Editor saves are recorded so a concurrent agent command never claims them.
    (isBound(DiskFileSystemProvider) ? rebind(DiskFileSystemProvider) : bind(DiskFileSystemProvider)).to(NextMuxDiskFileSystemProvider);
});
