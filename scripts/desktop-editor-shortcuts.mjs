/** CDP keyboard events for the installed Monaco CtrlCmd bindings. No editor API bypass. */
export function desktopEditorShortcutPlan(action, platform) {
  if (!['darwin', 'win32', 'linux'].includes(platform)) throw new Error('Unsupported desktop shortcut platform');
  const mac = platform === 'darwin';
  const actions = {
    selectAll: { key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 },
    find: { key: 'f', code: 'KeyF', windowsVirtualKeyCode: 70 },
    replace: { key: 'h', code: 'KeyH', windowsVirtualKeyCode: 72 },
    undo: { key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90 },
    redo: { key: 'Z', code: 'KeyZ', windowsVirtualKeyCode: 90 },
    save: { key: 's', code: 'KeyS', windowsVirtualKeyCode: 83 },
    // Monaco's macOS cursorBottom binding is Command+Down, not Control+End.
    documentEnd: mac ? { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 }
      : { key: 'End', code: 'End', windowsVirtualKeyCode: 35 },
  };
  if (!Object.hasOwn(actions, action)) throw new Error('Unsupported desktop editor shortcut');
  const primary = mac ? { key: 'Meta', code: 'MetaLeft', windowsVirtualKeyCode: 91, bit: 4 }
    : { key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, bit: 2 };
  const pressed = [primary, ...(action === 'redo' ? [{ key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16, bit: 8 }] : [])];
  const events = [];
  let modifiers = 0;
  for (const { bit, ...key } of pressed) {
    modifiers |= bit;
    events.push({ type: 'rawKeyDown', ...key, modifiers });
  }
  events.push({ type: 'rawKeyDown', ...actions[action], modifiers }, { type: 'keyUp', ...actions[action], modifiers });
  // Keep the desktop QA harness runnable on the Node 18 floor used by local
  // source launches; Array#toReversed is only available in newer runtimes.
  for (const { bit, ...key } of [...pressed].reverse()) {
    modifiers &= ~bit;
    events.push({ type: 'keyUp', ...key, modifiers });
  }
  return events;
}
