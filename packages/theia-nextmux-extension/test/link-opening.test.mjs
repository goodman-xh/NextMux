import assert from 'node:assert/strict';
import test from 'node:test';

const modulePath = process.env.NEXTMUX_LINK_OPENING_MODULE
  || '../lib/browser/nextmux-link-opening.js';
const {
  LINK_OPENING_PREFERENCE_STORAGE_KEY,
  LEGACY_LINK_OPENING_PREFERENCE_STORAGE_KEYS,
  NextMuxLinkOpeningPolicy,
  conversationLinkTargetKind,
} = await import(modulePath);

class MemoryStorage {
  values = new Map();

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, value);
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

test('the default policy opens HTTP or HTTPS conversation links in the built-in browser', () => {
  const policy = new NextMuxLinkOpeningPolicy(new MemoryStorage());

  assert.deepEqual(policy.decide('https://example.test/docs'), {
    action: 'open-builtin-browser',
    target: 'https://example.test/docs',
    remembered: false,
  });
  assert.equal(policy.decide('http://example.test').action, 'open-builtin-browser');
});

test('the compatibility confirmation API can choose one link without changing the default', () => {
  const policy = new NextMuxLinkOpeningPolicy(new MemoryStorage());

  assert.deepEqual(policy.confirm('https://example.test/once', {
    destination: 'builtin-browser',
    remember: false,
  }), {
    action: 'open-builtin-browser',
    target: 'https://example.test/once',
    remembered: false,
  });
  assert.equal(policy.confirm('https://example.test/system', {
    destination: 'system-browser',
    remember: false,
  }).action, 'open-system-browser');
  assert.equal(policy.decide('https://example.test/again').action, 'open-builtin-browser');
});

test('remembering a confirmation persists the destination across policy instances', () => {
  const storage = new MemoryStorage();
  const first = new NextMuxLinkOpeningPolicy(storage);

  assert.deepEqual(first.confirm('https://example.test/selected', {
    destination: 'builtin-browser',
    remember: true,
  }), {
    action: 'open-builtin-browser',
    target: 'https://example.test/selected',
    remembered: true,
  });
  assert.deepEqual(new NextMuxLinkOpeningPolicy(storage).decide('https://example.test/later'), {
    action: 'open-builtin-browser',
    target: 'https://example.test/later',
    remembered: true,
  });
});

test('a saved system-browser preference still overrides the new built-in default', () => {
  const storage = new MemoryStorage();
  storage.setItem(LINK_OPENING_PREFERENCE_STORAGE_KEY, JSON.stringify({ version: 2, destination: 'system-browser' }));
  const policy = new NextMuxLinkOpeningPolicy(storage);
  assert.equal(policy.getPreference(), 'system-browser');
  assert.deepEqual(policy.decide('https://example.test/saved'), {
    action: 'open-system-browser', target: 'https://example.test/saved', remembered: true,
  });
});

test('failure to clean up legacy storage does not undo a successfully saved preference', () => {
  const storage = new MemoryStorage();
  storage.removeItem = () => { throw new Error('cleanup unavailable'); };
  const policy = new NextMuxLinkOpeningPolicy(storage);
  assert.equal(policy.setPreference('system-browser'), true);
  for (const current of [policy, new NextMuxLinkOpeningPolicy(storage)]) {
    assert.deepEqual(current.decide('https://example.test/saved'), {
      action: 'open-system-browser', target: 'https://example.test/saved', remembered: true,
    });
  }
});

test('settings can explicitly select or clear the remembered opener', () => {
  const storage = new MemoryStorage();
  const policy = new NextMuxLinkOpeningPolicy(storage);

  assert.equal(policy.getPreference(), undefined);
  assert.equal(policy.setPreference('system-browser'), true);
  assert.equal(policy.getPreference(), 'system-browser');
  assert.equal(policy.decide('https://example.test/system').action, 'open-system-browser');

  policy.clearPreference();
  assert.equal(policy.getPreference(), undefined);
  assert.deepEqual(policy.decide('https://example.test/after-clear'), {
    action: 'open-builtin-browser',
    target: 'https://example.test/after-clear',
    remembered: false,
  });
  assert.equal(storage.getItem(LINK_OPENING_PREFERENCE_STORAGE_KEY), null);
});

test('relative paths and file URIs bypass web confirmation and go to the file drawer', () => {
  const policy = new NextMuxLinkOpeningPolicy(new MemoryStorage());

  for (const target of [
    './README.md',
    '../src/index.ts',
    'docs/guide.md',
    'C:\\work\\readme.md',
    'C:%5Cwork%5Creadme.md#L12',
    'C:%2Fwork%2Freadme.md',
    '\\\\server\\share\\readme.md',
    'file:///C:/work/readme.md',
  ]) {
    assert.deepEqual(policy.decide(target), {
      action: 'open-file-drawer',
      target,
    });
  }
});

test('file, web and blocked classification is shared by clicks and context menus', () => {
  for (const target of ['src/app.ts', 'C:%5Cwork%5Creadme.md', 'file://server/share/readme.md', '//server/share/a.ts']) {
    assert.equal(conversationLinkTargetKind(target), 'file', target);
  }
  for (const target of ['https://example.test/file.ts', 'http://localhost:3000/a.ts']) {
    assert.equal(conversationLinkTargetKind(target), 'web', target);
  }
  for (const target of ['', '#L12', 'javascript:alert(1)', 'java\nscript:alert(1)', 'mailto:test@example.test', 'C:relative.txt', '\0src/app.ts']) {
    assert.equal(conversationLinkTargetKind(target), 'blocked', target);
  }
});

test('dangerous executable and inline-data schemes are blocked before any opener is selected', () => {
  const policy = new NextMuxLinkOpeningPolicy(new MemoryStorage());

  for (const target of [
    'javascript:alert(1)',
    ' JAVASCRIPT:alert(1)',
    'java\nscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
  ]) {
    assert.deepEqual(policy.decide(target), {
      action: 'blocked',
      target: target.trim(),
      reason: 'unsafe-scheme',
    });
  }
  assert.equal(policy.confirm('javascript:alert(1)', {
    destination: 'system-browser',
    remember: true,
  }).action, 'blocked');
});

test('a valid legacy preference migrates to the versioned storage record', () => {
  const storage = new MemoryStorage();
  const legacyKey = LEGACY_LINK_OPENING_PREFERENCE_STORAGE_KEYS[0];
  storage.setItem(legacyKey, JSON.stringify({ version: 1, opener: 'external' }));

  assert.equal(
    new NextMuxLinkOpeningPolicy(storage).decide('https://example.test/migrated').action,
    'open-system-browser',
  );
  assert.equal(storage.getItem(legacyKey), null);
  assert.deepEqual(JSON.parse(storage.getItem(LINK_OPENING_PREFERENCE_STORAGE_KEY)), {
    version: 2,
    destination: 'system-browser',
  });
});

test('corrupt or unknown current storage falls back to the built-in browser instead of a stale legacy choice', () => {
  for (const currentValue of [
    '{not-json',
    JSON.stringify({ version: 99, destination: 'system-browser' }),
    JSON.stringify({ version: 2, destination: 'shell-execute' }),
  ]) {
    const storage = new MemoryStorage();
    storage.setItem(LINK_OPENING_PREFERENCE_STORAGE_KEY, currentValue);
    storage.setItem(
      LEGACY_LINK_OPENING_PREFERENCE_STORAGE_KEYS[0],
      JSON.stringify({ version: 1, opener: 'external' }),
    );

    assert.deepEqual(new NextMuxLinkOpeningPolicy(storage).decide('https://example.test/safe'), {
      action: 'open-builtin-browser', target: 'https://example.test/safe', remembered: false,
    });
  }
});

test('unavailable storage keeps the built-in default and still permits one explicit choice', () => {
  const unreadable = new NextMuxLinkOpeningPolicy({
    getItem() { throw new Error('storage unavailable'); },
    setItem() { throw new Error('storage unavailable'); },
  });
  assert.deepEqual(unreadable.decide('https://example.test/read'), {
    action: 'open-builtin-browser', target: 'https://example.test/read', remembered: false,
  });

  const unwritable = new NextMuxLinkOpeningPolicy({
    getItem() { return null; },
    setItem() { throw new Error('quota exceeded'); },
  });
  assert.deepEqual(unwritable.confirm('https://example.test/write', {
    destination: 'system-browser',
    remember: true,
  }), {
    action: 'open-system-browser',
    target: 'https://example.test/write',
    remembered: false,
  });
  assert.deepEqual(unwritable.decide('https://example.test/again'), {
    action: 'open-builtin-browser', target: 'https://example.test/again', remembered: false,
  });
});

test('a failed preference write preserves the previous saved choice', () => {
  const storage = new MemoryStorage();
  const policy = new NextMuxLinkOpeningPolicy(storage);
  assert.equal(policy.setPreference('system-browser'), true);
  storage.setItem = () => { throw new Error('quota exceeded'); };
  assert.equal(policy.setPreference('builtin-browser'), false);
  assert.deepEqual(policy.decide('https://example.test/previous'), {
    action: 'open-system-browser', target: 'https://example.test/previous', remembered: true,
  });
});

test('confirmation accepts only the two presentation-neutral destination ids', () => {
  const policy = new NextMuxLinkOpeningPolicy(new MemoryStorage());

  assert.deepEqual(policy.confirm('https://example.test/invalid', {
    destination: 'shell-execute',
    remember: true,
  }), {
    action: 'blocked',
    target: 'https://example.test/invalid',
    reason: 'invalid-selection',
  });
  assert.equal(policy.decide('https://example.test/again').action, 'open-builtin-browser');
});

test('an empty link target is blocked instead of being treated as a file path', () => {
  const policy = new NextMuxLinkOpeningPolicy(new MemoryStorage());

  assert.deepEqual(policy.decide('   '), {
    action: 'blocked',
    target: '',
    reason: 'invalid-target',
  });
});
