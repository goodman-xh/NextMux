#!/usr/bin/env node

import { connectToNextMuxWorkbench, runInDisposableAttachmentFileDesktop } from './desktop-attachment-file-e2e-harness.mjs';
import {
  ensureExactOfficialQaRoute,
  officialQaRouteConfig,
  readExactQaComposerRoute,
  verifyExactQaComposerRoute,
} from './desktop-official-qa-route.mjs';

const relaunched = await runInDisposableAttachmentFileDesktop(import.meta.url, {
  label: 'attachment production regression',
  withQaRoute: true,
});

if (!relaunched) await runAttachmentRegression();

async function runAttachmentRegression() {
  const cdpPort = process.env.NEXTMUX_CDP_PORT || '9222';
  const stamp = Date.now();
  const pastedImageName = `nextmux-pasted-${stamp}.png`;
  const droppedImageName = `nextmux-dropped-${stamp}.png`;
  const unsupportedName = `nextmux-unsupported-${stamp}.bin`;
  const marker = `NM_IMAGE_E2E_${stamp}`;
  const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  // Keep two visually valid but byte-distinct PNGs so product-level duplicate
  // attachment suppression does not turn the drag/drop assertion tautological.
  const droppedPngBase64 = Buffer.concat([Buffer.from(pngBase64, 'base64'), Buffer.from('drop-e2e')]).toString('base64');

  const { socket, call, evaluate, onEvent } = await connectToNextMuxWorkbench(cdpPort);
  const javascriptDialogs = [];
  onEvent(message => {
    if (message.method === 'Page.javascriptDialogOpening') javascriptDialogs.push(message.params);
  });
  const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const waitFor = async (read, predicate, timeoutMs, label) => {
    const startedAt = Date.now();
    let value;
    while (Date.now() - startedAt < timeoutMs) {
      value = await read();
      if (predicate(value)) return { value, elapsedMs: Date.now() - startedAt };
      await wait(120);
    }
    throw new Error(`Timed out waiting for ${label}. Last value: ${JSON.stringify(value)}`);
  };
  const state = () => evaluate(`(() => {
    const text = node => (node?.innerText || '').trim().replace(/\\s+/g, ' ');
    const color = value => {
      const parts = String(value || '').match(/[\\d.]+/g)?.map(Number) || [];
      return { raw: value || '', r: parts[0] || 0, g: parts[1] || 0, b: parts[2] || 0, a: parts[3] ?? 1 };
    };
    const chips = [...document.querySelectorAll('.nmx-attachment-chips > span')].map(node => {
      const style = getComputedStyle(node);
      const hint = node.querySelector('em');
      const hintStyle = hint ? getComputedStyle(hint) : undefined;
      const border = color(style.borderTopColor);
      const foreground = color(hintStyle?.color);
      const background = color(hintStyle?.backgroundColor);
      return {
        text: text(node), unsupported: node.classList.contains('is-unsupported'),
        visual: {
          border, foreground, background,
          darkRed: border.r > border.g + 25 && border.r > border.b + 20
            && foreground.r > foreground.g && background.r > background.g + 20
        }
      };
    });
    const turn = [...document.querySelectorAll('.nmx-task-turn')].find(node => text(node).includes(${JSON.stringify(marker)}));
    const lightbox = document.querySelector('.nmx-attachment-lightbox');
    const lightboxImage = lightbox?.querySelector('img');
    const lightboxRect = lightbox?.querySelector('section')?.getBoundingClientRect();
    const editor = document.querySelector('.nmx-work-context .nmx-monaco-file-editor, .nmx-work-context .monaco-editor');
    const binaryDialogPattern = /binary|unsupported text encoding|not support.*encoding|不支持的文本编码|二进制/i;
    return {
      running: Boolean(document.querySelector('.nmx-send-button.is-stop, .nmx-stop-glyph')),
      prompt: document.querySelector('.nmx-composer textarea')?.value || '', chips,
      dropOverlay: Boolean(document.querySelector('.nmx-composer-drop-overlay')),
      sendDisabled: Boolean(document.querySelector('.nmx-send-button')?.disabled),
      fileEditorOpened: Boolean(editor),
      lightbox: lightbox ? {
        label: lightbox.getAttribute('aria-label') || '',
        imageReady: Boolean(lightboxImage?.complete && lightboxImage.naturalWidth > 0),
        contained: Boolean(lightboxRect && lightboxRect.left >= 0 && lightboxRect.top >= 0
          && lightboxRect.right <= innerWidth && lightboxRect.bottom <= innerHeight)
      } : null,
      turn: turn ? {
        className: turn.querySelector('.nmx-agent-message')?.className || '',
        text: text(turn),
        responseText: text(turn.querySelector('.nmx-gateway-content')),
        imageButtons: [...turn.querySelectorAll('.nmx-turn-image')].map(button => button.getAttribute('title') || text(button))
      } : null,
      binaryDialog: [...document.querySelectorAll('[role="dialog"], .dialogOverlay, .theia-dialog')]
        .some(node => binaryDialogPattern.test(text(node)))
    };
  })()`);
  const dispatchFile = (kind, name, type, base64) => evaluate(`(async () => {
    const target = document.querySelector('.nmx-composer-wrap');
    if (!target) return false;
    const bytes = Uint8Array.from(atob(${JSON.stringify(base64)}), character => character.charCodeAt(0));
    const file = new File([bytes], ${JSON.stringify(name)}, { type: ${JSON.stringify(type)}, lastModified: ${stamp} });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const eventName = ${JSON.stringify(kind)} === 'paste' ? 'paste' : ${JSON.stringify(kind)};
    const event = new Event(eventName, { bubbles: true, cancelable: true });
    Object.defineProperty(event, eventName === 'paste' ? 'clipboardData' : 'dataTransfer', { value: transfer });
    return target.dispatchEvent(event);
  })()`);

  await Promise.all([call('Runtime.enable'), call('Page.enable')]);
  await call('Page.bringToFront');
  await call('Page.setWebLifecycleState', { state: 'active' });

  const qaConfig = officialQaRouteConfig(process.env, `attachment-${stamp}`);
  const qaRoute = await ensureExactOfficialQaRoute({ evaluate, environment: process.env, config: qaConfig });
  const assertSelectedQaRoute = async label => {
    const route = await readExactQaComposerRoute(evaluate);
    if (route.modelId !== qaRoute.modelId || route.routeId !== qaRoute.routeId
      || route.persistedRouteId !== qaRoute.routeId || route.relayKey !== qaRoute.relayKey) {
      throw new Error(`${label} is not bound to the exact local QA route: ${JSON.stringify(route)}`);
    }
    return route;
  };
  await assertSelectedQaRoute('Fresh composer');

  const initial = await state();
  if (initial.running || initial.prompt || initial.chips.length) {
    throw new Error(`The isolated composer is not idle and empty: ${JSON.stringify(initial)}`);
  }

  await dispatchFile('paste', pastedImageName, 'image/png', pngBase64);
  const pasted = await waitFor(state, value => value.chips.some(chip => chip.text.includes(pastedImageName) && !chip.unsupported), 5_000, 'pasted PNG attachment');
  if (pasted.value.fileEditorOpened || pasted.value.binaryDialog) {
    throw new Error(`Pasted PNG was routed through the text editor: ${JSON.stringify(pasted.value)}`);
  }

  await dispatchFile('dragenter', droppedImageName, 'image/png', droppedPngBase64);
  const dragEntered = await waitFor(state, value => value.dropOverlay, 2_000, 'PNG drag overlay');
  await dispatchFile('drop', droppedImageName, 'image/png', droppedPngBase64);
  const dropped = await waitFor(state, value => value.chips.some(chip => chip.text.includes(droppedImageName) && !chip.unsupported), 5_000, 'dropped PNG attachment');
  if (dropped.value.fileEditorOpened || dropped.value.binaryDialog) {
    throw new Error(`Dropped PNG was routed through the text editor: ${JSON.stringify(dropped.value)}`);
  }

  await evaluate(`document.querySelector('.nmx-attachment-preview')?.click()`);
  const previewBeforeSend = await waitFor(state, value => value.lightbox?.imageReady === true, 3_000, 'pre-send image lightbox');
  await evaluate(`document.querySelector('.nmx-attachment-lightbox header button')?.click()`);

  await dispatchFile('dragenter', unsupportedName, 'application/octet-stream', 'AAECAwQFBgc=');
  await waitFor(state, value => value.dropOverlay, 2_000, 'unsupported-file drag overlay');
  await dispatchFile('drop', unsupportedName, 'application/octet-stream', 'AAECAwQFBgc=');
  const unsupported = await waitFor(state, value => value.chips.some(chip => chip.text.includes(unsupportedName) && chip.unsupported), 5_000, 'retained unsupported attachment');
  const unsupportedChip = unsupported.value.chips.find(chip => chip.text.includes(unsupportedName));
  if (!unsupportedChip?.visual.darkRed || !unsupported.value.sendDisabled) {
    throw new Error(`Unsupported file was not retained as a dark-red, send-blocking attachment: ${JSON.stringify(unsupportedChip)}`);
  }
  await evaluate(`(() => {
    const chip = [...document.querySelectorAll('.nmx-attachment-chips > span')]
      .find(node => (node.innerText || '').includes(${JSON.stringify(unsupportedName)}));
    chip?.querySelector('.nmx-attachment-remove')?.click();
  })()`);
  const ready = await waitFor(state, value => value.chips.length === 2 && value.chips.every(chip => !chip.unsupported) && !value.sendDisabled, 5_000, 'two supported images ready to send');

  const focused = await evaluate(`(() => {
    const textarea = document.querySelector('.nmx-composer textarea:not(:disabled)');
    textarea?.focus();
    return Boolean(textarea);
  })()`);
  if (!focused) throw new Error('The isolated composer is not editable.');
  await call('Input.insertText', { text: `图片附件真实回归 ${marker}。只回复 ${marker}，不要调用工具。` });
  await assertSelectedQaRoute('Image composer before submit');
  const submitted = await evaluate(`(() => {
    const button = document.querySelector('.nmx-send-button:not(:disabled)');
    button?.click();
    return Boolean(button);
  })()`);
  if (!submitted) throw new Error(`Unable to submit the image task: ${JSON.stringify(await state())}`);

  const turnCreated = await waitFor(state, value => value.turn?.imageButtons.includes(pastedImageName)
    && value.turn?.imageButtons.includes(droppedImageName), 5_000, 'sent turn with both image attachments');
  await verifyExactQaComposerRoute(evaluate, qaRoute);
  const completed = await waitFor(state, value => Boolean(value.turn && !value.running
    && /is-complete|is-error|is-cancelled/.test(value.turn.className)), 120_000, 'image model task completion');
  const taskSucceeded = completed.value.turn?.className.includes('is-complete') === true;
  const providerReply = taskSucceeded
    ? await waitFor(state, value => value.turn?.responseText === marker, 8_000, 'final image-aware provider reply')
    : completed;
  await evaluate(`(() => {
    const turn = [...document.querySelectorAll('.nmx-task-turn')]
      .find(node => (node.innerText || '').includes(${JSON.stringify(marker)}));
    turn?.querySelector('.nmx-turn-image')?.click();
  })()`);
  const previewAfterSend = await waitFor(state, value => value.lightbox?.imageReady === true, 3_000, 'post-send image lightbox');
  await evaluate(`document.querySelector('.nmx-attachment-lightbox header button')?.click()`);

  const final = await state();
  const report = {
    marker,
    disposableProfile: process.env.NEXTMUX_DESKTOP_E2E_PROFILE_DIR,
    qaRoute: { endpoint: qaRoute.endpoint, modelId: qaRoute.modelId, routeId: qaRoute.routeId },
    pasteAddedImageWithoutEditor: !pasted.value.fileEditorOpened && pasted.value.chips.some(chip => chip.text.includes(pastedImageName)),
    dragOverlayVisible: dragEntered.value.dropOverlay,
    dropAddedImageWithoutEditor: !dropped.value.fileEditorOpened && dropped.value.chips.some(chip => chip.text.includes(droppedImageName)),
    previewBeforeSend: previewBeforeSend.value.lightbox,
    unsupportedRetainedDarkRed: unsupportedChip?.visual,
    unsupportedBlockedSend: unsupported.value.sendDisabled,
    supportedImagesReadyAfterRemoval: !ready.value.sendDisabled,
    sentImageNames: turnCreated.value.turn?.imageButtons,
    finalTaskClass: completed.value.turn?.className,
    finalTaskText: completed.value.turn?.text,
    providerResponse: providerReply.value.turn?.responseText,
    providerReceivedImage: providerReply.value.turn?.responseText === marker,
    previewAfterSend: previewAfterSend.value.lightbox,
    binaryDialogShown: final.binaryDialog || javascriptDialogs.some(dialog => /binary|encoding|二进制|编码/i.test(dialog.message || '')),
  };
  const pass = report.pasteAddedImageWithoutEditor
    && report.dragOverlayVisible
    && report.dropAddedImageWithoutEditor
    && report.previewBeforeSend?.contained === true
    && report.unsupportedRetainedDarkRed?.darkRed === true
    && report.unsupportedBlockedSend
    && report.supportedImagesReadyAfterRemoval
    && report.sentImageNames?.includes(pastedImageName)
    && report.sentImageNames?.includes(droppedImageName)
    && report.providerReceivedImage
    && report.previewAfterSend?.contained === true
    && !report.binaryDialogShown;
  console.log(JSON.stringify({ ...report, pass }, undefined, 2));
  socket.close();
  if (!pass) process.exitCode = 1;
}
