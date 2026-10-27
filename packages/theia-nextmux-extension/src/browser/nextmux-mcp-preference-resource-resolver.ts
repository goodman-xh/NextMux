import { injectable } from '@theia/core/shared/inversify';
import type URI from '@theia/core/lib/common/uri';
import { FileResourceResolver } from '@theia/filesystem/lib/browser/file-resource';
import { isMcpPreferenceSaveGuarded } from './nextmux-mcp-preference-save-guard';

@injectable()
export class NextMuxMcpPreferenceResourceResolver extends FileResourceResolver {
    protected override async shouldOverwrite(uri: URI): Promise<boolean> {
        return isMcpPreferenceSaveGuarded(uri.toString()) ? false : super.shouldOverwrite(uri);
    }
}
