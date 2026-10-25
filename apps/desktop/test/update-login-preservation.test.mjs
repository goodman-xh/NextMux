import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const source = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const { build } = JSON.parse(source('package.json'));

test('installed upgrades keep the product identity and persistent browser partition across both platforms', () => {
  assert.equal(build.appId, 'io.nextmux.desktop'); assert.equal(build.productName, 'NextMux');
  assert.equal(build.nsis.deleteAppDataOnUninstall, false);
  const bootstrap = source('bootstrap.cjs'), updater = source('updater.cjs');
  assert.ok(bootstrap.indexOf("app.setName('NextMux')") < bootstrap.indexOf('resolveDataLocation('));
  for (const text of [bootstrap, updater]) {
    assert.match(text, /setAppUserModelId\??\.?(?:\('io\.nextmux\.desktop'\))/);
    assert.doesNotMatch(text, /clearStorageData\(|clearAuthCache\(|setPath\(['"](?:userData|sessionData)/);
  }
  assert.match(updater, /session\.fromPartition\('persist:nextmux-browser'\)/);
  const install = updater.slice(updater.indexOf("ipcMain.handle('nextmux:update:install'"), updater.indexOf("ipcMain.handle('nextmux:update:install'") + 650);
  assert.match(install, /app\.quit\(\)/);
  assert.doesNotMatch(install, /clearCache|unlinkSync|rmSync|setPath/);
});

test('the installed NSIS templates protect upgrade data and portable cleanup only targets extracted program files', () => {
  const builder = createRequire(require.resolve('electron-builder/package.json'));
  const templates = join(dirname(builder.resolve('app-builder-lib/package.json')), 'templates/nsis');
  const uninstall = readFileSync(join(templates, 'uninstaller.nsh'), 'utf8');
  assert.match(uninstall, /StrCpy \$isDeleteAppData "0"/);
  assert.match(uninstall, /!ifdef DELETE_APP_DATA_ON_UNINSTALL\s+\$\{ifNot\} \$\{isUpdated\}/);
  assert.match(uninstall, /\$\{if\} \$isDeleteAppData == "1"[\s\S]*?SetShellVarContext current[\s\S]*?RMDir \/r "\$APPDATA/);
  const portable = readFileSync(join(templates, 'portable.nsi'), 'utf8');
  assert.match(portable, /"PORTABLE_EXECUTABLE_DIR", "\$EXEDIR"/);
  assert.deepEqual([...portable.matchAll(/RMDir[^\r\n]*/g)].map(match => match[0].trim()), ['RMDir /r $INSTDIR', 'RMDir /r $INSTDIR']);
  assert.match(portable, /StrCpy \$INSTDIR "\$PLUGINSDIR\\app"/);
});

test('the platform device credential keeps its stable keychain identity and its fallback is eligible for verified migration', () => {
  const platform = readFileSync(new URL('../../../packages/theia-nextmux-extension/src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
  assert.match(platform, /KEYCHAIN_SERVICE = 'NextMux'/);
  assert.match(platform, /DEVICE_ACCOUNT = 'desktop-device-id'/);
  assert.match(platform, /DEVICE_ROUTE_ACCOUNT = 'desktop-device-route-v1'/);
  assert.match(platform, /readDeviceId\(\)[\s\S]*?readKeychainPassword\(DEVICE_ACCOUNT, this\.nextmuxDataRoot\(\)\)/);
  const location = require('../data-location.cjs');
  assert.equal(location.isDataEntry('credential-vault-fallback-v1.json'), true);
});
