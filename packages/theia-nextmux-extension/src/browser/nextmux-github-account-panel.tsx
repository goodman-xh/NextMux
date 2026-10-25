import { domainMessageFromError, type DomainMessage } from '../common/nextmux-domain-errors';
import { skillDomainMessage } from './nextmux-skill-domain-locale';
import * as React from '@theia/core/shared/react';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { GITHUB_CLASSIC_TOKEN_URL, GITHUB_FINE_GRAINED_TOKEN_URL, githubTokenKind, type GitHubAccountState } from '../common/nextmux-github-account';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

/**
 * Settings → Account → GitHub: link a GitHub account with a personal access token so the AI can
 * push commits, open pull requests and work with issues. The token goes straight to the backend,
 * which verifies it with GitHub and keeps it in the OS keychain; this panel only shows the login.
 */

const text = {
    en: { title: 'GitHub', lead: 'Link your GitHub account so the AI can push code, open pull requests and work with issues for you.', connect: 'Link GitHub', step1: 'Create a token on GitHub. Fine-grained is recommended: pick only the repositories you need and give Contents, Pull requests and Issues read and write access.', fineGrained: 'Create fine-grained token', classic: 'Create classic token', step2: 'Paste the token here', placeholder: 'github_pat_… or ghp_…', verify: 'Verify and link', verifying: 'Verifying…', cancel: 'Cancel', privacy: 'The token stays in this computer’s system keychain and is never uploaded to NextMux.', since: 'Linked {date}', kindFine: 'Fine-grained token', kindClassic: 'Classic token', kindOauth: 'OAuth token', allowAgent: 'Let the AI use this account', allowAgentHint: 'The AI can read repositories and create pull requests and issues. In Full access, the git push and gh commands it runs use this account too.', replace: 'Replace token', disconnect: 'Unlink', disconnectConfirm: 'The AI will no longer be able to use this account. The token itself stays valid; delete it on GitHub if you no longer need it.', confirmDisconnect: 'Unlink', errFormat: 'That is not a GitHub token. It should start with github_pat_ or ghp_.', errInvalid: 'The token is invalid or expired. Create a new one on GitHub.', errLimited: 'GitHub is limiting requests right now. Try again later.', errUnreachable: 'Can’t reach GitHub. Check your network and try again.', errUnavailable: 'GitHub is unavailable right now. Try again later.', loadFailed: 'Couldn’t read the GitHub link status.' },
    'zh-CN': { title: 'GitHub', lead: '绑定 GitHub 账号后，AI 可以帮你推送代码、创建 Pull Request、处理 Issue。', connect: '绑定 GitHub', step1: '在 GitHub 创建一个令牌。推荐 Fine-grained：只选需要的仓库，并给 Contents、Pull requests、Issues 读写权限。', fineGrained: '创建 Fine-grained 令牌', classic: '创建经典令牌', step2: '把令牌粘贴到这里', placeholder: 'github_pat_… 或 ghp_…', verify: '验证并绑定', verifying: '正在验证…', cancel: '取消', privacy: '令牌只保存在这台电脑的系统钥匙串里，不会上传到 NextMux。', since: '绑定于 {date}', kindFine: 'Fine-grained 令牌', kindClassic: '经典令牌', kindOauth: 'OAuth 令牌', allowAgent: '允许 AI 使用此账号', allowAgentHint: 'AI 可以读取仓库、创建 Pull Request 和 Issue；在“完全访问”模式下，它运行的 git push 和 gh 命令也会使用此账号。', replace: '更换令牌', disconnect: '解除绑定', disconnectConfirm: '解除后 AI 将不能再使用此账号。令牌本身仍然有效，不再需要时请到 GitHub 删除。', confirmDisconnect: '确认解除', errFormat: '这不是 GitHub 令牌，应以 github_pat_ 或 ghp_ 开头。', errInvalid: '令牌无效或已过期，请在 GitHub 重新生成。', errLimited: 'GitHub 暂时限制了访问，请稍后重试。', errUnreachable: '无法连接 GitHub，请检查网络后重试。', errUnavailable: 'GitHub 暂时无法访问，请稍后重试。', loadFailed: '无法读取 GitHub 绑定状态。' },
    'zh-TW': { title: 'GitHub', lead: '綁定 GitHub 帳號後，AI 可以幫你推送程式碼、建立 Pull Request、處理 Issue。', connect: '綁定 GitHub', step1: '在 GitHub 建立一個權杖。建議使用 Fine-grained：只選需要的儲存庫，並給予 Contents、Pull requests、Issues 讀寫權限。', fineGrained: '建立 Fine-grained 權杖', classic: '建立傳統權杖', step2: '把權杖貼到這裡', placeholder: 'github_pat_… 或 ghp_…', verify: '驗證並綁定', verifying: '正在驗證…', cancel: '取消', privacy: '權杖只儲存在這台電腦的系統鑰匙圈中，不會上傳到 NextMux。', since: '綁定於 {date}', kindFine: 'Fine-grained 權杖', kindClassic: '傳統權杖', kindOauth: 'OAuth 權杖', allowAgent: '允許 AI 使用此帳號', allowAgentHint: 'AI 可以讀取儲存庫、建立 Pull Request 和 Issue；在「完全存取」模式下，它執行的 git push 和 gh 指令也會使用此帳號。', replace: '更換權杖', disconnect: '解除綁定', disconnectConfirm: '解除後 AI 將無法再使用此帳號。權杖本身仍然有效，不再需要時請到 GitHub 刪除。', confirmDisconnect: '確認解除', errFormat: '這不是 GitHub 權杖，應以 github_pat_ 或 ghp_ 開頭。', errInvalid: '權杖無效或已過期，請在 GitHub 重新產生。', errLimited: 'GitHub 暫時限制了存取，請稍後再試。', errUnreachable: '無法連線到 GitHub，請檢查網路後再試。', errUnavailable: 'GitHub 暫時無法存取，請稍後再試。', loadFailed: '無法讀取 GitHub 綁定狀態。' },
    ja: { title: 'GitHub', lead: 'GitHub アカウントを連携すると、AI がコードのプッシュ、プルリクエストの作成、Issue の対応を代わりに行えます。', connect: 'GitHub を連携', step1: 'GitHub でトークンを作成します。Fine-grained がおすすめです。必要なリポジトリだけを選び、Contents・Pull requests・Issues に読み書き権限を付けてください。', fineGrained: 'Fine-grained トークンを作成', classic: 'クラシックトークンを作成', step2: 'トークンをここに貼り付け', placeholder: 'github_pat_… または ghp_…', verify: '確認して連携', verifying: '確認中…', cancel: 'キャンセル', privacy: 'トークンはこのコンピューターのシステムキーチェーンにのみ保存され、NextMux にはアップロードされません。', since: '{date} に連携', kindFine: 'Fine-grained トークン', kindClassic: 'クラシックトークン', kindOauth: 'OAuth トークン', allowAgent: 'AI にこのアカウントの使用を許可', allowAgentHint: 'AI はリポジトリの読み取り、プルリクエストや Issue の作成ができます。「フルアクセス」では、AI が実行する git push と gh コマンドもこのアカウントを使います。', replace: 'トークンを変更', disconnect: '連携を解除', disconnectConfirm: '解除すると AI はこのアカウントを使えなくなります。トークン自体は有効なままなので、不要なら GitHub で削除してください。', confirmDisconnect: '解除する', errFormat: 'GitHub のトークンではありません。github_pat_ または ghp_ で始まります。', errInvalid: 'トークンが無効か期限切れです。GitHub で作り直してください。', errLimited: 'GitHub が一時的にアクセスを制限しています。しばらくしてから再試行してください。', errUnreachable: 'GitHub に接続できません。ネットワークを確認してください。', errUnavailable: 'GitHub に一時的にアクセスできません。しばらくしてから再試行してください。', loadFailed: 'GitHub の連携状態を読み込めませんでした。' },
    ko: { title: 'GitHub', lead: 'GitHub 계정을 연결하면 AI가 코드 푸시, Pull Request 생성, Issue 처리를 대신할 수 있습니다.', connect: 'GitHub 연결', step1: 'GitHub에서 토큰을 만드세요. Fine-grained를 권장합니다. 필요한 저장소만 고르고 Contents, Pull requests, Issues에 읽기/쓰기 권한을 주세요.', fineGrained: 'Fine-grained 토큰 만들기', classic: '클래식 토큰 만들기', step2: '토큰을 여기에 붙여넣기', placeholder: 'github_pat_… 또는 ghp_…', verify: '확인 후 연결', verifying: '확인 중…', cancel: '취소', privacy: '토큰은 이 컴퓨터의 시스템 키체인에만 저장되며 NextMux로 업로드되지 않습니다.', since: '{date}에 연결됨', kindFine: 'Fine-grained 토큰', kindClassic: '클래식 토큰', kindOauth: 'OAuth 토큰', allowAgent: 'AI가 이 계정을 사용하도록 허용', allowAgentHint: 'AI가 저장소를 읽고 Pull Request와 Issue를 만들 수 있습니다. "전체 액세스" 모드에서는 AI가 실행하는 git push와 gh 명령도 이 계정을 사용합니다.', replace: '토큰 교체', disconnect: '연결 해제', disconnectConfirm: '해제하면 AI가 이 계정을 더 이상 사용할 수 없습니다. 토큰 자체는 유효하므로 필요 없으면 GitHub에서 삭제하세요.', confirmDisconnect: '해제', errFormat: 'GitHub 토큰이 아닙니다. github_pat_ 또는 ghp_로 시작해야 합니다.', errInvalid: '토큰이 잘못되었거나 만료되었습니다. GitHub에서 새로 만드세요.', errLimited: 'GitHub가 일시적으로 접근을 제한하고 있습니다. 잠시 후 다시 시도하세요.', errUnreachable: 'GitHub에 연결할 수 없습니다. 네트워크를 확인하세요.', errUnavailable: 'GitHub를 일시적으로 사용할 수 없습니다. 잠시 후 다시 시도하세요.', loadFailed: 'GitHub 연결 상태를 읽지 못했습니다.' },
    es: { title: 'GitHub', lead: 'Vincula tu cuenta de GitHub para que la IA suba código, abra pull requests y gestione issues por ti.', connect: 'Vincular GitHub', step1: 'Crea un token en GitHub. Se recomienda uno fine-grained: elige solo los repositorios necesarios y da permiso de lectura y escritura a Contents, Pull requests e Issues.', fineGrained: 'Crear token fine-grained', classic: 'Crear token clásico', step2: 'Pega aquí el token', placeholder: 'github_pat_… o ghp_…', verify: 'Verificar y vincular', verifying: 'Verificando…', cancel: 'Cancelar', privacy: 'El token solo se guarda en el llavero del sistema de este equipo y nunca se sube a NextMux.', since: 'Vinculada el {date}', kindFine: 'Token fine-grained', kindClassic: 'Token clásico', kindOauth: 'Token OAuth', allowAgent: 'Permitir que la IA use esta cuenta', allowAgentHint: 'La IA puede leer repositorios y crear pull requests e issues. En Acceso completo, los comandos git push y gh que ejecuta también usan esta cuenta.', replace: 'Cambiar token', disconnect: 'Desvincular', disconnectConfirm: 'La IA ya no podrá usar esta cuenta. El token sigue siendo válido; elimínalo en GitHub si ya no lo necesitas.', confirmDisconnect: 'Desvincular', errFormat: 'No es un token de GitHub. Debe empezar por github_pat_ o ghp_.', errInvalid: 'El token no es válido o ha caducado. Crea uno nuevo en GitHub.', errLimited: 'GitHub está limitando el acceso. Inténtalo más tarde.', errUnreachable: 'No se puede conectar con GitHub. Revisa tu red.', errUnavailable: 'GitHub no está disponible ahora. Inténtalo más tarde.', loadFailed: 'No se pudo leer el estado de la vinculación con GitHub.' },
    fr: { title: 'GitHub', lead: 'Associez votre compte GitHub pour que l’IA pousse du code, ouvre des pull requests et traite des issues pour vous.', connect: 'Associer GitHub', step1: 'Créez un jeton sur GitHub. Un jeton fine-grained est recommandé : choisissez uniquement les dépôts utiles et donnez l’accès en lecture et écriture à Contents, Pull requests et Issues.', fineGrained: 'Créer un jeton fine-grained', classic: 'Créer un jeton classique', step2: 'Collez le jeton ici', placeholder: 'github_pat_… ou ghp_…', verify: 'Vérifier et associer', verifying: 'Vérification…', cancel: 'Annuler', privacy: 'Le jeton reste dans le trousseau système de cet ordinateur et n’est jamais envoyé à NextMux.', since: 'Associé le {date}', kindFine: 'Jeton fine-grained', kindClassic: 'Jeton classique', kindOauth: 'Jeton OAuth', allowAgent: 'Autoriser l’IA à utiliser ce compte', allowAgentHint: 'L’IA peut lire les dépôts et créer des pull requests et des issues. En Accès complet, les commandes git push et gh qu’elle exécute utilisent aussi ce compte.', replace: 'Remplacer le jeton', disconnect: 'Dissocier', disconnectConfirm: 'L’IA ne pourra plus utiliser ce compte. Le jeton reste valide : supprimez-le sur GitHub si vous n’en avez plus besoin.', confirmDisconnect: 'Dissocier', errFormat: 'Ce n’est pas un jeton GitHub : il doit commencer par github_pat_ ou ghp_.', errInvalid: 'Le jeton est invalide ou expiré. Créez-en un nouveau sur GitHub.', errLimited: 'GitHub limite l’accès pour le moment. Réessayez plus tard.', errUnreachable: 'Impossible de joindre GitHub. Vérifiez votre réseau.', errUnavailable: 'GitHub est indisponible pour le moment. Réessayez plus tard.', loadFailed: 'Impossible de lire l’état de l’association GitHub.' },
    de: { title: 'GitHub', lead: 'Verknüpfen Sie Ihr GitHub-Konto, damit die KI Code pushen, Pull Requests öffnen und Issues bearbeiten kann.', connect: 'GitHub verknüpfen', step1: 'Erstellen Sie auf GitHub ein Token. Empfohlen ist ein Fine-grained-Token: nur die nötigen Repositorys wählen und Contents, Pull requests und Issues Lese- und Schreibzugriff geben.', fineGrained: 'Fine-grained-Token erstellen', classic: 'Klassisches Token erstellen', step2: 'Token hier einfügen', placeholder: 'github_pat_… oder ghp_…', verify: 'Prüfen und verknüpfen', verifying: 'Wird geprüft…', cancel: 'Abbrechen', privacy: 'Das Token bleibt im Systemschlüsselbund dieses Computers und wird nie zu NextMux hochgeladen.', since: 'Verknüpft am {date}', kindFine: 'Fine-grained-Token', kindClassic: 'Klassisches Token', kindOauth: 'OAuth-Token', allowAgent: 'KI darf dieses Konto verwenden', allowAgentHint: 'Die KI kann Repositorys lesen sowie Pull Requests und Issues erstellen. Im Vollzugriff nutzen auch die git-push- und gh-Befehle, die sie ausführt, dieses Konto.', replace: 'Token ersetzen', disconnect: 'Trennen', disconnectConfirm: 'Die KI kann dieses Konto dann nicht mehr verwenden. Das Token bleibt gültig; löschen Sie es auf GitHub, wenn Sie es nicht mehr brauchen.', confirmDisconnect: 'Trennen', errFormat: 'Das ist kein GitHub-Token. Es beginnt mit github_pat_ oder ghp_.', errInvalid: 'Das Token ist ungültig oder abgelaufen. Erstellen Sie auf GitHub ein neues.', errLimited: 'GitHub begrenzt den Zugriff gerade. Bitte später erneut versuchen.', errUnreachable: 'GitHub ist nicht erreichbar. Prüfen Sie Ihr Netzwerk.', errUnavailable: 'GitHub ist gerade nicht verfügbar. Bitte später erneut versuchen.', loadFailed: 'Der GitHub-Verknüpfungsstatus konnte nicht gelesen werden.' },
    'pt-BR': { title: 'GitHub', lead: 'Vincule sua conta do GitHub para que a IA envie código, abra pull requests e trate issues por você.', connect: 'Vincular GitHub', step1: 'Crie um token no GitHub. Recomendamos o fine-grained: escolha só os repositórios necessários e dê acesso de leitura e escrita a Contents, Pull requests e Issues.', fineGrained: 'Criar token fine-grained', classic: 'Criar token clássico', step2: 'Cole o token aqui', placeholder: 'github_pat_… ou ghp_…', verify: 'Verificar e vincular', verifying: 'Verificando…', cancel: 'Cancelar', privacy: 'O token fica apenas no chaveiro do sistema deste computador e nunca é enviado ao NextMux.', since: 'Vinculada em {date}', kindFine: 'Token fine-grained', kindClassic: 'Token clássico', kindOauth: 'Token OAuth', allowAgent: 'Permitir que a IA use esta conta', allowAgentHint: 'A IA pode ler repositórios e criar pull requests e issues. No Acesso total, os comandos git push e gh que ela executa também usam esta conta.', replace: 'Trocar token', disconnect: 'Desvincular', disconnectConfirm: 'A IA não poderá mais usar esta conta. O token continua válido; exclua-o no GitHub se não precisar mais dele.', confirmDisconnect: 'Desvincular', errFormat: 'Isto não é um token do GitHub. Ele começa com github_pat_ ou ghp_.', errInvalid: 'O token é inválido ou expirou. Crie um novo no GitHub.', errLimited: 'O GitHub está limitando o acesso agora. Tente mais tarde.', errUnreachable: 'Não foi possível conectar ao GitHub. Verifique sua rede.', errUnavailable: 'O GitHub está indisponível no momento. Tente mais tarde.', loadFailed: 'Não foi possível ler o status do vínculo com o GitHub.' },
    ru: { title: 'GitHub', lead: 'Привяжите аккаунт GitHub, чтобы ИИ мог отправлять код, открывать pull request’ы и работать с issues за вас.', connect: 'Привязать GitHub', step1: 'Создайте токен на GitHub. Рекомендуется fine-grained: выберите только нужные репозитории и дайте Contents, Pull requests и Issues доступ на чтение и запись.', fineGrained: 'Создать fine-grained токен', classic: 'Создать классический токен', step2: 'Вставьте токен сюда', placeholder: 'github_pat_… или ghp_…', verify: 'Проверить и привязать', verifying: 'Проверка…', cancel: 'Отмена', privacy: 'Токен хранится только в системной связке ключей этого компьютера и не отправляется в NextMux.', since: 'Привязан {date}', kindFine: 'Fine-grained токен', kindClassic: 'Классический токен', kindOauth: 'OAuth-токен', allowAgent: 'Разрешить ИИ использовать этот аккаунт', allowAgentHint: 'ИИ может читать репозитории и создавать pull request’ы и issues. В режиме «Полный доступ» этот аккаунт используют и запускаемые им команды git push и gh.', replace: 'Сменить токен', disconnect: 'Отвязать', disconnectConfirm: 'ИИ больше не сможет использовать этот аккаунт. Сам токен остаётся действительным — удалите его на GitHub, если он не нужен.', confirmDisconnect: 'Отвязать', errFormat: 'Это не токен GitHub: он начинается с github_pat_ или ghp_.', errInvalid: 'Токен недействителен или истёк. Создайте новый на GitHub.', errLimited: 'GitHub временно ограничивает доступ. Повторите позже.', errUnreachable: 'Не удаётся подключиться к GitHub. Проверьте сеть.', errUnavailable: 'GitHub сейчас недоступен. Повторите позже.', loadFailed: 'Не удалось прочитать состояние привязки GitHub.' },
    ar: { title: 'GitHub', lead: 'اربط حسابك على GitHub ليتمكن الذكاء الاصطناعي من دفع الكود وفتح طلبات السحب ومعالجة المشكلات نيابةً عنك.', connect: 'ربط GitHub', step1: 'أنشئ رمزًا على GitHub. يُنصح بالرمز الدقيق (fine-grained): اختر المستودعات اللازمة فقط وامنح Contents وPull requests وIssues صلاحية القراءة والكتابة.', fineGrained: 'إنشاء رمز fine-grained', classic: 'إنشاء رمز كلاسيكي', step2: 'الصق الرمز هنا', placeholder: 'github_pat_… أو ghp_…', verify: 'تحقّق واربط', verifying: 'جارٍ التحقق…', cancel: 'إلغاء', privacy: 'يبقى الرمز في سلسلة مفاتيح النظام على هذا الكمبيوتر فقط ولا يُرفع إلى NextMux.', since: 'مرتبط منذ {date}', kindFine: 'رمز fine-grained', kindClassic: 'رمز كلاسيكي', kindOauth: 'رمز OAuth', allowAgent: 'السماح للذكاء الاصطناعي باستخدام هذا الحساب', allowAgentHint: 'يمكن للذكاء الاصطناعي قراءة المستودعات وإنشاء طلبات السحب والمشكلات. في وضع الوصول الكامل تستخدم أوامر git push وgh التي يشغّلها هذا الحساب أيضًا.', replace: 'استبدال الرمز', disconnect: 'إلغاء الربط', disconnectConfirm: 'لن يتمكن الذكاء الاصطناعي من استخدام هذا الحساب. يبقى الرمز صالحًا، فاحذفه من GitHub إن لم تعد تحتاجه.', confirmDisconnect: 'إلغاء الربط', errFormat: 'هذا ليس رمز GitHub؛ يبدأ الرمز بـ github_pat_ أو ghp_.', errInvalid: 'الرمز غير صالح أو منتهي الصلاحية. أنشئ رمزًا جديدًا على GitHub.', errLimited: 'يقيّد GitHub الوصول حاليًا. أعد المحاولة لاحقًا.', errUnreachable: 'تعذّر الاتصال بـ GitHub. تحقّق من الشبكة.', errUnavailable: 'GitHub غير متاح حاليًا. أعد المحاولة لاحقًا.', loadFailed: 'تعذّرت قراءة حالة ربط GitHub.' },
    hi: { title: 'GitHub', lead: 'GitHub खाता जोड़ें ताकि AI आपके लिए कोड पुश करे, pull request खोले और issues संभाले।', connect: 'GitHub जोड़ें', step1: 'GitHub पर एक टोकन बनाएँ। Fine-grained बेहतर है: सिर्फ़ ज़रूरी रिपॉज़िटरी चुनें और Contents, Pull requests और Issues को पढ़ने-लिखने की अनुमति दें।', fineGrained: 'Fine-grained टोकन बनाएँ', classic: 'क्लासिक टोकन बनाएँ', step2: 'टोकन यहाँ पेस्ट करें', placeholder: 'github_pat_… या ghp_…', verify: 'जाँचें और जोड़ें', verifying: 'जाँच हो रही है…', cancel: 'रद्द करें', privacy: 'टोकन सिर्फ़ इस कंप्यूटर के सिस्टम कीचेन में रहता है और NextMux पर कभी अपलोड नहीं होता।', since: '{date} को जोड़ा गया', kindFine: 'Fine-grained टोकन', kindClassic: 'क्लासिक टोकन', kindOauth: 'OAuth टोकन', allowAgent: 'AI को यह खाता इस्तेमाल करने दें', allowAgentHint: 'AI रिपॉज़िटरी पढ़ सकता है और pull request व issues बना सकता है। फ़ुल एक्सेस में, AI के चलाए git push और gh कमांड भी यही खाता इस्तेमाल करते हैं।', replace: 'टोकन बदलें', disconnect: 'अलग करें', disconnectConfirm: 'इसके बाद AI यह खाता इस्तेमाल नहीं कर पाएगा। टोकन मान्य रहता है; ज़रूरत न हो तो उसे GitHub पर हटा दें।', confirmDisconnect: 'अलग करें', errFormat: 'यह GitHub टोकन नहीं है; यह github_pat_ या ghp_ से शुरू होता है।', errInvalid: 'टोकन अमान्य है या उसकी अवधि खत्म हो गई है। GitHub पर नया बनाएँ।', errLimited: 'GitHub अभी पहुँच सीमित कर रहा है। बाद में फिर कोशिश करें।', errUnreachable: 'GitHub से कनेक्ट नहीं हो सका। नेटवर्क जाँचें।', errUnavailable: 'GitHub अभी उपलब्ध नहीं है। बाद में फिर कोशिश करें।', loadFailed: 'GitHub जुड़ाव की स्थिति नहीं पढ़ी जा सकी।' }
} as const satisfies Record<NextMuxDesktopLocale, Record<string, string>>;

type Key = keyof typeof text.en;
function uncheckedGithubAccountText(locale: NextMuxDesktopLocale, key: Key): string {
    return (text[locale] || text.en)[key];
}

/** Prefer RPC codes; legacy message matching is only for older desktop hosts. */
export function githubErrorKey(error: unknown): Key {
    const code = domainMessageFromError(error)?.code || (error && typeof error === 'object' && 'code' in error ? error.code : undefined);
    const keys: Readonly<Record<string, Key>> = { GITHUB_TOKEN_FORMAT: 'errFormat', GITHUB_TOKEN_INVALID: 'errInvalid',
        GITHUB_RATE_LIMITED: 'errLimited', GITHUB_UNREACHABLE: 'errUnreachable', GITHUB_UNAVAILABLE: 'errUnavailable', GITHUB_ACCOUNT_INVALID: 'errUnavailable' };
    if (typeof code === 'string' && keys[code]) return keys[code];
    const message = typeof error === 'string' ? error : error instanceof Error ? error.message : '';
    if (/github_pat_|不是 GitHub 令牌/.test(message)) return 'errFormat';
    if (/无效或已过期/.test(message)) return 'errInvalid';
    if (/限制/.test(message)) return 'errLimited';
    if (/无法连接/.test(message)) return 'errUnreachable';
    return 'errUnavailable';
}

export interface GitHubAccountApi {
    getGitHubAccount(): Promise<GitHubAccountState>;
    connectGitHubAccount(token: string): Promise<GitHubAccountState>;
    disconnectGitHubAccount(): Promise<GitHubAccountState>;
    setGitHubAgentAccess(allow: boolean): Promise<GitHubAccountState>;
}

export function GitHubAccountSettings(props: {
    readonly locale: NextMuxDesktopLocale;
    readonly api: GitHubAccountApi;
    readonly openExternal: (url: string) => void;
}): React.ReactElement {
    const t = (key: Key) => githubAccountText(props.locale, key);
    const [account, setAccount] = React.useState<GitHubAccountState | undefined>();
    const [editing, setEditing] = React.useState(false);
    const [token, setToken] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const [confirming, setConfirming] = React.useState(false);
    const [error, setError] = React.useState<{ readonly key?: Key; readonly domain?: DomainMessage }>();
    const [avatarFailed, setAvatarFailed] = React.useState(false);
    React.useEffect(() => {
        let live = true;
        props.api.getGitHubAccount().then(state => { if (live) setAccount(state); }, () => { if (live) { setAccount({ connected: false, allowAgent: true }); setError({ key: 'loadFailed' }); } });
        return () => { live = false; };
    }, [props.api]);
    const run = async (action: () => Promise<GitHubAccountState>, after?: () => void) => {
        setBusy(true); setError(undefined);
        try {
            setAccount(await action());
            after?.();
        } catch (failure) {
            setError({ domain: domainMessageFromError(failure), key: githubErrorKey(failure) });
        } finally {
            setBusy(false);
        }
    };
    const submit = () => {
        const value = token.trim();
        if (!githubTokenKind(value)) { setError({ key: 'errFormat' }); return; }
        void run(() => props.api.connectGitHubAccount(value), () => { setToken(''); setEditing(false); });
    };
    const connected = account?.connected === true;
    const form = <div className='nmx-github-connect'>
        <ol>
            <li><span>{t('step1')}</span>
                <span className='nmx-github-links'>
                    <button type='button' onClick={() => props.openExternal(GITHUB_FINE_GRAINED_TOKEN_URL)}><i className='codicon codicon-link-external' aria-hidden='true'></i>{t('fineGrained')}</button>
                    <button type='button' onClick={() => props.openExternal(GITHUB_CLASSIC_TOKEN_URL)}><i className='codicon codicon-link-external' aria-hidden='true'></i>{t('classic')}</button>
                </span>
            </li>
            <li><label htmlFor='nmx-github-token'>{t('step2')}</label>
                <span className='nmx-github-token-row'>
                    <input id='nmx-github-token' type='password' autoComplete='off' spellCheck={false} placeholder={t('placeholder')} value={token} disabled={busy} autoFocus
                        onChange={event => { setToken(event.currentTarget.value); setError(undefined); }}
                        onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); } if (event.key === 'Escape') { event.preventDefault(); setEditing(false); setToken(''); setError(undefined); } }} />
                    <button type='button' className='is-primary' disabled={busy || !token.trim()} onClick={submit}>{busy ? t('verifying') : t('verify')}</button>
                    <button type='button' disabled={busy} onClick={() => { setEditing(false); setToken(''); setError(undefined); }}>{t('cancel')}</button>
                </span>
            </li>
        </ol>
        <small className='nmx-github-privacy'><i className='codicon codicon-lock' aria-hidden='true'></i>{t('privacy')}</small>
    </div>;
    const kind = account?.tokenKind === 'fine-grained' ? t('kindFine') : account?.tokenKind === 'classic' ? t('kindClassic') : account?.tokenKind === 'oauth' ? t('kindOauth') : '';
    const since = account?.connectedAt ? t('since').replace('{date}', new Date(account.connectedAt).toLocaleDateString(props.locale)) : '';
    return <article className='nmx-settings-group nmx-github-account' aria-busy={!account || busy}>
        <header><i className='codicon codicon-github'></i><span><strong>{t('title')}</strong></span></header>
        {!account ? <p className='nmx-github-lead'><i className='codicon codicon-loading codicon-modifier-spin' aria-hidden='true'></i></p>
            : connected ? <>
                <div className='nmx-github-profile'>
                    {account.avatarUrl && !avatarFailed ? <img src={account.avatarUrl} alt='' onError={() => setAvatarFailed(true)} /> : <span className='nmx-github-avatar' aria-hidden='true'>{(account.login || '?').slice(0, 1).toUpperCase()}</span>}
                    <span><strong data-nmx-literal>{account.name || account.login}</strong>
                        <small><button type='button' className='nmx-link-button' data-nmx-literal onClick={() => props.openExternal(account.profileUrl || `https://github.com/${account.login}`)}>@{account.login}</button>
                            {[kind, account.scopes?.length ? account.scopes.join(', ') : '', since].filter(Boolean).map(item => <span key={item} data-nmx-literal> · {item}</span>)}</small></span>
                    <span className='nmx-github-actions'>
                        <button type='button' disabled={busy} onClick={() => { setEditing(value => !value); setConfirming(false); setError(undefined); }}>{t('replace')}</button>
                        <button type='button' disabled={busy} className='is-danger' onClick={() => { setConfirming(true); setEditing(false); }}>{t('disconnect')}</button>
                    </span>
                </div>
                {confirming && <div className='nmx-github-confirm' role='alertdialog' aria-label={t('disconnect')}>
                    <span>{t('disconnectConfirm')}</span>
                    <button type='button' disabled={busy} onClick={() => setConfirming(false)}>{t('cancel')}</button>
                    <button type='button' disabled={busy} className='is-danger' onClick={() => void run(() => props.api.disconnectGitHubAccount(), () => setConfirming(false))}>{t('confirmDisconnect')}</button>
                </div>}
                <label className='nmx-github-agent-toggle'>
                    <span><strong>{t('allowAgent')}</strong><small>{t('allowAgentHint')}</small></span>
                    <span className='nmx-switch'><input type='checkbox' checked={account.allowAgent} disabled={busy} onChange={event => { const allow = event.currentTarget.checked; void run(() => props.api.setGitHubAgentAccess(allow)); }} /><i></i></span>
                </label>
                {editing && form}
            </> : <>
                <div className='nmx-github-intro'><p>{t('lead')}</p>{!editing && <button type='button' className='is-primary' onClick={() => { setEditing(true); setError(undefined); }}><i className='codicon codicon-github' aria-hidden='true'></i>{t('connect')}</button>}</div>
                {editing && form}
            </>}
        {error && <p className='nmx-github-error' role='alert'><i className='codicon codicon-error' aria-hidden='true'></i>{error.domain ? skillDomainMessage(props.locale, error.domain) || t(error.key || 'errUnavailable') : t(error.key || 'errUnavailable')}</p>}
    </article>;
}

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function githubAccountText(locale: Parameters<typeof uncheckedGithubAccountText>[0], key: Parameters<typeof uncheckedGithubAccountText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedGithubAccountText>>): string {
    return totalCopy(locale, key, language => uncheckedGithubAccountText(language, key, ...rest));
}
