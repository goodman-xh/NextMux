import type { NextMuxDesktopLocale } from './nextmux-locale';

/**
 * Human phrasing for browser steps. Copied in behaviour from Cline's browser
 * session rows (Apache-2.0, webview-ui/src/components/chat/BrowserSessionRow.tsx:
 * "Launch browser at …", "Click …", "Type …", "Scroll down", "Close browser")
 * and Playwright MCP's tool vocabulary. A step is phrased as an action with its
 * human target, never as a raw action identifier such as `click` or `fill`.
 *
 * `{q}` is a quoted target (visible element text or option), `{t}` a plain one
 * (a site, field label, key or file). When no target is known the locale's
 * noun for that action is used instead.
 */
export type BrowserActivityAction =
    | 'open' | 'open_external' | 'snapshot' | 'click' | 'fill' | 'fill_form' | 'select' | 'upload' | 'drag' | 'hover'
    | 'wait' | 'press' | 'script' | 'screenshot' | 'close' | 'back' | 'forward' | 'reload' | 'resize' | 'console'
    | 'network' | 'tabs' | 'activate' | 'dialog';

export type BrowserActivityState = 'running' | 'completed' | 'failed' | 'stopped';

type Noun = 'page' | 'element' | 'field' | 'option' | 'file' | 'key';
type Forms = readonly [running: string, done: string, base: string];

interface BrowserLocale {
    readonly quotes: readonly [string, string];
    readonly nouns: Readonly<Record<Noun, string>>;
    readonly actions: Readonly<Record<BrowserActivityAction, Forms>>;
}

const nounFor: Readonly<Partial<Record<BrowserActivityAction, Noun>>> = {
    open: 'page', open_external: 'page', snapshot: 'page', click: 'element', drag: 'element', hover: 'element',
    fill: 'field', select: 'option', upload: 'file', press: 'key'
};

const locales: Readonly<Record<NextMuxDesktopLocale, BrowserLocale>> = {
    en: {
        quotes: ['“', '”'],
        nouns: { page: 'the page', element: 'an element', field: 'a field', option: 'an option', file: 'files', key: 'a key' },
        actions: {
            open: ['Opening {t}', 'Opened {t}', 'Open {t}'],
            open_external: ['Opening {t} in browser', 'Opened {t} in browser', 'Open {t} in browser'],
            snapshot: ['Reading {t}', 'Read {t}', 'Read {t}'],
            click: ['Clicking {q}', 'Clicked {q}', 'Click {q}'],
            fill: ['Typing into {t}', 'Typed into {t}', 'Type into {t}'],
            fill_form: ['Filling form', 'Filled form', 'Fill form'],
            select: ['Selecting {q}', 'Selected {q}', 'Select {q}'],
            upload: ['Uploading {t}', 'Uploaded {t}', 'Upload {t}'],
            drag: ['Dragging {q}', 'Dragged {q}', 'Drag {q}'],
            hover: ['Hovering over {q}', 'Hovered over {q}', 'Hover over {q}'],
            wait: ['Waiting for page', 'Waited for page', 'Wait for page'],
            press: ['Pressing {t}', 'Pressed {t}', 'Press {t}'],
            script: ['Running page script', 'Ran page script', 'Run page script'],
            screenshot: ['Taking screenshot', 'Took screenshot', 'Take screenshot'],
            close: ['Closing page', 'Closed page', 'Close page'],
            back: ['Going back', 'Went back', 'Go back'],
            forward: ['Going forward', 'Went forward', 'Go forward'],
            reload: ['Reloading page', 'Reloaded page', 'Reload page'],
            resize: ['Resizing browser', 'Resized browser', 'Resize browser'],
            console: ['Reading console', 'Read console', 'Read console'],
            network: ['Reading network requests', 'Read network requests', 'Read network requests'],
            tabs: ['Checking tabs', 'Checked tabs', 'Check tabs'],
            activate: ['Switching tab', 'Switched tab', 'Switch tab'],
            dialog: ['Handling dialog', 'Handled dialog', 'Handle dialog']
        }
    },
    'zh-CN': {
        quotes: ['“', '”'],
        nouns: { page: '页面', element: '页面元素', field: '输入框', option: '选项', file: '文件', key: '按键' },
        actions: {
            open: ['正在打开{t}', '已打开{t}', '打开{t}'],
            open_external: ['正在用系统浏览器打开{t}', '已用系统浏览器打开{t}', '用系统浏览器打开{t}'],
            snapshot: ['正在读取{t}', '已读取{t}', '读取{t}'],
            click: ['正在点击{q}', '已点击{q}', '点击{q}'],
            fill: ['正在填写{t}', '已填写{t}', '填写{t}'],
            fill_form: ['正在填写表单', '已填写表单', '填写表单'],
            select: ['正在选择{q}', '已选择{q}', '选择{q}'],
            upload: ['正在上传{t}', '已上传{t}', '上传{t}'],
            drag: ['正在拖动{q}', '已拖动{q}', '拖动{q}'],
            hover: ['正在指向{q}', '已指向{q}', '指向{q}'],
            wait: ['正在等待页面', '已等待页面', '等待页面'],
            press: ['正在按下{t}', '已按下{t}', '按下{t}'],
            script: ['正在运行页面脚本', '已运行页面脚本', '运行页面脚本'],
            screenshot: ['正在截图', '已截图', '截图'],
            close: ['正在关闭页面', '已关闭页面', '关闭页面'],
            back: ['正在返回上一页', '已返回上一页', '返回上一页'],
            forward: ['正在前进', '已前进', '前进'],
            reload: ['正在刷新页面', '已刷新页面', '刷新页面'],
            resize: ['正在调整浏览器大小', '已调整浏览器大小', '调整浏览器大小'],
            console: ['正在读取页面日志', '已读取页面日志', '读取页面日志'],
            network: ['正在读取网络请求', '已读取网络请求', '读取网络请求'],
            tabs: ['正在查看标签页', '已查看标签页', '查看标签页'],
            activate: ['正在切换标签页', '已切换标签页', '切换标签页'],
            dialog: ['正在处理页面对话框', '已处理页面对话框', '处理页面对话框']
        }
    },
    'zh-TW': {
        quotes: ['「', '」'],
        nouns: { page: '頁面', element: '頁面元素', field: '輸入框', option: '選項', file: '檔案', key: '按鍵' },
        actions: {
            open: ['正在開啟{t}', '已開啟{t}', '開啟{t}'],
            open_external: ['正在用系統瀏覽器開啟{t}', '已用系統瀏覽器開啟{t}', '用系統瀏覽器開啟{t}'],
            snapshot: ['正在讀取{t}', '已讀取{t}', '讀取{t}'],
            click: ['正在點擊{q}', '已點擊{q}', '點擊{q}'],
            fill: ['正在填寫{t}', '已填寫{t}', '填寫{t}'],
            fill_form: ['正在填寫表單', '已填寫表單', '填寫表單'],
            select: ['正在選擇{q}', '已選擇{q}', '選擇{q}'],
            upload: ['正在上傳{t}', '已上傳{t}', '上傳{t}'],
            drag: ['正在拖曳{q}', '已拖曳{q}', '拖曳{q}'],
            hover: ['正在指向{q}', '已指向{q}', '指向{q}'],
            wait: ['正在等待頁面', '已等待頁面', '等待頁面'],
            press: ['正在按下{t}', '已按下{t}', '按下{t}'],
            script: ['正在執行頁面指令碼', '已執行頁面指令碼', '執行頁面指令碼'],
            screenshot: ['正在截圖', '已截圖', '截圖'],
            close: ['正在關閉頁面', '已關閉頁面', '關閉頁面'],
            back: ['正在返回上一頁', '已返回上一頁', '返回上一頁'],
            forward: ['正在前進', '已前進', '前進'],
            reload: ['正在重新整理頁面', '已重新整理頁面', '重新整理頁面'],
            resize: ['正在調整瀏覽器大小', '已調整瀏覽器大小', '調整瀏覽器大小'],
            console: ['正在讀取頁面記錄', '已讀取頁面記錄', '讀取頁面記錄'],
            network: ['正在讀取網路請求', '已讀取網路請求', '讀取網路請求'],
            tabs: ['正在查看分頁', '已查看分頁', '查看分頁'],
            activate: ['正在切換分頁', '已切換分頁', '切換分頁'],
            dialog: ['正在處理頁面對話框', '已處理頁面對話框', '處理頁面對話框']
        }
    },
    ja: {
        quotes: ['「', '」'],
        nouns: { page: 'ページ', element: '要素', field: '入力欄', option: '選択肢', file: 'ファイル', key: 'キー' },
        actions: {
            open: ['{t}を開いています', '{t}を開きました', '{t}を開く'],
            open_external: ['{t}をブラウザーで開いています', '{t}をブラウザーで開きました', '{t}をブラウザーで開く'],
            snapshot: ['{t}を読み取り中', '{t}を読み取りました', '{t}を読み取る'],
            click: ['{q}をクリック中', '{q}をクリックしました', '{q}をクリック'],
            fill: ['{t}に入力中', '{t}に入力しました', '{t}に入力'],
            fill_form: ['フォームに入力中', 'フォームに入力しました', 'フォームに入力'],
            select: ['{q}を選択中', '{q}を選択しました', '{q}を選択'],
            upload: ['{t}をアップロード中', '{t}をアップロードしました', '{t}をアップロード'],
            drag: ['{q}をドラッグ中', '{q}をドラッグしました', '{q}をドラッグ'],
            hover: ['{q}にポインターを合わせています', '{q}にポインターを合わせました', '{q}にポインターを合わせる'],
            wait: ['ページを待機中', 'ページを待機しました', 'ページを待機'],
            press: ['{t}を押しています', '{t}を押しました', '{t}を押す'],
            script: ['ページスクリプトを実行中', 'ページスクリプトを実行しました', 'ページスクリプトを実行'],
            screenshot: ['スクリーンショットを撮影中', 'スクリーンショットを撮影しました', 'スクリーンショットを撮影'],
            close: ['ページを閉じています', 'ページを閉じました', 'ページを閉じる'],
            back: ['前のページに戻っています', '前のページに戻りました', '前のページに戻る'],
            forward: ['次のページに進んでいます', '次のページに進みました', '次のページに進む'],
            reload: ['ページを再読み込み中', 'ページを再読み込みしました', 'ページを再読み込み'],
            resize: ['ブラウザーのサイズを変更中', 'ブラウザーのサイズを変更しました', 'ブラウザーのサイズを変更'],
            console: ['コンソールを読み取り中', 'コンソールを読み取りました', 'コンソールを読み取る'],
            network: ['ネットワーク要求を読み取り中', 'ネットワーク要求を読み取りました', 'ネットワーク要求を読み取る'],
            tabs: ['タブを確認中', 'タブを確認しました', 'タブを確認'],
            activate: ['タブを切り替え中', 'タブを切り替えました', 'タブを切り替え'],
            dialog: ['ダイアログを処理中', 'ダイアログを処理しました', 'ダイアログを処理']
        }
    },
    ko: {
        quotes: ['“', '”'],
        nouns: { page: '페이지', element: '요소', field: '입력란', option: '옵션', file: '파일', key: '키' },
        actions: {
            open: ['{t} 여는 중', '{t} 열림', '{t} 열기'],
            open_external: ['브라우저에서 {t} 여는 중', '브라우저에서 {t} 열림', '브라우저에서 {t} 열기'],
            snapshot: ['{t} 읽는 중', '{t} 읽음', '{t} 읽기'],
            click: ['{q} 클릭 중', '{q} 클릭함', '{q} 클릭'],
            fill: ['{t}에 입력 중', '{t}에 입력함', '{t}에 입력'],
            fill_form: ['양식 입력 중', '양식 입력함', '양식 입력'],
            select: ['{q} 선택 중', '{q} 선택함', '{q} 선택'],
            upload: ['{t} 업로드 중', '{t} 업로드함', '{t} 업로드'],
            drag: ['{q} 드래그 중', '{q} 드래그함', '{q} 드래그'],
            hover: ['{q} 위로 이동 중', '{q} 위로 이동함', '{q} 위로 이동'],
            wait: ['페이지 대기 중', '페이지 대기함', '페이지 대기'],
            press: ['{t} 누르는 중', '{t} 누름', '{t} 누르기'],
            script: ['페이지 스크립트 실행 중', '페이지 스크립트 실행함', '페이지 스크립트 실행'],
            screenshot: ['스크린샷 찍는 중', '스크린샷 찍음', '스크린샷 찍기'],
            close: ['페이지 닫는 중', '페이지 닫음', '페이지 닫기'],
            back: ['뒤로 이동 중', '뒤로 이동함', '뒤로 이동'],
            forward: ['앞으로 이동 중', '앞으로 이동함', '앞으로 이동'],
            reload: ['페이지 새로고침 중', '페이지 새로고침함', '페이지 새로고침'],
            resize: ['브라우저 크기 조정 중', '브라우저 크기 조정함', '브라우저 크기 조정'],
            console: ['콘솔 읽는 중', '콘솔 읽음', '콘솔 읽기'],
            network: ['네트워크 요청 읽는 중', '네트워크 요청 읽음', '네트워크 요청 읽기'],
            tabs: ['탭 확인 중', '탭 확인함', '탭 확인'],
            activate: ['탭 전환 중', '탭 전환함', '탭 전환'],
            dialog: ['대화상자 처리 중', '대화상자 처리함', '대화상자 처리']
        }
    },
    es: {
        quotes: ['“', '”'],
        nouns: { page: 'una página', element: 'un elemento', field: 'un campo', option: 'una opción', file: 'archivos', key: 'una tecla' },
        actions: {
            open: ['Abriendo {t}', 'Abrió {t}', 'Abrir {t}'],
            open_external: ['Abriendo {t} en el navegador', 'Abrió {t} en el navegador', 'Abrir {t} en el navegador'],
            snapshot: ['Leyendo {t}', 'Leyó {t}', 'Leer {t}'],
            click: ['Haciendo clic en {q}', 'Hizo clic en {q}', 'Hacer clic en {q}'],
            fill: ['Escribiendo en {t}', 'Escribió en {t}', 'Escribir en {t}'],
            fill_form: ['Rellenando formulario', 'Rellenó el formulario', 'Rellenar formulario'],
            select: ['Seleccionando {q}', 'Seleccionó {q}', 'Seleccionar {q}'],
            upload: ['Subiendo {t}', 'Subió {t}', 'Subir {t}'],
            drag: ['Arrastrando {q}', 'Arrastró {q}', 'Arrastrar {q}'],
            hover: ['Pasando sobre {q}', 'Pasó sobre {q}', 'Pasar sobre {q}'],
            wait: ['Esperando la página', 'Esperó la página', 'Esperar la página'],
            press: ['Pulsando {t}', 'Pulsó {t}', 'Pulsar {t}'],
            script: ['Ejecutando script de la página', 'Ejecutó un script de la página', 'Ejecutar script de la página'],
            screenshot: ['Haciendo captura', 'Hizo una captura', 'Hacer captura'],
            close: ['Cerrando página', 'Cerró la página', 'Cerrar página'],
            back: ['Volviendo atrás', 'Volvió atrás', 'Volver atrás'],
            forward: ['Avanzando', 'Avanzó', 'Avanzar'],
            reload: ['Recargando página', 'Recargó la página', 'Recargar página'],
            resize: ['Ajustando el navegador', 'Ajustó el navegador', 'Ajustar el navegador'],
            console: ['Leyendo la consola', 'Leyó la consola', 'Leer la consola'],
            network: ['Leyendo solicitudes de red', 'Leyó solicitudes de red', 'Leer solicitudes de red'],
            tabs: ['Revisando pestañas', 'Revisó las pestañas', 'Revisar pestañas'],
            activate: ['Cambiando de pestaña', 'Cambió de pestaña', 'Cambiar de pestaña'],
            dialog: ['Gestionando diálogo', 'Gestionó un diálogo', 'Gestionar diálogo']
        }
    },
    fr: {
        quotes: ['« ', ' »'],
        nouns: { page: 'la page', element: 'un élément', field: 'un champ', option: 'une option', file: 'des fichiers', key: 'une touche' },
        actions: {
            open: ['Ouvre {t}', 'A ouvert {t}', 'Ouvrir {t}'],
            open_external: ['Ouvre {t} dans le navigateur', 'A ouvert {t} dans le navigateur', 'Ouvrir {t} dans le navigateur'],
            snapshot: ['Lit {t}', 'A lu {t}', 'Lire {t}'],
            click: ['Clique sur {q}', 'A cliqué sur {q}', 'Cliquer sur {q}'],
            fill: ['Saisit dans {t}', 'A saisi dans {t}', 'Saisir dans {t}'],
            fill_form: ['Remplit le formulaire', 'A rempli le formulaire', 'Remplir le formulaire'],
            select: ['Sélectionne {q}', 'A sélectionné {q}', 'Sélectionner {q}'],
            upload: ['Envoie {t}', 'A envoyé {t}', 'Envoyer {t}'],
            drag: ['Fait glisser {q}', 'A fait glisser {q}', 'Faire glisser {q}'],
            hover: ['Survole {q}', 'A survolé {q}', 'Survoler {q}'],
            wait: ['Attend la page', 'A attendu la page', 'Attendre la page'],
            press: ['Appuie sur {t}', 'A appuyé sur {t}', 'Appuyer sur {t}'],
            script: ['Exécute un script de page', 'A exécuté un script de page', 'Exécuter un script de page'],
            screenshot: ['Prend une capture', 'A pris une capture', 'Prendre une capture'],
            close: ['Ferme la page', 'A fermé la page', 'Fermer la page'],
            back: ['Revient en arrière', 'Est revenu en arrière', 'Revenir en arrière'],
            forward: ['Avance', 'A avancé', 'Avancer'],
            reload: ['Recharge la page', 'A rechargé la page', 'Recharger la page'],
            resize: ['Redimensionne le navigateur', 'A redimensionné le navigateur', 'Redimensionner le navigateur'],
            console: ['Lit la console', 'A lu la console', 'Lire la console'],
            network: ['Lit les requêtes réseau', 'A lu les requêtes réseau', 'Lire les requêtes réseau'],
            tabs: ['Vérifie les onglets', 'A vérifié les onglets', 'Vérifier les onglets'],
            activate: ['Change d’onglet', 'A changé d’onglet', 'Changer d’onglet'],
            dialog: ['Gère une boîte de dialogue', 'A géré une boîte de dialogue', 'Gérer une boîte de dialogue']
        }
    },
    de: {
        quotes: ['„', '“'],
        nouns: { page: 'die Seite', element: 'ein Element', field: 'ein Feld', option: 'eine Option', file: 'Dateien', key: 'eine Taste' },
        actions: {
            open: ['Öffnet {t}', '{t} geöffnet', '{t} öffnen'],
            open_external: ['Öffnet {t} im Browser', '{t} im Browser geöffnet', '{t} im Browser öffnen'],
            snapshot: ['Liest {t}', '{t} gelesen', '{t} lesen'],
            click: ['Klickt auf {q}', 'Auf {q} geklickt', 'Auf {q} klicken'],
            fill: ['Tippt in {t}', 'In {t} getippt', 'In {t} tippen'],
            fill_form: ['Füllt Formular aus', 'Formular ausgefüllt', 'Formular ausfüllen'],
            select: ['Wählt {q}', '{q} gewählt', '{q} wählen'],
            upload: ['Lädt {t} hoch', '{t} hochgeladen', '{t} hochladen'],
            drag: ['Zieht {q}', '{q} gezogen', '{q} ziehen'],
            hover: ['Zeigt auf {q}', 'Auf {q} gezeigt', 'Auf {q} zeigen'],
            wait: ['Wartet auf Seite', 'Auf Seite gewartet', 'Auf Seite warten'],
            press: ['Drückt {t}', '{t} gedrückt', '{t} drücken'],
            script: ['Führt Seitenskript aus', 'Seitenskript ausgeführt', 'Seitenskript ausführen'],
            screenshot: ['Erstellt Screenshot', 'Screenshot erstellt', 'Screenshot erstellen'],
            close: ['Schließt Seite', 'Seite geschlossen', 'Seite schließen'],
            back: ['Geht zurück', 'Zurückgegangen', 'Zurückgehen'],
            forward: ['Geht vor', 'Vorgegangen', 'Vorgehen'],
            reload: ['Lädt Seite neu', 'Seite neu geladen', 'Seite neu laden'],
            resize: ['Ändert Browsergröße', 'Browsergröße geändert', 'Browsergröße ändern'],
            console: ['Liest Konsole', 'Konsole gelesen', 'Konsole lesen'],
            network: ['Liest Netzwerkanfragen', 'Netzwerkanfragen gelesen', 'Netzwerkanfragen lesen'],
            tabs: ['Prüft Tabs', 'Tabs geprüft', 'Tabs prüfen'],
            activate: ['Wechselt Tab', 'Tab gewechselt', 'Tab wechseln'],
            dialog: ['Bearbeitet Dialog', 'Dialog bearbeitet', 'Dialog bearbeiten']
        }
    },
    'pt-BR': {
        quotes: ['“', '”'],
        nouns: { page: 'uma página', element: 'um elemento', field: 'um campo', option: 'uma opção', file: 'arquivos', key: 'uma tecla' },
        actions: {
            open: ['Abrindo {t}', 'Abriu {t}', 'Abrir {t}'],
            open_external: ['Abrindo {t} no navegador', 'Abriu {t} no navegador', 'Abrir {t} no navegador'],
            snapshot: ['Lendo {t}', 'Leu {t}', 'Ler {t}'],
            click: ['Clicando em {q}', 'Clicou em {q}', 'Clicar em {q}'],
            fill: ['Digitando em {t}', 'Digitou em {t}', 'Digitar em {t}'],
            fill_form: ['Preenchendo formulário', 'Preencheu o formulário', 'Preencher formulário'],
            select: ['Selecionando {q}', 'Selecionou {q}', 'Selecionar {q}'],
            upload: ['Enviando {t}', 'Enviou {t}', 'Enviar {t}'],
            drag: ['Arrastando {q}', 'Arrastou {q}', 'Arrastar {q}'],
            hover: ['Passando sobre {q}', 'Passou sobre {q}', 'Passar sobre {q}'],
            wait: ['Aguardando a página', 'Aguardou a página', 'Aguardar a página'],
            press: ['Pressionando {t}', 'Pressionou {t}', 'Pressionar {t}'],
            script: ['Executando script da página', 'Executou script da página', 'Executar script da página'],
            screenshot: ['Capturando tela', 'Capturou a tela', 'Capturar tela'],
            close: ['Fechando página', 'Fechou a página', 'Fechar página'],
            back: ['Voltando', 'Voltou', 'Voltar'],
            forward: ['Avançando', 'Avançou', 'Avançar'],
            reload: ['Recarregando página', 'Recarregou a página', 'Recarregar página'],
            resize: ['Redimensionando navegador', 'Redimensionou o navegador', 'Redimensionar navegador'],
            console: ['Lendo o console', 'Leu o console', 'Ler o console'],
            network: ['Lendo requisições de rede', 'Leu requisições de rede', 'Ler requisições de rede'],
            tabs: ['Verificando abas', 'Verificou as abas', 'Verificar abas'],
            activate: ['Trocando de aba', 'Trocou de aba', 'Trocar de aba'],
            dialog: ['Tratando diálogo', 'Tratou um diálogo', 'Tratar diálogo']
        }
    },
    ru: {
        quotes: ['«', '»'],
        nouns: { page: 'страницу', element: 'элемент', field: 'поле', option: 'вариант', file: 'файлы', key: 'клавишу' },
        actions: {
            open: ['Открывает {t}', 'Открыл {t}', 'Открыть {t}'],
            open_external: ['Открывает {t} в браузере', 'Открыл {t} в браузере', 'Открыть {t} в браузере'],
            snapshot: ['Читает {t}', 'Прочитал {t}', 'Прочитать {t}'],
            click: ['Нажимает {q}', 'Нажал {q}', 'Нажать {q}'],
            fill: ['Вводит текст в {t}', 'Ввёл текст в {t}', 'Ввести текст в {t}'],
            fill_form: ['Заполняет форму', 'Заполнил форму', 'Заполнить форму'],
            select: ['Выбирает {q}', 'Выбрал {q}', 'Выбрать {q}'],
            upload: ['Загружает {t}', 'Загрузил {t}', 'Загрузить {t}'],
            drag: ['Перетаскивает {q}', 'Перетащил {q}', 'Перетащить {q}'],
            hover: ['Наводит на {q}', 'Навёл на {q}', 'Навести на {q}'],
            wait: ['Ждёт страницу', 'Дождался страницы', 'Дождаться страницы'],
            press: ['Нажимает {t}', 'Нажал {t}', 'Нажать {t}'],
            script: ['Выполняет скрипт страницы', 'Выполнил скрипт страницы', 'Выполнить скрипт страницы'],
            screenshot: ['Делает снимок экрана', 'Сделал снимок экрана', 'Сделать снимок экрана'],
            close: ['Закрывает страницу', 'Закрыл страницу', 'Закрыть страницу'],
            back: ['Возвращается назад', 'Вернулся назад', 'Вернуться назад'],
            forward: ['Переходит вперёд', 'Перешёл вперёд', 'Перейти вперёд'],
            reload: ['Перезагружает страницу', 'Перезагрузил страницу', 'Перезагрузить страницу'],
            resize: ['Меняет размер браузера', 'Изменил размер браузера', 'Изменить размер браузера'],
            console: ['Читает консоль', 'Прочитал консоль', 'Прочитать консоль'],
            network: ['Читает сетевые запросы', 'Прочитал сетевые запросы', 'Прочитать сетевые запросы'],
            tabs: ['Проверяет вкладки', 'Проверил вкладки', 'Проверить вкладки'],
            activate: ['Переключает вкладку', 'Переключил вкладку', 'Переключить вкладку'],
            dialog: ['Обрабатывает диалог', 'Обработал диалог', 'Обработать диалог']
        }
    },
    ar: {
        quotes: ['«', '»'],
        nouns: { page: 'صفحة', element: 'عنصرًا', field: 'حقل', option: 'خيارًا', file: 'ملفات', key: 'مفتاحًا' },
        actions: {
            open: ['يفتح {t}', 'فتح {t}', 'فتح {t}'],
            open_external: ['يفتح {t} في المتصفح', 'فتح {t} في المتصفح', 'فتح {t} في المتصفح'],
            snapshot: ['يقرأ {t}', 'قرأ {t}', 'قراءة {t}'],
            click: ['ينقر على {q}', 'نقر على {q}', 'النقر على {q}'],
            fill: ['يكتب في {t}', 'كتب في {t}', 'الكتابة في {t}'],
            fill_form: ['يملأ النموذج', 'ملأ النموذج', 'ملء النموذج'],
            select: ['يختار {q}', 'اختار {q}', 'اختيار {q}'],
            upload: ['يرفع {t}', 'رفع {t}', 'رفع {t}'],
            drag: ['يسحب {q}', 'سحب {q}', 'سحب {q}'],
            hover: ['يمرّر المؤشر فوق {q}', 'مرّر المؤشر فوق {q}', 'تمرير المؤشر فوق {q}'],
            wait: ['ينتظر الصفحة', 'انتظر الصفحة', 'انتظار الصفحة'],
            press: ['يضغط {t}', 'ضغط {t}', 'الضغط على {t}'],
            script: ['يشغّل برنامج الصفحة', 'شغّل برنامج الصفحة', 'تشغيل برنامج الصفحة'],
            screenshot: ['يلتقط لقطة شاشة', 'التقط لقطة شاشة', 'التقاط لقطة شاشة'],
            close: ['يغلق الصفحة', 'أغلق الصفحة', 'إغلاق الصفحة'],
            back: ['يعود للخلف', 'عاد للخلف', 'العودة للخلف'],
            forward: ['يتقدم للأمام', 'تقدم للأمام', 'التقدم للأمام'],
            reload: ['يعيد تحميل الصفحة', 'أعاد تحميل الصفحة', 'إعادة تحميل الصفحة'],
            resize: ['يغيّر حجم المتصفح', 'غيّر حجم المتصفح', 'تغيير حجم المتصفح'],
            console: ['يقرأ وحدة التحكم', 'قرأ وحدة التحكم', 'قراءة وحدة التحكم'],
            network: ['يقرأ طلبات الشبكة', 'قرأ طلبات الشبكة', 'قراءة طلبات الشبكة'],
            tabs: ['يفحص علامات التبويب', 'فحص علامات التبويب', 'فحص علامات التبويب'],
            activate: ['يبدّل علامة التبويب', 'بدّل علامة التبويب', 'تبديل علامة التبويب'],
            dialog: ['يعالج مربع الحوار', 'عالج مربع الحوار', 'معالجة مربع الحوار']
        }
    },
    hi: {
        quotes: ['“', '”'],
        nouns: { page: 'पेज', element: 'एलिमेंट', field: 'फ़ील्ड', option: 'विकल्प', file: 'फ़ाइलें', key: 'कुंजी' },
        actions: {
            open: ['{t} खोल रहा है', '{t} खोला', '{t} खोलें'],
            open_external: ['{t} ब्राउज़र में खोल रहा है', '{t} ब्राउज़र में खोला', '{t} ब्राउज़र में खोलें'],
            snapshot: ['{t} पढ़ रहा है', '{t} पढ़ा', '{t} पढ़ें'],
            click: ['{q} पर क्लिक कर रहा है', '{q} पर क्लिक किया', '{q} पर क्लिक करें'],
            fill: ['{t} में टाइप कर रहा है', '{t} में टाइप किया', '{t} में टाइप करें'],
            fill_form: ['फ़ॉर्म भर रहा है', 'फ़ॉर्म भरा', 'फ़ॉर्म भरें'],
            select: ['{q} चुन रहा है', '{q} चुना', '{q} चुनें'],
            upload: ['{t} अपलोड कर रहा है', '{t} अपलोड किया', '{t} अपलोड करें'],
            drag: ['{q} खींच रहा है', '{q} खींचा', '{q} खींचें'],
            hover: ['{q} पर होवर कर रहा है', '{q} पर होवर किया', '{q} पर होवर करें'],
            wait: ['पेज की प्रतीक्षा कर रहा है', 'पेज की प्रतीक्षा की', 'पेज की प्रतीक्षा करें'],
            press: ['{t} दबा रहा है', '{t} दबाया', '{t} दबाएँ'],
            script: ['पेज स्क्रिप्ट चला रहा है', 'पेज स्क्रिप्ट चलाई', 'पेज स्क्रिप्ट चलाएँ'],
            screenshot: ['स्क्रीनशॉट ले रहा है', 'स्क्रीनशॉट लिया', 'स्क्रीनशॉट लें'],
            close: ['पेज बंद कर रहा है', 'पेज बंद किया', 'पेज बंद करें'],
            back: ['पीछे जा रहा है', 'पीछे गया', 'पीछे जाएँ'],
            forward: ['आगे जा रहा है', 'आगे गया', 'आगे जाएँ'],
            reload: ['पेज रीलोड कर रहा है', 'पेज रीलोड किया', 'पेज रीलोड करें'],
            resize: ['ब्राउज़र का आकार बदल रहा है', 'ब्राउज़र का आकार बदला', 'ब्राउज़र का आकार बदलें'],
            console: ['कंसोल पढ़ रहा है', 'कंसोल पढ़ा', 'कंसोल पढ़ें'],
            network: ['नेटवर्क अनुरोध पढ़ रहा है', 'नेटवर्क अनुरोध पढ़े', 'नेटवर्क अनुरोध पढ़ें'],
            tabs: ['टैब देख रहा है', 'टैब देखे', 'टैब देखें'],
            activate: ['टैब बदल रहा है', 'टैब बदला', 'टैब बदलें'],
            dialog: ['डायलॉग संभाल रहा है', 'डायलॉग संभाला', 'डायलॉग संभालें']
        }
    }
};

/** Registered identifiers only: built-in `browser.*` and Playwright-compatible MCP `browser_*` tools. */
const actionAliases: Readonly<Record<string, BrowserActivityAction>> = {
    open: 'open', navigate: 'open', open_external: 'open_external', snapshot: 'snapshot', click: 'click',
    fill: 'fill', type: 'fill', fill_form: 'fill_form', select: 'select', select_option: 'select',
    upload: 'upload', file_upload: 'upload', drag: 'drag', hover: 'hover', wait: 'wait', wait_for: 'wait',
    press: 'press', press_key: 'press', evaluate: 'script', run_code: 'script', run_code_unsafe: 'script',
    take_screenshot: 'screenshot', close: 'close', back: 'back', navigate_back: 'back', forward: 'forward',
    navigate_forward: 'forward', reload: 'reload', resize: 'resize', console_messages: 'console',
    network_requests: 'network', tabs: 'tabs', activate: 'activate', handle_dialog: 'dialog'
};

export interface BrowserToolIdentity {
    readonly action: BrowserActivityAction;
    /** MCP server name for external browser tools. */
    readonly service?: string;
}

export function browserToolIdentity(toolName: string): BrowserToolIdentity | undefined {
    const mcp = /^mcp\.([^.]+)\.browser_([a-z_]+?)(?:_[a-f0-9]{8})?$/.exec(toolName);
    const raw = mcp?.[2] || /^browser\.([a-z_]+)$/.exec(toolName)?.[1];
    const action = raw ? actionAliases[raw] : undefined;
    return action ? { action, ...(mcp ? { service: mcp[1] } : {}) } : undefined;
}

export interface BrowserActivityPhrase {
    /** Whole sentence, for titles and accessibility. */
    readonly text: string;
    /** Text before the target, the target itself and the text after it. */
    readonly before: string;
    readonly target: string;
    readonly after: string;
}

const cjk = /[぀-ヿ㐀-鿿가-힯]/;
const latin = /[A-Za-z0-9]/;

/** Phrase one browser step, e.g. `Clicked “Sign in”`, `已打开 example.com`. */
export function browserActivityPhrase(
    locale: NextMuxDesktopLocale, action: BrowserActivityAction, state: BrowserActivityState, target?: string
): BrowserActivityPhrase {
    const catalog = locales[locale] || locales.en;
    const template = catalog.actions[action][state === 'running' ? 0 : state === 'completed' ? 1 : 2];
    const match = /\{([qt])\}/.exec(template);
    const clean = (target || '').replace(/\s+/g, ' ').trim();
    if (!match) return { text: template, before: template, target: '', after: '' };
    let before = template.slice(0, match.index);
    let after = template.slice(match.index + match[0].length);
    let value: string;
    if (!clean) value = catalog.nouns[nounFor[action] || 'page'];
    else if (match[1] === 'q') value = `${catalog.quotes[0]}${clean}${catalog.quotes[1]}`;
    else value = clean;
    // Pangu spacing: a Latin site, field or key next to CJK text gets a space.
    if (before && cjk.test(before.slice(-1)) && latin.test(value[0])) before = `${before} `;
    if (after && cjk.test(after[0]) && latin.test(value.slice(-1))) after = ` ${after}`;
    // Sentence case for templates that start with a target ("die Seite geöffnet").
    if (!before && value && /^\p{Ll}/u.test(value) && !clean) value = value[0].toLocaleUpperCase(locale) + value.slice(1);
    return { text: `${before}${value}${after}`, before, target: value, after };
}

/** Short site label for a URL: host without `www.`, or the page title for local previews. */
export function browserSiteLabel(url: string | undefined, title?: string): string {
    if (!url) return title?.trim() || '';
    try {
        const parsed = new URL(url);
        return parsed.host.replace(/^www\./, '') || title?.trim() || '';
    } catch {
        return title?.trim() || '';
    }
}
