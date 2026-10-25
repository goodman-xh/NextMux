'use strict';
// Load the actual application handlers, without booting Theia, an updater, a
// user profile or any service. Both the unit and native guest tests use these.
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const { join } = require('node:path');
const vm = require('node:vm');
const extensionRequire = createRequire(join(__dirname, '../../../../packages/theia-nextmux-extension/package.json'));
const ts = extensionRequire('typescript');

function method(source, className, methodName) {
  const file = ts.createSourceFile('actual.ts', source, ts.ScriptTarget.Latest, true);
  const node = file.statements.find(value => ts.isClassDeclaration(value) && value.name?.text === className)
    || file.statements.flatMap(value => ts.isVariableStatement(value) ? value.declarationList.declarations : [])
      .find(value => value.name.getText(file) === className)?.initializer;
  const member = node?.members.find(value => value.name?.getText(file) === methodName);
  if (!member) throw Error(`Actual method missing: ${className}.${methodName}`);
  return member.getText(file);
}

function loadNavigationHandlers(electron) {
  const inherited = readFileSync(extensionRequire.resolve('@theia/core/lib/electron-main/electron-main-application'), 'utf8');
  const own = readFileSync(join(__dirname, '../../../../packages/theia-nextmux-extension/src/electron-main/nextmux-electron-main-module.ts'), 'utf8');
  const Theia = vm.runInNewContext(`(class { ${method(inherited, 'ElectronMainApplication', 'onWebContentsCreated')} })`, {
    uri_1: extensionRequire('@theia/core/lib/common/uri'), common_1: extensionRequire('@theia/core/lib/common/path'), electron_1: electron
  });
  const NextMux = vm.runInNewContext(ts.transpileModule(`(class extends Theia { ${method(own, 'NextMuxElectronMainApplication', 'onWebContentsCreated')} })`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText, { Theia, session: electron.session });
  const updater = readFileSync(join(__dirname, '../../updater.cjs'), 'utf8');
  const file = ts.createSourceFile('updater.cjs', updater, ts.ScriptTarget.Latest, true);
  const safeUrl = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'safeBrowserUrl');
  const registration = file.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
    && node.expression.expression.getText(file) === 'app.on' && node.expression.arguments[0]?.text === 'web-contents-created');
  if (!safeUrl || !registration) throw Error('Actual updater navigation handler missing');
  const updaterHandler = vm.runInNewContext(`${safeUrl.getText(file)}; (${registration.expression.arguments[1].getText(file)});`, { URL });
  for (const Class of [Theia, NextMux]) Class.prototype.globals = { THEIA_SECONDARY_WINDOW_HTML_PATH: '/fixture/secondary-window.html' };
  return { theia: new Theia(), nextmux: new NextMux(), updater: updaterHandler };
}
module.exports = { loadNavigationHandlers };
