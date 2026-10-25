import { inject, injectable } from '@theia/core/shared/inversify';
import { MaybeArray, URI } from '@theia/core/lib/common';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { FileAccess } from '@theia/filesystem/lib/common/filesystem';
import { FileStat } from '@theia/filesystem/lib/common/files';
import { DirNode } from '@theia/filesystem/lib/browser/file-tree';
import { OpenFileDialogProps, SaveFileDialogProps } from '@theia/filesystem/lib/browser/file-dialog';
import { ElectronFileDialogService } from '@theia/filesystem/lib/electron-browser/file-dialog/electron-file-dialog-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { WorkspaceUserWorkingDirectoryProvider } from '@theia/workspace/lib/browser/workspace-user-working-directory-provider';

/**
 * Ensures deleted or unmounted workspace roots in `.theia/workspaces/NextMux.auto.theia-workspace`
 * never poison `getUserWorkingDir()` or prevent native Electron file/folder dialogs from opening.
 */
@injectable()
export class NextMuxUserWorkingDirectoryProvider extends WorkspaceUserWorkingDirectoryProvider {
    override async getFromWorkspace(): Promise<URI | undefined> {
        for (const root of this.workspaceService.tryGetRoots()) {
            const existing = await this.ensureIsDirectory(root.resource);
            if (existing) return existing;
        }
        return undefined;
    }
}

@injectable()
export class NextMuxFileDialogService extends ElectronFileDialogService {
    @inject(WorkspaceService)
    protected readonly workspaceService!: WorkspaceService;

    override async getRootNode(folderToOpen?: FileStat): Promise<DirNode | undefined> {
        const direct = await super.getRootNode(folderToOpen).catch(() => undefined);
        if (direct) return direct;
        for (const root of this.workspaceService?.tryGetRoots?.() ?? []) {
            try {
                const stat = await this.fileService.resolve(root.resource);
                if (stat.isDirectory) return DirNode.createRoot(stat);
            } catch { /* try next workspace root */ }
        }
        try {
            const homeDirUri = await this.environments.getHomeDirUri();
            if (homeDirUri) {
                const stat = await this.fileService.resolve(new URI(homeDirUri));
                if (stat.isDirectory) return DirNode.createRoot(stat);
            }
        } catch { /* ignore */ }
        return undefined;
    }

    protected async resolveFallbackDialogUri(folder?: FileStat): Promise<URI | undefined> {
        const rootNode = await this.getRootNode(folder).catch(() => undefined);
        if (rootNode?.uri) return rootNode.uri;
        try {
            const homeDirUri = await this.environments.getHomeDirUri();
            if (homeDirUri) return new URI(homeDirUri);
        } catch { /* ignore */ }
        return undefined;
    }

    override async showOpenDialog(props: OpenFileDialogProps & { canSelectMany: true }, folder?: FileStat): Promise<MaybeArray<URI> | undefined>;
    override async showOpenDialog(props: OpenFileDialogProps & { canSelectMany?: false }, folder?: FileStat): Promise<URI | undefined>;
    override async showOpenDialog(props: OpenFileDialogProps, folder?: FileStat): Promise<MaybeArray<URI> | undefined> {
        if (typeof window !== 'undefined' && window.electronTheiaCore?.useNativeElements && window.electronTheiaFilesystem) {
            const fallbackUri = await this.resolveFallbackDialogUri(folder);
            const options = fallbackUri
                ? this.toOpenDialogOptions(fallbackUri, props)
                : {
                    path: '',
                    title: props.title,
                    buttonLabel: props.openLabel,
                    maxWidth: props.maxWidth,
                    modal: props.modal ?? true,
                    openFiles: props.canSelectFiles,
                    openFolders: props.canSelectFolders,
                    selectMany: props.canSelectMany,
                    ...(props.filters ? {
                        filters: [
                            ...Object.entries(props.filters).map(([name, extensions]) => ({ name, extensions })),
                            ...(props.canSelectFiles && Object.keys(props.filters).length > 0 ? [{ name: 'All Files', extensions: ['*'] }] : [])
                        ]
                    } : {})
                };
            const filePaths = await window.electronTheiaFilesystem.showOpenDialog(options);
            if (!filePaths || filePaths.length === 0) return undefined;
            const uris = filePaths.map(filePath => {
                let uri = FileUri.create(filePath);
                if (props.fileScheme) uri = uri.withScheme(props.fileScheme);
                return uri;
            });
            const canAccess = await this.canRead(uris);
            return canAccess ? (uris.length === 1 ? uris[0] : uris) : undefined;
        }
        return super.showOpenDialog(props, folder);
    }

    override async showSaveDialog(props: SaveFileDialogProps, folder?: FileStat): Promise<URI | undefined> {
        if (typeof window !== 'undefined' && window.electronTheiaCore?.useNativeElements && window.electronTheiaFilesystem) {
            const fallbackUri = await this.resolveFallbackDialogUri(folder);
            const options = fallbackUri
                ? this.toSaveDialogOptions(fallbackUri, props)
                : {
                    path: '',
                    title: props.title,
                    buttonLabel: props.saveLabel,
                    maxWidth: props.maxWidth,
                    modal: props.modal ?? true,
                    ...(props.filters ? {
                        filters: Object.entries(props.filters).map(([name, extensions]) => ({ name, extensions }))
                    } : {})
                };
            const filePath = await window.electronTheiaFilesystem.showSaveDialog(options);
            if (!filePath) return undefined;
            let uri = FileUri.create(filePath);
            if (props.fileScheme) uri = uri.withScheme(props.fileScheme);
            const exists = await this.fileService.exists(uri).catch(() => false);
            if (!exists) return uri;
            const canWrite = await this.canReadWrite(uri);
            return canWrite ? uri : undefined;
        }
        return super.showSaveDialog(props, folder);
    }

    protected override async canRead(uris: MaybeArray<URI>): Promise<boolean> {
        const resources = Array.isArray(uris) ? uris : [uris];
        const unreadableResourcePaths: string[] = [];
        await Promise.all(resources.map(async resource => {
            const accessible = await this.fileService.access(resource, FileAccess.Constants.R_OK).catch(() => false)
                || await this.fileService.exists(resource).catch(() => false);
            if (!accessible) unreadableResourcePaths.push(resource.path.toString());
        }));
        if (unreadableResourcePaths.length > 0) {
            this.messageService.error(`Cannot read ${unreadableResourcePaths.length} resource(s): ${unreadableResourcePaths.join(', ')}`);
        }
        return unreadableResourcePaths.length === 0;
    }
}
