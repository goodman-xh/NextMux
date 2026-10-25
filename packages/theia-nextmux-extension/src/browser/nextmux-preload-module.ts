import { TextReplacementContribution } from '@theia/core/lib/browser/preload/text-replacement-contribution';
import { ContainerModule } from '@theia/core/shared/inversify';
import { NextMuxTextReplacementContribution } from './nextmux-text-replacement-contribution';

export default new ContainerModule(bind => {
    bind(TextReplacementContribution).to(NextMuxTextReplacementContribution).inSingletonScope();
});
