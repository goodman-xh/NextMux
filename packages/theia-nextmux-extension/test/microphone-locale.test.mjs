import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MICROPHONE_TEXT_KEYS,
  microphoneLocale,
  microphoneText
} from '../lib/browser/nextmux-microphone-locale.js';

const locales = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];
const requiredKeys = [
  'title',
  'description',
  'statusGranted',
  'statusPrompt',
  'statusDenied',
  'statusSystemBlocked',
  'permissionNotice',
  'statusDeviceMissing',
  'statusUnsupported',
  'inputDevice',
  'defaultDevice',
  'unnamedDevice',
  'noDevices',
  'openSystemSettings',
  'requestPermission',
  'check',
  'startTest',
  'stopTest',
  'startFailed',
  'deviceBusy',
  'systemPermissionBoundary'
];

test('microphone interface text covers every shipped desktop locale and required key', () => {
  assert.deepEqual([...MICROPHONE_TEXT_KEYS], requiredKeys);

  for (const locale of locales) {
    const catalog = microphoneLocale(locale);
    assert.deepEqual(Object.keys(catalog), requiredKeys, locale);

    for (const key of requiredKeys) {
      assert.ok(catalog[key].trim(), `${locale}:${key}`);
      assert.equal(microphoneText(locale, key), catalog[key], `${locale}:${key}`);
    }
  }
});

test('microphone permission states and operating-system boundaries are explicit', () => {
  assert.equal(microphoneText('zh-CN', 'statusGranted'), '已允许麦克风访问');
  assert.equal(microphoneText('zh-CN', 'statusSystemBlocked'), '系统已阻止麦克风访问');
  // The composer corner shows this one line; the full steps are its hover text.
  assert.equal(microphoneText('zh-CN', 'permissionNotice'), '未获得麦克风权限，请在系统隐私设置中开启');
  for (const locale of locales) assert.ok(microphoneText(locale, 'permissionNotice').length <= 80, locale);
  assert.equal(microphoneText('zh-CN', 'statusDeviceMissing'), '未检测到麦克风');
  assert.equal(microphoneText('zh-CN', 'requestPermission'), '重新请求权限');
  assert.match(microphoneText('zh-CN', 'description'), /音量测试.*系统设置/);
  assert.match(microphoneText('zh-CN', 'systemPermissionBoundary'), /系统.*权限/);

  assert.equal(microphoneText('en', 'statusGranted'), 'Microphone access allowed');
  assert.equal(microphoneText('en', 'statusSystemBlocked'), 'Microphone access blocked by the system');
  assert.equal(microphoneText('en', 'requestPermission'), 'Request permission again');
  assert.match(microphoneText('en', 'description'), /level test.*system settings/i);
  assert.match(microphoneText('en', 'systemPermissionBoundary'), /operating system/i);
});

test('non-English microphone catalogs are localized instead of inheriting English labels', () => {
  const english = microphoneLocale('en');
  for (const locale of locales.filter(candidate => candidate !== 'en')) {
    const catalog = microphoneLocale(locale);
    for (const key of requiredKeys) {
      assert.notEqual(catalog[key], english[key], `${locale}:${key}`);
    }
  }
});
