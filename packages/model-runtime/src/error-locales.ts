import type { ModelErrorAction, ModelErrorKind, WalletAdmissionDiagnostic } from './errors.js';

const kinds: readonly ModelErrorKind[] = ['auth_invalid', 'auth_missing', 'permission_denied', 'balance_insufficient', 'provider_quota_exhausted', 'rate_limited', 'overloaded', 'model_not_found', 'model_not_supported_here', 'context_too_long', 'output_too_long', 'content_refused', 'invalid_request', 'upload_too_large', 'unsupported_file', 'timeout', 'network', 'provider_error', 'relay_unavailable', 'cancelled', 'stream_interrupted', 'tool_call_invalid', 'invalid_response', 'unknown'];
const adviceKeys = ['auth', 'permission', 'balance', 'quota', 'wait', 'retry', 'model', 'context', 'output', 'content', 'parameter', 'upload', 'file', 'network', 'relay', 'cancelled', 'unknown'] as const;
const kindAdvice = ['auth', 'auth', 'permission', 'balance', 'quota', 'wait', 'retry', 'model', 'model', 'context', 'output', 'content', 'parameter', 'upload', 'file', 'retry', 'network', 'retry', 'relay', 'cancelled', 'retry', 'retry', 'retry', 'unknown'] as const;
interface ErrorLocale {
  messages: Record<ModelErrorKind, string>;
  advice: Record<ModelErrorKind, string>;
  actions: Record<ModelErrorAction, string>;
  wait: string;
  parameter: string;
  reason: string;
  retried: string;
  switched: string;
  relayAccount: string;
  localConnection: string;
  relayConnection: string;
  ownApiConnection: string;
  signInRequired: string;
  signInRequiredAdvice: string;
  /** A route excluded by the user's privacy settings (gateway route_privacy_unavailable). */
  privacyBlocked: string;
}
function make(messages: string, advice: string, actions: string, extras: string): ErrorLocale {
  const messagesList = messages.split('|');
  const adviceList = advice.split('|');
  const actionsList = actions.split('|');
  const extrasList = extras.split('|');
  if (messagesList.some(value => !value.trim()) || adviceList.some(value => !value.trim()) || actionsList.slice(0, 5).some(value => !value.trim()) || extrasList.some(value => !value.trim()) || messagesList.length !== kinds.length || adviceList.length !== adviceKeys.length || actionsList.length !== 6 || extrasList.length !== 9) {
    throw new Error('Incomplete model error translations');
  }
  return {
    messages: Object.fromEntries(kinds.map((kind, i) => [kind, messagesList[i]])) as ErrorLocale['messages'],
    advice: Object.fromEntries(kinds.map((kind, i) => [kind, adviceList[adviceKeys.indexOf(kindAdvice[i])]])) as ErrorLocale['advice'],
    actions: { retry: actionsList[0], settings: actionsList[1], top_up: actionsList[2], switch_model: actionsList[3], switch_relay: actionsList[4], none: actionsList[5] },
    wait: extrasList[0], parameter: extrasList[1], reason: extrasList[2], retried: extrasList[3], switched: extrasList[4], relayAccount: extrasList[5], localConnection: extrasList[6], privacyBlocked: extrasList[7], relayConnection: extrasList[8], ownApiConnection: '', signInRequired: '', signInRequiredAdvice: '',
  };
}
const locales: Record<string, ErrorLocale> = {
  'zh-CN': make(
    'API 密钥无效或已过期。|尚未配置 API 密钥。|当前账号没有执行此请求的权限。|NextMux 余额不足。|服务商额度不足，或本次请求的输出上限超出可用额度。|模型服务暂时限制了请求频率。|模型服务当前繁忙。|找不到所选模型或 API 地址。|当前服务、地区或模型不支持这项功能。|对话内容超过了模型的上下文长度限制。|模型输出超过了长度限制。|模型服务因内容安全规则拒绝了这次请求。|模型请求中的参数无效。|上传的文件或请求超过了大小限制。|模型服务不支持这个文件格式。|模型请求超时。|无法连接模型服务。|模型服务暂时发生错误。|当前中转没有可用的模型线路。|模型请求已取消。|模型回复传输中断。|模型返回的工具调用无法解析。|模型服务返回了无法识别的响应。|模型请求未完成。',
    '请打开“模型中心 → 我的 API”检查并更换密钥。|请检查账号权限、模型访问资格或联系服务商。|请充值后重试。|请检查服务商余额、账户限额和请求的输出上限。|请稍后重试。|请稍后重试。|请检查模型名称，或切换模型。|上下文已自动压缩，仍超出模型的长度限制。请新建对话，或换用上下文更大的模型；本机模型可在“我的 API”里调大上下文长度。|请减少输出长度，或切换支持更长输出的模型。|请修改提示词或素材后重试。|请检查模型设置和请求参数后重试。|请缩小文件或减少输入后重试。|请转换为该模型支持的文件格式。|请检查网络连接后重试。|请切换中转后重试。|需要继续时可重新发送。|请查看详情并重试；若持续失败，请检查模型设置。',
    '重试|打开我的 API|充值|切换模型|切换中转|',
    '请等待 {seconds} 秒后重试。|需要检查的参数：{parameter}。|服务商给出的原因：{reason}|NextMux 已自动重试 {count} 次。|NextMux 已自动切换中转 {count} 次。|当前中转的上游凭据或额度不可用。|请确认本地模型服务已启动。|所选模型的服务商声明会收集请求数据，与你的隐私设置（禁止数据收集或零数据保留）不符，因此无法使用。请换一个模型，或在“设置 → 隐私”中调整。|请检查网络或切换中转商。'),
  'zh-TW': make(
    'API 金鑰無效或已過期。|尚未設定 API 金鑰。|目前帳號沒有執行此請求的權限。|NextMux 餘額不足。|服務商額度不足，或本次請求的輸出上限超出可用額度。|模型服務暫時限制了請求頻率。|模型服務目前忙碌。|找不到所選模型或 API 位址。|目前服務、地區或模型不支援這項功能。|對話內容超過了模型的上下文長度限制。|模型輸出超過了長度限制。|模型服務因內容安全規則拒絕了這次請求。|模型請求中的參數無效。|上傳的檔案或請求超過了大小限制。|模型服務不支援這個檔案格式。|模型請求逾時。|無法連線至模型服務。|模型服務暫時發生錯誤。|目前中轉沒有可用的模型線路。|模型請求已取消。|模型回覆傳輸中斷。|模型傳回的工具呼叫無法解析。|模型服務傳回了無法辨識的回應。|模型請求未完成。',
    '請開啟「模型中心 → 我的 API」檢查並更換金鑰。|請檢查帳號權限、模型存取資格或聯絡服務商。|請儲值後重試。|請檢查服務商餘額、帳戶限額和請求的輸出上限。|請稍後重試。|請稍後重試。|請檢查模型名稱，或切換模型。|上下文已自動壓縮，仍超出模型的長度限制。請建立新對話，或改用上下文更大的模型；本機模型可在「我的 API」裡調大上下文長度。|請減少輸出長度，或切換支援更長輸出的模型。|請修改提示詞或素材後重試。|請檢查模型設定和請求參數後重試。|請縮小檔案或減少輸入後重試。|請轉換為該模型支援的檔案格式。|請檢查網路連線。|請切換中轉後重試。|需要繼續時可重新傳送。|請查看詳細資料並重試；若持續失敗，請檢查模型設定。',
    '重試|開啟我的 API|儲值|切換模型|切換中轉|',
    '請等待 {seconds} 秒後重試。|需要檢查的參數：{parameter}。|服務商提供的原因：{reason}|NextMux 已自動重試 {count} 次。|NextMux 已自動切換中轉 {count} 次。|目前中轉的上游憑證或額度無法使用。|請確認本地模型服務已啟動。|所選模型的服務商聲明會收集請求資料，與你的隱私設定（禁止資料收集或零資料保留）不符，因此無法使用。請換一個模型，或在「設定 → 隱私」中調整。|請檢查網路或切換中轉。'),
  en: make(
    'The API key is invalid or has expired.|No API key is configured.|This account does not have permission for this request.|Your NextMux balance is too low.|The provider quota is insufficient, or the requested output limit exceeds available credit.|The model service is limiting requests.|The model service is busy.|The selected model or API address could not be found.|This service, region, or model does not support this feature.|The conversation exceeds the model’s context limit.|The model output exceeds the length limit.|The model service refused the request under its content safety rules.|A model request parameter is invalid.|The uploaded file or request exceeds the size limit.|The model service does not support this file format.|The model request timed out.|Could not connect to the model service.|The model service encountered a temporary error.|This relay has no available model route.|The model request was cancelled.|The model response stream was interrupted.|The model’s tool call could not be parsed.|The model service returned an unreadable response.|The model request did not complete.',
    'Open Model center → My APIs to check or replace the key.|Check account permissions and model access, or contact the provider.|Top up and try again.|Check the provider balance, account limits, and requested output limit.|Wait a moment and try again.|Wait a moment and try again.|Check the model name or switch models.|The context was compacted automatically and is still too long for this model. Start a new conversation or switch to a model with a larger context window; for a local model, raise its context length in My APIs.|Request a shorter output or switch to a model with a larger output limit.|Change the prompt or input material and try again.|Check the model settings and request parameters, then try again.|Reduce the file size or input and try again.|Convert the file to a format supported by this model.|Check your network connection.|Switch relays and try again.|Send the request again when you want to continue.|Check the details and try again; if it keeps failing, check the model settings.',
    'Retry|Open My APIs|Top up|Switch model|Switch relay|',
    'Wait {seconds} seconds and try again.|Parameter to check: {parameter}.|Provider’s reason: {reason}|NextMux already retried {count} times.|NextMux already switched relays {count} times.|This relay’s upstream credentials or quota are unavailable.|Ensure your local model service is running.|The selected model’s provider declares that it collects request data, which your privacy settings (no data collection or zero data retention) do not allow. Choose another model or change Settings → Privacy.|Check your network or switch relay.'),
  ja: make(
    'API キーが無効か、有効期限が切れています。|API キーが設定されていません。|このアカウントにはリクエストを実行する権限がありません。|NextMux の残高が不足しています。|提供元の利用枠が不足しているか、リクエストの出力上限が利用可能な残高を超えています。|モデルサービスがリクエスト数を制限しています。|モデルサービスが混雑しています。|選択したモデルまたは API アドレスが見つかりません。|このサービス、地域、またはモデルはこの機能に対応していません。|会話がモデルのコンテキスト長の上限を超えています。|モデルの出力が長さの上限を超えています。|モデルサービスの安全規則によりリクエストが拒否されました。|モデルリクエストのパラメーターが無効です。|アップロードしたファイルまたはリクエストがサイズの上限を超えています。|モデルサービスがこのファイル形式に対応していません。|モデルリクエストがタイムアウトしました。|モデルサービスに接続できません。|モデルサービスで一時的なエラーが発生しました。|このリレーには利用できるモデル接続先がありません。|モデルリクエストはキャンセルされました。|モデルの応答の受信が中断されました。|モデルのツール呼び出しを解析できませんでした。|モデルサービスから読み取れない応答が返されました。|モデルリクエストが完了しませんでした。',
    '「モデルセンター → マイ API」でキーを確認または交換してください。|アカウント権限とモデルへのアクセス権を確認するか、提供元にお問い合わせください。|チャージしてから再試行してください。|提供元の残高、アカウントの利用枠、リクエストの出力上限を確認してください。|しばらく待ってから再試行してください。|しばらく待ってから再試行してください。|モデル名を確認するか、モデルを切り替えてください。|コンテキストを自動圧縮しても、このモデルの上限を超えています。新しい会話を開始するか、コンテキストの大きいモデルに切り替えてください。ローカルモデルは「マイ API」でコンテキスト長を増やせます。|出力を短くするか、出力上限の大きいモデルに切り替えてください。|プロンプトまたは素材を変更して再試行してください。|モデル設定とリクエストのパラメーターを確認して再試行してください。|ファイルサイズまたは入力を減らして再試行してください。|このモデルが対応するファイル形式に変換してください。|ネットワーク接続を確認してください。|リレーを切り替えて再試行してください。|続行する場合は再送信してください。|詳細を確認して再試行し、失敗が続く場合はモデル設定を確認してください。',
    '再試行|マイ API を開く|チャージ|モデルを切り替え|リレーを切り替え|',
    '{seconds} 秒待ってから再試行してください。|確認するパラメーター：{parameter}。|提供元の理由：{reason}|NextMux はすでに {count} 回自動再試行しました。|NextMux はすでにリレーを {count} 回切り替えました。|このリレーの上流サービスの認証情報または利用枠を利用できません。|ローカルモデルサービスが起動しているか確認してください。|選択したモデルの提供元はリクエストデータを収集すると表明しており、プライバシー設定（データ収集を禁止／データ非保持）と合わないため使えません。別のモデルを選ぶか、「設定 → プライバシー」を変更してください。|ネットワークを確認するか、中継を切り替えてください。'),
  ko: make(
    'API 키가 유효하지 않거나 만료되었습니다.|API 키가 설정되지 않았습니다.|이 계정에는 요청을 실행할 권한이 없습니다.|NextMux 잔액이 부족합니다.|제공업체 할당량이 부족하거나 요청한 출력 한도가 사용 가능한 크레딧을 초과합니다.|모델 서비스가 요청 빈도를 제한하고 있습니다.|모델 서비스가 혼잡합니다.|선택한 모델 또는 API 주소를 찾을 수 없습니다.|이 서비스, 지역 또는 모델은 해당 기능을 지원하지 않습니다.|대화가 모델의 컨텍스트 길이 제한을 초과했습니다.|모델 출력이 길이 제한을 초과했습니다.|모델 서비스의 콘텐츠 안전 규칙에 따라 요청이 거부되었습니다.|모델 요청의 매개변수가 유효하지 않습니다.|업로드한 파일 또는 요청이 크기 제한을 초과했습니다.|모델 서비스가 이 파일 형식을 지원하지 않습니다.|모델 요청 시간이 초과되었습니다.|모델 서비스에 연결할 수 없습니다.|모델 서비스에 일시적인 오류가 발생했습니다.|현재 릴레이에 사용 가능한 모델 경로가 없습니다.|모델 요청이 취소되었습니다.|모델 응답 전송이 중단되었습니다.|모델의 도구 호출을 해석할 수 없습니다.|모델 서비스가 읽을 수 없는 응답을 반환했습니다.|모델 요청이 완료되지 않았습니다.',
    '모델 센터 → 내 API에서 키를 확인하거나 교체하세요.|계정 권한과 모델 접근 권한을 확인하거나 제공업체에 문의하세요.|충전한 후 다시 시도하세요.|제공업체 잔액, 계정 한도 및 요청한 출력 한도를 확인하세요.|잠시 후 다시 시도하세요.|잠시 후 다시 시도하세요.|모델 이름을 확인하거나 모델을 변경하세요.|컨텍스트를 자동으로 압축했지만 여전히 이 모델의 한도를 넘습니다. 새 대화를 시작하거나 컨텍스트가 더 큰 모델로 바꾸세요. 로컬 모델은 내 API에서 컨텍스트 길이를 늘릴 수 있습니다.|출력을 줄이거나 출력 한도가 더 큰 모델로 변경하세요.|프롬프트 또는 입력 자료를 수정한 후 다시 시도하세요.|모델 설정과 요청 매개변수를 확인한 후 다시 시도하세요.|파일 크기나 입력을 줄인 후 다시 시도하세요.|이 모델이 지원하는 파일 형식으로 변환하세요.|네트워크 연결을 확인하세요.|릴레이를 변경한 후 다시 시도하세요.|계속하려면 요청을 다시 보내세요.|세부 정보를 확인하고 다시 시도하세요. 계속 실패하면 모델 설정을 확인하세요.',
    '다시 시도|내 API 열기|충전|모델 변경|릴레이 변경|',
    '{seconds}초 후 다시 시도하세요.|확인할 매개변수: {parameter}.|제공업체의 사유: {reason}|NextMux가 이미 {count}회 자동으로 재시도했습니다.|NextMux가 이미 릴레이를 {count}회 변경했습니다.|현재 릴레이의 상위 서비스 인증 정보 또는 할당량을 사용할 수 없습니다.|로컬 모델 서비스가 실행 중인지 확인하세요.|선택한 모델의 제공업체가 요청 데이터를 수집한다고 밝혀 개인정보 설정(데이터 수집 금지 또는 데이터 미보관)과 맞지 않아 사용할 수 없습니다. 다른 모델을 고르거나 설정 → 개인정보에서 변경하세요.|네트워크를 확인하거나 릴레이를 변경하세요.'),
  es: make(
    'La clave API no es válida o ha caducado.|No hay ninguna clave API configurada.|Esta cuenta no tiene permiso para realizar la solicitud.|Tu saldo de NextMux es insuficiente.|La cuota del proveedor es insuficiente o el límite de salida solicitado supera el crédito disponible.|El servicio del modelo está limitando las solicitudes.|El servicio del modelo está ocupado.|No se encontró el modelo o la dirección API seleccionados.|Este servicio, región o modelo no admite esta función.|La conversación supera el límite de contexto del modelo.|La salida del modelo supera el límite de longitud.|El servicio del modelo rechazó la solicitud por sus normas de seguridad de contenido.|Un parámetro de la solicitud no es válido.|El archivo subido o la solicitud supera el límite de tamaño.|El servicio del modelo no admite este formato de archivo.|La solicitud al modelo agotó el tiempo de espera.|No se pudo conectar con el servicio del modelo.|El servicio del modelo tuvo un error temporal.|Este relay no tiene ninguna ruta de modelo disponible.|La solicitud al modelo se canceló.|Se interrumpió la transmisión de la respuesta del modelo.|No se pudo interpretar la llamada a herramienta del modelo.|El servicio del modelo devolvió una respuesta ilegible.|La solicitud al modelo no se completó.',
    'Abre Centro de modelos → Mis API para comprobar o sustituir la clave.|Comprueba los permisos de la cuenta y el acceso al modelo, o contacta con el proveedor.|Recarga el saldo y vuelve a intentarlo.|Revisa el saldo del proveedor, los límites de la cuenta y el límite de salida solicitado.|Espera un momento y vuelve a intentarlo.|Espera un momento y vuelve a intentarlo.|Comprueba el nombre del modelo o cambia de modelo.|El contexto se compactó automáticamente y sigue siendo demasiado largo para este modelo. Inicia una nueva conversación o cambia a un modelo con más contexto; en un modelo local, aumenta su longitud de contexto en Mis API.|Solicita una salida más corta o cambia a un modelo con un límite mayor.|Cambia el texto de la solicitud o el material y vuelve a intentarlo.|Comprueba los ajustes del modelo y los parámetros de la solicitud.|Reduce el tamaño del archivo o la entrada y vuelve a intentarlo.|Convierte el archivo a un formato compatible con este modelo.|Comprueba tu conexión de red.|Cambia de relay y vuelve a intentarlo.|Envía la solicitud de nuevo cuando quieras continuar.|Consulta los detalles y reinténtalo; si sigue fallando, revisa los ajustes del modelo.',
    'Reintentar|Abrir Mis API|Recargar saldo|Cambiar modelo|Cambiar relay|',
    'Espera {seconds} segundos y vuelve a intentarlo.|Parámetro que debes revisar: {parameter}.|Motivo del proveedor: {reason}|NextMux ya lo reintentó {count} veces.|NextMux ya cambió de relay {count} veces.|Las credenciales o la cuota del proveedor de este relay no están disponibles.|Asegúrate de que el servicio de modelo local esté iniciado.|El proveedor del modelo elegido declara que recopila datos de las solicitudes, algo que tu privacidad (sin recopilación o sin retención de datos) no permite. Elige otro modelo o cambia Ajustes → Privacidad.|Comprueba tu red o cambia de relay.'),
  fr: make(
    'La clé API est invalide ou a expiré.|Aucune clé API n’est configurée.|Ce compte n’a pas l’autorisation d’effectuer cette requête.|Votre solde NextMux est insuffisant.|Le quota du fournisseur est insuffisant ou la limite de sortie demandée dépasse le crédit disponible.|Le service du modèle limite les requêtes.|Le service du modèle est occupé.|Le modèle ou l’adresse API sélectionnés sont introuvables.|Ce service, cette région ou ce modèle ne prend pas en charge cette fonction.|La conversation dépasse la limite de contexte du modèle.|La sortie du modèle dépasse la limite de longueur.|Le service du modèle a refusé la requête conformément à ses règles de sécurité du contenu.|Un paramètre de la requête est invalide.|Le fichier envoyé ou la requête dépasse la taille maximale.|Le service du modèle ne prend pas en charge ce format de fichier.|La requête au modèle a expiré.|Impossible de se connecter au service du modèle.|Le service du modèle a rencontré une erreur temporaire.|Ce relais n’a aucune route de modèle disponible.|La requête au modèle a été annulée.|La transmission de la réponse du modèle a été interrompue.|L’appel d’outil du modèle n’a pas pu être analysé.|Le service du modèle a renvoyé une réponse illisible.|La requête au modèle n’a pas abouti.',
    'Ouvrez Centre des modèles → Mes API pour vérifier ou remplacer la clé.|Vérifiez les autorisations du compte et l’accès au modèle, ou contactez le fournisseur.|Rechargez le solde puis réessayez.|Vérifiez le solde du fournisseur, les limites du compte et la limite de sortie demandée.|Patientez un instant puis réessayez.|Patientez un instant puis réessayez.|Vérifiez le nom du modèle ou changez de modèle.|Le contexte a été compacté automatiquement et reste trop long pour ce modèle. Démarrez une nouvelle conversation ou passez à un modèle avec un contexte plus grand ; pour un modèle local, augmentez sa longueur de contexte dans Mes API.|Demandez une sortie plus courte ou choisissez un modèle avec une limite plus élevée.|Modifiez la consigne ou les éléments fournis puis réessayez.|Vérifiez les paramètres du modèle et de la requête puis réessayez.|Réduisez la taille du fichier ou de l’entrée puis réessayez.|Convertissez le fichier dans un format pris en charge par ce modèle.|Vérifiez votre connexion réseau.|Changez de relais puis réessayez.|Renvoyez la requête lorsque vous souhaitez continuer.|Consultez les détails et réessayez ; si l’échec persiste, vérifiez les paramètres du modèle.',
    'Réessayer|Ouvrir Mes API|Recharger|Changer de modèle|Changer de relais|',
    'Attendez {seconds} secondes puis réessayez.|Paramètre à vérifier : {parameter}.|Motif du fournisseur : {reason}|NextMux a déjà réessayé {count} fois.|NextMux a déjà changé de relais {count} fois.|Les identifiants ou le quota du fournisseur de ce relais sont indisponibles.|Assurez-vous que le service de modèle local est démarré.|Le fournisseur du modèle choisi déclare collecter les données des requêtes, ce que vos paramètres de confidentialité (pas de collecte ou zéro conservation) n’autorisent pas. Choisissez un autre modèle ou modifiez Réglages → Confidentialité.|Vérifiez votre réseau ou changez de relais.'),
  de: make(
    'Der API-Schlüssel ist ungültig oder abgelaufen.|Es ist kein API-Schlüssel eingerichtet.|Dieses Konto hat keine Berechtigung für diese Anfrage.|Dein NextMux-Guthaben reicht nicht aus.|Das Kontingent des Anbieters reicht nicht aus, oder das angeforderte Ausgabelimit übersteigt das verfügbare Guthaben.|Der Modelldienst begrenzt derzeit die Anfragen.|Der Modelldienst ist ausgelastet.|Das gewählte Modell oder die API-Adresse wurde nicht gefunden.|Dieser Dienst, diese Region oder dieses Modell unterstützt die Funktion nicht.|Das Gespräch überschreitet das Kontextlimit des Modells.|Die Modellausgabe überschreitet das Längenlimit.|Der Modelldienst hat die Anfrage aufgrund seiner Regeln zur Inhaltssicherheit abgelehnt.|Ein Parameter der Modellanfrage ist ungültig.|Die hochgeladene Datei oder Anfrage überschreitet das Größenlimit.|Der Modelldienst unterstützt dieses Dateiformat nicht.|Die Modellanfrage hat das Zeitlimit überschritten.|Die Verbindung zum Modelldienst ist fehlgeschlagen.|Beim Modelldienst ist vorübergehend ein Fehler aufgetreten.|Für dieses Relay ist keine Modellroute verfügbar.|Die Modellanfrage wurde abgebrochen.|Die Übertragung der Modellantwort wurde unterbrochen.|Der Werkzeugaufruf des Modells konnte nicht verarbeitet werden.|Der Modelldienst hat eine unlesbare Antwort zurückgegeben.|Die Modellanfrage wurde nicht abgeschlossen.',
    'Öffne Modellzentrum → Meine APIs, um den Schlüssel zu prüfen oder zu ersetzen.|Prüfe Kontoberechtigungen und Modellzugriff oder kontaktiere den Anbieter.|Lade Guthaben auf und versuche es erneut.|Prüfe das Guthaben beim Anbieter, die Kontolimits und das angeforderte Ausgabelimit.|Warte kurz und versuche es erneut.|Warte kurz und versuche es erneut.|Prüfe den Modellnamen oder wechsle das Modell.|Der Kontext wurde automatisch komprimiert und ist für dieses Modell immer noch zu lang. Starte ein neues Gespräch oder wechsle zu einem Modell mit größerem Kontext; bei einem lokalen Modell erhöhst du die Kontextlänge unter Meine APIs.|Fordere eine kürzere Ausgabe an oder wähle ein Modell mit höherem Ausgabelimit.|Ändere die Eingabe oder das Material und versuche es erneut.|Prüfe die Modelleinstellungen und Anfrageparameter und versuche es erneut.|Verkleinere die Datei oder Eingabe und versuche es erneut.|Wandle die Datei in ein vom Modell unterstütztes Format um.|Prüfe deine Netzwerkverbindung.|Wechsle das Relay und versuche es erneut.|Sende die Anfrage erneut, wenn du fortfahren möchtest.|Prüfe die Details und versuche es erneut. Prüfe bei weiteren Fehlern die Modelleinstellungen.',
    'Erneut versuchen|Meine APIs öffnen|Guthaben aufladen|Modell wechseln|Relay wechseln|',
    'Warte {seconds} Sekunden und versuche es erneut.|Zu prüfender Parameter: {parameter}.|Begründung des Anbieters: {reason}|NextMux hat es bereits {count} Mal erneut versucht.|NextMux hat das Relay bereits {count} Mal gewechselt.|Die Zugangsdaten oder das Kontingent des Anbieters dieses Relays sind nicht verfügbar.|Stelle sicher, dass der lokale Modelldienst läuft.|Der Anbieter des gewählten Modells gibt an, Anfragedaten zu sammeln; deine Datenschutzeinstellungen (keine Datenerhebung bzw. keine Speicherung) erlauben das nicht. Wähle ein anderes Modell oder ändere Einstellungen → Datenschutz.|Prüfe dein Netzwerk oder wechsle das Relay.'),
  'pt-BR': make(
    'A chave de API é inválida ou expirou.|Nenhuma chave de API está configurada.|Esta conta não tem permissão para fazer a solicitação.|Seu saldo do NextMux é insuficiente.|A cota do provedor é insuficiente ou o limite de saída solicitado excede o crédito disponível.|O serviço do modelo está limitando as solicitações.|O serviço do modelo está ocupado.|O modelo ou endereço de API selecionado não foi encontrado.|Este serviço, região ou modelo não oferece suporte a este recurso.|A conversa excede o limite de contexto do modelo.|A saída do modelo excede o limite de tamanho.|O serviço do modelo recusou a solicitação por suas regras de segurança de conteúdo.|Um parâmetro da solicitação ao modelo é inválido.|O arquivo enviado ou a solicitação excede o limite de tamanho.|O serviço do modelo não oferece suporte a este formato de arquivo.|A solicitação ao modelo excedeu o tempo limite.|Não foi possível conectar ao serviço do modelo.|O serviço do modelo apresentou um erro temporário.|Este relay não tem uma rota de modelo disponível.|A solicitação ao modelo foi cancelada.|A transmissão da resposta do modelo foi interrompida.|Não foi possível interpretar a chamada de ferramenta do modelo.|O serviço do modelo retornou uma resposta ilegível.|A solicitação ao modelo não foi concluída.',
    'Abra Central de modelos → Minhas APIs para verificar ou substituir a chave.|Verifique as permissões da conta e o acesso ao modelo ou entre em contato com o provedor.|Recarregue o saldo e tente novamente.|Verifique o saldo do provedor, os limites da conta e o limite de saída solicitado.|Aguarde um momento e tente novamente.|Aguarde um momento e tente novamente.|Confira o nome do modelo ou troque de modelo.|O contexto foi compactado automaticamente e ainda é longo demais para este modelo. Inicie uma nova conversa ou troque para um modelo com mais contexto; em um modelo local, aumente o comprimento de contexto em Minhas APIs.|Peça uma saída mais curta ou use um modelo com um limite maior.|Altere o prompt ou o material e tente novamente.|Verifique as configurações do modelo e os parâmetros da solicitação.|Reduza o tamanho do arquivo ou da entrada e tente novamente.|Converta o arquivo para um formato aceito por este modelo.|Verifique sua conexão de rede.|Troque de relay e tente novamente.|Envie a solicitação novamente quando quiser continuar.|Confira os detalhes e tente novamente; se o problema persistir, revise as configurações do modelo.',
    'Tentar novamente|Abrir Minhas APIs|Recarregar|Trocar modelo|Trocar relay|',
    'Aguarde {seconds} segundos e tente novamente.|Parâmetro a verificar: {parameter}.|Motivo informado pelo provedor: {reason}|O NextMux já tentou novamente {count} vezes.|O NextMux já trocou de relay {count} vezes.|As credenciais ou a cota do provedor deste relay estão indisponíveis.|Certifique-se de que o serviço de modelo local está em execução.|O provedor do modelo escolhido declara que coleta dados das solicitações, o que suas configurações de privacidade (sem coleta ou sem retenção) não permitem. Escolha outro modelo ou altere Configurações → Privacidade.|Verifique sua rede ou troque de relay.'),
  ru: make(
    'Ключ API недействителен или срок его действия истёк.|Ключ API не настроен.|У этой учётной записи нет разрешения на запрос.|На балансе NextMux недостаточно средств.|Квоты поставщика недостаточно либо запрошенный лимит вывода превышает доступный баланс.|Сервис модели ограничивает частоту запросов.|Сервис модели перегружен.|Выбранная модель или адрес API не найдены.|Этот сервис, регион или модель не поддерживает данную функцию.|Разговор превышает ограничение контекста модели.|Ответ модели превышает ограничение длины.|Сервис модели отклонил запрос по правилам безопасности контента.|Параметр запроса к модели недействителен.|Загруженный файл или запрос превышает допустимый размер.|Сервис модели не поддерживает этот формат файла.|Время ожидания ответа модели истекло.|Не удалось подключиться к сервису модели.|В сервисе модели произошла временная ошибка.|У этого ретранслятора нет доступного маршрута к модели.|Запрос к модели отменён.|Передача ответа модели прервана.|Не удалось разобрать вызов инструмента модели.|Сервис модели вернул нечитаемый ответ.|Запрос к модели не завершён.',
    'Откройте Центр моделей → Мои API, чтобы проверить или заменить ключ.|Проверьте разрешения учётной записи и доступ к модели либо обратитесь к поставщику.|Пополните баланс и повторите попытку.|Проверьте баланс у поставщика, лимиты учётной записи и запрошенный лимит вывода.|Подождите немного и повторите попытку.|Подождите немного и повторите попытку.|Проверьте название модели или смените модель.|Контекст был сжат автоматически, но всё ещё превышает лимит этой модели. Начните новый разговор или выберите модель с бо́льшим контекстом; для локальной модели увеличьте длину контекста в разделе «Мои API».|Запросите более короткий ответ или выберите модель с большим лимитом вывода.|Измените запрос или исходные материалы и повторите попытку.|Проверьте настройки модели и параметры запроса.|Уменьшите размер файла или объём входных данных и повторите попытку.|Преобразуйте файл в поддерживаемый моделью формат.|Проверьте подключение к сети.|Смените ретранслятор и повторите попытку.|Отправьте запрос снова, когда захотите продолжить.|Посмотрите подробности и повторите попытку; если ошибка сохраняется, проверьте настройки модели.',
    'Повторить|Открыть «Мои API»|Пополнить|Сменить модель|Сменить ретранслятор|',
    'Подождите {seconds} сек. и повторите попытку.|Проверьте параметр: {parameter}.|Причина от поставщика: {reason}|NextMux уже выполнил повторные попытки: {count}.|NextMux уже сменил ретранслятор: {count} раз.|Учётные данные или квота поставщика этого ретранслятора недоступны.|Убедитесь, что локальный сервис модели запущен.|Поставщик выбранной модели заявляет, что собирает данные запросов, а ваши настройки конфиденциальности (запрет сбора или нулевое хранение) этого не позволяют. Выберите другую модель или измените Настройки → Конфиденциальность.|Проверьте сеть или смените ретранслятор.'),
  ar: make(
    'مفتاح API غير صالح أو انتهت صلاحيته.|لم يتم إعداد مفتاح API.|لا يملك هذا الحساب إذنًا لتنفيذ الطلب.|رصيد NextMux غير كافٍ.|حصة مزود الخدمة غير كافية، أو أن حد المخرجات المطلوب يتجاوز الرصيد المتاح.|خدمة النموذج تحد من معدل الطلبات.|خدمة النموذج مشغولة حاليًا.|تعذر العثور على النموذج المحدد أو عنوان API.|هذه الخدمة أو المنطقة أو النموذج لا يدعم هذه الميزة.|تجاوزت المحادثة حد سياق النموذج.|تجاوز ناتج النموذج حد الطول.|رفضت خدمة النموذج الطلب وفق قواعد سلامة المحتوى.|إحدى معلمات طلب النموذج غير صالحة.|تجاوز الملف المرفوع أو الطلب حد الحجم.|خدمة النموذج لا تدعم تنسيق الملف هذا.|انتهت مهلة طلب النموذج.|تعذر الاتصال بخدمة النموذج.|حدث خطأ مؤقت في خدمة النموذج.|لا يتوفر مسار للنموذج عبر هذا الوسيط.|تم إلغاء طلب النموذج.|انقطع نقل استجابة النموذج.|تعذر تحليل استدعاء الأداة من النموذج.|أعادت خدمة النموذج استجابة غير قابلة للقراءة.|لم يكتمل طلب النموذج.',
    'افتح مركز النماذج ← واجهات API الخاصة بي للتحقق من المفتاح أو استبداله.|تحقق من أذونات الحساب وإمكانية الوصول إلى النموذج، أو تواصل مع المزود.|اشحن الرصيد ثم أعد المحاولة.|تحقق من رصيد مزود الخدمة وحدود الحساب وحد المخرجات المطلوب.|انتظر قليلًا ثم أعد المحاولة.|انتظر قليلًا ثم أعد المحاولة.|تحقق من اسم النموذج أو بدّل النموذج.|تم ضغط السياق تلقائيًا وما زال أطول من حد هذا النموذج. ابدأ محادثة جديدة أو انتقل إلى نموذج بسياق أكبر؛ وللنموذج المحلي زد طول السياق من «واجهات API الخاصة بي».|اطلب ناتجًا أقصر أو بدّل إلى نموذج بحد إخراج أكبر.|عدّل الطلب أو المواد المدخلة ثم أعد المحاولة.|تحقق من إعدادات النموذج ومعلمات الطلب ثم أعد المحاولة.|قلّل حجم الملف أو المدخلات ثم أعد المحاولة.|حوّل الملف إلى تنسيق يدعمه هذا النموذج.|تحقق من اتصال الشبكة.|بدّل الوسيط ثم أعد المحاولة.|أرسل الطلب مجددًا عندما ترغب في المتابعة.|راجع التفاصيل وأعد المحاولة؛ وإذا استمر الخطأ فتحقق من إعدادات النموذج.',
    'إعادة المحاولة|فتح واجهات API الخاصة بي|شحن الرصيد|تبديل النموذج|تبديل الوسيط|',
    'انتظر {seconds} ثانية ثم أعد المحاولة.|المعلمة المطلوب التحقق منها: {parameter}.|سبب المزود: {reason}|أعاد NextMux المحاولة تلقائيًا {count} مرة بالفعل.|بدّل NextMux الوسيط تلقائيًا {count} مرة بالفعل.|بيانات اعتماد المزود أو حصته لدى هذا الوسيط غير متاحة.|تأكد من تشغيل خدمة النموذج المحلي.|يعلن مزوّد النموذج المختار أنه يجمع بيانات الطلبات، وهذا لا تسمح به إعدادات الخصوصية لديك (منع جمع البيانات أو عدم الاحتفاظ بها). اختر نموذجًا آخر أو غيّر الإعدادات ← الخصوصية.|تحقق من الشبكة أو بدّل الوسيط.'),
  hi: make(
    'API कुंजी अमान्य है या उसकी समय सीमा समाप्त हो गई है।|API कुंजी सेट नहीं की गई है।|इस खाते को यह अनुरोध करने की अनुमति नहीं है।|आपका NextMux बैलेंस पर्याप्त नहीं है।|प्रदाता का कोटा अपर्याप्त है या अनुरोधित आउटपुट सीमा उपलब्ध क्रेडिट से अधिक है।|मॉडल सेवा अनुरोधों की दर सीमित कर रही है।|मॉडल सेवा अभी व्यस्त है।|चुना गया मॉडल या API पता नहीं मिला।|यह सेवा, क्षेत्र या मॉडल इस सुविधा का समर्थन नहीं करता।|बातचीत मॉडल की संदर्भ सीमा से अधिक है।|मॉडल का आउटपुट लंबाई सीमा से अधिक है।|मॉडल सेवा ने सामग्री सुरक्षा नियमों के कारण अनुरोध अस्वीकार कर दिया।|मॉडल अनुरोध का एक पैरामीटर अमान्य है।|अपलोड की गई फ़ाइल या अनुरोध आकार सीमा से अधिक है।|मॉडल सेवा इस फ़ाइल प्रारूप का समर्थन नहीं करती।|मॉडल अनुरोध का समय समाप्त हो गया।|मॉडल सेवा से कनेक्ट नहीं हो सका।|मॉडल सेवा में अस्थायी त्रुटि हुई।|इस रिले पर मॉडल का कोई मार्ग उपलब्ध नहीं है।|मॉडल अनुरोध रद्द कर दिया गया।|मॉडल के उत्तर का प्रसारण बाधित हो गया।|मॉडल के टूल कॉल को समझा नहीं जा सका।|मॉडल सेवा ने अपठनीय उत्तर दिया।|मॉडल अनुरोध पूरा नहीं हुआ।',
    'कुंजी जाँचने या बदलने के लिए मॉडल केंद्र → मेरे API खोलें।|खाते की अनुमतियाँ और मॉडल तक पहुँच जाँचें या प्रदाता से संपर्क करें।|बैलेंस रिचार्ज करके फिर प्रयास करें।|प्रदाता का बैलेंस, खाते की सीमाएँ और अनुरोधित आउटपुट सीमा जाँचें।|थोड़ा इंतज़ार करके फिर प्रयास करें।|थोड़ा इंतज़ार करके फिर प्रयास करें।|मॉडल का नाम जाँचें या मॉडल बदलें।|संदर्भ अपने-आप संक्षिप्त किया गया, फिर भी यह इस मॉडल की सीमा से लंबा है। नई बातचीत शुरू करें या बड़े संदर्भ वाला मॉडल चुनें; लोकल मॉडल के लिए “मेरे API” में संदर्भ लंबाई बढ़ाएँ।|छोटा आउटपुट माँगें या अधिक आउटपुट सीमा वाला मॉडल चुनें।|प्रॉम्प्ट या सामग्री बदलकर फिर प्रयास करें।|मॉडल सेटिंग्स और अनुरोध के पैरामीटर जाँचकर फिर प्रयास करें।|फ़ाइल का आकार या इनपुट कम करके फिर प्रयास करें।|फ़ाइल को इस मॉडल द्वारा समर्थित प्रारूप में बदलें।|अपना नेटवर्क कनेक्शन जाँचें।|रिले बदलकर फिर प्रयास करें।|जारी रखने के लिए अनुरोध दोबारा भेजें।|विवरण देखकर फिर प्रयास करें; समस्या बनी रहे तो मॉडल सेटिंग्स जाँचें।',
    'फिर प्रयास करें|मेरे API खोलें|रिचार्ज करें|मॉडल बदलें|रिले बदलें|',
    '{seconds} सेकंड इंतज़ार करके फिर प्रयास करें।|जाँचने वाला पैरामीटर: {parameter}।|प्रदाता का कारण: {reason}|NextMux पहले ही {count} बार अपने आप फिर प्रयास कर चुका है।|NextMux पहले ही {count} बार रिले बदल चुका है।|इस रिले के प्रदाता की पहचान संबंधी जानकारी या कोटा उपलब्ध नहीं है।|सुनिश्चित करें कि स्थानीय मॉडल सेवा चालू है।|चुने गए मॉडल का प्रदाता अनुरोध डेटा एकत्र करने की घोषणा करता है, जिसकी अनुमति आपकी गोपनीयता सेटिंग (डेटा संग्रह नहीं या डेटा न रखना) नहीं देती। कोई दूसरा मॉडल चुनें या सेटिंग → गोपनीयता बदलें।|अपना नेटवर्क जाँचें या रिले बदलें।'),
};

// A paid request with an uncertain outcome must not offer another paid retry.
const billingReview: Record<string, readonly [string, string]> = {
  'zh-CN': ['本次请求的计费状态需要核对。', '请先查看账单或联系支持，确认后再发起请求。'],
  'zh-TW': ['本次請求的計費狀態需要核對。', '請先查看帳單或聯絡支援，確認後再發起請求。'],
  en: ['The billing status of this request needs review.', 'Check the bill or contact support before making another request.'],
  ja: ['このリクエストの課金状況を確認する必要があります。', '次のリクエストを送る前に、請求を確認するかサポートにお問い合わせください。'],
  ko: ['이 요청의 과금 상태를 확인해야 합니다.', '새 요청을 보내기 전에 청구 내역을 확인하거나 지원팀에 문의하세요.'],
  es: ['Es necesario revisar el estado de facturación de esta solicitud.', 'Consulta la factura o contacta con soporte antes de hacer otra solicitud.'],
  fr: ['La facturation de cette requête doit être vérifiée.', 'Consultez la facture ou contactez l’assistance avant d’envoyer une autre requête.'],
  de: ['Der Abrechnungsstatus dieser Anfrage muss geprüft werden.', 'Prüfe die Rechnung oder kontaktiere den Support, bevor du eine neue Anfrage sendest.'],
  'pt-BR': ['O status de cobrança desta solicitação precisa ser revisado.', 'Confira a cobrança ou contate o suporte antes de fazer outra solicitação.'],
  ru: ['Необходимо проверить состояние оплаты этого запроса.', 'Проверьте счёт или обратитесь в поддержку перед новым запросом.'],
  ar: ['تحتاج حالة فوترة هذا الطلب إلى مراجعة.', 'تحقق من الفاتورة أو تواصل مع الدعم قبل إرسال طلب آخر.'],
  hi: ['इस अनुरोध की बिलिंग स्थिति की जाँच आवश्यक है।', 'अगला अनुरोध करने से पहले बिल जाँचें या सहायता से संपर्क करें।'],
};
const initializationPending: Record<string, readonly [string, string]> = {
  'zh-CN': ['暂时无法确认平台是否已接收原请求。', '请稍后查看原请求状态，不要重复发送；这不代表已经扣费。'],
  'zh-TW': ['暫時無法確認平台是否已接收原請求。', '請稍後查看原請求狀態，不要重複傳送；這不代表已經扣費。'],
  en: ['The platform has not yet confirmed receipt of the original request.', 'Check the original request status later without sending it again. This does not mean you were charged.'],
  ja: ['元のリクエストをプラットフォームが受信したか、まだ確認できません。', '再送せず、後で元のリクエストの状態を確認してください。課金されたという意味ではありません。'],
  ko: ['플랫폼이 원래 요청을 받았는지 아직 확인할 수 없습니다.', '다시 보내지 말고 나중에 원래 요청의 상태를 확인하세요. 요금이 청구되었다는 뜻은 아닙니다.'],
  es: ['La plataforma aún no ha confirmado la recepción de la solicitud original.', 'Consulta el estado de la solicitud original más tarde sin volver a enviarla. Esto no significa que se haya cobrado.'],
  fr: ['La plateforme n’a pas encore confirmé la réception de la requête initiale.', 'Vérifiez l’état de la requête initiale plus tard sans la renvoyer. Cela ne signifie pas qu’elle a été facturée.'],
  de: ['Die Plattform hat den Eingang der ursprünglichen Anfrage noch nicht bestätigt.', 'Prüfe den Status der ursprünglichen Anfrage später, ohne sie erneut zu senden. Dies bedeutet nicht, dass eine Gebühr berechnet wurde.'],
  'pt-BR': ['A plataforma ainda não confirmou o recebimento da solicitação original.', 'Confira o status da solicitação original mais tarde sem enviá-la novamente. Isso não significa que houve cobrança.'],
  ru: ['Платформа ещё не подтвердила получение исходного запроса.', 'Проверьте состояние исходного запроса позже, не отправляя его повторно. Это не означает, что деньги были списаны.'],
  ar: ['لم تؤكد المنصة بعد استلام الطلب الأصلي.', 'تحقق من حالة الطلب الأصلي لاحقًا دون إرساله مجددًا. هذا لا يعني أنه تم تحصيل رسوم.'],
  hi: ['प्लेटफ़ॉर्म ने अभी तक मूल अनुरोध प्राप्त होने की पुष्टि नहीं की है।', 'दोबारा भेजे बिना बाद में मूल अनुरोध की स्थिति जाँचें। इसका अर्थ यह नहीं है कि शुल्क लिया गया है।'],
};
const requestBudgetUnavailable: Record<string, readonly [string, string]> = {
  "zh-CN": [
    "本次调用暂时无法开始，可用请求预算不足。",
    "部分资金可能正用于其他请求或等待用量确认。已有工作已保留，可稍后继续；不会自动降低输出上限或重新执行已完成的操作。"
  ],
  "zh-TW": [
    "本次呼叫暫時無法開始，可用請求預算不足。",
    "部分資金可能正用於其他請求或等待用量確認。已完成的工作會保留，可稍後繼續；不會自動降低輸出上限或重新執行已完成的操作。"
  ],
  "en": [
    "This call cannot start yet because its available request budget is too small.",
    "Some funds may cover other requests or usage awaiting confirmation. Completed work is preserved; continue later. Output limits and completed operations are not changed automatically."
  ],
  "ja": [
    "利用可能なリクエスト予算が足りないため、この呼び出しはまだ開始できません。",
    "他のリクエストや利用量の確認待ちに充てられた資金がある可能性があります。完了した作業は保持されます。後で続行してください。出力上限の引き下げや完了済み操作の再実行は自動では行いません。"
  ],
  "ko": [
    "사용 가능한 요청 예산이 부족해 이 호출을 아직 시작할 수 없습니다.",
    "일부 자금은 다른 요청이나 사용량 확인을 기다리는 요청에 사용될 수 있습니다. 완료한 작업은 보존되며 나중에 계속할 수 있습니다. 출력 한도를 자동으로 낮추거나 완료한 작업을 다시 실행하지 않습니다."
  ],
  "es": [
    "Esta llamada aún no puede empezar porque el presupuesto disponible es insuficiente.",
    "Parte de los fondos puede cubrir otras solicitudes o consumo pendiente de confirmar. El trabajo terminado se conserva; continúa más tarde. No se reducen automáticamente los límites de salida ni se repiten las operaciones terminadas."
  ],
  "fr": [
    "Cet appel ne peut pas encore démarrer car son budget disponible est insuffisant.",
    "Des fonds peuvent couvrir d’autres requêtes ou un usage en attente de confirmation. Le travail terminé est conservé ; reprenez plus tard. Les limites de sortie et les opérations terminées ne sont pas modifiées automatiquement."
  ],
  "de": [
    "Dieser Aufruf kann noch nicht starten, weil sein verfügbares Anfragebudget zu gering ist.",
    "Ein Teil des Guthabens kann andere Anfragen oder noch unbestätigte Nutzung abdecken. Erledigte Arbeit bleibt erhalten; fahre später fort. Ausgabelimits werden nicht automatisch gesenkt und erledigte Aktionen nicht wiederholt."
  ],
  "pt-BR": [
    "Esta chamada ainda não pode começar porque o orçamento disponível é insuficiente.",
    "Parte dos fundos pode cobrir outras solicitações ou uso aguardando confirmação. O trabalho concluído é preservado; continue mais tarde. Os limites de saída não são reduzidos automaticamente e as operações concluídas não são repetidas."
  ],
  "ru": [
    "Этот вызов пока нельзя начать: доступного бюджета запроса недостаточно.",
    "Часть средств может покрывать другие запросы или использование, ожидающее подтверждения. Завершённая работа сохранена; продолжите позже. Лимиты вывода не снижаются автоматически, завершённые операции не повторяются."
  ],
  "ar": [
    "لا يمكن بدء هذا الاستدعاء بعد لأن ميزانية الطلب المتاحة غير كافية.",
    "قد تغطي بعض الأموال طلبات أخرى أو استخدامًا ينتظر التأكيد. يتم الاحتفاظ بالعمل المنجز؛ تابع لاحقًا. لن يتم خفض حدود المخرجات أو إعادة العمليات المنجزة تلقائيًا."
  ],
  "hi": [
    "उपलब्ध अनुरोध बजट पर्याप्त नहीं होने के कारण यह कॉल अभी शुरू नहीं हो सकती।",
    "कुछ धन अन्य अनुरोधों या पुष्टि की प्रतीक्षा कर रहे उपयोग को पूरा कर सकता है। पूरा काम सुरक्षित है; बाद में जारी रखें। आउटपुट सीमाएँ अपने आप कम नहीं की जातीं और पूरे किए गए कार्य दोहराए नहीं जाते।"
  ]
};
const billingUnavailable: Record<string, readonly [string, string]> = {
  'zh-CN': ['平台计费暂时不可用，本次请求尚未发送给模型。', '请联系平台支持，待计费服务恢复后再继续。'],
  'zh-TW': ['平台計費暫時無法使用，本次請求尚未傳送給模型。', '請聯絡平台支援，待計費服務恢復後再繼續。'],
  en: ['Platform billing is temporarily unavailable. This request has not been sent to the model.', 'Contact platform support and continue once billing is available again.'],
  ja: ['プラットフォームの課金を現在利用できないため、このリクエストはまだモデルに送信されていません。', 'プラットフォームのサポートに連絡し、課金サービスの復旧後に続行してください。'],
  ko: ['플랫폼 결제를 일시적으로 사용할 수 없어 이 요청은 아직 모델에 전송되지 않았습니다.', '플랫폼 지원팀에 문의하고 결제 서비스가 복구된 후 계속하세요.'],
  es: ['La facturación de la plataforma no está disponible temporalmente. Esta solicitud no se ha enviado al modelo.', 'Contacta con el soporte de la plataforma y continúa cuando se restablezca la facturación.'],
  fr: ['La facturation de la plateforme est temporairement indisponible. Cette requête n’a pas été envoyée au modèle.', 'Contactez l’assistance de la plateforme et reprenez une fois la facturation rétablie.'],
  de: ['Die Abrechnung der Plattform ist vorübergehend nicht verfügbar. Diese Anfrage wurde noch nicht an das Modell gesendet.', 'Wende dich an den Plattform-Support und fahre fort, sobald die Abrechnung wieder verfügbar ist.'],
  'pt-BR': ['A cobrança da plataforma está temporariamente indisponível. Esta solicitação não foi enviada ao modelo.', 'Entre em contato com o suporte da plataforma e continue quando a cobrança estiver disponível novamente.'],
  ru: ['Оплата на платформе временно недоступна. Этот запрос ещё не отправлен модели.', 'Обратитесь в службу поддержки платформы и продолжите после восстановления оплаты.'],
  ar: ['فوترة المنصة غير متاحة مؤقتًا. لم يُرسل هذا الطلب إلى النموذج.', 'تواصل مع دعم المنصة وتابع بعد عودة خدمة الفوترة.'],
  hi: ['प्लेटफ़ॉर्म की बिलिंग अस्थायी रूप से उपलब्ध नहीं है। यह अनुरोध मॉडल को नहीं भेजा गया है।', 'प्लेटफ़ॉर्म सहायता से संपर्क करें और बिलिंग सेवा बहाल होने के बाद आगे बढ़ें।'],
};
const ownApiConnection: Record<string, string> = {
  'zh-CN': '请检查网络或“我的 API”接口地址。',
  'zh-TW': '請檢查網路或「我的 API」介面位址。',
  en: 'Check your network or your My API endpoint URL.',
  ja: 'ネットワークまたは「マイ API」のエンドポイント URL を確認してください。',
  ko: '네트워크 또는 내 API 엔드포인트 주소를 확인하세요.',
  es: 'Revisa tu red o la URL del endpoint en Mi API.',
  fr: 'Vérifiez votre réseau ou l’URL de point de terminaison dans Mon API.',
  de: 'Prüfe dein Netzwerk oder die Endpunkt-URL in Meine API.',
  'pt-BR': 'Verifique sua rede ou a URL do endpoint em Minha API.',
  ru: 'Проверьте сеть или адрес конечной точки в «Мои API».',
  ar: 'تحقق من الشبكة أو عنوان نقطة النهاية في واجهات API الخاصة بي.',
  hi: 'अपना नेटवर्क या मेरे API में एंडपॉइंट URL जांचें।',
};
const signInRequiredCopy: Record<string, readonly [string, string]> = {
  'zh-CN': ['请先登录账号，或切换至“我的 API”。', ''],
  'zh-TW': ['請先登入帳號，或切換至「我的 API」。', ''],
  en: ['Please sign in first, or switch to My API.', ''],
  ja: ['先にログインするか、「マイ API」に切り替えてください。', ''],
  ko: ['먼저 로그인하거나 내 API로 전환하세요.', ''],
  es: ['Inicia sesión primero o cambia a Mis API.', ''],
  fr: ['Connectez-vous d’abord ou passez à Mes API.', ''],
  de: ['Melde dich zuerst an oder wechsle zu Meine APIs.', ''],
  'pt-BR': ['Entre primeiro ou mude para Minhas APIs.', ''],
  ru: ['Сначала войдите в аккаунт или переключитесь на «Мои API».', ''],
  ar: ['يرجى تسجيل الدخول أولًا أو التبديل إلى «واجهات API الخاصة بي».', ''],
  hi: ['कृपया पहले साइन इन करें या “मेरे API” पर स्विच करें।', ''],
};
for (const [locale, copy] of Object.entries(locales)) {
  copy.ownApiConnection = ownApiConnection[locale];
  copy.signInRequired = signInRequiredCopy[locale][0];
  copy.signInRequiredAdvice = signInRequiredCopy[locale][1];
  copy.messages.billing_unavailable = billingUnavailable[locale][0];
  copy.advice.billing_unavailable = billingUnavailable[locale][1];
  copy.messages.request_budget_unavailable = requestBudgetUnavailable[locale][0];
  copy.advice.request_budget_unavailable = requestBudgetUnavailable[locale][1];
  copy.messages.billing_review_required = billingReview[locale][0];
  copy.advice.billing_review_required = billingReview[locale][1];
  copy.messages.request_initialization_pending = initializationPending[locale][0];
  copy.advice.request_initialization_pending = initializationPending[locale][1];
}
export const MODEL_ERROR_LOCALES = Object.freeze(Object.keys(locales));
export function modelErrorLocale(locale: string): ErrorLocale {
  const normalized = locale.replace(/_/g, '-');
  if (/^zh-(?:tw|hk|hant)/i.test(normalized)) return locales['zh-TW'];
  if (/^zh/i.test(normalized)) return locales['zh-CN'];
  if (/^pt/i.test(normalized)) return locales['pt-BR'];
  return locales[normalized] ?? locales[normalized.toLowerCase().split('-')[0]] ?? locales.en;
}


const walletAdmissionCopy: Record<string, readonly [string, string, string, string]> = {
  "en": [
    "Other requests await usage confirmation",
    "Existing reserved funds reduce admission headroom",
    "The request admission ceiling exceeds available headroom",
    "Reason: {reason}. Admission ceiling: {required} {currency}; available headroom: {available} {currency}; outstanding request risk: {risk} {currency}. These amounts are not reserved or charged fees."
  ],
  "zh-CN": [
    "其他请求的用量尚待确认",
    "已有预留资金影响本次准入",
    "本次准入上限超过可用余量",
    "原因：{reason}。准入上限：{required} {currency}；可用余量：{available} {currency}；未结请求风险：{risk} {currency}。这些数字不是预扣款或已扣费用。"
  ],
  "zh-TW": [
    "其他請求的用量尚待確認",
    "已有預留資金影響本次准入",
    "本次准入上限超過可用餘量",
    "原因：{reason}。准入上限：{required} {currency}；可用餘量：{available} {currency}；未結請求風險：{risk} {currency}。這些數字不是預扣款或已扣費用。"
  ],
  "ja": [
    "他のリクエストの利用量が未確認",
    "既存の予約資金により利用可能枠が減少",
    "リクエストの開始上限が利用可能枠を超過",
    "理由：{reason}。開始上限：{required} {currency}、利用可能枠：{available} {currency}、未確定リクエストのリスク：{risk} {currency}。これらは予約額や請求額ではありません。"
  ],
  "ko": [
    "다른 요청의 사용량 확인 대기",
    "기존 예약 자금으로 승인 여유 감소",
    "요청 승인 상한이 가용 여유 초과",
    "이유: {reason}. 승인 상한: {required} {currency}; 가용 여유: {available} {currency}; 미확정 요청 위험: {risk} {currency}. 이 금액은 예약되거나 청구된 요금이 아닙니다."
  ],
  "es": [
    "Otras solicitudes esperan confirmación de uso",
    "Los fondos reservados reducen el margen disponible",
    "El límite de admisión supera el margen disponible",
    "Motivo: {reason}. Límite de admisión: {required} {currency}; margen disponible: {available} {currency}; riesgo de solicitudes pendientes: {risk} {currency}. Estos importes no son fondos reservados ni cargos."
  ],
  "fr": [
    "Usage d’autres requêtes en attente de confirmation",
    "Les fonds réservés réduisent la marge disponible",
    "Le plafond d’admission dépasse la marge disponible",
    "Motif : {reason}. Plafond d’admission : {required} {currency} ; marge disponible : {available} {currency} ; risque des requêtes en cours : {risk} {currency}. Ces montants ne sont ni des réservations ni des frais débités."
  ],
  "de": [
    "Nutzung anderer Anfragen noch unbestätigt",
    "Reserviertes Guthaben verringert den verfügbaren Spielraum",
    "Die Zulassungsgrenze übersteigt den verfügbaren Spielraum",
    "Grund: {reason}. Zulassungsgrenze: {required} {currency}; verfügbarer Spielraum: {available} {currency}; Risiko offener Anfragen: {risk} {currency}. Diese Beträge sind keine reservierten oder abgebuchten Gebühren."
  ],
  "pt-BR": [
    "Uso de outras solicitações aguarda confirmação",
    "Fundos reservados reduzem a margem disponível",
    "O limite de admissão excede a margem disponível",
    "Motivo: {reason}. Limite de admissão: {required} {currency}; margem disponível: {available} {currency}; risco de solicitações pendentes: {risk} {currency}. Estes valores não são reservas nem tarifas cobradas."
  ],
  "ru": [
    "Использование других запросов ожидает подтверждения",
    "Зарезервированные средства уменьшают доступный запас",
    "Предел допуска запроса превышает доступный запас",
    "Причина: {reason}. Предел допуска: {required} {currency}; доступный запас: {available} {currency}; риск незавершённых запросов: {risk} {currency}. Эти суммы не являются резервом или списанной платой."
  ],
  "ar": [
    "استخدام طلبات أخرى ينتظر التأكيد",
    "الأموال المحجوزة تقلل الهامش المتاح",
    "حد قبول الطلب يتجاوز الهامش المتاح",
    "السبب: {reason}. حد القبول: {required} {currency}؛ الهامش المتاح: {available} {currency}؛ مخاطر الطلبات المعلقة: {risk} {currency}. هذه المبالغ ليست أموالًا محجوزة أو رسومًا مخصومة."
  ],
  "hi": [
    "अन्य अनुरोधों के उपयोग की पुष्टि बाकी है",
    "आरक्षित धन से उपलब्ध गुंजाइश कम है",
    "अनुरोध की स्वीकृति सीमा उपलब्ध गुंजाइश से अधिक है",
    "कारण: {reason}। स्वीकृति सीमा: {required} {currency}; उपलब्ध गुंजाइश: {available} {currency}; लंबित अनुरोध जोखिम: {risk} {currency}। ये राशियाँ आरक्षित धन या काटा गया शुल्क नहीं हैं।"
  ]
};

/** Display the validated snapshot exactly to six micro-unit decimal places. */
export function formatWalletAdmissionDiagnostic(value: WalletAdmissionDiagnostic, locale = 'en'): string {
  const normalized = locale.replace(/_/g, '-');
  const key = /^zh-(?:tw|hk|hant)/i.test(normalized) ? 'zh-TW' : /^zh/i.test(normalized) ? 'zh-CN'
    : /^pt/i.test(normalized) ? 'pt-BR' : walletAdmissionCopy[normalized] ? normalized
    : walletAdmissionCopy[normalized.toLowerCase().split('-')[0]] ? normalized.toLowerCase().split('-')[0] : 'en';
  const copy = walletAdmissionCopy[key];
  const reason = copy[value.reason === 'outstanding_usage' ? 0 : value.reason === 'reserved_funds' ? 1 : 2];
  const amount = (micros: number): string => {
    const fraction = String(micros % 1_000_000).padStart(6, '0').replace(/0+$/, '');
    return String(Math.floor(micros / 1_000_000)) + (fraction ? `.${fraction}` : '');
  };
  return copy[3].replace('{reason}', reason).replace('{required}', amount(value.requiredMicros))
    .replace('{available}', amount(value.availableRequestBudgetMicros)).replace('{risk}', amount(value.outstandingRiskMicros))
    .replace(/\{currency\}/g, value.currency);
}

/** An explicit coverage check; locale fallback is not proof of a translation. */
export function hasModelErrorTranslation(locale: string, kind: ModelErrorKind): boolean {
  const copy = locales[locale];
  return Boolean(copy && Object.prototype.hasOwnProperty.call(copy.messages, kind) && copy.messages[kind]?.trim()
    && Object.prototype.hasOwnProperty.call(copy.advice, kind) && copy.advice[kind]?.trim());
}

/**
 * Exact user-facing wording when a platform content/safety filter blocks a response
 * (OpenAI/Azure `content_filter`, ResponsibleAIPolicyViolation, Gemini safety block).
 * The zh-CN sentence is the verbatim approved wording and must never be reworded.
 */
export const CONTENT_FILTER_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  'zh-CN': '内容触发了平台安全过滤，请调整后重新发送',
  'zh-TW': '內容觸發了平台安全過濾，請調整後重新傳送',
  en: 'The response was blocked by the platform content safety filter. Adjust it and send again.',
  ja: 'プラットフォームのコンテンツ安全フィルターにより応答がブロックされました。修正して再送信してください。',
  ko: '플랫폼 콘텐츠 안전 필터로 응답이 차단되었습니다. 수정 후 다시 보내세요.',
  es: 'La respuesta fue bloqueada por el filtro de seguridad de contenido de la plataforma. Ajústala y vuelve a enviarla.',
  fr: 'La réponse a été bloquée par le filtre de sécurité du contenu de la plateforme. Modifiez-la et renvoyez-la.',
  de: 'Die Antwort wurde vom Inhalts-Sicherheitsfilter der Plattform blockiert. Passe sie an und sende sie erneut.',
  'pt-BR': 'A resposta foi bloqueada pelo filtro de segurança de conteúdo da plataforma. Ajuste e envie novamente.',
  ru: 'Ответ заблокирован фильтром безопасности контента платформы. Измените его и отправьте снова.',
  ar: 'تم حجب الاستجابة بواسطة مرشح سلامة المحتوى في المنصة. عدّلها وأعد إرسالها.',
  hi: 'प्लेटफ़ॉर्म की कंटेंट सुरक्षा फ़िल्टर ने प्रतिक्रिया को अवरुद्ध कर दिया। इसे संशोधित करके दोबारा भेजें।',
});
/** Resolves the exact safety-filter sentence for a locale; falls back like modelErrorLocale. */
export function contentFilterMessage(locale = 'zh-CN'): string {
  const normalized = locale.replace(/_/g, '-');
  if (/^zh-(?:tw|hk|hant)/i.test(normalized)) return CONTENT_FILTER_MESSAGES['zh-TW']!;
  if (/^zh/i.test(normalized)) return CONTENT_FILTER_MESSAGES['zh-CN']!;
  if (/^pt/i.test(normalized)) return CONTENT_FILTER_MESSAGES['pt-BR']!;
  return CONTENT_FILTER_MESSAGES[normalized] ?? CONTENT_FILTER_MESSAGES[normalized.toLowerCase().split('-')[0]] ?? CONTENT_FILTER_MESSAGES.en!;
}

const operationFallbacks: Record<string, readonly [string, string, string]> = {
  en: ['The operation could not be completed. See details for more information.', 'The media operation could not be completed. See details for more information.', 'The comic operation could not be completed. See details for more information.'],
  'zh-CN': ['操作未能完成，请查看详情。', '媒体操作未能完成，请查看详情。', '漫画操作未能完成，请查看详情。'],
  'zh-TW': ['操作未能完成，請查看詳情。', '媒體操作未能完成，請查看詳情。', '漫畫操作未能完成，請查看詳情。'],
  ja: ['操作を完了できませんでした。詳細を確認してください。', 'メディア操作を完了できませんでした。詳細を確認してください。', '漫画の操作を完了できませんでした。詳細を確認してください。'],
  ko: ['작업을 완료하지 못했습니다. 자세한 내용을 확인하세요.', '미디어 작업을 완료하지 못했습니다. 자세한 내용을 확인하세요.', '만화 작업을 완료하지 못했습니다. 자세한 내용을 확인하세요.'],
  es: ['No se pudo completar la operación. Consulta los detalles.', 'No se pudo completar la operación de medios. Consulta los detalles.', 'No se pudo completar la operación del cómic. Consulta los detalles.'],
  fr: ['L’opération n’a pas pu être terminée. Consultez les détails.', 'L’opération multimédia n’a pas pu être terminée. Consultez les détails.', 'L’opération sur la bande dessinée n’a pas pu être terminée. Consultez les détails.'],
  de: ['Der Vorgang konnte nicht abgeschlossen werden. Weitere Informationen stehen in den Details.', 'Der Medienvorgang konnte nicht abgeschlossen werden. Weitere Informationen stehen in den Details.', 'Der Comic-Vorgang konnte nicht abgeschlossen werden. Weitere Informationen stehen in den Details.'],
  'pt-BR': ['Não foi possível concluir a operação. Consulte os detalhes.', 'Não foi possível concluir a operação de mídia. Consulte os detalhes.', 'Não foi possível concluir a operação do quadrinho. Consulte os detalhes.'],
  ru: ['Не удалось завершить операцию. См. подробности.', 'Не удалось завершить операцию с медиа. См. подробности.', 'Не удалось завершить операцию с комиксом. См. подробности.'],
  ar: ['تعذر إكمال العملية. راجع التفاصيل.', 'تعذر إكمال عملية الوسائط. راجع التفاصيل.', 'تعذر إكمال عملية القصة المصورة. راجع التفاصيل.'],
  hi: ['कार्रवाई पूरी नहीं हो सकी। विवरण देखें।', 'मीडिया कार्रवाई पूरी नहीं हो सकी। विवरण देखें।', 'कॉमिक कार्रवाई पूरी नहीं हो सकी। विवरण देखें।'],
};
export function operationErrorFallback(locale: string, domain: 'media' | 'comic' | 'operation'): string {
  const copy = modelErrorLocale(locale);
  const resolved = Object.keys(locales).find(key => locales[key] === copy) ?? 'en';
  return operationFallbacks[resolved][domain === 'media' ? 1 : domain === 'comic' ? 2 : 0];
}
