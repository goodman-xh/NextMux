import * as React from '@theia/core/shared/react';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import type { NextMuxPlatformService } from '../common/nextmux-platform-protocol';
import { AGENT_INSTRUCTIONS_MAX_CHARACTERS, agentInstructionEditorText, sameInstructionText, type AgentInstructionFile } from '../common/nextmux-agent-instructions';
import {
    THREAD_NOTE_IMAGE_ID_PREFIX,
    THREAD_NOTE_MAX_IMAGES,
    THREAD_NOTE_MAX_LENGTH,
    appendThreadNoteText,
    computeThreadNoteDigest,
    createThreadNoteState,
    hasThreadNoteContent,
    isThreadNoteImageAttachmentId,
    mergeThreadNoteUpdate,
    normalizeThreadNoteText,
    parseMarkdownNoteWithImages,
    resolveThreadNotePromptSync,
    serializeNoteToMarkdown,
    stripConversationNoteBlocksFromText,
    toThreadNoteImageAttachmentId,
    type ResolveThreadNotePromptSyncOptions,
    type ThreadNoteImageItem,
    type ThreadNoteState,
    type ThreadNoteSyncDecision
} from '../common/nextmux-thread-notes-model';

export {
    THREAD_NOTE_IMAGE_ID_PREFIX,
    THREAD_NOTE_MAX_IMAGES,
    THREAD_NOTE_MAX_LENGTH,
    appendThreadNoteText,
    computeThreadNoteDigest,
    createThreadNoteState,
    hasThreadNoteContent,
    isThreadNoteImageAttachmentId,
    mergeThreadNoteUpdate,
    normalizeThreadNoteText,
    parseMarkdownNoteWithImages,
    resolveThreadNotePromptSync,
    serializeNoteToMarkdown,
    stripConversationNoteBlocksFromText,
    toThreadNoteImageAttachmentId,
    type ResolveThreadNotePromptSyncOptions,
    type ThreadNoteImageItem,
    type ThreadNoteState,
    type ThreadNoteSyncDecision
};

/**
 * Sticky notes in the conversation's notes float (its own icon on the right, beside the
 * file float and AGENTS.md float): one only this conversation sees, one every conversation sees.
 * Ctrl/⌘ + wheel over a note changes its text size within NOTE_FONT_MIN…NOTE_FONT_MAX without zooming the window.
 */
export const NOTE_FONT_MIN = 10;
export const NOTE_FONT_MAX = 18;
export const NOTE_FONT_DEFAULT = 11;
const GLOBAL_KEY = 'nextmux.desktop.notes.global.v1';
const GLOBAL_META_KEY = 'nextmux.desktop.notes.global.meta.v1';
const CONVERSATION_PREFIX = 'nextmux.desktop.notes.conversation.v1:';
const CONVERSATION_META_PREFIX = 'nextmux.desktop.notes.conversation.meta.v1:';
const FONT_KEY = 'nextmux.desktop.notes.fontSize.v1';
/** The notes and project instructions keep the height the user dragged them to, across conversations. */
const HEIGHT_KEYS = {
    conversation: 'nextmux.desktop.notes.height.conversation.v1',
    global: 'nextmux.desktop.notes.height.global.v1',
    agents: 'nextmux.desktop.notes.height.agents.v1'
} as const;
export const NOTE_HEIGHT_MIN = 52;
export const NOTE_HEIGHT_MAX = 320;
const MAX_LENGTH = THREAD_NOTE_MAX_LENGTH;

/** A numbered line: indentation, number and the text after “N. ”. */
const NUMBERED_LINE = /^([ \t]*)(\d{1,4})\.[ \t]+/;

/**
 * Enter inside a numbered note continues the list (“1. …” → “2. ”), like a Markdown editor.
 * Enter on an empty item ends the list. A line whose number the user deleted is plain text,
 * so numbering stops there. Returns undefined when a normal newline should be inserted.
 */
export function continueNoteList(value: string, selectionStart: number, selectionEnd = selectionStart): { value: string; caret: number } | undefined {
    const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
    const line = value.slice(lineStart, selectionStart);
    const match = NUMBERED_LINE.exec(line);
    if (!match) return undefined;
    if (!line.slice(match[0].length).trim() && selectionEnd === selectionStart && !value.slice(selectionStart).split('\n', 1)[0].trim()) {
        // “3. ” with nothing after it: leave the list instead of adding “4. ”.
        const next = value.slice(0, lineStart) + value.slice(selectionStart);
        return { value: next, caret: lineStart };
    }
    const marker = `${match[1]}${Number(match[2]) + 1}. `;
    const next = `${value.slice(0, selectionStart)}\n${marker}${value.slice(selectionEnd)}`;
    return { value: next, caret: selectionStart + 1 + marker.length };
}

/** Backspace right after an automatic “N. ” removes the whole marker. */
export function removeNoteListMarker(value: string, caret: number): { value: string; caret: number } | undefined {
    const lineStart = value.lastIndexOf('\n', caret - 1) + 1;
    const line = value.slice(lineStart, caret);
    const match = NUMBERED_LINE.exec(line);
    if (!match || match[0].length !== line.length) return undefined;
    return { value: value.slice(0, lineStart + match[1].length) + value.slice(caret), caret: lineStart + match[1].length };
}

/** What the AGENTS.md card saves: its text, or nothing while it only holds the list's first “1. ” (as a note does). */
export function agentInstructionContent(draft: string): string {
    return hasThreadNoteContent(draft) ? draft : '';
}

function readHeight(kind: keyof typeof HEIGHT_KEYS): number | undefined {
    const value = Number(read(HEIGHT_KEYS[kind]));
    return Number.isFinite(value) && value >= NOTE_HEIGHT_MIN ? Math.min(NOTE_HEIGHT_MAX, Math.round(value)) : undefined;
}

type Key = 'title' | 'conversation' | 'global' | 'placeholder' | 'zoom' | 'size' | 'modelReadable' | 'removeImage' | 'agentsTitle' | 'agentsHint' | 'agentsPlaceholder' | 'agentsSaving' | 'agentsSaved' | 'agentsOpen'
    | 'imageTooLarge' | 'imageUnsupported' | 'imageLimit' | 'readableGlobalHint' | 'agentsConflict' | 'agentsUseFile' | 'agentsOverwrite' | 'agentsSaveFailed' | 'agentsRetry' | 'agentsTooLarge';
const copy: Readonly<Record<NextMuxDesktopLocale, Readonly<Record<Key, string>>>> = {
    'zh-CN': {
        title: '便签',
        conversation: '便签 · 本对话可见',
        global: '便签 · 全对话可见',
        placeholder: '写点什么…',
        zoom: '{mod} + 滚轮 调整字号',
        size: '字号 {size}',
        modelReadable: '模型可读取',
        removeImage: '删除图片',
        agentsTitle: 'AGENTS.md · 项目长期指令',
        agentsHint: '本项目所有对话每次都会自动读取的长期规范（与「设置 → AI 指令」同步）',
        agentsPlaceholder: '# 项目约定\n- 写入此项目的长期 AI 指令（保存在项目根目录 AGENTS.md）…',
        agentsSaving: '保存中…',
        agentsSaved: '已保存',
        agentsOpen: '在编辑器中打开',
        imageTooLarge: '空间不足，图片未保存',
        imageUnsupported: '不支持此图片格式',
        imageLimit: '每个便签最多 {count} 张图片',
        readableGlobalHint: '只有本对话的便签可以让模型读取',
        agentsConflict: '文件已在别处修改',
        agentsUseFile: '使用文件版本',
        agentsOverwrite: '覆盖',
        agentsSaveFailed: '保存失败',
        agentsRetry: '重试',
        agentsTooLarge: '文件过大，无法在此编辑'
    },
    'zh-TW': {
        title: '便籤',
        conversation: '便籤 · 本對話可見',
        global: '便籤 · 全部對話可見',
        placeholder: '寫點什麼…',
        zoom: '{mod} + 滾輪 調整字級',
        size: '字級 {size}',
        modelReadable: '模型可讀取',
        removeImage: '刪除圖片',
        agentsTitle: 'AGENTS.md · 專案長期指令',
        agentsHint: '本專案所有對話每次都會自動讀取的長期規範（與「設定 → AI 指令」同步）',
        agentsPlaceholder: '# 專案約定\n- 寫入此專案的長期 AI 指令（儲存在專案根目錄 AGENTS.md）…',
        agentsSaving: '儲存中…',
        agentsSaved: '已儲存',
        agentsOpen: '在編輯器中開啟',
        imageTooLarge: '空間不足，圖片未儲存',
        imageUnsupported: '不支援此圖片格式',
        imageLimit: '每個便籤最多 {count} 張圖片',
        readableGlobalHint: '只有本對話的便籤可以讓模型讀取',
        agentsConflict: '檔案已在別處修改',
        agentsUseFile: '使用檔案版本',
        agentsOverwrite: '覆寫',
        agentsSaveFailed: '儲存失敗',
        agentsRetry: '重試',
        agentsTooLarge: '檔案過大，無法在此編輯'
    },
    en: {
        title: 'Notes',
        conversation: 'Note · this conversation',
        global: 'Note · all conversations',
        placeholder: 'Write something…',
        zoom: '{mod} + scroll to resize text',
        size: 'Text {size}',
        modelReadable: 'Model can read',
        removeImage: 'Remove image',
        agentsTitle: 'AGENTS.md · Project instructions',
        agentsHint: 'Standing rules read automatically in every conversation for this project (synced with Settings → AI instructions).',
        agentsPlaceholder: '# Project instructions\n- Standing instructions for this project (saved to AGENTS.md)…',
        agentsSaving: 'Saving…',
        agentsSaved: 'Saved',
        agentsOpen: 'Open in editor',
        imageTooLarge: 'Not enough space to save this image',
        imageUnsupported: 'This image format isn’t supported',
        imageLimit: 'A note holds up to {count} images',
        readableGlobalHint: 'Only this conversation’s note can be shared with the model',
        agentsConflict: 'Changed outside this panel',
        agentsUseFile: 'Use file',
        agentsOverwrite: 'Overwrite',
        agentsSaveFailed: 'Couldn’t save',
        agentsRetry: 'Retry',
        agentsTooLarge: 'Too large to edit here'
    },
    ja: {
        title: 'メモ',
        conversation: 'メモ · この会話のみ',
        global: 'メモ · すべての会話',
        placeholder: 'メモを書く…',
        zoom: '{mod} + スクロールで文字サイズ',
        size: '文字 {size}',
        modelReadable: 'モデルが読み取り可能',
        removeImage: '画像を削除',
        agentsTitle: 'AGENTS.md · プロジェクトの指示',
        agentsHint: 'このプロジェクトのすべての会話で毎回自動的に読み込まれる常設ルール（設定 → AI 指示と同期）',
        agentsPlaceholder: '# プロジェクトの規約\n- このプロジェクトの AGENTS.md に保存されます…',
        agentsSaving: '保存中…',
        agentsSaved: '保存しました',
        agentsOpen: 'エディターで開く',
        imageTooLarge: '容量が足りず画像を保存できません',
        imageUnsupported: 'この画像形式には対応していません',
        imageLimit: '付箋に追加できる画像は最大 {count} 枚です',
        readableGlobalHint: 'モデルが読み取れるのはこの会話の付箋だけです',
        agentsConflict: 'ファイルが別の場所で変更されました',
        agentsUseFile: 'ファイルの内容を使う',
        agentsOverwrite: '上書き',
        agentsSaveFailed: '保存できませんでした',
        agentsRetry: '再試行',
        agentsTooLarge: '大きすぎるためここでは編集できません'
    },
    ko: {
        title: '메모',
        conversation: '메모 · 이 대화에서만',
        global: '메모 · 모든 대화',
        placeholder: '메모를 입력하세요…',
        zoom: '{mod} + 스크롤로 글자 크기 조절',
        size: '글자 {size}',
        modelReadable: '모델 읽기 허용',
        removeImage: '이미지 삭제',
        agentsTitle: 'AGENTS.md · 프로젝트 지침',
        agentsHint: '이 프로젝트의 모든 대화에서 매번 자동으로 읽는 상시 규칙(설정 → AI 지침과 동기화)',
        agentsPlaceholder: '# 프로젝트 규칙\n- 프로젝트 루트의 AGENTS.md에 저장됩니다…',
        agentsSaving: '저장 중…',
        agentsSaved: '저장됨',
        agentsOpen: '편집기에서 열기',
        imageTooLarge: '공간이 부족해 이미지를 저장하지 못했습니다',
        imageUnsupported: '지원하지 않는 이미지 형식입니다',
        imageLimit: '메모 하나에 이미지는 최대 {count}개까지 추가할 수 있습니다',
        readableGlobalHint: '모델은 이 대화의 메모만 읽을 수 있습니다',
        agentsConflict: '다른 곳에서 파일이 변경되었습니다',
        agentsUseFile: '파일 버전 사용',
        agentsOverwrite: '덮어쓰기',
        agentsSaveFailed: '저장하지 못했습니다',
        agentsRetry: '다시 시도',
        agentsTooLarge: '파일이 너무 커서 여기서 편집할 수 없습니다'
    },
    es: {
        title: 'Notas',
        conversation: 'Nota · esta conversación',
        global: 'Nota · todas las conversaciones',
        placeholder: 'Escribe algo…',
        zoom: '{mod} + rueda para cambiar el tamaño',
        size: 'Texto {size}',
        modelReadable: 'El modelo puede leer',
        removeImage: 'Eliminar imagen',
        agentsTitle: 'AGENTS.md · Instrucciones del proyecto',
        agentsHint: 'Reglas permanentes que se leen automáticamente en cada conversación de este proyecto (sincronizado con Ajustes → Instrucciones de IA).',
        agentsPlaceholder: '# Instrucciones del proyecto\n- Guardado como AGENTS.md en este proyecto…',
        agentsSaving: 'Guardando…',
        agentsSaved: 'Guardado',
        agentsOpen: 'Abrir en el editor',
        imageTooLarge: 'No hay espacio para guardar la imagen',
        imageUnsupported: 'Este formato de imagen no es compatible',
        imageLimit: 'Una nota admite hasta {count} imágenes',
        readableGlobalHint: 'Solo la nota de esta conversación puede compartirse con el modelo',
        agentsConflict: 'Modificado fuera de este panel',
        agentsUseFile: 'Usar archivo',
        agentsOverwrite: 'Sobrescribir',
        agentsSaveFailed: 'No se pudo guardar',
        agentsRetry: 'Reintentar',
        agentsTooLarge: 'Demasiado grande para editarlo aquí'
    },
    fr: {
        title: 'Notes',
        conversation: 'Note · cette conversation',
        global: 'Note · toutes les conversations',
        placeholder: 'Écrivez quelque chose…',
        zoom: '{mod} + molette pour la taille du texte',
        size: 'Texte {size}',
        modelReadable: 'Lisible par le modèle',
        removeImage: 'Supprimer l’image',
        agentsTitle: 'AGENTS.md · Instructions du projet',
        agentsHint: 'Règles permanentes lues automatiquement dans chaque conversation de ce projet (synchronisées avec Paramètres → Instructions IA).',
        agentsPlaceholder: '# Instructions du projet\n- Enregistré sous AGENTS.md dans ce projet…',
        agentsSaving: 'Enregistrement…',
        agentsSaved: 'Enregistré',
        agentsOpen: 'Ouvrir dans l’éditeur',
        imageTooLarge: 'Espace insuffisant pour enregistrer l’image',
        imageUnsupported: 'Ce format d’image n’est pas pris en charge',
        imageLimit: 'Une note peut contenir jusqu’à {count} images',
        readableGlobalHint: 'Seule la note de cette conversation peut être partagée avec le modèle',
        agentsConflict: 'Modifié en dehors de ce panneau',
        agentsUseFile: 'Utiliser le fichier',
        agentsOverwrite: 'Écraser',
        agentsSaveFailed: 'Échec de l’enregistrement',
        agentsRetry: 'Réessayer',
        agentsTooLarge: 'Trop volumineux pour être modifié ici'
    },
    de: {
        title: 'Notizen',
        conversation: 'Notiz · diese Unterhaltung',
        global: 'Notiz · alle Unterhaltungen',
        placeholder: 'Etwas notieren…',
        zoom: '{mod} + Mausrad für Textgröße',
        size: 'Text {size}',
        modelReadable: 'Vom Modell lesbar',
        removeImage: 'Bild entfernen',
        agentsTitle: 'AGENTS.md · Projektanweisungen',
        agentsHint: 'Dauerhafte Regeln, die in jeder Unterhaltung dieses Projekts automatisch gelesen werden (synchron mit Einstellungen → KI-Anweisungen).',
        agentsPlaceholder: '# Projektanweisungen\n- Gespeichert als AGENTS.md im Projektstamm…',
        agentsSaving: 'Speichern…',
        agentsSaved: 'Gespeichert',
        agentsOpen: 'Im Editor öffnen',
        imageTooLarge: 'Nicht genug Speicher, um das Bild zu sichern',
        imageUnsupported: 'Dieses Bildformat wird nicht unterstützt',
        imageLimit: 'Eine Notiz fasst bis zu {count} Bilder',
        readableGlobalHint: 'Nur die Notiz dieser Unterhaltung kann mit dem Modell geteilt werden',
        agentsConflict: 'Außerhalb dieses Bereichs geändert',
        agentsUseFile: 'Datei verwenden',
        agentsOverwrite: 'Überschreiben',
        agentsSaveFailed: 'Speichern fehlgeschlagen',
        agentsRetry: 'Erneut versuchen',
        agentsTooLarge: 'Zu groß, um es hier zu bearbeiten'
    },
    'pt-BR': {
        title: 'Notas',
        conversation: 'Nota · esta conversa',
        global: 'Nota · todas as conversas',
        placeholder: 'Escreva algo…',
        zoom: '{mod} + rolagem para o tamanho do texto',
        size: 'Texto {size}',
        modelReadable: 'O modelo pode ler',
        removeImage: 'Remover imagem',
        agentsTitle: 'AGENTS.md · Instruções do projeto',
        agentsHint: 'Regras permanentes lidas automaticamente em todas as conversas deste projeto (sincronizado com Configurações → Instruções de IA).',
        agentsPlaceholder: '# Instruções do projeto\n- Salvo como AGENTS.md na raiz do projeto…',
        agentsSaving: 'Salvando…',
        agentsSaved: 'Salvo',
        agentsOpen: 'Abrir no editor',
        imageTooLarge: 'Sem espaço para salvar a imagem',
        imageUnsupported: 'Este formato de imagem não é compatível',
        imageLimit: 'Uma nota comporta até {count} imagens',
        readableGlobalHint: 'Só a nota desta conversa pode ser compartilhada com o modelo',
        agentsConflict: 'Alterado fora deste painel',
        agentsUseFile: 'Usar arquivo',
        agentsOverwrite: 'Substituir',
        agentsSaveFailed: 'Não foi possível salvar',
        agentsRetry: 'Tentar novamente',
        agentsTooLarge: 'Grande demais para editar aqui'
    },
    ru: {
        title: 'Заметки',
        conversation: 'Заметка · эта беседа',
        global: 'Заметка · все беседы',
        placeholder: 'Напишите что-нибудь…',
        zoom: '{mod} + колесо — размер текста',
        size: 'Текст {size}',
        modelReadable: 'Доступно модели для чтения',
        removeImage: 'Удалить изображение',
        agentsTitle: 'AGENTS.md · Инструкции проекта',
        agentsHint: 'Постоянные правила, автоматически читаемые в каждом диалоге этого проекта (синхронизировано с Настройки → Инструкции ИИ).',
        agentsPlaceholder: '# Инструкции проекта\n- Сохраняется как AGENTS.md в корне проекта…',
        agentsSaving: 'Сохранение…',
        agentsSaved: 'Сохранено',
        agentsOpen: 'Открыть в редакторе',
        imageTooLarge: 'Недостаточно места, изображение не сохранено',
        imageUnsupported: 'Этот формат изображений не поддерживается',
        imageLimit: 'В заметке может быть не более {count} изображений',
        readableGlobalHint: 'Модели можно открыть только заметку этой беседы',
        agentsConflict: 'Файл изменён в другом месте',
        agentsUseFile: 'Взять из файла',
        agentsOverwrite: 'Перезаписать',
        agentsSaveFailed: 'Не удалось сохранить',
        agentsRetry: 'Повторить',
        agentsTooLarge: 'Файл слишком большой для редактирования здесь'
    },
    ar: {
        title: 'ملاحظات',
        conversation: 'ملاحظة · هذه المحادثة',
        global: 'ملاحظة · كل المحادثات',
        placeholder: 'اكتب شيئًا…',
        zoom: '{mod} + التمرير لتغيير حجم النص',
        size: 'النص {size}',
        modelReadable: 'يمكن للنموذج القراءة',
        removeImage: 'حذف الصورة',
        agentsTitle: 'AGENTS.md · تعليمات المشروع',
        agentsHint: 'قواعد دائمة تُقرأ تلقائيًا في كل محادثة لهذا المشروع (متزامنة مع الإعدادات ← تعليمات الذكاء الاصطناعي).',
        agentsPlaceholder: '# تعليمات المشروع\n- تُحفظ باسم AGENTS.md في جذر المشروع…',
        agentsSaving: 'جارٍ الحفظ…',
        agentsSaved: 'تم الحفظ',
        agentsOpen: 'فتح في المحرر',
        imageTooLarge: 'لا توجد مساحة كافية لحفظ الصورة',
        imageUnsupported: 'تنسيق الصورة هذا غير مدعوم',
        imageLimit: 'تتسع الملاحظة لما يصل إلى {count} صورة',
        readableGlobalHint: 'يمكن مشاركة ملاحظة هذه المحادثة فقط مع النموذج',
        agentsConflict: 'تم تعديله خارج هذه اللوحة',
        agentsUseFile: 'استخدام الملف',
        agentsOverwrite: 'استبدال',
        agentsSaveFailed: 'تعذّر الحفظ',
        agentsRetry: 'إعادة المحاولة',
        agentsTooLarge: 'أكبر من أن يُحرَّر هنا'
    },
    hi: {
        title: 'नोट्स',
        conversation: 'नोट · यह बातचीत',
        global: 'नोट · सभी बातचीत',
        placeholder: 'कुछ लिखें…',
        zoom: '{mod} + स्क्रॉल से टेक्स्ट आकार',
        size: 'टेक्स्ट {size}',
        modelReadable: 'मॉडल पढ़ सकता है',
        removeImage: 'छवि हटाएँ',
        agentsTitle: 'AGENTS.md · प्रोजेक्ट निर्देश',
        agentsHint: 'इस प्रोजेक्ट की हर बातचीत में अपने-आप पढ़े जाने वाले स्थायी नियम (सेटिंग्स → AI निर्देश के साथ सिंक)।',
        agentsPlaceholder: '# प्रोजेक्ट निर्देश\n- प्रोजेक्ट रूट में AGENTS.md के रूप में सहेजा जाता है…',
        agentsSaving: 'सहेजा जा रहा है…',
        agentsSaved: 'सहेजा गया',
        agentsOpen: 'एडिटर में खोलें',
        imageTooLarge: 'छवि सहेजने के लिए पर्याप्त जगह नहीं है',
        imageUnsupported: 'यह छवि प्रारूप समर्थित नहीं है',
        imageLimit: 'एक नोट में अधिकतम {count} छवियाँ हो सकती हैं',
        readableGlobalHint: 'मॉडल के साथ केवल इस बातचीत का नोट साझा किया जा सकता है',
        agentsConflict: 'इस पैनल के बाहर बदला गया',
        agentsUseFile: 'फ़ाइल का संस्करण उपयोग करें',
        agentsOverwrite: 'ओवरराइट करें',
        agentsSaveFailed: 'सहेजा नहीं जा सका',
        agentsRetry: 'फिर से कोशिश करें',
        agentsTooLarge: 'यहाँ संपादित करने के लिए बहुत बड़ा'
    }
};

function read(key: string): string {
    try {
        return typeof window !== 'undefined' && window.localStorage ? (window.localStorage.getItem(key) || '') : '';
    } catch {
        return '';
    }
}

function write(key: string, value: string): void {
    try {
        if (typeof window === 'undefined' || !window.localStorage) return;
        if (value) window.localStorage.setItem(key, value.slice(0, MAX_LENGTH));
        else window.localStorage.removeItem(key);
    } catch { /* keep the text in memory */ }
}

/** False when the browser refused the write (storage full): the caller keeps the previous stored state. */
function writeRawJson(key: string, value: unknown): boolean {
    try {
        if (typeof window === 'undefined' || !window.localStorage) return false;
        if (value === undefined || value === null) {
            window.localStorage.removeItem(key);
        } else {
            window.localStorage.setItem(key, JSON.stringify(value));
        }
        return true;
    } catch {
        return false;
    }
}

interface StoredNoteMeta {
    readonly images?: readonly ThreadNoteImageItem[];
    readonly modelReadable?: boolean;
    readonly digest?: string;
    readonly updatedAt?: number;
    readonly readableCycleId?: number;
}

function readMeta(metaKey: string): StoredNoteMeta {
    const raw = read(metaKey);
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw) as StoredNoteMeta;
        if (!parsed || typeof parsed !== 'object') return {};
        const images = Array.isArray(parsed.images)
            ? parsed.images.filter((img): img is ThreadNoteImageItem => Boolean(img && typeof img.id === 'string' && ((typeof img.dataUrl === 'string' && img.dataUrl) || (typeof img.filePath === 'string' && img.filePath))))
            : [];
        const modelReadable = Boolean(parsed.modelReadable);
        const readableCycleId = typeof parsed.readableCycleId === 'number' && Number.isFinite(parsed.readableCycleId) && parsed.readableCycleId >= 0
            ? Math.floor(parsed.readableCycleId)
            : (modelReadable ? 1 : 0);
        return {
            images,
            modelReadable,
            digest: typeof parsed.digest === 'string' ? parsed.digest : undefined,
            updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
            readableCycleId
        };
    } catch {
        return {};
    }
}

function writeMeta(metaKey: string, meta: StoredNoteMeta, isGlobal = false): boolean {
    const images = Array.isArray(meta.images) ? meta.images.slice(0, THREAD_NOTE_MAX_IMAGES) : [];
    const modelReadable = isGlobal ? false : Boolean(meta.modelReadable);
    const readableCycleId = isGlobal
        ? 0
        : (typeof meta.readableCycleId === 'number' && Number.isFinite(meta.readableCycleId) ? Math.max(0, Math.floor(meta.readableCycleId)) : (modelReadable ? 1 : 0));
    if (images.length === 0 && !modelReadable && !meta.digest && readableCycleId === 0) {
        return writeRawJson(metaKey, undefined);
    }
    return writeRawJson(metaKey, {
        images,
        modelReadable,
        digest: meta.digest || '',
        updatedAt: typeof meta.updatedAt === 'number' && Number.isFinite(meta.updatedAt) ? meta.updatedAt : Date.now(),
        readableCycleId
    });
}

function writeNote(key: string, value: string): void {
    write(key, hasThreadNoteContent(value) ? value : '');
}

function dispatchThreadNoteUpdated(conversationId: string, state: ThreadNoteState): void {
    if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
        window.dispatchEvent(new CustomEvent('nextmux:thread-note-updated', {
            detail: { conversationId, state }
        }));
    }
}

/**
 * Reads the full sticky note state (`text`, `images`, `modelReadable`, `digest`, `updatedAt`, `readableCycleId`) for a conversation.
 */
export function readConversationThreadNoteState(conversationId: string): ThreadNoteState {
    if (!conversationId) {
        return createThreadNoteState();
    }
    const rawText = read(`${CONVERSATION_PREFIX}${conversationId}`);
    const text = hasThreadNoteContent(rawText) ? rawText : '';
    const meta = readMeta(`${CONVERSATION_META_PREFIX}${conversationId}`);
    const images = meta.images ?? [];
    const modelReadable = Boolean(meta.modelReadable);
    const digest = computeThreadNoteDigest(text, images);
    const readableCycleId = typeof meta.readableCycleId === 'number' && Number.isFinite(meta.readableCycleId)
        ? meta.readableCycleId
        : (modelReadable ? 1 : 0);
    return {
        text,
        images,
        modelReadable,
        digest,
        updatedAt: meta.updatedAt ?? 0,
        readableCycleId
    };
}

/**
 * Reads the global sticky note state (`modelReadable` is always `false`).
 */
export function readGlobalThreadNoteState(): ThreadNoteState {
    const rawText = read(GLOBAL_KEY);
    const text = hasThreadNoteContent(rawText) ? rawText : '';
    const meta = readMeta(GLOBAL_META_KEY);
    const images = meta.images ?? [];
    const digest = computeThreadNoteDigest(text, images);
    return {
        text,
        images,
        modelReadable: false,
        digest,
        updatedAt: meta.updatedAt ?? 0,
        readableCycleId: 0
    };
}

/**
 * Updates a conversation's sticky note state in localStorage and notifies all open listeners.
 * Defaults to `mode: 'append'` so existing text and images are preserved unless `mode: 'replace'` is explicitly passed.
 */
export function writeConversationThreadNoteState(
    conversationId: string,
    update: {
        readonly text?: string;
        readonly images?: readonly ThreadNoteImageItem[];
        readonly modelReadable?: boolean;
        readonly mode?: 'append' | 'replace';
    }
): ThreadNoteState {
    const current = readConversationThreadNoteState(conversationId);
    if (!conversationId) {
        return current;
    }
    const nextState = mergeThreadNoteUpdate(current, {
        ...update,
        mode: update.mode === 'replace' ? 'replace' : 'append',
        updatedAt: Date.now()
    });
    // Images and the "Model can read" flag live in one entry: write it first, so a full storage changes nothing.
    if (!writeMeta(`${CONVERSATION_META_PREFIX}${conversationId}`, {
        images: nextState.images,
        modelReadable: nextState.modelReadable,
        digest: nextState.digest,
        updatedAt: nextState.updatedAt,
        readableCycleId: nextState.readableCycleId
    }, false)) {
        throw new Error('NOTE_STORAGE_FULL');
    }
    writeNote(`${CONVERSATION_PREFIX}${conversationId}`, nextState.text);
    dispatchThreadNoteUpdated(conversationId, nextState);
    return nextState;
}

/** The notes surface's own name, for labels outside the notes panel. */
export function threadNotesTitle(locale: NextMuxDesktopLocale): string {
    return (copy[locale] || copy.en).title;
}

/** The 3rd floating panel's title, e.g. "AGENTS.md · Project instructions". */
export function threadProjectAgentsTitle(locale: NextMuxDesktopLocale = 'zh-CN'): string {
    return (copy[locale] || copy.en).agentsTitle;
}

/** The names the notes surfaces show, so the model can point the user to them in the user's words. */
export function threadNoteLabels(locale: NextMuxDesktopLocale): { readonly conversation: string; readonly global: string; readonly modelReadable: string; readonly agents: string } {
    const t = copy[locale] || copy.en;
    return { conversation: t.conversation, global: t.global, modelReadable: t.modelReadable, agents: t.agentsTitle };
}

export function clampNoteFont(size: number): number {
    return Math.max(NOTE_FONT_MIN, Math.min(NOTE_FONT_MAX, Math.round(size)));
}

function readFont(): number {
    const value = Number(read(FONT_KEY));
    return Number.isFinite(value) && value > 0 ? clampNoteFont(value) : NOTE_FONT_DEFAULT;
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
        reader.onerror = () => reject(reader.error || new Error('Failed to read pasted image'));
        reader.readAsDataURL(blob);
    });
}

function extractClipboardImageFiles(clipboardData: DataTransfer | null | undefined): File[] {
    if (!clipboardData) return [];
    const files: File[] = [];
    const seen = new Set<string>();
    if (clipboardData.items) {
        for (let i = 0; i < clipboardData.items.length; i++) {
            const item = clipboardData.items[i];
            if (item && item.kind === 'file' && item.type.startsWith('image/')) {
                const file = item.getAsFile();
                if (file) {
                    const key = `${file.name}:${file.size}:${file.type}:${file.lastModified}`;
                    if (!seen.has(key)) {
                        seen.add(key);
                        files.push(file);
                    }
                }
            }
        }
    }
    if (files.length === 0 && clipboardData.files) {
        for (let i = 0; i < clipboardData.files.length; i++) {
            const file = clipboardData.files[i];
            if (file && file.type.startsWith('image/')) {
                const key = `${file.name}:${file.size}:${file.type}:${file.lastModified}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    files.push(file);
                }
            }
        }
    }
    return files;
}

/** The image types every model API and the runtime accept; anything else is re-encoded on paste. */
const NOTE_IMAGE_TYPES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
/** Longest edge a pasted image keeps: screenshots stay legible to the model and in the viewer. */
const NOTE_IMAGE_MAX_EDGE = 1600;
/** Stored size per image: every conversation's notes share the window's local storage (about 10 MB). */
const NOTE_IMAGE_MAX_DATA_URL = 700_000;

export type NormalizedNoteImage = { readonly dataUrl: string; readonly mimeType: string } | 'unsupported' | 'tooLarge';

/** Keeps a small, accepted image as pasted; otherwise scales it to NOTE_IMAGE_MAX_EDGE and re-encodes it as WebP. */
export async function normalizeNoteImage(file: Blob): Promise<NormalizedNoteImage> {
    if (NOTE_IMAGE_TYPES.has(file.type) && file.size * 4 / 3 + 64 <= NOTE_IMAGE_MAX_DATA_URL) {
        const dataUrl = await readBlobAsDataUrl(file);
        if (dataUrl.startsWith(`data:${file.type};base64,`)) return { dataUrl, mimeType: file.type };
    }
    let bitmap: ImageBitmap;
    try {
        bitmap = await createImageBitmap(file);
    } catch {
        return 'unsupported';
    }
    try {
        let scale = Math.min(1, NOTE_IMAGE_MAX_EDGE / Math.max(bitmap.width, bitmap.height, 1));
        for (let attempt = 0; attempt < 4; attempt++) {
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(bitmap.width * scale));
            canvas.height = Math.max(1, Math.round(bitmap.height * scale));
            const context = canvas.getContext('2d');
            if (!context) return 'unsupported';
            context.imageSmoothingQuality = 'high';
            context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/webp', attempt === 0 ? 0.9 : 0.82);
            // A browser without a WebP encoder returns PNG instead.
            const mimeType = dataUrl.startsWith('data:image/webp;') ? 'image/webp' : 'image/png';
            if (dataUrl.length <= NOTE_IMAGE_MAX_DATA_URL) return { dataUrl, mimeType };
            scale *= 0.72;
        }
        return 'tooLarge';
    } finally {
        bitmap.close();
    }
}

function NoteBox(props: {
    readonly title: string;
    readonly storageKey: string;
    readonly metaStorageKey: string;
    readonly conversationId?: string;
    readonly locale: NextMuxDesktopLocale;
    readonly global?: boolean;
    readonly fontSize: number;
    readonly onFontSize: (size: number) => void;
    readonly onContentChange?: () => void;
    readonly onOpenImage?: (name: string, dataUrl: string) => void;
}): React.ReactElement {
    const kind = props.global ? 'global' : 'conversation';
    const [height, setHeight] = React.useState(() => readHeight(kind));
    const [maxHeight, setMaxHeight] = React.useState<number | undefined>(undefined);
    const t = copy[props.locale] || copy.en;
    const [value, setValue] = React.useState(() => {
        const stored = read(props.storageKey);
        return hasThreadNoteContent(stored) ? stored : '';
    });
    const [images, setImages] = React.useState<readonly ThreadNoteImageItem[]>(() => readMeta(props.metaStorageKey).images ?? []);
    const [modelReadable, setModelReadable] = React.useState<boolean>(() => props.global ? false : Boolean(readMeta(props.metaStorageKey).modelReadable));
    const [sizeBadge, setSizeBadge] = React.useState(false);
    const [notice, setNotice] = React.useState('');
    const noticeTimer = React.useRef<number | undefined>(undefined);
    const area = React.useRef<HTMLTextAreaElement>(null);
    const imageStrip = React.useRef<HTMLDivElement>(null);
    const saveTimer = React.useRef<number | undefined>(undefined);
    const latest = React.useRef(value);
    const latestImages = React.useRef(images);
    latestImages.current = images;
    const latestReadable = React.useRef(modelReadable);
    latestReadable.current = modelReadable;
    const readableCycleRef = React.useRef<number>(props.global ? 0 : (readMeta(props.metaStorageKey).readableCycleId ?? (modelReadable ? 1 : 0)));
    const fontRef = React.useRef(props.fontSize);
    fontRef.current = props.fontSize;

    /** Saves the note; false when the storage refused the images/flag entry (then nothing changed and nothing is announced). */
    const persistAll = React.useCallback((nextText: string, nextImages: readonly ThreadNoteImageItem[], nextReadable: boolean, notifyExternal = true, nextCycleId?: number): boolean => {
        const cleanText = hasThreadNoteContent(nextText) ? nextText : '';
        const effectiveReadable = props.global ? false : nextReadable;
        const cycleId = props.global ? 0 : (nextCycleId ?? readableCycleRef.current ?? (effectiveReadable ? 1 : 0));
        const digest = computeThreadNoteDigest(cleanText, nextImages);
        const updatedAt = Date.now();
        if (!writeMeta(props.metaStorageKey, {
            images: nextImages,
            modelReadable: effectiveReadable,
            digest,
            updatedAt,
            readableCycleId: cycleId
        }, Boolean(props.global))) return false;
        readableCycleRef.current = cycleId;
        writeNote(props.storageKey, cleanText);
        props.onContentChange?.();
        if (notifyExternal && !props.global && props.conversationId) {
            dispatchThreadNoteUpdated(props.conversationId, {
                text: cleanText,
                images: nextImages,
                modelReadable: effectiveReadable,
                digest,
                updatedAt,
                readableCycleId: cycleId
            });
        }
        return true;
    }, [props.storageKey, props.metaStorageKey, props.global, props.conversationId, props.onContentChange]);

    const flashNotice = (text: string): void => {
        setNotice(text);
        window.clearTimeout(noticeTimer.current);
        noticeTimer.current = window.setTimeout(() => setNotice(''), 3200);
    };
    React.useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

    React.useEffect(() => {
        const stored = read(props.storageKey);
        const hasContent = hasThreadNoteContent(stored);
        const isFocused = Boolean(area.current && document.activeElement === area.current);
        const next = hasContent ? stored : (isFocused ? '1. ' : '');
        setValue(next);
        latest.current = next;
        const meta = readMeta(props.metaStorageKey);
        const nextImgs = meta.images ?? [];
        const nextRead = props.global ? false : Boolean(meta.modelReadable);
        const nextCycle = props.global ? 0 : (meta.readableCycleId ?? (nextRead ? 1 : 0));
        setImages(nextImgs);
        latestImages.current = nextImgs;
        setModelReadable(nextRead);
        latestReadable.current = nextRead;
        readableCycleRef.current = nextCycle;
    }, [props.storageKey, props.metaStorageKey, props.global]);

    // Sync across windows and with external `writeConversationThreadNoteState` calls (e.g. `nextmux.notes.write`).
    React.useEffect(() => {
        const onStorage = (event: StorageEvent): void => {
            if (event.key === props.storageKey && document.activeElement !== area.current) {
                const next = hasThreadNoteContent(event.newValue) ? (event.newValue || '') : '';
                setValue(next);
                latest.current = next;
                props.onContentChange?.();
            } else if (event.key === props.metaStorageKey) {
                const meta = readMeta(props.metaStorageKey);
                const nextImgs = meta.images ?? [];
                const nextRead = props.global ? false : Boolean(meta.modelReadable);
                const nextCycle = props.global ? 0 : (meta.readableCycleId ?? (nextRead ? 1 : 0));
                setImages(nextImgs);
                latestImages.current = nextImgs;
                setModelReadable(nextRead);
                latestReadable.current = nextRead;
                readableCycleRef.current = nextCycle;
                props.onContentChange?.();
            }
        };
        const onNoteUpdated = (event: Event): void => {
            if (props.global || !props.conversationId) return;
            const detail = (event as CustomEvent<{ conversationId?: string; state?: ThreadNoteState }>).detail;
            if (!detail || detail.conversationId !== props.conversationId) return;
            const state = detail.state ?? readConversationThreadNoteState(props.conversationId);
            if (document.activeElement !== area.current || state.text !== (hasThreadNoteContent(latest.current) ? latest.current : '')) {
                setValue(state.text);
                latest.current = state.text;
            }
            setImages(state.images);
            latestImages.current = state.images;
            setModelReadable(state.modelReadable);
            latestReadable.current = state.modelReadable;
            if (typeof state.readableCycleId === 'number') {
                readableCycleRef.current = state.readableCycleId;
            }
            props.onContentChange?.();
        };
        window.addEventListener('storage', onStorage);
        window.addEventListener('nextmux:thread-note-updated', onNoteUpdated);
        return () => {
            window.removeEventListener('storage', onStorage);
            window.removeEventListener('nextmux:thread-note-updated', onNoteUpdated);
        };
    }, [props.storageKey, props.metaStorageKey, props.global, props.conversationId, props.onContentChange]);

    React.useEffect(() => () => {
        if (saveTimer.current !== undefined) {
            window.clearTimeout(saveTimer.current);
            saveTimer.current = undefined;
            persistAll(latest.current, latestImages.current, latestReadable.current);
        }
    }, [persistAll]);

    React.useEffect(() => {
        const element = area.current;
        if (!element) return;
        let badgeTimer: number | undefined;
        // Native, non-passive: React's wheel listener cannot cancel the window zoom.
        const onWheel = (event: WheelEvent): void => {
            if (!event.ctrlKey && !event.metaKey) return;
            event.preventDefault();
            event.stopPropagation();
            const step = event.deltaY < 0 ? 1 : event.deltaY > 0 ? -1 : 0;
            if (!step) return;
            props.onFontSize(clampNoteFont(fontRef.current + step));
            setSizeBadge(true);
            window.clearTimeout(badgeTimer);
            badgeTimer = window.setTimeout(() => setSizeBadge(false), 900);
        };
        element.addEventListener('wheel', onWheel, { passive: false });
        return () => { element.removeEventListener('wheel', onWheel); window.clearTimeout(badgeTimer); };
    }, [props.onFontSize]);

    const change = (next: string, persist = true): void => {
        setValue(next);
        latest.current = next;
        if (saveTimer.current !== undefined) {
            window.clearTimeout(saveTimer.current);
            saveTimer.current = undefined;
        }
        if (!persist || !hasThreadNoteContent(next)) {
            persistAll('', latestImages.current, latestReadable.current, persist);
            return;
        }
        saveTimer.current = window.setTimeout(() => {
            saveTimer.current = undefined;
            persistAll(latest.current, latestImages.current, latestReadable.current, true);
        }, 300);
    };

    const appendPastedImages = async (files: File[]): Promise<void> => {
        const room = THREAD_NOTE_MAX_IMAGES - latestImages.current.length;
        if (room <= 0) {
            flashNotice(t.imageLimit.replace('{count}', String(THREAD_NOTE_MAX_IMAGES)));
            return;
        }
        const added: ThreadNoteImageItem[] = [];
        let failure: 'unsupported' | 'tooLarge' | undefined;
        for (const file of files.slice(0, room)) {
            try {
                const image = await normalizeNoteImage(file);
                if (typeof image === 'string') { failure = image; continue; }
                const now = Date.now();
                added.push({
                    id: `${THREAD_NOTE_IMAGE_ID_PREFIX}${now}-${Math.random().toString(36).slice(2, 8)}`,
                    name: file.name || `image-${now}.${image.mimeType.slice('image/'.length)}`,
                    mimeType: image.mimeType,
                    dataUrl: image.dataUrl,
                    createdAt: now
                });
            } catch { failure = 'unsupported'; }
        }
        if (files.length > room) flashNotice(t.imageLimit.replace('{count}', String(THREAD_NOTE_MAX_IMAGES)));
        else if (failure) flashNotice(failure === 'unsupported' ? t.imageUnsupported : t.imageTooLarge);
        if (!added.length) return;
        const nextImages = [...latestImages.current, ...added].slice(0, THREAD_NOTE_MAX_IMAGES);
        // Storage full: the note keeps its saved images and "Model can read" flag, and says why the image is missing.
        if (!persistAll(latest.current, nextImages, latestReadable.current, true)) {
            flashNotice(t.imageTooLarge);
            return;
        }
        setImages(nextImages);
        latestImages.current = nextImages;
    };

    const removeImage = (id: string, refocus = false): void => {
        const index = latestImages.current.findIndex(img => img.id === id);
        const nextImages = latestImages.current.filter(img => img.id !== id);
        setImages(nextImages);
        latestImages.current = nextImages;
        persistAll(latest.current, nextImages, latestReadable.current, true);
        if (!refocus) return;
        requestAnimationFrame(() => {
            const thumbs = imageStrip.current?.querySelectorAll<HTMLButtonElement>('.nmx-thread-note-thumb-open');
            const next = thumbs?.[Math.min(index, thumbs.length - 1)];
            (next || area.current)?.focus({ preventScroll: true });
        });
    };

    const toggleModelReadable = (checked: boolean): void => {
        if (props.global) return;
        const wasReadable = latestReadable.current;
        const nextCycleId = (!wasReadable && checked)
            ? (readableCycleRef.current || 0) + 1
            : (checked && !readableCycleRef.current ? 1 : (readableCycleRef.current || 0));
        if (!persistAll(latest.current, latestImages.current, checked, true, nextCycleId)) {
            flashNotice(t.imageTooLarge);
            return;
        }
        setModelReadable(checked);
        latestReadable.current = checked;
    };

    /** Apply an edit made by the list helpers, keeping undo-free caret placement. */
    const applyEdit = (edit: { value: string; caret: number }): void => {
        change(edit.value);
        requestAnimationFrame(() => { area.current?.setSelectionRange(edit.caret, edit.caret); });
    };

    const keyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
        if (event.nativeEvent.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey) return;
        const target = event.currentTarget;
        if (event.key === 'Enter' && !event.shiftKey) {
            const edit = continueNoteList(target.value, target.selectionStart, target.selectionEnd);
            if (edit) { event.preventDefault(); applyEdit(edit); }
        } else if (event.key === 'Backspace' && !event.shiftKey && target.selectionStart === target.selectionEnd) {
            const edit = removeNoteListMarker(target.value, target.selectionStart);
            if (edit) { event.preventDefault(); applyEdit(edit); }
        }
    };

    // Resizing a note keeps the float open (focus-within) and remembers the height for every conversation.
    // Only a press on the native grip (the bottom corner) resizes; an ordinary click to type bounds nothing.
    const beginResize = (event: React.PointerEvent<HTMLTextAreaElement>): void => {
        const element = area.current;
        if (!element) return;
        const box = element.getBoundingClientRect();
        const rtl = getComputedStyle(element).direction === 'rtl';
        if (event.clientY < box.bottom - 18 || (rtl ? event.clientX > box.left + 18 : event.clientX < box.right - 18)) return;
        if (document.activeElement !== element) element.focus({ preventScroll: true });
        const before = element.offsetHeight;
        // A note can only grow into the room the float has left (its box ends at the composer).
        const float = element.closest<HTMLElement>('.nmx-thread-notes-float');
        const notes = element.closest<HTMLElement>('.nmx-thread-notes');
        const floatHeight = float?.getBoundingClientRect().height || (typeof window !== 'undefined' ? window.innerHeight - 64 : 600);
        const viewportMax = Math.max(NOTE_HEIGHT_MIN, Math.floor((floatHeight - 96) / 2));
        const spare = float && notes ? Math.max(0, float.getBoundingClientRect().bottom - notes.getBoundingClientRect().bottom) : viewportMax;
        const boundedMax = Math.max(NOTE_HEIGHT_MIN, Math.min(NOTE_HEIGHT_MAX, viewportMax, before + spare));
        setMaxHeight(boundedMax);
        element.style.maxHeight = `${boundedMax}px`;
        const end = (): void => {
            window.removeEventListener('pointerup', end, true);
            window.removeEventListener('pointercancel', end, true);
            const after = area.current?.offsetHeight;
            if (after && after !== before) {
                const clamped = Math.max(NOTE_HEIGHT_MIN, Math.min(boundedMax, after));
                setHeight(clamped);
                write(HEIGHT_KEYS[kind], String(clamped));
            }
            // The room is measured again at the next drag; between drags only the CSS ceiling applies.
            setMaxHeight(undefined);
            if (area.current) area.current.style.maxHeight = '';
        };
        window.addEventListener('pointerup', end, true);
        window.addEventListener('pointercancel', end, true);
    };

    const mac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent);
    return <div className={`nmx-thread-note ${props.global ? 'is-global' : ''}`} data-nmx-literal>
        <span className='nmx-thread-note-title' onClick={() => area.current?.focus()}>
            <i className={`codicon codicon-${props.global ? 'globe' : 'note'}`} aria-hidden='true'></i>{props.title}
        </span>
        <textarea ref={area} value={value} maxLength={MAX_LENGTH} spellCheck={false} placeholder={`1. ${t.placeholder}`}
            title={t.zoom.replace('{mod}', mac ? '⌘' : 'Ctrl')} aria-label={props.title}
            style={{ fontSize: `${props.fontSize}px`, ...(height ? { height: `${height}px` } : {}), ...(maxHeight ? { maxHeight: `${maxHeight}px` } : {}) }}
            onChange={event => change(event.currentTarget.value)}
            onKeyDown={keyDown}
            onPointerDown={beginResize}
            onPaste={event => {
                const imageFiles = extractClipboardImageFiles(event.clipboardData);
                if (imageFiles.length > 0) {
                    event.preventDefault();
                    void appendPastedImages(imageFiles);
                    return;
                }
                if (!hasThreadNoteContent(latest.current) && latest.current.startsWith('1.')) {
                    const pasted = event.clipboardData?.getData('text/plain') || '';
                    if (NUMBERED_LINE.test(pasted.trimStart())) {
                        event.preventDefault();
                        const next = pasted.trimStart().slice(0, MAX_LENGTH);
                        change(next);
                        requestAnimationFrame(() => area.current?.setSelectionRange(next.length, next.length));
                    }
                }
            }}
            // An empty note starts as a numbered list in memory without saving to storage until actual text is typed; an untouched “1. ” is removed on blur.
            onFocus={event => {
                if (!event.currentTarget.value) {
                    change('1. ', false);
                    const element = event.currentTarget;
                    requestAnimationFrame(() => element.setSelectionRange(3, 3));
                }
            }}
            onBlur={event => {
                if (saveTimer.current !== undefined) {
                    window.clearTimeout(saveTimer.current);
                    saveTimer.current = undefined;
                }
                if (!hasThreadNoteContent(latest.current)) {
                    event.currentTarget.value = '';
                    setValue('');
                    latest.current = '';
                    persistAll('', latestImages.current, latestReadable.current, false);
                } else {
                    persistAll(latest.current, latestImages.current, latestReadable.current, true);
                }
            }} />
        {images.length > 0 && <div ref={imageStrip} className='nmx-thread-note-images'>
            {images.map(img => <div key={img.id} className='nmx-thread-note-thumb'>
                <button type='button' className='nmx-thread-note-thumb-open' title={img.name} aria-label={img.name}
                    onClick={event => {
                        event.preventDefault();
                        event.stopPropagation();
                        props.onOpenImage?.(img.name, img.dataUrl);
                    }}
                    onKeyDown={event => {
                        if (event.key !== 'Delete' && event.key !== 'Backspace') return;
                        event.preventDefault();
                        event.stopPropagation();
                        removeImage(img.id, true);
                    }}>
                    <img src={img.dataUrl} alt='' draggable={false} decoding='async' />
                </button>
                <button type='button' className='nmx-thread-note-thumb-remove' aria-label={t.removeImage} title={t.removeImage} tabIndex={-1}
                    onClick={event => {
                        event.preventDefault();
                        event.stopPropagation();
                        removeImage(img.id);
                    }}>
                    <i className='codicon codicon-close' aria-hidden='true'></i>
                </button>
            </div>)}
        </div>}
        {notice && <span className='nmx-thread-note-notice' role='status' aria-live='polite'>
            <i className='codicon codicon-warning' aria-hidden='true'></i>{notice}
        </span>}
        {!props.global ? (
            <label className='nmx-thread-note-readable' onClick={event => event.stopPropagation()}>
                <input type='checkbox' checked={modelReadable} onChange={event => toggleModelReadable(event.currentTarget.checked)} />
                <span>{t.modelReadable}</span>
            </label>
        ) : (
            <label className='nmx-thread-note-readable is-disabled' aria-disabled='true' title={t.readableGlobalHint} onClick={event => event.stopPropagation()}>
                <input type='checkbox' checked={false} disabled tabIndex={-1} readOnly />
                <span>{t.modelReadable}</span>
            </label>
        )}
        {sizeBadge && <span className='nmx-thread-note-size' aria-live='polite'>{t.size.replace('{size}', String(props.fontSize))}</span>}
    </div>;
}

/**
 * The two notes inside the notes float: the note for this conversation, then a dashed line on to
 * the note every conversation shares.
 */
export function ThreadNotes(props: {
    readonly locale: NextMuxDesktopLocale;
    readonly conversationId: string;
    readonly onNoteChange?: (conversationId: string, hasNotes: boolean) => void;
    readonly onOpenImage?: (name: string, dataUrl: string) => void;
}): React.ReactElement {
    const t = copy[props.locale] || copy.en;
    const [fontSize, setFontSize] = React.useState(readFont);
    const [fallbackPreview, setFallbackPreview] = React.useState<{ readonly name: string; readonly dataUrl: string } | undefined>(undefined);
    const panel = React.useRef<HTMLDivElement>(null);
    const lastHasNotes = React.useRef<boolean | undefined>(undefined);
    const syncHasNotes = React.useCallback(() => {
        const active = hasThreadNotes(props.conversationId);
        const float = panel.current?.closest<HTMLElement>('.nmx-thread-notes-float');
        const icon = float?.querySelector<HTMLElement>(':scope > .nmx-thread-float-tab .codicon-note');
        icon?.classList.toggle('has-notes', active);
        if (lastHasNotes.current !== active) {
            lastHasNotes.current = active;
            props.onNoteChange?.(props.conversationId, active);
        }
    }, [props.conversationId, props.onNoteChange]);
    React.useEffect(() => {
        lastHasNotes.current = hasThreadNotes(props.conversationId);
        syncHasNotes();
    }, [props.conversationId, syncHasNotes]);
    const onFontSize = React.useCallback((size: number) => { setFontSize(size); write(FONT_KEY, String(size)); }, []);
    const handleOpenImage = React.useCallback((name: string, dataUrl: string) => {
        if (props.onOpenImage) {
            props.onOpenImage(name, dataUrl);
        } else {
            setFallbackPreview({ name, dataUrl });
        }
    }, [props.onOpenImage]);
    return <div ref={panel} className='nmx-thread-notes'>
        <NoteBox
            title={t.conversation}
            storageKey={`${CONVERSATION_PREFIX}${props.conversationId}`}
            metaStorageKey={`${CONVERSATION_META_PREFIX}${props.conversationId}`}
            conversationId={props.conversationId}
            locale={props.locale}
            fontSize={fontSize}
            onFontSize={onFontSize}
            onContentChange={syncHasNotes}
            onOpenImage={handleOpenImage}
        />
        <span className='nmx-thread-note-link is-dashed' aria-hidden='true'></span>
        <NoteBox
            title={t.global}
            storageKey={GLOBAL_KEY}
            metaStorageKey={GLOBAL_META_KEY}
            locale={props.locale}
            global
            fontSize={fontSize}
            onFontSize={onFontSize}
            onContentChange={syncHasNotes}
            onOpenImage={handleOpenImage}
        />
        {fallbackPreview && <div className='nmx-thread-note-lightbox' role='dialog' aria-modal='true' aria-label={fallbackPreview.name} tabIndex={-1} autoFocus
            onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setFallbackPreview(undefined); } }}
            onClick={event => { event.stopPropagation(); setFallbackPreview(undefined); }}>
            <img src={fallbackPreview.dataUrl} alt={fallbackPreview.name} onClick={event => event.stopPropagation()} />
        </div>}
    </div>;
}

export interface ThreadProjectAgentsFloatProps {
    readonly locale: NextMuxDesktopLocale;
    readonly workspaceRoot: string;
    readonly api: Pick<NextMuxPlatformService, 'getAgentInstructions' | 'saveAgentInstructions'>;
    readonly onOpenFile?: (path: string) => void;
    readonly onStateChange?: (workspaceRoot: string, hasContent: boolean) => void;
}

/**
 * 3rd right-side floating panel for the current project's `AGENTS.md` file (shared 2-way with Settings → AI instructions → Project instructions).
 * The card title is always literally `AGENTS.md`.
 */
export function ThreadProjectAgentsFloat(props: ThreadProjectAgentsFloatProps): React.ReactElement {
    const t = copy[props.locale] || copy.en;
    const [fontSize, setFontSize] = React.useState(readFont);
    const [height, setHeight] = React.useState(() => readHeight('agents'));
    const [maxHeight, setMaxHeight] = React.useState<number | undefined>(undefined);
    const [draft, setDraft] = React.useState('');
    const [filePath, setFilePath] = React.useState('');
    const [truncated, setTruncated] = React.useState(false);
    const [saveStatus, setSaveStatus] = React.useState<'idle' | 'saving' | 'saved' | 'conflict' | 'error'>('idle');
    const [sizeBadge, setSizeBadge] = React.useState(false);

    const panel = React.useRef<HTMLDivElement>(null);
    const area = React.useRef<HTMLTextAreaElement>(null);
    const saveTimer = React.useRef<number | undefined>(undefined);
    const statusTimer = React.useRef<number | undefined>(undefined);
    const expectedShaRef = React.useRef<string>('');
    const loadedContentRef = React.useRef<string>('');
    const latestDraftRef = React.useRef<string>('');
    const dirtyRef = React.useRef<boolean>(false);
    const savingRef = React.useRef<boolean>(false);
    /** The version on disk that differs from both what this panel loaded and what the user is typing. */
    const conflictFileRef = React.useRef<AgentInstructionFile | undefined>(undefined);
    const fontRef = React.useRef(fontSize);
    fontRef.current = fontSize;

    const syncIndicator = React.useCallback((content: string) => {
        const hasContent = Boolean(content.trim());
        const float = panel.current?.closest<HTMLElement>('.nmx-thread-agents-float');
        const icon = float?.querySelector<HTMLElement>(':scope > .nmx-thread-float-tab .codicon-book, :scope > .nmx-thread-float-tab .codicon');
        icon?.classList.toggle('has-notes', hasContent);
        props.onStateChange?.(props.workspaceRoot, hasContent);
    }, [props.workspaceRoot, props.onStateChange]);

    const applySnapshotFile = React.useCallback((file: AgentInstructionFile | undefined) => {
        if (!file) return;
        expectedShaRef.current = file.sha256 || '';
        loadedContentRef.current = file.content || '';
        setFilePath(file.path || '');
        setTruncated(Boolean(file.truncated));
        // Only a different document replaces the text: the same one (or an untouched “1. ” on an empty file) keeps the caret.
        if (!dirtyRef.current && !sameInstructionText(agentInstructionContent(latestDraftRef.current), file.content)) {
            const text = agentInstructionEditorText(file.content);
            setDraft(text);
            latestDraftRef.current = text;
        }
        syncIndicator(file.content || '');
    }, [syncIndicator]);

    const lastLoadAtRef = React.useRef(0);
    const load = React.useCallback(async (force = false): Promise<void> => {
        if (!props.workspaceRoot || (dirtyRef.current && !force) || savingRef.current) return;
        const now = Date.now();
        if (!force && now - lastLoadAtRef.current < 1500) return;
        lastLoadAtRef.current = now;
        try {
            const snapshot = await props.api.getAgentInstructions(props.workspaceRoot);
            if (snapshot?.project) {
                applySnapshotFile(snapshot.project);
            }
        } catch { /* ignore transient read failures */ }
    }, [props.api, props.workspaceRoot, applySnapshotFile]);

    React.useEffect(() => {
        dirtyRef.current = false;
        void load(true);
    }, [props.workspaceRoot, load]);

    React.useEffect(() => {
        const float = panel.current?.closest<HTMLElement>('.nmx-thread-agents-float');
        if (!float) return;
        const onEnterOrFocus = (): void => {
            if (!dirtyRef.current && !savingRef.current) {
                void load(false);
            }
        };
        float.addEventListener('pointerenter', onEnterOrFocus);
        float.addEventListener('focusin', onEnterOrFocus);
        return () => {
            float.removeEventListener('pointerenter', onEnterOrFocus);
            float.removeEventListener('focusin', onEnterOrFocus);
        };
    }, [load]);

    const flushSave = React.useCallback(async (): Promise<void> => {
        if (saveTimer.current !== undefined) {
            window.clearTimeout(saveTimer.current);
            saveTimer.current = undefined;
        }
        if (!props.workspaceRoot || truncated || savingRef.current || conflictFileRef.current) return;
        // A note-style list that holds no text yet (“1. ”) is an empty file, as in the notes.
        const contentToSave = agentInstructionContent(latestDraftRef.current);
        if (!dirtyRef.current && sameInstructionText(contentToSave, loadedContentRef.current)) return;
        savingRef.current = true;
        setSaveStatus('saving');
        const save = (expectedSha256: string): Promise<AgentInstructionFile> => props.api.saveAgentInstructions({
            scope: 'project', workspaceRoot: props.workspaceRoot, content: contentToSave, expectedSha256
        });
        try {
            let saved: AgentInstructionFile;
            try {
                saved = await save(expectedShaRef.current);
            } catch (error) {
                // AGENTS.md is a project file: an editor, Settings in another window or the model may have saved it.
                // Never write over a version this panel has not seen; only a moved hash with unchanged text is retried.
                const fresh = (await props.api.getAgentInstructions(props.workspaceRoot).catch(() => undefined))?.project;
                if (!fresh || fresh.sha256 === expectedShaRef.current) throw error;
                if (sameInstructionText(fresh.content, contentToSave)) {
                    saved = fresh;
                } else if (sameInstructionText(fresh.content, loadedContentRef.current)) {
                    saved = await save(fresh.sha256);
                } else {
                    conflictFileRef.current = fresh;
                    setSaveStatus('conflict');
                    return;
                }
            }
            conflictFileRef.current = undefined;
            expectedShaRef.current = saved.sha256;
            loadedContentRef.current = saved.content;
            if (sameInstructionText(agentInstructionContent(latestDraftRef.current), contentToSave)) {
                dirtyRef.current = false;
            }
            syncIndicator(saved.content);
            setSaveStatus('saved');
            window.clearTimeout(statusTimer.current);
            statusTimer.current = window.setTimeout(() => setSaveStatus('idle'), 1800);
            if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
                window.dispatchEvent(new CustomEvent('nextmux:agent-instructions-saved', {
                    detail: { scope: 'project', workspaceRoot: props.workspaceRoot, file: saved }
                }));
            }
        } catch {
            // Unsaved text stays in the panel; the status says so and offers a retry.
            setSaveStatus('error');
        } finally {
            savingRef.current = false;
        }
    }, [props.api, props.workspaceRoot, truncated, syncIndicator]);

    /** Conflict: take the version on disk and drop this panel's unsaved text. */
    const useFileVersion = (): void => {
        const file = conflictFileRef.current;
        if (!file) return;
        conflictFileRef.current = undefined;
        window.clearTimeout(saveTimer.current);
        saveTimer.current = undefined;
        expectedShaRef.current = file.sha256;
        loadedContentRef.current = file.content;
        dirtyRef.current = false;
        const text = agentInstructionEditorText(file.content);
        setDraft(text);
        latestDraftRef.current = text;
        syncIndicator(file.content);
        setSaveStatus('idle');
    };

    /** Conflict: keep this panel's text and save it over the version on disk, which the user has now seen. */
    const overwriteFile = (): void => {
        const file = conflictFileRef.current;
        if (!file) return;
        conflictFileRef.current = undefined;
        expectedShaRef.current = file.sha256;
        loadedContentRef.current = file.content;
        dirtyRef.current = true;
        void flushSave();
    };

    React.useEffect(() => {
        const onSaved = (event: Event): void => {
            const detail = (event as CustomEvent<{ scope?: string; workspaceRoot?: string; file?: AgentInstructionFile }>).detail;
            if (!detail?.file || detail.workspaceRoot !== props.workspaceRoot) return;
            if (detail.file.scope && detail.file.scope !== 'project') return;
            const file = detail.file;
            setFilePath(file.path || '');
            setTruncated(Boolean(file.truncated));
            // Settings (or another window) saved a version this panel has not seen while it holds unsaved text: the next
            // debounced save must not write over it. The user chooses (useFileVersion / overwriteFile).
            if (dirtyRef.current && !sameInstructionText(agentInstructionContent(latestDraftRef.current), file.content) && file.sha256 !== expectedShaRef.current) {
                if (saveTimer.current !== undefined) {
                    window.clearTimeout(saveTimer.current);
                    saveTimer.current = undefined;
                }
                conflictFileRef.current = file;
                setSaveStatus('conflict');
                return;
            }
            const conflictEnded = conflictFileRef.current !== undefined;
            conflictFileRef.current = undefined;
            expectedShaRef.current = file.sha256;
            loadedContentRef.current = file.content;
            const sameDocument = sameInstructionText(agentInstructionContent(latestDraftRef.current), file.content);
            if (!dirtyRef.current || sameDocument) {
                dirtyRef.current = false;
                // This panel's own save comes back here with the writer's trailing newline: the text stays as typed.
                // Only another surface's different version replaces it, keeping the caret where it was.
                if (!sameDocument) {
                    const text = agentInstructionEditorText(file.content);
                    const element = area.current;
                    const caret = element && document.activeElement === element ? [element.selectionStart, element.selectionEnd] as const : undefined;
                    setDraft(text);
                    latestDraftRef.current = text;
                    if (caret) requestAnimationFrame(() => { if (area.current) area.current.setSelectionRange(Math.min(caret[0], text.length), Math.min(caret[1], text.length)); });
                }
            }
            syncIndicator(agentInstructionContent(latestDraftRef.current));
            // The file now matches this text, or is back at the version it was loaded from: nothing left to choose.
            if (conflictEnded) {
                setSaveStatus('idle');
                if (dirtyRef.current && saveTimer.current === undefined) {
                    saveTimer.current = window.setTimeout(() => {
                        saveTimer.current = undefined;
                        void flushSave();
                    }, 450);
                }
            }
        };
        window.addEventListener('nextmux:agent-instructions-saved', onSaved);
        return () => window.removeEventListener('nextmux:agent-instructions-saved', onSaved);
    }, [props.workspaceRoot, syncIndicator, flushSave]);

    React.useEffect(() => () => {
        window.clearTimeout(statusTimer.current);
        if (saveTimer.current !== undefined) {
            window.clearTimeout(saveTimer.current);
            saveTimer.current = undefined;
            void flushSave();
        }
    }, [flushSave]);

    React.useEffect(() => {
        const element = area.current;
        if (!element) return;
        let badgeTimer: number | undefined;
        const onWheel = (event: WheelEvent): void => {
            if (!event.ctrlKey && !event.metaKey) return;
            event.preventDefault();
            event.stopPropagation();
            const step = event.deltaY < 0 ? 1 : event.deltaY > 0 ? -1 : 0;
            if (!step) return;
            const nextSize = clampNoteFont(fontRef.current + step);
            setFontSize(nextSize);
            write(FONT_KEY, String(nextSize));
            setSizeBadge(true);
            window.clearTimeout(badgeTimer);
            badgeTimer = window.setTimeout(() => setSizeBadge(false), 900);
        };
        element.addEventListener('wheel', onWheel, { passive: false });
        return () => { element.removeEventListener('wheel', onWheel); window.clearTimeout(badgeTimer); };
    }, []);

    const onChange = (next: string): void => {
        setDraft(next);
        latestDraftRef.current = next;
        dirtyRef.current = !sameInstructionText(agentInstructionContent(next), loadedContentRef.current);
        syncIndicator(agentInstructionContent(next));
        if (saveTimer.current !== undefined) {
            window.clearTimeout(saveTimer.current);
            saveTimer.current = undefined;
        }
        // A pending conflict waits for the user's choice; the text keeps changing in the panel meanwhile.
        if (conflictFileRef.current) return;
        saveTimer.current = window.setTimeout(() => {
            saveTimer.current = undefined;
            void flushSave();
        }, 450);
    };

    const beginResize = (event: React.PointerEvent<HTMLTextAreaElement>): void => {
        const element = area.current;
        if (!element) return;
        const box = element.getBoundingClientRect();
        const rtl = getComputedStyle(element).direction === 'rtl';
        if (event.clientY < box.bottom - 18 || (rtl ? event.clientX > box.left + 18 : event.clientX < box.right - 18)) return;
        if (document.activeElement !== element) element.focus({ preventScroll: true });
        const before = element.offsetHeight;
        const float = element.closest<HTMLElement>('.nmx-thread-agents-float');
        const notes = element.closest<HTMLElement>('.nmx-thread-agents');
        const floatHeight = float?.getBoundingClientRect().height || (typeof window !== 'undefined' ? window.innerHeight - 64 : 600);
        const viewportMax = Math.max(NOTE_HEIGHT_MIN, Math.floor(floatHeight - 72));
        const spare = float && notes ? Math.max(0, float.getBoundingClientRect().bottom - notes.getBoundingClientRect().bottom) : viewportMax;
        const boundedMax = Math.max(NOTE_HEIGHT_MIN, Math.min(NOTE_HEIGHT_MAX, viewportMax, before + spare));
        setMaxHeight(boundedMax);
        element.style.maxHeight = `${boundedMax}px`;
        const end = (): void => {
            window.removeEventListener('pointerup', end, true);
            window.removeEventListener('pointercancel', end, true);
            const after = area.current?.offsetHeight;
            if (after && after !== before) {
                const clamped = Math.max(NOTE_HEIGHT_MIN, Math.min(boundedMax, after));
                setHeight(clamped);
                write(HEIGHT_KEYS.agents, String(clamped));
            }
            setMaxHeight(undefined);
            if (area.current) area.current.style.maxHeight = '';
        };
        window.addEventListener('pointerup', end, true);
        window.addEventListener('pointercancel', end, true);
    };

    const workspaceName = props.workspaceRoot.split(/[\\/]/).filter(Boolean).pop() || props.workspaceRoot;
    const mac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent);

    return <div ref={panel} className='nmx-thread-notes nmx-thread-agents'
        onPointerEnter={() => { if (!dirtyRef.current) void load(false); }}
        onFocus={() => { if (!dirtyRef.current) void load(false); }}>
        <div className='nmx-thread-note is-agents-md' data-nmx-literal>
            <span className='nmx-thread-note-title nmx-thread-agents-title' title={t.agentsTitle} onClick={() => area.current?.focus()}>
                <i className='codicon codicon-book' aria-hidden='true'></i>
                <b className='nmx-thread-agents-name'>AGENTS.md</b>
                <span className='nmx-thread-agents-badge'>{t.agentsTitle.replace(/^AGENTS\.md\s*·\s*/u, '')}</span>
            </span>
            <span className='nmx-thread-note-hint'>{truncated ? t.agentsTooLarge : t.agentsHint}</span>
            <textarea
                ref={area}
                value={draft}
                maxLength={AGENT_INSTRUCTIONS_MAX_CHARACTERS}
                disabled={truncated}
                spellCheck={false}
                placeholder={`1. ${t.placeholder}`}
                title={t.zoom.replace('{mod}', mac ? '⌘' : 'Ctrl')}
                aria-label={t.agentsTitle}
                style={{ fontSize: `${fontSize}px`, ...(height ? { height: `${height}px` } : {}), ...(maxHeight ? { maxHeight: `${maxHeight}px` } : {}) }}
                onChange={event => onChange(event.currentTarget.value)}
                onPointerDown={beginResize}
                onKeyDown={event => {
                    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
                        event.preventDefault();
                        void flushSave();
                        return;
                    }
                    // The same list keys as a note: Enter continues “1. …” with “2. ”, Backspace on a bare number removes it.
                    if (event.nativeEvent.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey) return;
                    const target = event.currentTarget;
                    const edit = event.key === 'Enter' && !event.shiftKey ? continueNoteList(target.value, target.selectionStart, target.selectionEnd)
                        : event.key === 'Backspace' && !event.shiftKey && target.selectionStart === target.selectionEnd ? removeNoteListMarker(target.value, target.selectionStart)
                            : undefined;
                    if (!edit) return;
                    event.preventDefault();
                    onChange(edit.value);
                    requestAnimationFrame(() => area.current?.setSelectionRange(edit.caret, edit.caret));
                }}
                onPaste={event => {
                    // A numbered list pasted into the untouched “1. ” replaces it instead of becoming “1. 1. …”.
                    if (hasThreadNoteContent(latestDraftRef.current) || !latestDraftRef.current.startsWith('1.')) return;
                    const pasted = (event.clipboardData?.getData('text/plain') || '').trimStart();
                    if (!NUMBERED_LINE.test(pasted)) return;
                    event.preventDefault();
                    const next = pasted.slice(0, AGENT_INSTRUCTIONS_MAX_CHARACTERS);
                    onChange(next);
                    requestAnimationFrame(() => area.current?.setSelectionRange(next.length, next.length));
                }}
                // An empty file starts as a numbered list in the textarea only; nothing is saved until real text is typed.
                onFocus={event => {
                    if (event.currentTarget.value || truncated) return;
                    setDraft('1. ');
                    latestDraftRef.current = '1. ';
                    const element = event.currentTarget;
                    requestAnimationFrame(() => element.setSelectionRange(3, 3));
                }}
                onBlur={() => {
                    // An untouched “1. ” is removed again, as in a note.
                    if (!hasThreadNoteContent(latestDraftRef.current) && latestDraftRef.current) {
                        setDraft('');
                        latestDraftRef.current = '';
                    }
                    void flushSave();
                }}
            />
            <div className='nmx-thread-note-agents-meta'>
                <span className='nmx-thread-note-agents-folder' title={filePath || props.workspaceRoot}>
                    <i className='codicon codicon-folder' aria-hidden='true'></i>
                    <b>{workspaceName}</b>
                </span>
                {saveStatus === 'conflict' || saveStatus === 'error'
                    ? <span className={`nmx-thread-note-agents-status is-${saveStatus}`} role='alert'>
                        <i className='codicon codicon-warning' aria-hidden='true'></i>
                        {saveStatus === 'conflict' ? t.agentsConflict : t.agentsSaveFailed}
                    </span>
                    : <span className={`nmx-thread-note-agents-status is-${saveStatus}`} aria-live='polite'>
                        {saveStatus === 'saving' ? t.agentsSaving : saveStatus === 'saved' ? t.agentsSaved : 'AGENTS.md'}
                    </span>}
                {props.onOpenFile && Boolean(filePath || props.workspaceRoot) && <button type='button' className='nmx-thread-note-agents-open' title={t.agentsOpen} aria-label={t.agentsOpen}
                    onClick={event => {
                        event.preventDefault();
                        event.stopPropagation();
                        void (async () => {
                            if (dirtyRef.current || saveTimer.current !== undefined) {
                                await flushSave();
                            }
                            const resolvedPath = filePath || `${props.workspaceRoot.replace(/[\\/]+$/, '')}/AGENTS.md`;
                            props.onOpenFile?.(resolvedPath);
                        })();
                    }}>
                    <i className='codicon codicon-go-to-file' aria-hidden='true'></i>
                </button>}
            </div>
            {(saveStatus === 'conflict' || saveStatus === 'error') && <div className='nmx-thread-note-agents-actions'>
                {saveStatus === 'conflict'
                    ? <>
                        <button type='button' onClick={useFileVersion}>{t.agentsUseFile}</button>
                        <button type='button' className='is-primary' onClick={overwriteFile}>{t.agentsOverwrite}</button>
                    </>
                    : <button type='button' className='is-primary' onClick={() => void flushSave()}>{t.agentsRetry}</button>}
            </div>}
            {sizeBadge && <span className='nmx-thread-note-size' aria-live='polite'>{t.size.replace('{size}', String(fontSize))}</span>}
        </div>
    </div>;
}

export const ThreadProjectAgentsNote = ThreadProjectAgentsFloat;

export function forgetConversationNote(conversationId: string): void {
    write(`${CONVERSATION_PREFIX}${conversationId}`, '');
    writeRawJson(`${CONVERSATION_META_PREFIX}${conversationId}`, undefined);
}

export function hasThreadNotes(conversationId: string): boolean {
    const convText = hasThreadNoteContent(read(`${CONVERSATION_PREFIX}${conversationId}`));
    const convImgs = (readMeta(`${CONVERSATION_META_PREFIX}${conversationId}`).images?.length ?? 0) > 0;
    const globalText = hasThreadNoteContent(read(GLOBAL_KEY));
    const globalImgs = (readMeta(GLOBAL_META_KEY).images?.length ?? 0) > 0;
    return convText || convImgs || globalText || globalImgs;
}
