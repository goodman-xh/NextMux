import { domainMessageFromError, type DomainMessage } from '../common/nextmux-domain-errors';
import { componentDomainMessage } from './nextmux-component-domain-locale';
import * as React from 'react';
import type { NextMuxPlatformService } from '../common/nextmux-platform-protocol';
import { AGENT_INSTRUCTIONS_MAX_CHARACTERS, type AgentInstructionAlternative, type AgentInstructionFile, agentInstructionEditorText, sameInstructionText } from '../common/nextmux-agent-instructions';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';
import { ThreadProjectAgentsFloat, ThreadProjectAgentsNote, threadProjectAgentsTitle, type ThreadProjectAgentsFloatProps } from './nextmux-thread-notes';

export { ThreadProjectAgentsFloat, ThreadProjectAgentsNote, threadProjectAgentsTitle, type ThreadProjectAgentsFloatProps };

type Key = 'nav' | 'title' | 'intro' | 'personal' | 'personalHint' | 'project' | 'projectHint' | 'chooseProject' | 'noProject'
    | 'save' | 'saving' | 'saved' | 'revert' | 'open' | 'reload' | 'conflict' | 'overwrite' | 'failed' | 'truncated' | 'personalPlaceholder'
    | 'projectPlaceholder' | 'notCreated' | 'unsaved' | 'otherFiles' | 'importFrom';

const en: Readonly<Record<Key, string>> = {
    nav: 'AI instructions', title: 'AI instructions (AGENTS.md)',
    intro: 'Every AI conversation reads these standing instructions before it starts. They use the open AGENTS.md format, so Codex, Cursor and other agents read the project file too.',
    personal: 'Personal habits', personalHint: 'Applies to every project on this computer.',
    project: 'Project instructions', projectHint: 'Applies only to the project folder you choose. Saved as AGENTS.md in that folder; commit it to share with your team.',
    chooseProject: 'Project', noProject: 'Open a project to edit its AGENTS.md.',
    save: 'Save', saving: 'Saving…', saved: 'Saved', revert: 'Discard changes', open: 'Open in editor', reload: 'Reload',
    conflict: 'The file changed on disk. Reload it, or overwrite it with your changes.', overwrite: 'Overwrite', failed: 'The file could not be read or saved.',
    truncated: 'This file is longer than the editor limit. Open it in the editor to change it.',
    personalPlaceholder: '# Personal habits\n- Reply in English; keep code comments in English\n- Prefer small, reviewable changes\n- Explain trade-offs before large refactors',
    projectPlaceholder: '# Project conventions\n- Use pnpm, not npm\n- Run pnpm test after changes\n- UI text lives in src/locales',
    notCreated: 'Not created yet', unsaved: 'Save or discard your changes before switching projects',
    otherFiles: 'This project has {names} (another AI tool’s instruction file). Runs already use it while AGENTS.md is missing; import it here and save to keep one shared file.', importFrom: 'Import {name}'
};

const catalog: Readonly<Record<NextMuxDesktopLocale, Readonly<Record<Key, string>>>> = {
    en,
    'zh-CN': {
        nav: 'AI 指令', title: 'AI 指令（AGENTS.md）',
        intro: '每次 AI 对话开始前都会先读取这里的长期指令。采用开放的 AGENTS.md 格式，Codex、Cursor 等其他 AI 工具也会读取项目里的这个文件。',
        personal: '个人习惯', personalHint: '对这台电脑上的所有项目生效。',
        project: '项目指令', projectHint: '只对下面选中的项目文件夹生效，保存为该文件夹根目录的 AGENTS.md，可提交到仓库与团队共享。',
        chooseProject: '项目', noProject: '打开一个项目后即可编辑它的 AGENTS.md。',
        save: '保存', saving: '保存中…', saved: '已保存', revert: '放弃修改', open: '在编辑器中打开', reload: '重新加载',
        conflict: '文件已在磁盘上被修改。可以重新加载，或用你的修改覆盖它。', overwrite: '覆盖', failed: '无法读取或保存该文件。',
        truncated: '文件超出编辑长度上限，请在编辑器中修改。',
        personalPlaceholder: '# 个人习惯\n- 用简体中文回复，代码注释用英文\n- 修改尽量小而清晰，方便审阅\n- 大规模重构前先说明取舍',
        projectPlaceholder: '# 项目约定\n- 使用 pnpm，不要使用 npm\n- 修改后运行 pnpm test\n- 界面文案放在 src/locales',
        notCreated: '尚未创建', unsaved: '有未保存的修改，保存或放弃后才能切换项目', otherFiles: '这个项目里已有 {names}（其他 AI 工具的指令文件）。没有 AGENTS.md 时，运行会先使用它；导入到这里保存后，各工具共用这一份。', importFrom: '导入 {name}'
    },
    'zh-TW': {
        nav: 'AI 指令', title: 'AI 指令（AGENTS.md）',
        intro: '每次 AI 對話開始前都會先讀取這裡的長期指令。採用開放的 AGENTS.md 格式，Codex、Cursor 等其他 AI 工具也會讀取專案裡的這個檔案。',
        personal: '個人習慣', personalHint: '對這台電腦上的所有專案生效。',
        project: '專案指令', projectHint: '只對下方選取的專案資料夾生效，儲存為該資料夾根目錄的 AGENTS.md，可提交到儲存庫與團隊共享。',
        chooseProject: '專案', noProject: '開啟一個專案後即可編輯它的 AGENTS.md。',
        save: '儲存', saving: '儲存中…', saved: '已儲存', revert: '捨棄修改', open: '在編輯器中開啟', reload: '重新載入',
        conflict: '檔案已在磁碟上被修改。可以重新載入，或用你的修改覆寫它。', overwrite: '覆寫', failed: '無法讀取或儲存此檔案。',
        truncated: '檔案超出編輯長度上限，請在編輯器中修改。',
        personalPlaceholder: '# 個人習慣\n- 以繁體中文回覆，程式碼註解使用英文\n- 修改盡量小而清楚，方便審閱',
        projectPlaceholder: '# 專案約定\n- 使用 pnpm，不要使用 npm\n- 修改後執行 pnpm test',
        notCreated: '尚未建立', unsaved: '有未儲存的修改，儲存或放棄後才能切換專案', otherFiles: '這個專案裡已有 {names}（其他 AI 工具的指令檔）。沒有 AGENTS.md 時，執行會先使用它；匯入到這裡儲存後，各工具共用這一份。', importFrom: '匯入 {name}'
    },
    ja: {
        nav: 'AI 指示', title: 'AI 指示（AGENTS.md）',
        intro: 'AI との会話は毎回、開始前にこの指示を読み込みます。オープンな AGENTS.md 形式なので、Codex や Cursor などもプロジェクトのファイルを読み込みます。',
        personal: '個人の習慣', personalHint: 'このコンピューターのすべてのプロジェクトに適用されます。',
        project: 'プロジェクトの指示', projectHint: 'プロジェクトのルートに AGENTS.md として保存され、リポジトリでチームと共有できます。',
        chooseProject: 'プロジェクト', noProject: 'プロジェクトを開くと AGENTS.md を編集できます。',
        save: '保存', saving: '保存中…', saved: '保存しました', revert: '変更を破棄', open: 'エディターで開く', reload: '再読み込み',
        conflict: 'ファイルがディスク上で変更されました。再読み込みするか、編集内容で上書きしてください。', overwrite: '上書き', failed: 'ファイルを読み書きできませんでした。',
        truncated: 'ファイルが編集上限を超えています。エディターで変更してください。',
        personalPlaceholder: '# 個人の習慣\n- 日本語で回答する\n- 変更は小さくレビューしやすく', projectPlaceholder: '# プロジェクトの規約\n- npm ではなく pnpm を使う\n- 変更後に pnpm test を実行',
        notCreated: '未作成', unsaved: '未保存の変更があります', otherFiles: 'このプロジェクトには {names}（他の AI ツールの指示ファイル）があります。AGENTS.md がない間は実行時にそれを使います。ここに取り込んで保存すると共通の 1 ファイルになります。', importFrom: '{name} を取り込む'
    },
    ko: {
        nav: 'AI 지침', title: 'AI 지침(AGENTS.md)',
        intro: '모든 AI 대화는 시작 전에 이 지침을 먼저 읽습니다. 개방형 AGENTS.md 형식이라 Codex, Cursor 등도 프로젝트 파일을 읽습니다.',
        personal: '개인 습관', personalHint: '이 컴퓨터의 모든 프로젝트에 적용됩니다.',
        project: '프로젝트 지침', projectHint: '프로젝트 루트의 AGENTS.md로 저장되며 저장소로 팀과 공유할 수 있습니다.',
        chooseProject: '프로젝트', noProject: '프로젝트를 열면 AGENTS.md를 편집할 수 있습니다.',
        save: '저장', saving: '저장 중…', saved: '저장됨', revert: '변경 취소', open: '편집기에서 열기', reload: '다시 불러오기',
        conflict: '디스크의 파일이 변경되었습니다. 다시 불러오거나 내 변경 내용으로 덮어쓰세요.', overwrite: '덮어쓰기', failed: '파일을 읽거나 저장할 수 없습니다.',
        truncated: '파일이 편집 한도를 넘습니다. 편집기에서 변경하세요.',
        personalPlaceholder: '# 개인 습관\n- 한국어로 답변\n- 변경은 작고 검토하기 쉽게', projectPlaceholder: '# 프로젝트 규칙\n- npm 대신 pnpm 사용\n- 변경 후 pnpm test 실행',
        notCreated: '아직 만들지 않음', unsaved: '저장하지 않은 변경 사항', otherFiles: '이 프로젝트에는 {names}(다른 AI 도구의 지침 파일)가 있습니다. AGENTS.md가 없으면 실행 시 이 파일을 사용합니다. 여기로 가져와 저장하면 모든 도구가 한 파일을 공유합니다.', importFrom: '{name} 가져오기'
    },
    es: {
        nav: 'Instrucciones de IA', title: 'Instrucciones de IA (AGENTS.md)',
        intro: 'Cada conversación con la IA lee estas instrucciones permanentes antes de empezar. Usan el formato abierto AGENTS.md, así que Codex, Cursor y otros agentes también leen el archivo del proyecto.',
        personal: 'Hábitos personales', personalHint: 'Se aplica a todos los proyectos de este equipo.',
        project: 'Instrucciones del proyecto', projectHint: 'Se guarda como AGENTS.md en la raíz del proyecto; confírmalo en el repositorio para compartirlo.',
        chooseProject: 'Proyecto', noProject: 'Abre un proyecto para editar su AGENTS.md.',
        save: 'Guardar', saving: 'Guardando…', saved: 'Guardado', revert: 'Descartar cambios', open: 'Abrir en el editor', reload: 'Volver a cargar',
        conflict: 'El archivo cambió en el disco. Vuelve a cargarlo o sobrescríbelo con tus cambios.', overwrite: 'Sobrescribir', failed: 'No se pudo leer ni guardar el archivo.',
        truncated: 'El archivo supera el límite del editor. Ábrelo en el editor para cambiarlo.',
        personalPlaceholder: '# Hábitos personales\n- Responde en español\n- Prefiere cambios pequeños y fáciles de revisar', projectPlaceholder: '# Convenciones del proyecto\n- Usa pnpm, no npm\n- Ejecuta pnpm test tras los cambios',
        notCreated: 'Aún no creado', unsaved: 'Cambios sin guardar', otherFiles: 'Este proyecto tiene {names} (el archivo de instrucciones de otra herramienta de IA). Mientras falte AGENTS.md, las ejecuciones lo usan; impórtalo aquí y guárdalo para compartir un solo archivo.', importFrom: 'Importar {name}'
    },
    fr: {
        nav: 'Instructions IA', title: 'Instructions IA (AGENTS.md)',
        intro: 'Chaque conversation avec l’IA lit ces instructions permanentes avant de commencer. Elles utilisent le format ouvert AGENTS.md : Codex, Cursor et d’autres agents lisent aussi le fichier du projet.',
        personal: 'Habitudes personnelles', personalHint: 'S’applique à tous les projets de cet ordinateur.',
        project: 'Instructions du projet', projectHint: 'Enregistré sous AGENTS.md à la racine du projet ; versionnez-le pour le partager avec l’équipe.',
        chooseProject: 'Projet', noProject: 'Ouvrez un projet pour modifier son AGENTS.md.',
        save: 'Enregistrer', saving: 'Enregistrement…', saved: 'Enregistré', revert: 'Annuler les modifications', open: 'Ouvrir dans l’éditeur', reload: 'Recharger',
        conflict: 'Le fichier a changé sur le disque. Rechargez-le ou écrasez-le avec vos modifications.', overwrite: 'Écraser', failed: 'Impossible de lire ou d’enregistrer le fichier.',
        truncated: 'Le fichier dépasse la limite de l’éditeur. Ouvrez-le dans l’éditeur pour le modifier.',
        personalPlaceholder: '# Habitudes personnelles\n- Répondre en français\n- Préférer des modifications petites et lisibles', projectPlaceholder: '# Conventions du projet\n- Utiliser pnpm, pas npm\n- Lancer pnpm test après les modifications',
        notCreated: 'Pas encore créé', unsaved: 'Modifications non enregistrées', otherFiles: 'Ce projet contient {names} (le fichier d’instructions d’un autre outil d’IA). Tant qu’AGENTS.md manque, les exécutions l’utilisent ; importez-le ici et enregistrez pour n’avoir qu’un seul fichier.', importFrom: 'Importer {name}'
    },
    de: {
        nav: 'KI-Anweisungen', title: 'KI-Anweisungen (AGENTS.md)',
        intro: 'Jede KI-Unterhaltung liest diese dauerhaften Anweisungen vor dem Start. Sie nutzen das offene AGENTS.md-Format, daher lesen auch Codex, Cursor und andere Agenten die Projektdatei.',
        personal: 'Persönliche Gewohnheiten', personalHint: 'Gilt für alle Projekte auf diesem Computer.',
        project: 'Projektanweisungen', projectHint: 'Wird als AGENTS.md im Projektstamm gespeichert; per Commit mit dem Team teilen.',
        chooseProject: 'Projekt', noProject: 'Öffnen Sie ein Projekt, um seine AGENTS.md zu bearbeiten.',
        save: 'Speichern', saving: 'Speichern…', saved: 'Gespeichert', revert: 'Änderungen verwerfen', open: 'Im Editor öffnen', reload: 'Neu laden',
        conflict: 'Die Datei wurde auf dem Datenträger geändert. Laden Sie sie neu oder überschreiben Sie sie mit Ihren Änderungen.', overwrite: 'Überschreiben', failed: 'Die Datei konnte nicht gelesen oder gespeichert werden.',
        truncated: 'Die Datei überschreitet das Editorlimit. Öffnen Sie sie zum Ändern im Editor.',
        personalPlaceholder: '# Persönliche Gewohnheiten\n- Auf Deutsch antworten\n- Kleine, gut prüfbare Änderungen bevorzugen', projectPlaceholder: '# Projektkonventionen\n- pnpm statt npm verwenden\n- Nach Änderungen pnpm test ausführen',
        notCreated: 'Noch nicht erstellt', unsaved: 'Nicht gespeicherte Änderungen', otherFiles: 'Dieses Projekt hat {names} (Anweisungsdatei eines anderen KI-Tools). Solange AGENTS.md fehlt, wird sie verwendet; hier importieren und speichern, damit alle Tools eine Datei teilen.', importFrom: '{name} importieren'
    },
    'pt-BR': {
        nav: 'Instruções de IA', title: 'Instruções de IA (AGENTS.md)',
        intro: 'Toda conversa com a IA lê estas instruções permanentes antes de começar. Elas usam o formato aberto AGENTS.md, então Codex, Cursor e outros agentes também leem o arquivo do projeto.',
        personal: 'Hábitos pessoais', personalHint: 'Vale para todos os projetos deste computador.',
        project: 'Instruções do projeto', projectHint: 'Salvo como AGENTS.md na raiz do projeto; faça commit para compartilhar com a equipe.',
        chooseProject: 'Projeto', noProject: 'Abra um projeto para editar o AGENTS.md dele.',
        save: 'Salvar', saving: 'Salvando…', saved: 'Salvo', revert: 'Descartar alterações', open: 'Abrir no editor', reload: 'Recarregar',
        conflict: 'O arquivo mudou no disco. Recarregue-o ou substitua-o pelas suas alterações.', overwrite: 'Substituir', failed: 'Não foi possível ler ou salvar o arquivo.',
        truncated: 'O arquivo excede o limite do editor. Abra-o no editor para alterá-lo.',
        personalPlaceholder: '# Hábitos pessoais\n- Responder em português\n- Preferir mudanças pequenas e fáceis de revisar', projectPlaceholder: '# Convenções do projeto\n- Usar pnpm, não npm\n- Rodar pnpm test após as mudanças',
        notCreated: 'Ainda não criado', unsaved: 'Alterações não salvas', otherFiles: 'Este projeto tem {names} (arquivo de instruções de outra ferramenta de IA). Enquanto faltar AGENTS.md, as execuções o usam; importe-o aqui e salve para compartilhar um só arquivo.', importFrom: 'Importar {name}'
    },
    ru: {
        nav: 'Инструкции ИИ', title: 'Инструкции ИИ (AGENTS.md)',
        intro: 'Каждый диалог с ИИ перед началом читает эти постоянные инструкции. Используется открытый формат AGENTS.md, поэтому Codex, Cursor и другие агенты тоже читают файл проекта.',
        personal: 'Личные привычки', personalHint: 'Действует для всех проектов на этом компьютере.',
        project: 'Инструкции проекта', projectHint: 'Сохраняется как AGENTS.md в корне проекта; добавьте в репозиторий, чтобы поделиться с командой.',
        chooseProject: 'Проект', noProject: 'Откройте проект, чтобы изменить его AGENTS.md.',
        save: 'Сохранить', saving: 'Сохранение…', saved: 'Сохранено', revert: 'Отменить изменения', open: 'Открыть в редакторе', reload: 'Перезагрузить',
        conflict: 'Файл изменился на диске. Перезагрузите его или перезапишите своими изменениями.', overwrite: 'Перезаписать', failed: 'Не удалось прочитать или сохранить файл.',
        truncated: 'Файл превышает лимит редактора. Откройте его в редакторе.',
        personalPlaceholder: '# Личные привычки\n- Отвечать на русском\n- Делать небольшие, удобные для проверки изменения', projectPlaceholder: '# Правила проекта\n- Использовать pnpm, а не npm\n- После изменений запускать pnpm test',
        notCreated: 'Ещё не создан', unsaved: 'Есть несохранённые изменения', otherFiles: 'В проекте есть {names} (файл инструкций другого ИИ-инструмента). Пока нет AGENTS.md, запуски используют его; импортируйте его сюда и сохраните, чтобы у всех был один файл.', importFrom: 'Импортировать {name}'
    },
    ar: {
        nav: 'تعليمات الذكاء الاصطناعي', title: 'تعليمات الذكاء الاصطناعي (AGENTS.md)',
        intro: 'تقرأ كل محادثة مع الذكاء الاصطناعي هذه التعليمات الدائمة قبل أن تبدأ. تستخدم صيغة AGENTS.md المفتوحة، لذا يقرأ Codex وCursor ووكلاء آخرون ملف المشروع أيضًا.',
        personal: 'عاداتي الشخصية', personalHint: 'تنطبق على كل المشاريع على هذا الحاسوب.',
        project: 'تعليمات المشروع', projectHint: 'تُحفظ باسم AGENTS.md في جذر المشروع؛ أضفها إلى المستودع لمشاركتها مع الفريق.',
        chooseProject: 'المشروع', noProject: 'افتح مشروعًا لتعديل ملف AGENTS.md الخاص به.',
        save: 'حفظ', saving: 'جارٍ الحفظ…', saved: 'تم الحفظ', revert: 'تجاهل التغييرات', open: 'فتح في المحرر', reload: 'إعادة التحميل',
        conflict: 'تغيّر الملف على القرص. أعد تحميله أو استبدله بتعديلاتك.', overwrite: 'استبدال', failed: 'تعذّرت قراءة الملف أو حفظه.',
        truncated: 'الملف أطول من حد المحرر. افتحه في المحرر لتعديله.',
        personalPlaceholder: '# عاداتي الشخصية\n- الرد بالعربية\n- تفضيل تغييرات صغيرة وسهلة المراجعة', projectPlaceholder: '# أعراف المشروع\n- استخدم pnpm وليس npm\n- شغّل pnpm test بعد التغييرات',
        notCreated: 'لم يُنشأ بعد', unsaved: 'تغييرات غير محفوظة', otherFiles: 'يحتوي هذا المشروع على {names} (ملف تعليمات لأداة ذكاء اصطناعي أخرى). تستخدمه عمليات التشغيل ما دام AGENTS.md غير موجود؛ استورده هنا واحفظه لتكون هناك نسخة واحدة مشتركة.', importFrom: 'استيراد {name}'
    },
    hi: {
        nav: 'AI निर्देश', title: 'AI निर्देश (AGENTS.md)',
        intro: 'हर AI बातचीत शुरू होने से पहले ये स्थायी निर्देश पढ़ती है। ये खुले AGENTS.md फ़ॉर्मैट में हैं, इसलिए Codex, Cursor और अन्य एजेंट भी प्रोजेक्ट की फ़ाइल पढ़ते हैं।',
        personal: 'निजी आदतें', personalHint: 'इस कंप्यूटर के सभी प्रोजेक्ट पर लागू।',
        project: 'प्रोजेक्ट निर्देश', projectHint: 'प्रोजेक्ट रूट में AGENTS.md के रूप में सहेजा जाता है; टीम से साझा करने के लिए कमिट करें।',
        chooseProject: 'प्रोजेक्ट', noProject: 'AGENTS.md बदलने के लिए कोई प्रोजेक्ट खोलें।',
        save: 'सहेजें', saving: 'सहेजा जा रहा है…', saved: 'सहेजा गया', revert: 'बदलाव छोड़ें', open: 'एडिटर में खोलें', reload: 'फिर से लोड करें',
        conflict: 'डिस्क पर फ़ाइल बदल गई है। इसे फिर से लोड करें या अपने बदलावों से अधिलेखित करें।', overwrite: 'अधिलेखित करें', failed: 'फ़ाइल पढ़ी या सहेजी नहीं जा सकी।',
        truncated: 'फ़ाइल एडिटर की सीमा से बड़ी है। बदलने के लिए इसे एडिटर में खोलें।',
        personalPlaceholder: '# निजी आदतें\n- हिंदी में जवाब दें\n- छोटे, आसानी से जाँचे जा सकने वाले बदलाव', projectPlaceholder: '# प्रोजेक्ट नियम\n- npm नहीं, pnpm इस्तेमाल करें\n- बदलाव के बाद pnpm test चलाएँ',
        notCreated: 'अभी बनाया नहीं गया', unsaved: 'बिना सहेजे बदलाव', otherFiles: 'इस प्रोजेक्ट में {names} है (किसी दूसरे AI टूल की निर्देश फ़ाइल)। AGENTS.md न होने तक रन इसी का उपयोग करते हैं; इसे यहाँ आयात करके सहेजें ताकि सभी टूल एक ही फ़ाइल साझा करें।', importFrom: '{name} आयात करें'
    }
};

function uncheckedAgentInstructionsText(locale: NextMuxDesktopLocale, key: Key): string {
    return catalog[locale]?.[key] || en[key];
}

type Api = Pick<NextMuxPlatformService, 'getAgentInstructions' | 'saveAgentInstructions'>;

interface EditorProps {
    readonly locale: NextMuxDesktopLocale;
    readonly scope: 'personal' | 'project';
    readonly file?: AgentInstructionFile;
    readonly workspaceRoot?: string;
    readonly api: Api;
    readonly onSaved: (file: AgentInstructionFile) => void;
    readonly onReload: () => void;
    readonly onOpen: (path: string) => void;
    readonly onDirtyChange: (scope: 'personal' | 'project', dirty: boolean) => void;
    readonly children?: React.ReactNode;
    /** Other tools' instruction files (CLAUDE.md, .cursorrules, …) when AGENTS.md is missing. */
    readonly alternatives?: readonly AgentInstructionAlternative[];
}

function InstructionEditor(props: EditorProps): React.ReactElement {
    const t = (key: Key): string => agentInstructionsText(props.locale, key);
    // The textarea shows the document without the trailing newline the writer adds, so a save never moves the caret.
    const [draft, setDraft] = React.useState(agentInstructionEditorText(props.file?.content));
    const [busy, setBusy] = React.useState(false);
    const [status, setStatus] = React.useState<'idle' | 'saved' | 'conflict' | 'failed'>('idle');
    const [failure, setFailure] = React.useState<DomainMessage | undefined>();
    const loadedSha = React.useRef(props.file?.sha256);
    const loadedContent = React.useRef(props.file?.content ?? '');
    const loadedPath = React.useRef(props.file?.path);
    React.useEffect(() => {
        if (!props.file) {
            loadedSha.current = undefined;
            loadedContent.current = '';
            loadedPath.current = undefined;
            setDraft('');
            setStatus('idle');
            return;
        }
        const pathChanged = props.file.path !== loadedPath.current;
        if (pathChanged || props.file.sha256 !== loadedSha.current) {
            const hasUnsavedLocalEdits = !pathChanged && loadedSha.current !== undefined
                && !sameInstructionText(draft, loadedContent.current) && !sameInstructionText(draft, props.file.content);
            if (hasUnsavedLocalEdits) {
                setStatus('conflict');
                return;
            }
            loadedSha.current = props.file.sha256;
            loadedContent.current = props.file.content;
            loadedPath.current = props.file.path;
            // The same document (e.g. the AGENTS.md card's own save) keeps the text and the caret as they are.
            if (pathChanged || !sameInstructionText(draft, props.file.content)) setDraft(agentInstructionEditorText(props.file.content));
            setStatus(current => current === 'saved' ? current : 'idle');
        }
    }, [props.file?.path, props.file?.sha256, props.file?.content]);
    const dirty = Boolean(props.file) && !sameInstructionText(draft, props.file!.content);
    React.useEffect(() => props.onDirtyChange(props.scope, dirty), [dirty]);
    React.useEffect(() => {
        if (status !== 'saved') return;
        const timer = window.setTimeout(() => setStatus('idle'), 2200);
        return () => window.clearTimeout(timer);
    }, [status]);
    const save = async (expectedSha256?: string): Promise<void> => {
        if (!props.file || busy || props.file.truncated) return;
        setBusy(true); setStatus('idle');
        try {
            const saved = await props.api.saveAgentInstructions({ scope: props.scope, workspaceRoot: props.workspaceRoot, content: draft,
                expectedSha256: expectedSha256 ?? loadedSha.current ?? props.file.sha256 });
            loadedSha.current = saved.sha256;
            loadedContent.current = saved.content;
            loadedPath.current = saved.path;
            if (!sameInstructionText(draft, saved.content)) setDraft(agentInstructionEditorText(saved.content));
            props.onSaved(saved);
            setStatus('saved');
            if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
                window.dispatchEvent(new CustomEvent('nextmux:agent-instructions-saved', {
                    detail: { scope: props.scope, workspaceRoot: props.workspaceRoot, file: saved }
                }));
            }
        } catch (error) {
            setFailure(domainMessageFromError(error));
            setStatus(domainMessageFromError(error)?.code === 'AGENT_INSTRUCTIONS_CHANGED' || /AGENT_INSTRUCTIONS_CHANGED/.test(String((error as { code?: string })?.code || (error as Error)?.message)) ? 'conflict' : 'failed');
        } finally {
            setBusy(false);
        }
    };
    /** Conflict: keep this text and save it over the version on disk, read again so the save is made against it. */
    const overwrite = async (): Promise<void> => {
        const fresh = await props.api.getAgentInstructions(props.scope === 'project' ? props.workspaceRoot : undefined)
            .then(snapshot => props.scope === 'personal' ? snapshot.personal : snapshot.project).catch(() => undefined);
        await save(fresh?.sha256 ?? props.file?.sha256);
    };
    const count = draft.length;
    return <article className={`nmx-settings-group nmx-agent-instructions-editor${dirty ? ' is-dirty' : ''}`}>
        <header>
            <i className={`codicon codicon-${props.scope === 'personal' ? 'account' : 'repo'}`}></i>
            <span><strong>{t(props.scope)}</strong><small>{t(props.scope === 'personal' ? 'personalHint' : 'projectHint')}</small></span>
        </header>
        {props.children}
        {props.file && <>
            <div className='nmx-agent-instructions-path'>
                <code data-nmx-literal title={props.file.path}>{props.file.path}</code>
                <span className={props.file.exists ? 'is-exists' : ''}>{dirty ? t('unsaved') : props.file.exists ? (props.file.updatedAt ? new Date(props.file.updatedAt).toLocaleString(props.locale) : '') : t('notCreated')}</span>
            </div>
            <textarea dir='auto' spellCheck={false} value={draft} maxLength={AGENT_INSTRUCTIONS_MAX_CHARACTERS} disabled={busy || props.file.truncated}
                placeholder={t(props.scope === 'personal' ? 'personalPlaceholder' : 'projectPlaceholder')}
                onChange={event => { setDraft(event.currentTarget.value); if (status !== 'idle' && status !== 'conflict') setStatus('idle'); }}
                onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save(); } }} />
            {!props.file.exists && !dirty && props.alternatives?.length ? <p className='nmx-agent-instructions-note is-import' role='status'>
                <span>{t('otherFiles').replace('{names}', props.alternatives.map(item => item.name).join('、'))}</span>
                {props.alternatives.map(item => <button type='button' key={item.path} title={item.path} onClick={() => { setDraft(agentInstructionEditorText(item.content)); setStatus('idle'); }}>{t('importFrom').replace('{name}', item.name)}</button>)}
            </p> : undefined}
            {props.file.truncated && <p className='nmx-agent-instructions-note is-warning' role='status'>{t('truncated')}</p>}
            {status === 'conflict' && <p className='nmx-agent-instructions-note is-error' role='alert'>{t('conflict')} <button type='button' disabled={busy} onClick={() => {
                if (props.file) { loadedSha.current = props.file.sha256; loadedContent.current = props.file.content; loadedPath.current = props.file.path; setDraft(agentInstructionEditorText(props.file.content)); }
                setStatus('idle'); props.onReload();
            }}>{t('reload')}</button> <button type='button' disabled={busy || props.file.truncated} onClick={() => void overwrite()}>{t('overwrite')}</button></p>}
            {status === 'failed' && <p className='nmx-agent-instructions-note is-error' role='alert'>{failure && componentDomainMessage(props.locale, failure) || t('failed')}</p>}
            <footer>
                <small className={count > AGENT_INSTRUCTIONS_MAX_CHARACTERS * .9 ? 'is-near-limit' : ''}>{count.toLocaleString(props.locale)} / {AGENT_INSTRUCTIONS_MAX_CHARACTERS.toLocaleString(props.locale)}</small>
                {status === 'saved' && <span className='nmx-agent-instructions-saved' role='status'><i className='codicon codicon-check'></i>{t('saved')}</span>}
                {props.file.exists && <button type='button' disabled={busy || dirty} onClick={() => props.onOpen(props.file!.path)}><i className='codicon codicon-go-to-file'></i>{t('open')}</button>}
                {dirty && <button type='button' disabled={busy} onClick={() => { loadedSha.current = props.file!.sha256; loadedContent.current = props.file!.content; setDraft(agentInstructionEditorText(props.file!.content)); setStatus('idle'); }}>{t('revert')}</button>}
                <button type='button' className='is-primary' disabled={busy || !dirty || props.file.truncated} onClick={() => void save()}>{busy ? t('saving') : t('save')}</button>
            </footer>
        </>}
    </article>;
}

export interface AgentInstructionsSettingsProps {
    readonly locale: NextMuxDesktopLocale;
    readonly api: Api;
    readonly projects: readonly { readonly path: string; readonly label: string }[];
    readonly project: string;
    readonly onProjectChange: (path: string) => void;
    readonly onOpenFile: (path: string) => void;
}

/** Settings page for the personal and project AGENTS.md files. */
export function AgentInstructionsSettings(props: AgentInstructionsSettingsProps): React.ReactElement {
    const t = (key: Key): string => agentInstructionsText(props.locale, key);
    const [personal, setPersonal] = React.useState<AgentInstructionFile>();
    const [project, setProject] = React.useState<AgentInstructionFile>();
    const [alternatives, setAlternatives] = React.useState<readonly AgentInstructionAlternative[]>([]);
    const [failed, setFailed] = React.useState(false);
    const [loadFailure, setLoadFailure] = React.useState<DomainMessage | undefined>();
    const [projectDirty, setProjectDirty] = React.useState(false);
    const generation = React.useRef(0);
    const load = React.useCallback(async (): Promise<void> => {
        const current = ++generation.current;
        setFailed(false);
        try {
            const snapshot = await props.api.getAgentInstructions(props.project || undefined);
            if (current !== generation.current) return;
            setPersonal(snapshot.personal); setProject(snapshot.project); setAlternatives(snapshot.projectAlternatives || []);
        } catch (error) {
            if (current === generation.current) { setLoadFailure(domainMessageFromError(error)); setFailed(true); }
        }
    }, [props.api, props.project]);
    React.useEffect(() => { setProject(undefined); void load(); }, [load]);
    React.useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const onExternalSaved = (event: Event): void => {
            const detail = (event as CustomEvent<{ scope?: 'personal' | 'project'; workspaceRoot?: string; file?: AgentInstructionFile }>).detail;
            if (!detail?.file) return;
            const scope = detail.scope || detail.file.scope;
            if (scope === 'personal') {
                setPersonal(detail.file);
            } else if (scope === 'project' && detail.workspaceRoot && detail.workspaceRoot === props.project) {
                setProject(detail.file);
                if (detail.file.exists) setAlternatives([]);
            }
        };
        window.addEventListener('nextmux:agent-instructions-saved', onExternalSaved);
        return () => window.removeEventListener('nextmux:agent-instructions-saved', onExternalSaved);
    }, [props.project]);
    const onDirtyChange = React.useCallback((scope: 'personal' | 'project', value: boolean) => { if (scope === 'project') setProjectDirty(value); }, []);
    return <section className='nmx-settings-panel nmx-agent-instructions'>
        <p className='nmx-agent-instructions-intro'>{t('intro')}</p>
        {failed && <p className='nmx-agent-instructions-note is-error' role='alert'>{loadFailure && componentDomainMessage(props.locale, loadFailure) || t('failed')} <button type='button' onClick={() => void load()}>{t('reload')}</button></p>}
        <InstructionEditor locale={props.locale} scope='personal' file={personal} api={props.api} onSaved={setPersonal}
            onReload={() => void load()} onOpen={props.onOpenFile} onDirtyChange={onDirtyChange} />
        <InstructionEditor locale={props.locale} scope='project' file={props.project ? project : undefined} workspaceRoot={props.project} api={props.api}
            onSaved={file => { setProject(file); if (file.exists) setAlternatives([]); }} onReload={() => void load()} onOpen={props.onOpenFile} onDirtyChange={onDirtyChange}
            alternatives={props.project ? alternatives : []}>
            {props.projects.length ? <label className='nmx-agent-instructions-project'>
                <span>{t('chooseProject')}</span>
                <select data-nmx-literal value={props.project} disabled={projectDirty} title={projectDirty ? t('unsaved') : undefined}
                    onChange={event => props.onProjectChange(event.currentTarget.value)}>
                    {props.projects.map(item => <option key={item.path} value={item.path} title={item.path}>{item.label} — {item.path}</option>)}
                </select>
                {projectDirty && <small className='nmx-agent-instructions-note'>{t('unsaved')}</small>}
            </label> : <p className='nmx-agent-instructions-note'>{t('noProject')}</p>}
        </InstructionEditor>
    </section>;
}

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function agentInstructionsText(locale: Parameters<typeof uncheckedAgentInstructionsText>[0], key: Parameters<typeof uncheckedAgentInstructionsText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedAgentInstructionsText>>): string {
    return totalCopy(locale, key, language => uncheckedAgentInstructionsText(language, key, ...rest));
}
