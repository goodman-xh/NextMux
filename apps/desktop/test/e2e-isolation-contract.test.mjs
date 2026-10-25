// Run the shared harness contracts in the ordinary desktop test/CI gate too.
import '../../../scripts/desktop-e2e-cleanup.test.mjs';
import '../../../scripts/desktop-isolated-launch.test.mjs';
import '../../../scripts/official-model-qa-fixture.test.mjs';
import '../../../scripts/desktop-navigation-qa.test.mjs';
import '../../../scripts/desktop-editor-shortcuts.test.mjs';
import '../../../scripts/desktop-branch-readiness.test.mjs';
import '../../../scripts/desktop-agent-delegation-contract.test.mjs';
import '../../../scripts/desktop-agent-recovery-contract.test.mjs';
import '../../../scripts/desktop-restart-exit-marker.test.mjs';
import '../../../scripts/desktop-attachment-owner-e2e.test.mjs';
import '../../../scripts/desktop-editor-recovery-e2e.test.mjs';
import '../../../scripts/desktop-close-persistence-e2e.test.mjs';
