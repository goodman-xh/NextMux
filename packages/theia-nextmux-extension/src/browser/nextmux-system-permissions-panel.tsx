import * as React from 'react';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';
import { microphoneStatusFromError, requestMicrophoneAccess, type MicrophoneCapability, type MicrophoneCapabilityStatus } from './nextmux-microphone-policy';
import { microphoneText } from './nextmux-microphone-locale';

/**
 * Settings → System permissions. One place that shows what the operating
 * system has granted NextMux and asks for the rest the right way for this
 * exact macOS / Windows version (see apps/desktop/system-permissions.cjs).
 */
export type SystemPermissionKind = 'accessibility' | 'screen' | 'microphone' | 'speechRecognition' | 'notifications' | 'automation'
    | 'files' | 'fullDisk' | 'inputMonitoring' | 'appManagement' | 'localNetwork';
export type SystemPermissionStatus = 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown';

export interface SystemPermissionItem {
    readonly kind: SystemPermissionKind;
    readonly status: SystemPermissionStatus;
    readonly required: 'computer' | 'voice' | 'notify' | 'automation' | 'files' | 'input' | 'apps' | 'network';
    readonly essential?: boolean;
    readonly draggable?: boolean;
    readonly relaunchAfterGrant?: boolean;
    readonly elevation?: boolean;
    /** macOS 14+: the Screen Recording pane also covers system audio recording. */
    readonly systemAudio?: boolean;
    readonly settingsUrl: string;
}

export interface SystemPermissionsState {
    readonly platform: string;
    readonly version: number;
    readonly osRelease: string;
    readonly arch: string;
    readonly computerSupported: boolean;
    readonly items: readonly SystemPermissionItem[];
}

export interface SystemPermissionsBridge {
    getSystemPermissions?(): Promise<SystemPermissionsState | undefined>;
    requestSystemPermission?(kind: SystemPermissionKind, texts: { title: string; body: string; close: string; notificationTitle?: string; notificationBody?: string; locale?: string }): Promise<SystemPermissionsState | undefined>;
    openPermissionSettings?(kind: SystemPermissionKind): Promise<boolean>;
    relaunchApp?(): Promise<boolean>;
    onSystemPermissionsChanged?(callback: (state: SystemPermissionsState) => void): () => void;
}

type Key = 'windowsMicrophoneHint' | 'nav' | 'title' | 'intro' | 'granted' | 'denied' | 'notDetermined' | 'unknown' | 'restricted' | 'allow' | 'openSettings' | 'refresh'
    | 'accessibility' | 'accessibilityHint' | 'screen' | 'screenAudio' | 'screenHint' | 'microphone' | 'microphoneHint' | 'speechRecognition' | 'speechRecognitionHint'
    | 'notifications' | 'notificationsHint' | 'automation' | 'automationHint' | 'files' | 'filesHint' | 'fullDisk' | 'fullDiskHint'
    | 'inputMonitoring' | 'inputMonitoringHint' | 'appManagement' | 'appManagementHint' | 'localNetwork' | 'localNetworkHint' | 'workerHint'
    | 'dragTitle' | 'dragBody' | 'close' | 'relaunch' | 'relaunchHint' | 'montereyHint' | 'sequoiaHint' | 'computerUnsupported' | 'systemLine'
    | 'unavailable' | 'windowsScreenHint' | 'install' | 'essential' | 'optional' | 'notifyTest';

const zh: Readonly<Record<Key, string>> = {
    nav: '系统权限', title: '系统权限', intro: '这里列出 NextMux 需要的系统权限和当前授权状态。点击“授权”会按你当前的系统版本弹出正确的系统提示或打开对应的设置页。',
    granted: '已授权', denied: '未授权', notDetermined: '未请求', unknown: '使用时询问', restricted: '被系统限制',
    allow: '授权', openSettings: '打开系统设置', refresh: '重新检查',
    accessibility: '辅助功能', accessibilityHint: '让 AI 在你允许时点击、输入并读取应用界面（电脑控制）。',
    screen: '屏幕录制', screenAudio: '屏幕与系统录音', screenHint: '让 AI 看到屏幕内容，完成电脑控制、截图和录屏。',
    microphone: '麦克风', microphoneHint: '语音输入和漫剧剪辑的语音操作。',
    speechRecognition: '语音识别', speechRecognitionHint: '把你说的话在本机实时转成文字，语音指令不经过网络。',
    notifications: '通知', notificationsHint: '任务在后台完成时提醒你，点一下回到对应对话。',
    automation: '自动化（Apple 事件）', automationHint: 'AI 通过 AppleScript 控制其他应用时，系统会逐个应用询问。',
    files: '文件与文件夹', filesHint: '访问“桌面”“文稿”“下载”等文件夹时系统会询问；项目文件夹通常不需要。',
    fullDisk: '完全磁盘访问', fullDiskHint: '只在需要让 AI 读取受保护的位置（如邮件、系统资料库）时开启。',
    inputMonitoring: '输入监控', inputMonitoringHint: '全局快捷键或录制键盘操作时需要；普通使用不需要。',
    appManagement: 'App 管理', appManagementHint: 'AI 帮你更新、安装或删除其他 App 时需要。',
    localNetwork: '本地网络', localNetworkHint: '连接局域网里的远程桌面、虚拟机或本地模型服务时需要。',
    workerHint: 'Windows 的电脑控制需要一次性安装系统组件（会弹出管理员确认）。',
    dragTitle: '把 NextMux 图标拖到上方列表中', dragBody: '放进系统设置的列表后，打开它旁边的开关。', close: '关闭',
    relaunch: '重新打开 NextMux', relaunchHint: '屏幕录制授权后，需要重新打开 NextMux 才会生效。',
    montereyHint: 'macOS 12：先点系统偏好设置左下角的锁解锁，再勾选或拖入 NextMux。',
    sequoiaHint: 'macOS 15 起，系统会定期再次确认屏幕录制权限，出现提示时选择“允许”即可。',
    computerUnsupported: '电脑控制需要 macOS 13 或更高版本，或 Windows 10（1809）及以上版本；其他功能不受影响。',
    systemLine: '当前系统', unavailable: '当前环境无法读取系统权限。', windowsScreenHint: 'Windows 桌面应用无需单独授权屏幕录制。', windowsMicrophoneHint: 'NextMux 属于桌面应用，不会单独出现在麦克风列表里：在打开的页面中打开“麦克风访问权限”和“允许桌面应用访问你的麦克风”即可。', install: '安装组件',
    essential: '核心功能需要', optional: '按需开启', notifyTest: 'NextMux 通知已开启'
};

const zhTW: Readonly<Record<Key, string>> = {
    nav: '系統權限', title: '系統權限', intro: '這裡列出 NextMux 需要的系統權限與目前授權狀態。點擊「授權」會依你目前的系統版本顯示正確的系統提示或開啟對應設定頁。',
    granted: '已授權', denied: '未授權', notDetermined: '尚未請求', unknown: '使用時詢問', restricted: '受系統限制', allow: '授權', openSettings: '開啟系統設定', refresh: '重新檢查',
    accessibility: '輔助使用', accessibilityHint: '讓 AI 在你允許時點擊、輸入並讀取 App 介面（電腦控制）。',
    screen: '螢幕錄製', screenAudio: '螢幕與系統錄音', screenHint: '讓 AI 看見螢幕內容，完成電腦控制、截圖與錄影。',
    microphone: '麥克風', microphoneHint: '語音輸入與漫劇剪輯的語音操作。',
    speechRecognition: '語音辨識', speechRecognitionHint: '在本機即時把你說的話轉成文字，語音指令不經過網路。',
    notifications: '通知', notificationsHint: '任務在背景完成時提醒你，點一下回到對應對話。',
    automation: '自動化（Apple 事件）', automationHint: 'AI 透過 AppleScript 控制其他 App 時，系統會逐一詢問。',
    files: '檔案與檔案夾', filesHint: '取用「桌面」「文件」「下載項目」等資料夾時系統會詢問；專案資料夾通常不需要。',
    fullDisk: '完整磁碟取用權', fullDiskHint: '僅在需要讓 AI 讀取受保護位置（如郵件、系統資料庫）時開啟。',
    inputMonitoring: '輸入監控', inputMonitoringHint: '全域快速鍵或錄製鍵盤操作時需要；一般使用不需要。',
    appManagement: 'App 管理', appManagementHint: 'AI 幫你更新、安裝或刪除其他 App 時需要。',
    localNetwork: '區域網路', localNetworkHint: '連線區域網路中的遠端桌面、虛擬機或本機模型服務時需要。',
    workerHint: 'Windows 的電腦控制需要一次性安裝系統元件（會出現系統管理員確認）。',
    dragTitle: '把 NextMux 圖示拖到上方列表中', dragBody: '放進系統設定的列表後，開啟旁邊的開關。', close: '關閉',
    relaunch: '重新開啟 NextMux', relaunchHint: '螢幕錄製授權後，需要重新開啟 NextMux 才會生效。',
    montereyHint: 'macOS 12：先點系統偏好設定左下角的鎖頭解鎖，再勾選或拖入 NextMux。', sequoiaHint: '自 macOS 15 起，系統會定期再次確認螢幕錄製權限，出現提示時選擇「允許」。',
    computerUnsupported: '電腦控制需要 macOS 13 或更新版本，或 Windows 10（1809）以上；其他功能不受影響。',
    systemLine: '目前系統', unavailable: '目前環境無法讀取系統權限。', windowsScreenHint: 'Windows 桌面 App 不需另外授權螢幕錄製。', windowsMicrophoneHint: 'NextMux 屬於桌面 App，不會單獨出現在麥克風清單中：在開啟的頁面中開啟「麥克風存取」與「允許桌面應用程式存取您的麥克風」即可。', install: '安裝元件',
    essential: '核心功能需要', optional: '依需求開啟', notifyTest: 'NextMux 通知已開啟'
};

const en: Readonly<Record<Key, string>> = {
    nav: 'System permissions', title: 'System permissions', intro: 'What the operating system has granted NextMux, and what is still needed. “Allow” shows the right system prompt or settings page for your exact system version.',
    granted: 'Allowed', denied: 'Not allowed', notDetermined: 'Not asked yet', unknown: 'Asked when used', restricted: 'Restricted by the system',
    allow: 'Allow', openSettings: 'Open System Settings', refresh: 'Check again',
    accessibility: 'Accessibility', accessibilityHint: 'Lets the AI click, type and read app interfaces when you allow computer control.',
    screen: 'Screen Recording', screenAudio: 'Screen & System Audio Recording', screenHint: 'Lets the AI see the screen for computer control, screenshots and recordings.',
    microphone: 'Microphone', microphoneHint: 'Voice input and voice commands in the comic editor.',
    speechRecognition: 'Speech Recognition', speechRecognitionHint: 'Turns what you say into text on this computer in real time; voice commands never leave the device.',
    notifications: 'Notifications', notificationsHint: 'Tells you when a background task finishes; click to return to the conversation.',
    automation: 'Automation (Apple Events)', automationHint: 'When the AI controls another app through AppleScript, macOS asks once per app.',
    files: 'Files & Folders', filesHint: 'macOS asks before Desktop, Documents or Downloads is opened; project folders usually need nothing.',
    fullDisk: 'Full Disk Access', fullDiskHint: 'Only needed when the AI must read protected places such as Mail or the system library.',
    inputMonitoring: 'Input Monitoring', inputMonitoringHint: 'Needed for global shortcuts or recording keystrokes; everyday use does not need it.',
    appManagement: 'App Management', appManagementHint: 'Needed when the AI updates, installs or removes other apps for you.',
    localNetwork: 'Local Network', localNetworkHint: 'Needed to reach remote desktops, virtual machines or model servers on your network.',
    workerHint: 'Computer control on Windows needs a one-time system component (an administrator prompt appears).',
    dragTitle: 'Drag the NextMux icon into the list above', dragBody: 'Drop the icon into the list in System Settings, then turn on its switch.', close: 'Close',
    relaunch: 'Reopen NextMux', relaunchHint: 'Screen Recording takes effect after NextMux reopens.',
    montereyHint: 'macOS 12: click the lock in System Preferences first, then tick or drop NextMux.',
    sequoiaHint: 'From macOS 15 the system periodically re-confirms Screen Recording; choose Allow when asked.',
    computerUnsupported: 'Computer control needs macOS 13 or later, or Windows 10 (1809) or later. Everything else works.',
    systemLine: 'This system', unavailable: 'System permissions cannot be read in this environment.', windowsScreenHint: 'Windows desktop apps need no separate screen permission.', windowsMicrophoneHint: 'NextMux is a desktop app, so it is not listed by name: on the page that opens, turn on “Microphone access” and “Let desktop apps access your microphone”.', install: 'Install component',
    essential: 'Needed for core features', optional: 'Only when you need them', notifyTest: 'NextMux notifications are on'
};

const ja: Readonly<Record<Key, string>> = { ...en,
    nav: 'システム権限', title: 'システム権限', intro: 'NextMux に許可されている権限と、まだ必要な権限です。「許可」を押すと、お使いのシステムのバージョンに合ったプロンプトまたは設定画面を開きます。',
    granted: '許可済み', denied: '未許可', notDetermined: '未確認', unknown: '使用時に確認', restricted: 'システムにより制限', allow: '許可', openSettings: 'システム設定を開く', refresh: '再確認',
    accessibility: 'アクセシビリティ', accessibilityHint: 'コンピューター操作を許可したときに、AI がクリック・入力・画面の読み取りを行います。',
    screen: '画面収録', screenAudio: '画面とシステムオーディオの収録', screenHint: 'コンピューター操作、スクリーンショット、画面収録のために AI が画面を見られるようにします。',
    microphone: 'マイク', microphoneHint: '音声入力とコミック編集の音声操作。', speechRecognition: '音声認識', speechRecognitionHint: '話した内容をこのコンピューターでリアルタイムに文字にします。音声コマンドは外部に送信されません。',
    notifications: '通知', notificationsHint: 'バックグラウンドのタスクが終わると知らせます。クリックで会話に戻ります。',
    automation: 'オートメーション（Apple イベント）', automationHint: 'AI が AppleScript で他のアプリを操作するとき、macOS がアプリごとに確認します。',
    files: 'ファイルとフォルダー', filesHint: 'デスクトップ、書類、ダウンロードを開く前に macOS が確認します。プロジェクトフォルダーには通常不要です。',
    fullDisk: 'フルディスクアクセス', fullDiskHint: 'メールやシステムライブラリなど保護された場所を読む必要があるときだけ。',
    inputMonitoring: '入力監視', inputMonitoringHint: 'グローバルショートカットやキー操作の記録に必要です。通常は不要です。', appManagement: 'App 管理', appManagementHint: 'AI が他のアプリを更新・インストール・削除するときに必要です。',
    localNetwork: 'ローカルネットワーク', localNetworkHint: 'ネットワーク上のリモートデスクトップ、仮想マシン、モデルサーバーに接続するときに必要です。',
    workerHint: 'Windows のコンピューター操作には一度だけシステムコンポーネントのインストールが必要です（管理者の確認が表示されます）。',
    dragTitle: 'NextMux のアイコンを上のリストへドラッグ', dragBody: 'アイコンをシステム設定のリストにドロップし、スイッチをオンにします。', close: '閉じる', relaunch: 'NextMux を再起動', relaunchHint: '画面収録は NextMux の再起動後に有効になります。',
    montereyHint: 'macOS 12：システム環境設定の鍵をクリックしてから、NextMux にチェックするかドロップします。', sequoiaHint: 'macOS 15 以降は画面収録の許可が定期的に再確認されます。表示されたら「許可」を選んでください。',
    computerUnsupported: 'コンピューター操作には macOS 13 以降、または Windows 10（1809）以降が必要です。その他の機能は使えます。',
    systemLine: 'このシステム', unavailable: 'この環境ではシステム権限を読み取れません。', windowsScreenHint: 'Windows のデスクトップアプリは画面の許可が不要です。', install: 'コンポーネントをインストール',
    essential: '主要機能に必要', optional: '必要なときだけ', notifyTest: 'NextMux の通知がオンになりました' };

const ko: Readonly<Record<Key, string>> = { ...en,
    nav: '시스템 권한', title: '시스템 권한', intro: 'NextMux에 허용된 권한과 아직 필요한 권한입니다. “허용”을 누르면 현재 시스템 버전에 맞는 요청 창이나 설정 페이지가 열립니다.',
    granted: '허용됨', denied: '허용 안 됨', notDetermined: '요청 전', unknown: '사용 시 요청', restricted: '시스템에서 제한됨', allow: '허용', openSettings: '시스템 설정 열기', refresh: '다시 확인',
    accessibility: '손쉬운 사용', accessibilityHint: '컴퓨터 제어를 허용하면 AI가 앱을 클릭하고 입력하며 화면을 읽습니다.',
    screen: '화면 기록', screenAudio: '화면 및 시스템 오디오 기록', screenHint: '컴퓨터 제어, 스크린샷, 화면 녹화를 위해 AI가 화면을 볼 수 있게 합니다.',
    microphone: '마이크', microphoneHint: '음성 입력과 만화극 편집의 음성 조작.', speechRecognition: '음성 인식', speechRecognitionHint: '말한 내용을 이 컴퓨터에서 실시간으로 텍스트로 바꿉니다. 음성 명령은 외부로 전송되지 않습니다.',
    notifications: '알림', notificationsHint: '백그라운드 작업이 끝나면 알려 줍니다. 클릭하면 대화로 돌아갑니다.',
    automation: '자동화(Apple 이벤트)', automationHint: 'AI가 AppleScript로 다른 앱을 제어할 때 macOS가 앱마다 확인합니다.',
    files: '파일 및 폴더', filesHint: '데스크탑, 문서, 다운로드 폴더를 열기 전에 macOS가 묻습니다. 프로젝트 폴더에는 보통 필요 없습니다.',
    fullDisk: '전체 디스크 접근', fullDiskHint: 'Mail이나 시스템 라이브러리 같은 보호된 위치를 읽어야 할 때만 필요합니다.',
    inputMonitoring: '입력 모니터링', inputMonitoringHint: '전역 단축키나 키 입력 기록에 필요합니다. 일반 사용에는 필요 없습니다.', appManagement: '앱 관리', appManagementHint: 'AI가 다른 앱을 업데이트, 설치, 삭제할 때 필요합니다.',
    localNetwork: '로컬 네트워크', localNetworkHint: '네트워크의 원격 데스크톱, 가상 머신, 모델 서버에 연결할 때 필요합니다.',
    workerHint: 'Windows에서 컴퓨터 제어를 하려면 시스템 구성 요소를 한 번 설치해야 합니다(관리자 확인이 표시됩니다).',
    dragTitle: 'NextMux 아이콘을 위 목록으로 드래그', dragBody: '아이콘을 시스템 설정 목록에 놓고 스위치를 켜세요.', close: '닫기', relaunch: 'NextMux 다시 열기', relaunchHint: '화면 기록은 NextMux를 다시 연 뒤에 적용됩니다.',
    montereyHint: 'macOS 12: 시스템 환경설정의 자물쇠를 먼저 클릭한 뒤 NextMux를 체크하거나 끌어 놓으세요.', sequoiaHint: 'macOS 15부터 화면 기록 권한을 주기적으로 다시 확인합니다. 요청이 뜨면 “허용”을 선택하세요.',
    computerUnsupported: '컴퓨터 제어에는 macOS 13 이상 또는 Windows 10(1809) 이상이 필요합니다. 다른 기능은 모두 사용할 수 있습니다.',
    systemLine: '현재 시스템', unavailable: '이 환경에서는 시스템 권한을 읽을 수 없습니다.', windowsScreenHint: 'Windows 데스크톱 앱은 화면 권한이 따로 필요 없습니다.', install: '구성 요소 설치',
    essential: '핵심 기능에 필요', optional: '필요할 때만', notifyTest: 'NextMux 알림이 켜졌습니다' };

const es: Readonly<Record<Key, string>> = { ...en, nav: 'Permisos del sistema', title: 'Permisos del sistema', intro: 'Lo que el sistema ha permitido a NextMux y lo que aún falta. «Permitir» abre el aviso o la página de ajustes adecuada para tu versión del sistema.', granted: 'Permitido', denied: 'No permitido', notDetermined: 'Aún no solicitado', unknown: 'Se pide al usarlo', restricted: 'Restringido por el sistema', allow: 'Permitir', openSettings: 'Abrir Ajustes del Sistema', refresh: 'Comprobar de nuevo', accessibility: 'Accesibilidad', accessibilityHint: 'Permite a la IA hacer clic, escribir y leer apps cuando autorizas el control del equipo.', screen: 'Grabación de pantalla', screenAudio: 'Grabación de pantalla y audio del sistema', screenHint: 'Permite a la IA ver la pantalla para controlar el equipo, capturas y grabaciones.', microphone: 'Micrófono', microphoneHint: 'Entrada de voz y comandos de voz en el editor de cómics.', speechRecognition: 'Reconocimiento de voz', speechRecognitionHint: 'Convierte lo que dices en texto en este equipo al instante; los comandos de voz no salen del dispositivo.', notifications: 'Notificaciones', notificationsHint: 'Te avisa cuando termina una tarea en segundo plano; pulsa para volver a la conversación.', automation: 'Automatización (eventos de Apple)', automationHint: 'Cuando la IA controla otra app con AppleScript, macOS pregunta una vez por app.', files: 'Archivos y carpetas', filesHint: 'macOS pregunta antes de abrir Escritorio, Documentos o Descargas; las carpetas de proyecto no suelen necesitarlo.', fullDisk: 'Acceso total al disco', fullDiskHint: 'Solo si la IA debe leer lugares protegidos como Mail o la biblioteca del sistema.', inputMonitoring: 'Monitorización de entrada', inputMonitoringHint: 'Necesario para atajos globales o grabar pulsaciones; el uso normal no lo necesita.', appManagement: 'Gestión de apps', appManagementHint: 'Necesario cuando la IA actualiza, instala o elimina otras apps por ti.', localNetwork: 'Red local', localNetworkHint: 'Necesario para conectar con escritorios remotos, máquinas virtuales o servidores de modelos de tu red.', workerHint: 'El control del equipo en Windows necesita instalar una vez un componente del sistema (aparece un aviso de administrador).', dragTitle: 'Arrastra el icono de NextMux a la lista de arriba', dragBody: 'Suelta el icono en la lista de Ajustes del Sistema y activa su interruptor.', close: 'Cerrar', relaunch: 'Reabrir NextMux', relaunchHint: 'La grabación de pantalla se aplica al reabrir NextMux.', montereyHint: 'macOS 12: pulsa primero el candado de Preferencias del Sistema y luego marca o suelta NextMux.', sequoiaHint: 'Desde macOS 15 el sistema vuelve a confirmar la grabación de pantalla; elige Permitir cuando se pida.', computerUnsupported: 'El control del equipo requiere macOS 13 o posterior, o Windows 10 (1809) o posterior. Lo demás funciona.', systemLine: 'Este sistema', unavailable: 'No se pueden leer los permisos del sistema en este entorno.', windowsScreenHint: 'Las apps de escritorio de Windows no necesitan permiso de pantalla.', install: 'Instalar componente', essential: 'Necesarios para las funciones principales', optional: 'Solo cuando los necesites', notifyTest: 'Las notificaciones de NextMux están activadas' };

const fr: Readonly<Record<Key, string>> = { ...en, nav: 'Autorisations système', title: 'Autorisations système', intro: 'Ce que le système a autorisé pour NextMux et ce qui manque encore. « Autoriser » ouvre l’invite ou la page de réglages adaptée à votre version.', granted: 'Autorisé', denied: 'Non autorisé', notDetermined: 'Pas encore demandé', unknown: 'Demandé à l’usage', restricted: 'Restreint par le système', allow: 'Autoriser', openSettings: 'Ouvrir les Réglages Système', refresh: 'Vérifier à nouveau', accessibility: 'Accessibilité', accessibilityHint: 'Permet à l’IA de cliquer, saisir et lire les apps quand vous autorisez le contrôle de l’ordinateur.', screen: 'Enregistrement de l’écran', screenAudio: 'Enregistrement de l’écran et de l’audio système', screenHint: 'Permet à l’IA de voir l’écran pour le contrôle, les captures et les enregistrements.', microphone: 'Micro', microphoneHint: 'Saisie vocale et commandes vocales du montage.', speechRecognition: 'Reconnaissance vocale', speechRecognitionHint: 'Transforme votre voix en texte sur cet ordinateur en temps réel ; les commandes ne quittent pas l’appareil.', notifications: 'Notifications', notificationsHint: 'Vous prévient quand une tâche en arrière-plan se termine ; cliquez pour revenir à la conversation.', automation: 'Automatisation (événements Apple)', automationHint: 'Quand l’IA pilote une autre app via AppleScript, macOS demande une fois par app.', files: 'Fichiers et dossiers', filesHint: 'macOS demande avant d’ouvrir Bureau, Documents ou Téléchargements ; les dossiers de projet n’en ont généralement pas besoin.', fullDisk: 'Accès complet au disque', fullDiskHint: 'Seulement si l’IA doit lire des emplacements protégés comme Mail ou la bibliothèque système.', inputMonitoring: 'Surveillance de l’entrée', inputMonitoringHint: 'Nécessaire pour les raccourcis globaux ou l’enregistrement des frappes ; inutile au quotidien.', appManagement: 'Gestion des apps', appManagementHint: 'Nécessaire quand l’IA met à jour, installe ou supprime d’autres apps.', localNetwork: 'Réseau local', localNetworkHint: 'Nécessaire pour joindre bureaux distants, machines virtuelles ou serveurs de modèles sur votre réseau.', workerHint: 'Le contrôle de l’ordinateur sous Windows nécessite d’installer une fois un composant système (une invite administrateur s’affiche).', dragTitle: 'Faites glisser l’icône NextMux dans la liste ci-dessus', dragBody: 'Déposez l’icône dans la liste des Réglages Système, puis activez son interrupteur.', close: 'Fermer', relaunch: 'Rouvrir NextMux', relaunchHint: 'L’enregistrement de l’écran s’applique après la réouverture de NextMux.', montereyHint: 'macOS 12 : cliquez d’abord sur le cadenas des Préférences Système, puis cochez ou déposez NextMux.', sequoiaHint: 'Depuis macOS 15, le système reconfirme régulièrement l’enregistrement de l’écran ; choisissez Autoriser.', computerUnsupported: 'Le contrôle de l’ordinateur requiert macOS 13 ou ultérieur, ou Windows 10 (1809) ou ultérieur. Le reste fonctionne.', systemLine: 'Ce système', unavailable: 'Impossible de lire les autorisations dans cet environnement.', windowsScreenHint: 'Les apps de bureau Windows n’ont pas besoin d’autorisation d’écran.', install: 'Installer le composant', essential: 'Nécessaires aux fonctions principales', optional: 'Seulement si besoin', notifyTest: 'Les notifications NextMux sont activées' };

const de: Readonly<Record<Key, string>> = { ...en, nav: 'Systemberechtigungen', title: 'Systemberechtigungen', intro: 'Was das System NextMux erlaubt hat und was noch fehlt. „Erlauben“ öffnet die passende Abfrage oder Einstellungsseite für Ihre Systemversion.', granted: 'Erlaubt', denied: 'Nicht erlaubt', notDetermined: 'Noch nicht angefragt', unknown: 'Wird bei Nutzung gefragt', restricted: 'Vom System eingeschränkt', allow: 'Erlauben', openSettings: 'Systemeinstellungen öffnen', refresh: 'Erneut prüfen', accessibility: 'Bedienungshilfen', accessibilityHint: 'Die KI darf klicken, tippen und Apps lesen, wenn Sie die Computersteuerung erlauben.', screen: 'Bildschirmaufnahme', screenAudio: 'Bildschirm- und Systemaudioaufnahme', screenHint: 'Die KI sieht den Bildschirm für Steuerung, Screenshots und Aufnahmen.', microphone: 'Mikrofon', microphoneHint: 'Spracheingabe und Sprachbefehle im Comic-Schnitt.', speechRecognition: 'Spracherkennung', speechRecognitionHint: 'Wandelt Gesprochenes auf diesem Computer sofort in Text; Sprachbefehle verlassen das Gerät nicht.', notifications: 'Mitteilungen', notificationsHint: 'Meldet, wenn eine Hintergrundaufgabe fertig ist; ein Klick führt zur Unterhaltung.', automation: 'Automation (Apple-Events)', automationHint: 'Steuert die KI eine andere App per AppleScript, fragt macOS einmal pro App.', files: 'Dateien und Ordner', filesHint: 'macOS fragt, bevor Schreibtisch, Dokumente oder Downloads geöffnet werden; Projektordner brauchen das meist nicht.', fullDisk: 'Festplattenvollzugriff', fullDiskHint: 'Nur wenn die KI geschützte Orte wie Mail oder die Systembibliothek lesen muss.', inputMonitoring: 'Eingabeüberwachung', inputMonitoringHint: 'Für globale Kurzbefehle oder das Aufzeichnen von Tastenanschlägen; im Alltag nicht nötig.', appManagement: 'App-Verwaltung', appManagementHint: 'Nötig, wenn die KI andere Apps aktualisiert, installiert oder entfernt.', localNetwork: 'Lokales Netzwerk', localNetworkHint: 'Nötig für Remote-Desktops, virtuelle Maschinen oder Modellserver im Netzwerk.', workerHint: 'Die Computersteuerung unter Windows braucht einmalig eine Systemkomponente (eine Administratorabfrage erscheint).', dragTitle: 'Das NextMux-Symbol in die Liste oben ziehen', dragBody: 'Symbol in die Liste der Systemeinstellungen ziehen und den Schalter einschalten.', close: 'Schließen', relaunch: 'NextMux neu öffnen', relaunchHint: 'Die Bildschirmaufnahme gilt nach dem Neustart von NextMux.', montereyHint: 'macOS 12: Zuerst das Schloss in den Systemeinstellungen anklicken, dann NextMux ankreuzen oder hineinziehen.', sequoiaHint: 'Ab macOS 15 bestätigt das System die Bildschirmaufnahme regelmäßig neu; wählen Sie Erlauben.', computerUnsupported: 'Computersteuerung erfordert macOS 13 oder neuer bzw. Windows 10 (1809) oder neuer. Alles andere funktioniert.', systemLine: 'Dieses System', unavailable: 'Systemberechtigungen können hier nicht gelesen werden.', windowsScreenHint: 'Windows-Desktop-Apps brauchen keine Bildschirmberechtigung.', install: 'Komponente installieren', essential: 'Für Kernfunktionen nötig', optional: 'Nur bei Bedarf', notifyTest: 'NextMux-Mitteilungen sind aktiv' };

const ptBR: Readonly<Record<Key, string>> = { ...en, nav: 'Permissões do sistema', title: 'Permissões do sistema', intro: 'O que o sistema já permitiu ao NextMux e o que ainda falta. “Permitir” abre o aviso ou a página de ajustes certa para a sua versão.', granted: 'Permitido', denied: 'Não permitido', notDetermined: 'Ainda não pedido', unknown: 'Pedido ao usar', restricted: 'Restrito pelo sistema', allow: 'Permitir', openSettings: 'Abrir Ajustes do Sistema', refresh: 'Verificar de novo', accessibility: 'Acessibilidade', accessibilityHint: 'Permite que a IA clique, digite e leia apps quando você autoriza o controle do computador.', screen: 'Gravação de tela', screenAudio: 'Gravação de tela e áudio do sistema', screenHint: 'Permite que a IA veja a tela para controle, capturas e gravações.', microphone: 'Microfone', microphoneHint: 'Entrada de voz e comandos de voz na edição.', speechRecognition: 'Reconhecimento de fala', speechRecognitionHint: 'Transforma sua fala em texto neste computador na hora; os comandos não saem do dispositivo.', notifications: 'Notificações', notificationsHint: 'Avisa quando uma tarefa em segundo plano termina; clique para voltar à conversa.', automation: 'Automação (eventos da Apple)', automationHint: 'Quando a IA controla outro app por AppleScript, o macOS pergunta uma vez por app.', files: 'Arquivos e pastas', filesHint: 'O macOS pergunta antes de abrir Mesa, Documentos ou Downloads; pastas de projeto geralmente não precisam.', fullDisk: 'Acesso Total ao Disco', fullDiskHint: 'Só se a IA precisar ler locais protegidos como Mail ou a biblioteca do sistema.', inputMonitoring: 'Monitoramento de entrada', inputMonitoringHint: 'Necessário para atalhos globais ou gravar teclas; o uso comum não precisa.', appManagement: 'Gerenciamento de apps', appManagementHint: 'Necessário quando a IA atualiza, instala ou remove outros apps.', localNetwork: 'Rede local', localNetworkHint: 'Necessário para acessar áreas de trabalho remotas, máquinas virtuais ou servidores de modelos na rede.', workerHint: 'O controle do computador no Windows precisa instalar uma vez um componente do sistema (aparece um aviso de administrador).', dragTitle: 'Arraste o ícone do NextMux para a lista acima', dragBody: 'Solte o ícone na lista dos Ajustes do Sistema e ative o interruptor.', close: 'Fechar', relaunch: 'Reabrir o NextMux', relaunchHint: 'A gravação de tela vale depois de reabrir o NextMux.', montereyHint: 'macOS 12: clique primeiro no cadeado das Preferências do Sistema e depois marque ou solte o NextMux.', sequoiaHint: 'A partir do macOS 15 o sistema reconfirma a gravação de tela; escolha Permitir quando pedir.', computerUnsupported: 'O controle do computador exige macOS 13 ou posterior, ou Windows 10 (1809) ou posterior. O resto funciona.', systemLine: 'Este sistema', unavailable: 'Não é possível ler as permissões neste ambiente.', windowsScreenHint: 'Apps de desktop do Windows não precisam de permissão de tela.', install: 'Instalar componente', essential: 'Necessárias para os recursos principais', optional: 'Só quando precisar', notifyTest: 'As notificações do NextMux estão ativas' };

const ru: Readonly<Record<Key, string>> = { ...en, nav: 'Системные разрешения', title: 'Системные разрешения', intro: 'Что система уже разрешила NextMux и что ещё нужно. «Разрешить» откроет подходящий запрос или страницу настроек для вашей версии системы.', granted: 'Разрешено', denied: 'Не разрешено', notDetermined: 'Ещё не запрошено', unknown: 'Спросят при использовании', restricted: 'Ограничено системой', allow: 'Разрешить', openSettings: 'Открыть настройки', refresh: 'Проверить снова', accessibility: 'Универсальный доступ', accessibilityHint: 'ИИ сможет нажимать, печатать и читать приложения, когда вы разрешите управление компьютером.', screen: 'Запись экрана', screenAudio: 'Запись экрана и системного звука', screenHint: 'ИИ видит экран для управления, снимков и записи.', microphone: 'Микрофон', microphoneHint: 'Голосовой ввод и голосовые команды в монтаже.', speechRecognition: 'Распознавание речи', speechRecognitionHint: 'Превращает речь в текст на этом компьютере в реальном времени; команды не покидают устройство.', notifications: 'Уведомления', notificationsHint: 'Сообщает о завершении фоновой задачи; нажмите, чтобы вернуться к беседе.', automation: 'Автоматизация (события Apple)', automationHint: 'Когда ИИ управляет другим приложением через AppleScript, macOS спрашивает для каждого приложения.', files: 'Файлы и папки', filesHint: 'macOS спросит перед открытием Рабочего стола, Документов или Загрузок; папкам проектов это обычно не нужно.', fullDisk: 'Полный доступ к диску', fullDiskHint: 'Нужен, только если ИИ должен читать защищённые места, например Почту или системную библиотеку.', inputMonitoring: 'Мониторинг ввода', inputMonitoringHint: 'Нужен для глобальных сочетаний клавиш или записи нажатий; обычно не требуется.', appManagement: 'Управление приложениями', appManagementHint: 'Нужно, когда ИИ обновляет, устанавливает или удаляет другие приложения.', localNetwork: 'Локальная сеть', localNetworkHint: 'Нужно для удалённых рабочих столов, виртуальных машин или серверов моделей в сети.', workerHint: 'Для управления компьютером в Windows нужно один раз установить системный компонент (появится запрос администратора).', dragTitle: 'Перетащите значок NextMux в список выше', dragBody: 'Бросьте значок в список в Системных настройках и включите переключатель.', close: 'Закрыть', relaunch: 'Перезапустить NextMux', relaunchHint: 'Запись экрана начнёт работать после перезапуска NextMux.', montereyHint: 'macOS 12: сначала нажмите на замок в Системных настройках, затем отметьте или перетащите NextMux.', sequoiaHint: 'С macOS 15 система периодически переспрашивает запись экрана; выберите «Разрешить».', computerUnsupported: 'Для управления компьютером нужна macOS 13 или новее либо Windows 10 (1809) или новее. Остальное работает.', systemLine: 'Эта система', unavailable: 'В этой среде нельзя прочитать системные разрешения.', windowsScreenHint: 'Настольным приложениям Windows не нужно разрешение на экран.', install: 'Установить компонент', essential: 'Нужны для основных функций', optional: 'Только при необходимости', notifyTest: 'Уведомления NextMux включены' };

const ar: Readonly<Record<Key, string>> = { ...en, nav: 'أذونات النظام', title: 'أذونات النظام', intro: 'ما سمح به النظام لـ NextMux وما زال مطلوبًا. «السماح» يفتح الطلب أو صفحة الإعدادات المناسبة لإصدار نظامك.', granted: 'مسموح', denied: 'غير مسموح', notDetermined: 'لم يُطلب بعد', unknown: 'يُطلب عند الاستخدام', restricted: 'مقيد من النظام', allow: 'السماح', openSettings: 'فتح إعدادات النظام', refresh: 'إعادة الفحص', accessibility: 'تسهيلات الاستخدام', accessibilityHint: 'يتيح للذكاء الاصطناعي النقر والكتابة وقراءة التطبيقات عند السماح بالتحكم في الكمبيوتر.', screen: 'تسجيل الشاشة', screenAudio: 'تسجيل الشاشة وصوت النظام', screenHint: 'يتيح للذكاء الاصطناعي رؤية الشاشة للتحكم واللقطات والتسجيل.', microphone: 'الميكروفون', microphoneHint: 'الإدخال الصوتي والأوامر الصوتية في المونتاج.', speechRecognition: 'التعرف على الكلام', speechRecognitionHint: 'يحوّل كلامك إلى نص على هذا الكمبيوتر فورًا؛ الأوامر الصوتية لا تغادر الجهاز.', notifications: 'الإشعارات', notificationsHint: 'ينبهك عند انتهاء مهمة في الخلفية؛ انقر للعودة إلى المحادثة.', automation: 'الأتمتة (أحداث Apple)', automationHint: 'عندما يتحكم الذكاء الاصطناعي بتطبيق آخر عبر AppleScript يسأل macOS مرة لكل تطبيق.', files: 'الملفات والمجلدات', filesHint: 'يسأل macOS قبل فتح سطح المكتب أو المستندات أو التنزيلات؛ مجلدات المشاريع لا تحتاج ذلك عادةً.', fullDisk: 'الوصول الكامل إلى القرص', fullDiskHint: 'فقط إذا احتاج الذكاء الاصطناعي إلى قراءة أماكن محمية مثل البريد أو مكتبة النظام.', inputMonitoring: 'مراقبة الإدخال', inputMonitoringHint: 'مطلوب للاختصارات العامة أو تسجيل ضغطات المفاتيح؛ لا يلزم للاستخدام العادي.', appManagement: 'إدارة التطبيقات', appManagementHint: 'مطلوب عندما يحدّث الذكاء الاصطناعي تطبيقات أخرى أو يثبتها أو يزيلها.', localNetwork: 'الشبكة المحلية', localNetworkHint: 'مطلوب للاتصال بأسطح المكتب البعيدة أو الأجهزة الافتراضية أو خوادم النماذج في شبكتك.', workerHint: 'يتطلب التحكم في الكمبيوتر على Windows تثبيت مكوّن نظام مرة واحدة (يظهر طلب مسؤول).', dragTitle: 'اسحب أيقونة NextMux إلى القائمة أعلاه', dragBody: 'أفلت الأيقونة في قائمة إعدادات النظام ثم فعّل مفتاحها.', close: 'إغلاق', relaunch: 'إعادة فتح NextMux', relaunchHint: 'يسري تسجيل الشاشة بعد إعادة فتح NextMux.', montereyHint: 'macOS 12: انقر القفل في تفضيلات النظام أولًا ثم حدّد NextMux أو أفلته.', sequoiaHint: 'منذ macOS 15 يعيد النظام تأكيد تسجيل الشاشة دوريًا؛ اختر «السماح».', computerUnsupported: 'يتطلب التحكم في الكمبيوتر macOS 13 أو أحدث، أو Windows 10 (1809) أو أحدث. كل شيء آخر يعمل.', systemLine: 'هذا النظام', unavailable: 'لا يمكن قراءة أذونات النظام في هذه البيئة.', windowsScreenHint: 'لا تحتاج تطبيقات سطح المكتب في Windows إلى إذن للشاشة.', install: 'تثبيت المكوّن', essential: 'مطلوبة للميزات الأساسية', optional: 'عند الحاجة فقط', notifyTest: 'إشعارات NextMux مفعّلة' };

const hi: Readonly<Record<Key, string>> = { ...en, nav: 'सिस्टम अनुमतियाँ', title: 'सिस्टम अनुमतियाँ', intro: 'सिस्टम ने NextMux को क्या अनुमति दी है और क्या अभी बाकी है। “अनुमति दें” आपके सिस्टम संस्करण के लिए सही संकेत या सेटिंग पेज खोलता है।', granted: 'अनुमति है', denied: 'अनुमति नहीं', notDetermined: 'अभी नहीं पूछा', unknown: 'उपयोग पर पूछा जाएगा', restricted: 'सिस्टम द्वारा सीमित', allow: 'अनुमति दें', openSettings: 'सिस्टम सेटिंग्स खोलें', refresh: 'फिर से जाँचें', accessibility: 'एक्सेसिबिलिटी', accessibilityHint: 'कंप्यूटर नियंत्रण की अनुमति देने पर AI क्लिक, टाइप और ऐप पढ़ सकता है।', screen: 'स्क्रीन रिकॉर्डिंग', screenAudio: 'स्क्रीन और सिस्टम ऑडियो रिकॉर्डिंग', screenHint: 'नियंत्रण, स्क्रीनशॉट और रिकॉर्डिंग के लिए AI स्क्रीन देख सकता है।', microphone: 'माइक्रोफ़ोन', microphoneHint: 'आवाज़ से इनपुट और संपादन के आवाज़ आदेश।', speechRecognition: 'वाक् पहचान', speechRecognitionHint: 'आपकी बात को इसी कंप्यूटर पर तुरंत टेक्स्ट बनाता है; आवाज़ आदेश डिवाइस से बाहर नहीं जाते।', notifications: 'सूचनाएँ', notificationsHint: 'पृष्ठभूमि कार्य पूरा होने पर बताता है; क्लिक करके बातचीत पर लौटें।', automation: 'ऑटोमेशन (Apple इवेंट)', automationHint: 'जब AI AppleScript से दूसरे ऐप को नियंत्रित करता है, macOS हर ऐप के लिए एक बार पूछता है।', files: 'फ़ाइलें और फ़ोल्डर', filesHint: 'डेस्कटॉप, दस्तावेज़ या डाउनलोड खोलने से पहले macOS पूछता है; प्रोजेक्ट फ़ोल्डर के लिए आमतौर पर ज़रूरी नहीं।', fullDisk: 'पूर्ण डिस्क एक्सेस', fullDiskHint: 'केवल तब जब AI को मेल या सिस्टम लाइब्रेरी जैसी सुरक्षित जगहें पढ़नी हों।', inputMonitoring: 'इनपुट मॉनिटरिंग', inputMonitoringHint: 'वैश्विक शॉर्टकट या कीस्ट्रोक रिकॉर्ड करने के लिए; सामान्य उपयोग में ज़रूरी नहीं।', appManagement: 'ऐप प्रबंधन', appManagementHint: 'जब AI दूसरे ऐप अपडेट, इंस्टॉल या हटाए तब ज़रूरी।', localNetwork: 'लोकल नेटवर्क', localNetworkHint: 'नेटवर्क पर रिमोट डेस्कटॉप, वर्चुअल मशीन या मॉडल सर्वर से जुड़ने के लिए ज़रूरी।', workerHint: 'Windows पर कंप्यूटर नियंत्रण के लिए एक बार सिस्टम घटक इंस्टॉल करना होता है (व्यवस्थापक पुष्टि दिखेगी)।', dragTitle: 'NextMux आइकन को ऊपर की सूची में खींचें', dragBody: 'आइकन को सिस्टम सेटिंग्स की सूची में छोड़ें और स्विच चालू करें।', close: 'बंद करें', relaunch: 'NextMux फिर खोलें', relaunchHint: 'स्क्रीन रिकॉर्डिंग NextMux फिर खोलने के बाद लागू होगी।', montereyHint: 'macOS 12: पहले सिस्टम प्रेफ़रेंस का ताला खोलें, फिर NextMux चुनें या छोड़ें।', sequoiaHint: 'macOS 15 से सिस्टम समय-समय पर स्क्रीन रिकॉर्डिंग की पुष्टि करता है; “अनुमति दें” चुनें।', computerUnsupported: 'कंप्यूटर नियंत्रण के लिए macOS 13 या नया, या Windows 10 (1809) या नया चाहिए। बाकी सब काम करता है।', systemLine: 'यह सिस्टम', unavailable: 'इस वातावरण में सिस्टम अनुमतियाँ नहीं पढ़ी जा सकतीं।', windowsScreenHint: 'Windows डेस्कटॉप ऐप्स को स्क्रीन अनुमति की ज़रूरत नहीं।', install: 'घटक इंस्टॉल करें', essential: 'मुख्य सुविधाओं के लिए ज़रूरी', optional: 'केवल ज़रूरत पर', notifyTest: 'NextMux सूचनाएँ चालू हैं' };

const catalog: Readonly<Record<NextMuxDesktopLocale, Readonly<Record<Key, string>>>> = { 'zh-CN': zh, 'zh-TW': zhTW, en, ja, ko, es, fr, de, 'pt-BR': ptBR, ru, ar, hi };

function uncheckedSystemPermissionsText(locale: NextMuxDesktopLocale, key: Key): string {
    return catalog[locale]?.[key] || en[key];
}

const ICONS: Readonly<Record<SystemPermissionKind, string>> = {
    accessibility: 'person', screen: 'screen-full', microphone: 'mic', speechRecognition: 'record-keys', notifications: 'bell',
    automation: 'symbol-event', files: 'folder', fullDisk: 'folder-library', inputMonitoring: 'keyboard', appManagement: 'extensions', localNetwork: 'broadcast'
};

function statusKey(status: SystemPermissionStatus): Key {
    return status === 'granted' ? 'granted' : status === 'not-determined' ? 'notDetermined' : status === 'restricted' ? 'restricted' : status === 'unknown' ? 'unknown' : 'denied';
}

function systemName(state: SystemPermissionsState): string {
    if (state.platform === 'darwin') return `macOS ${state.version >= 11 ? Math.floor(state.version) : state.version.toFixed(2)} · ${state.arch}`;
    if (state.platform === 'win32') return `${state.version >= 22000 ? 'Windows 11' : 'Windows 10'} (build ${state.version}) · ${state.arch}`;
    return `${state.platform} ${state.osRelease}`;
}

function usePermissionState(bridge: SystemPermissionsBridge | undefined): {
    readonly state: SystemPermissionsState | undefined; readonly loaded: boolean; readonly relaunchNeeded: boolean;
    readonly load: () => Promise<void>; readonly setState: (state: SystemPermissionsState) => void;
} {
    const [state, setState] = React.useState<SystemPermissionsState | undefined>();
    const [loaded, setLoaded] = React.useState(false);
    const [relaunchNeeded, setRelaunchNeeded] = React.useState(false);
    // Every new state (a change event, a refresh, the answer to a request) goes through here, so Screen Recording
    // turning granted always asks to reopen NextMux, whichever way it was seen first (audit A09-04).
    const apply = React.useCallback((next: SystemPermissionsState | undefined) => setState(previous => {
        const before = previous?.items.find(item => item.kind === 'screen')?.status;
        const after = next?.items.find(item => item.kind === 'screen')?.status;
        if (before && before !== 'granted' && after === 'granted') setRelaunchNeeded(true);
        return next;
    }), []);
    const load = React.useCallback(async () => {
        try { apply(await bridge?.getSystemPermissions?.()); } catch { setState(undefined); }
        setLoaded(true);
    }, [bridge, apply]);
    React.useEffect(() => {
        void load();
        const off = bridge?.onSystemPermissionsChanged?.(next => apply(next));
        return () => off?.();
    }, [bridge, load, apply]);
    return { state, loaded, relaunchNeeded, load, setState: apply };
}

/** The permission rows; used by Settings and by the first-run setup. */
export function SystemPermissionsList(props: {
    readonly locale: NextMuxDesktopLocale;
    readonly bridge: SystemPermissionsBridge | undefined;
    readonly essentialOnly?: boolean;
    readonly state: SystemPermissionsState;
    readonly onState: (state: SystemPermissionsState) => void;
    readonly microphoneSlot?: React.ReactNode;
    readonly microphoneStatus?: MicrophoneCapabilityStatus;
    readonly onRequestMicrophone?: () => Promise<MicrophoneCapability | void> | MicrophoneCapability | void;
}): React.ReactElement {
    const { locale, bridge, state } = props;
    const t = (key: Key) => systemPermissionsText(locale, key);
    const [busy, setBusy] = React.useState<SystemPermissionKind | ''>('');
    const [microphoneResult, setMicrophoneResult] = React.useState<{ status: MicrophoneCapabilityStatus; systemStatus: SystemPermissionStatus }>();
    const requesting = React.useRef(false);
    const request = async (item: SystemPermissionItem) => {
        if (requesting.current) return;
        requesting.current = true;
        setBusy(item.kind);
        let microphoneStatus: MicrophoneCapabilityStatus | undefined;
        try {
            if (item.kind === 'microphone') {
                // Settings already owns the permission probe. Running another
                // getUserMedia first caused duplicate requests on Windows.
                const result = props.onRequestMicrophone
                    ? await props.onRequestMicrophone()
                    : await requestMicrophoneAccess({ mediaDevices: navigator.mediaDevices, locale });
                microphoneStatus = result?.status;
                if (microphoneStatus) setMicrophoneResult({ status: microphoneStatus, systemStatus: item.status });
            }
            // getUserMedia already requests capture permission, including in setup.
            // Read the OS state afterwards; do not ask twice or open settings on success.
            const next = item.kind === 'microphone'
                ? await bridge?.getSystemPermissions?.()
                : await bridge?.requestSystemPermission?.(item.kind, { title: t('dragTitle'), body: t('dragBody'), close: t('close'), notificationTitle: 'NextMux', notificationBody: t('notifyTest'), locale });
            if (microphoneStatus) setMicrophoneResult({ status: microphoneStatus, systemStatus: next?.items.find(row => row.kind === 'microphone')?.status ?? item.status });
            if (next) props.onState(next);
        } catch (error) {
            // A failed native settings bridge must not leave the row busy or
            // turn a handled capture failure into an unhandled rejection.
            if (item.kind === 'microphone' && !microphoneStatus && (error as { name?: string } | null)?.name !== 'AbortError') {
                setMicrophoneResult({ status: microphoneStatusFromError(error), systemStatus: item.status });
            }
        } finally { requesting.current = false; setBusy(''); }
    };
    const row = (item: SystemPermissionItem): React.ReactNode => {
        // A later OS change invalidates an old local capture result. The settings
        // owner can also publish checks triggered by the inline device controls.
        const microphoneStatus = item.kind === 'microphone'
            ? props.microphoneStatus ?? (microphoneResult?.systemStatus === item.status ? microphoneResult.status : undefined)
            : undefined;
        const granted = microphoneStatus ? microphoneStatus === 'granted' : item.status === 'granted';
        const hintKey = `${item.kind}Hint` as Key;
        // macOS asks for these by itself the first time a task needs them.
        const onlyOnUse = item.status === 'unknown' && (item.kind === 'automation' || item.kind === 'localNetwork' || item.kind === 'files');
        const label = item.kind === 'screen' && item.systemAudio ? t('screenAudio') : t(item.kind as Key);
        const micSlot = item.kind === 'microphone' ? props.microphoneSlot : undefined;
        const microphoneMessage = microphoneStatus
            ? microphoneText(locale, microphoneStatus === 'device-busy' ? 'deviceBusy'
                : microphoneStatus === 'device-missing' ? 'statusDeviceMissing'
                    : microphoneStatus === 'denied' ? 'statusDenied'
                        : microphoneStatus === 'system-blocked' ? 'statusSystemBlocked'
                            : microphoneStatus === 'prompt' ? 'statusPrompt'
                                : microphoneStatus === 'granted' ? 'statusGranted' : 'statusUnsupported')
            : undefined;
        // The pill uses the same short words as every other row; the microphone's own sentence is its hover text.
        // A device problem (busy, missing, unsupported) is not a permission state, so it replaces the row's hint.
        const pillStatus: SystemPermissionStatus = microphoneStatus === 'granted' ? 'granted' : microphoneStatus === 'prompt' ? 'not-determined'
            : microphoneStatus === 'denied' ? 'denied' : microphoneStatus === 'system-blocked' ? 'restricted' : item.status;
        const deviceProblem = microphoneStatus === 'device-busy' || microphoneStatus === 'device-missing' || microphoneStatus === 'unsupported';
        const hint = deviceProblem ? microphoneMessage!
            : state.platform === 'win32' && item.kind === 'screen' ? t('windowsScreenHint') : state.platform === 'win32' && item.kind === 'microphone' ? t('windowsMicrophoneHint')
                : state.platform === 'win32' && item.kind === 'accessibility' ? t('workerHint') : t(hintKey);
        return <li key={item.kind} className={`is-${item.status}${micSlot ? ' has-microphone-slot' : ''}`}>
            <i className={`codicon codicon-${ICONS[item.kind]}`} aria-hidden='true'></i>
            <div>
                <strong>{label}</strong>
                <small className={deviceProblem ? 'is-warning' : undefined} title={micSlot ? hint : undefined}>{hint}</small>
            </div>
            <span className={`nmx-system-permission-status is-${pillStatus}`} title={microphoneMessage}>{t(statusKey(pillStatus))}</span>
            {micSlot && <div className='nmx-system-permission-slot'>{micSlot}</div>}
            {!granted && !onlyOnUse && <button type='button' className='nmx-primary-button' disabled={busy === item.kind}
                onClick={() => request(item)}>{busy === item.kind ? <i className='codicon codicon-loading codicon-modifier-spin'></i> : state.platform === 'win32' && item.kind === 'accessibility' ? t('install') : item.kind === 'microphone' && microphoneStatus ? microphoneText(locale, microphoneStatus === 'denied' || microphoneStatus === 'system-blocked' ? 'requestPermission' : 'check') : t('allow')}</button>}
            {(granted || onlyOnUse || item.kind === 'microphone') && item.settingsUrl && <button type='button' onClick={() => void bridge?.openPermissionSettings?.(item.kind)?.catch(() => undefined)}>{t('openSettings')}</button>}
        </li>;
    };
    // A permission that only works after NextMux reopens (Screen Recording) goes last, so the
    // restart it asks for comes after everything else could be granted.
    const byRestart = (left: SystemPermissionItem, right: SystemPermissionItem): number => Number(Boolean(left.relaunchAfterGrant)) - Number(Boolean(right.relaunchAfterGrant));
    const essential = state.items.filter(item => item.essential).sort(byRestart);
    const optional = state.items.filter(item => !item.essential).sort(byRestart);
    return <>
        {!props.essentialOnly && <h3 className='nmx-system-permissions-group'>{t('essential')}</h3>}
        <ul className='nmx-system-permissions-list'>{essential.map(row)}</ul>
        {!props.essentialOnly && optional.length > 0 && <>
            <h3 className='nmx-system-permissions-group'>{t('optional')}</h3>
            <ul className='nmx-system-permissions-list is-optional'>{optional.map(row)}</ul>
        </>}
    </>;
}

export function SystemPermissionsSettings(props: {
    readonly locale: NextMuxDesktopLocale;
    readonly bridge: SystemPermissionsBridge | undefined;
    readonly microphoneSlot?: React.ReactNode;
    readonly microphoneStatus?: MicrophoneCapabilityStatus;
    readonly onRequestMicrophone?: () => Promise<MicrophoneCapability | void> | MicrophoneCapability | void;
    /** Rendered under the list (e.g. the task-notification switch). */
    readonly footer?: React.ReactNode;
}): React.ReactElement {
    const { locale, bridge } = props;
    const t = (key: Key) => systemPermissionsText(locale, key);
    const { state, loaded, relaunchNeeded, load, setState } = usePermissionState(bridge);
    if (loaded && !state) return <section className='nmx-settings-panel nmx-system-permissions'><p className='nmx-agent-instructions-intro'>{t('unavailable')}</p>{props.microphoneSlot}{props.footer}</section>;
    const mac = state?.platform === 'darwin';
    return <section className='nmx-settings-panel nmx-system-permissions' aria-busy={!loaded}>
        {state && <p className='nmx-system-permissions-system'><i className='codicon codicon-info' aria-hidden='true'></i>{t('systemLine')}: <strong data-nmx-literal>{systemName(state)}</strong>
            <button type='button' onClick={() => { void load(); void props.onRequestMicrophone?.(); }}><i className='codicon codicon-refresh' aria-hidden='true'></i>{t('refresh')}</button></p>}
        {state && !state.computerSupported && <p className='nmx-system-permissions-note is-warning'>{t('computerUnsupported')}</p>}
        {relaunchNeeded && <p className='nmx-system-permissions-note'>{t('relaunchHint')} <button type='button' onClick={() => void bridge?.relaunchApp?.()}>{t('relaunch')}</button></p>}
        {state && <SystemPermissionsList locale={locale} bridge={bridge} state={state} onState={setState} microphoneSlot={props.microphoneSlot} microphoneStatus={props.microphoneStatus} onRequestMicrophone={props.onRequestMicrophone} />}
        {props.footer}
        {mac && state && state.version < 13 && <p className='nmx-system-permissions-note'>{t('montereyHint')}</p>}
        {mac && state && state.version >= 15 && <p className='nmx-system-permissions-note'>{t('sequoiaHint')}</p>}
    </section>;
}

/** Stand-alone permission state for the first-run setup. */
export function SystemPermissionsSetup(props: {
    readonly locale: NextMuxDesktopLocale;
    readonly bridge: SystemPermissionsBridge | undefined;
    /** Called before NextMux reopens for a permission that needs it, so the setup counts as finished. */
    readonly onBeforeRelaunch?: () => void;
}): React.ReactElement | null {
    const { state, setState, relaunchNeeded } = usePermissionState(props.bridge);
    if (!state || !state.items.length) return null;
    const t = (key: Key) => systemPermissionsText(props.locale, key);
    return <>
        <SystemPermissionsList locale={props.locale} bridge={props.bridge} state={state} onState={setState} essentialOnly />
        {relaunchNeeded && <p className='nmx-system-permissions-note is-relaunch'>{t('relaunchHint')}
            <button type='button' className='nmx-primary-button' onClick={() => { props.onBeforeRelaunch?.(); void props.bridge?.relaunchApp?.(); }}>{t('relaunch')}</button></p>}
    </>;
}

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function systemPermissionsText(locale: Parameters<typeof uncheckedSystemPermissionsText>[0], key: Parameters<typeof uncheckedSystemPermissionsText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedSystemPermissionsText>>): string {
    return totalCopy(locale, key, language => uncheckedSystemPermissionsText(language, key, ...rest));
}
