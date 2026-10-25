/** Browser-safe media-domain messages. Keys select semantics; diagnostic prose is never parsed. */
export type MediaDomainErrorParams = Readonly<Record<string, string | number | boolean | null>>;
export const MEDIA_ERROR_LOCALES = ["en","zh-CN","zh-TW","ja","ko","es","fr","de","pt-BR","ru","ar","hi"] as const;
const subjects: Readonly<Record<string, readonly string[]>> = {
  "request": [
    "media request",
    "媒体请求",
    "媒體請求",
    "メディアリクエスト",
    "미디어 요청",
    "solicitud multimedia",
    "requête multimédia",
    "Medienanfrage",
    "solicitação de mídia",
    "медиазапрос",
    "طلب الوسائط",
    "मीडिया अनुरोध"
  ],
  "response": [
    "media response",
    "媒体响应",
    "媒體回應",
    "メディア応答",
    "미디어 응답",
    "respuesta multimedia",
    "réponse multimédia",
    "Medienantwort",
    "resposta de mídia",
    "медиаответ",
    "استجابة الوسائط",
    "मीडिया प्रतिक्रिया"
  ],
  "job": [
    "media job",
    "媒体任务",
    "媒體工作",
    "メディアタスク",
    "미디어 작업",
    "tarea multimedia",
    "tâche multimédia",
    "Medienauftrag",
    "tarefa de mídia",
    "медиазадача",
    "مهمة الوسائط",
    "मीडिया कार्य"
  ],
  "worker": [
    "media worker",
    "媒体工作进程",
    "媒體工作程序",
    "メディアワーカー",
    "미디어 작업 프로세스",
    "proceso multimedia",
    "processus multimédia",
    "Medienprozess",
    "processo de mídia",
    "медиапроцесс",
    "عملية الوسائط",
    "मीडिया प्रक्रिया"
  ],
  "queue": [
    "media queue",
    "媒体队列",
    "媒體佇列",
    "メディアキュー",
    "미디어 대기열",
    "cola multimedia",
    "file multimédia",
    "Medienwarteschlange",
    "fila de mídia",
    "очередь медиазадач",
    "قائمة انتظار الوسائط",
    "मीडिया कतार"
  ],
  "history": [
    "media history",
    "媒体历史记录",
    "媒體歷程記錄",
    "メディア履歴",
    "미디어 기록",
    "historial multimedia",
    "historique multimédia",
    "Medienverlauf",
    "histórico de mídia",
    "история медиазадач",
    "سجل الوسائط",
    "मीडिया इतिहास"
  ],
  "checkpoint": [
    "media checkpoint",
    "媒体结果检查点",
    "媒體結果檢查點",
    "メディア結果のチェックポイント",
    "미디어 결과 체크포인트",
    "punto de control multimedia",
    "point de contrôle multimédia",
    "Medienprüfpunkt",
    "ponto de controle de mídia",
    "контрольная точка медиа",
    "نقطة حفظ الوسائط",
    "मीडिया चेकपॉइंट"
  ],
  "image": [
    "image",
    "图像",
    "影像",
    "画像",
    "이미지",
    "imagen",
    "image",
    "Bild",
    "imagem",
    "изображение",
    "الصورة",
    "छवि"
  ],
  "audio": [
    "audio",
    "音频",
    "音訊",
    "音声",
    "오디오",
    "audio",
    "audio",
    "Audio",
    "áudio",
    "аудио",
    "الصوت",
    "ऑडियो"
  ],
  "music": [
    "music",
    "音乐",
    "音樂",
    "音楽",
    "음악",
    "música",
    "musique",
    "Musik",
    "música",
    "музыка",
    "الموسيقى",
    "संगीत"
  ],
  "speech": [
    "speech",
    "配音",
    "配音",
    "読み上げ音声",
    "음성",
    "voz",
    "voix",
    "Sprachausgabe",
    "voz",
    "речь",
    "الكلام",
    "वाणी"
  ],
  "sound_effect": [
    "sound effect",
    "音效",
    "音效",
    "効果音",
    "효과음",
    "efecto de sonido",
    "effet sonore",
    "Soundeffekt",
    "efeito sonoro",
    "звуковой эффект",
    "المؤثر الصوتي",
    "ध्वनि प्रभाव"
  ],
  "subtitle": [
    "subtitles",
    "字幕",
    "字幕",
    "字幕",
    "자막",
    "subtítulos",
    "sous-titres",
    "Untertitel",
    "legendas",
    "субтитры",
    "الترجمة النصية",
    "उपशीर्षक"
  ],
  "transcription": [
    "transcription",
    "字幕识别",
    "字幕辨識",
    "文字起こし",
    "음성 전사",
    "transcripción",
    "transcription",
    "Transkription",
    "transcrição",
    "транскрипция",
    "التفريغ النصي",
    "प्रतिलेखन"
  ],
  "reference": [
    "media reference",
    "参考素材",
    "參考素材",
    "参照素材",
    "참조 미디어",
    "referencia multimedia",
    "référence multimédia",
    "Medienreferenz",
    "referência de mídia",
    "медиареференс",
    "الوسائط المرجعية",
    "मीडिया संदर्भ"
  ],
  "video": [
    "video",
    "视频",
    "影片",
    "動画",
    "동영상",
    "vídeo",
    "vidéo",
    "Video",
    "vídeo",
    "видео",
    "الفيديو",
    "वीडियो"
  ],
  "workflow": [
    "ComfyUI workflow",
    "ComfyUI 工作流",
    "ComfyUI 工作流程",
    "ComfyUI ワークフロー",
    "ComfyUI 워크플로",
    "flujo de ComfyUI",
    "workflow ComfyUI",
    "ComfyUI-Workflow",
    "fluxo do ComfyUI",
    "процесс ComfyUI",
    "سير عمل ComfyUI",
    "ComfyUI कार्यप्रवाह"
  ],
  "node": [
    "ComfyUI node",
    "ComfyUI 节点",
    "ComfyUI 節點",
    "ComfyUI ノード",
    "ComfyUI 노드",
    "nodo de ComfyUI",
    "nœud ComfyUI",
    "ComfyUI-Knoten",
    "nó do ComfyUI",
    "узел ComfyUI",
    "عقدة ComfyUI",
    "ComfyUI नोड"
  ],
  "provider": [
    "media service",
    "媒体服务",
    "媒體服務",
    "メディアサービス",
    "미디어 서비스",
    "servicio multimedia",
    "service multimédia",
    "Mediendienst",
    "serviço de mídia",
    "медиасервис",
    "خدمة الوسائط",
    "मीडिया सेवा"
  ],
  "field": [
    "field",
    "字段",
    "欄位",
    "フィールド",
    "필드",
    "campo",
    "champ",
    "Feld",
    "campo",
    "поле",
    "الحقل",
    "फ़ील्ड"
  ],
  "ComfyUI": [
    "ComfyUI",
    "ComfyUI",
    "ComfyUI",
    "ComfyUI",
    "ComfyUI",
    "ComfyUI",
    "ComfyUI",
    "ComfyUI",
    "ComfyUI",
    "ComfyUI",
    "ComfyUI",
    "ComfyUI"
  ]
};
const templates: Readonly<Record<string, readonly string[]>> = {
"positive_range": ["{fieldName} must be greater than {minimum} and at most {maximum}{unit}.","{fieldName}必须大于{minimum}且不超过{maximum}{unit}。","{fieldName}必須大於{minimum}且不超過{maximum}{unit}。","{fieldName}は{minimum}より大きく、{maximum}{unit}以下にしてください。","{fieldName}은(는) {minimum}보다 크고 {maximum}{unit} 이하여야 합니다.","{fieldName} debe ser mayor que {minimum} y como máximo {maximum}{unit}.","{fieldName} doit dépasser {minimum} sans dépasser {maximum}{unit}.","{fieldName} muss größer als {minimum} und höchstens {maximum}{unit} sein.","{fieldName} deve ser maior que {minimum} e no máximo {maximum}{unit}.","{fieldName}: больше {minimum}, но не больше {maximum}{unit}.","يجب أن يكون {fieldName} أكبر من {minimum} وألا يتجاوز {maximum}{unit}.","{fieldName} को {minimum} से अधिक और अधिकतम {maximum}{unit} होना चाहिए।"],
"plan_local": ["Handled by the local subtitle or timeline renderer.","由本地字幕或时间线渲染器处理。","由本機字幕或時間軸算繪器處理。","ローカルの字幕・タイムラインレンダラーで処理します。","로컬 자막 또는 타임라인 렌더러가 처리합니다.","Se procesa con el renderizador local de subtítulos o línea de tiempo.","Traitement par le moteur local de sous-titres ou de montage.","Verarbeitung durch den lokalen Untertitel- oder Timeline-Renderer.","Processado pelo renderizador local de legendas ou linha do tempo.","Обработка локальным средством рендеринга субтитров или шкалы времени.","تُعالج بواسطة عارض الترجمة أو المخطط الزمني المحلي.","स्थानीय उपशीर्षक या टाइमलाइन रेंडरर द्वारा संसाधित।"],
"plan_verified": ["The required model capability is verified.","所需模型能力已经验证。","所需模型能力已經驗證。","必要なモデル機能は検証済みです。","필요한 모델 기능이 검증되었습니다.","La capacidad necesaria del modelo está verificada.","La capacité requise du modèle est vérifiée.","Die erforderliche Modellfunktion ist verifiziert.","A capacidade necessária do modelo foi verificada.","Необходимая возможность модели проверена.","تم التحقق من قدرة النموذج المطلوبة.","आवश्यक मॉडल क्षमता सत्यापित है।"],
"plan_music_unsupported": ["The model has no verified support for this music mode.","此模型尚未验证支持当前音乐模式。","此模型尚未驗證支援目前音樂模式。","この音楽モードへのモデルの対応は未検証です。","이 음악 모드에 대한 모델 지원이 검증되지 않았습니다.","No se ha verificado que el modelo admita este modo musical.","La prise en charge de ce mode musical n’est pas vérifiée.","Die Unterstützung dieses Musikmodus ist nicht verifiziert.","O suporte do modelo a este modo musical não foi verificado.","Поддержка этого музыкального режима не проверена.","لم يُتحقق من دعم النموذج لوضع الموسيقى هذا.","इस संगीत मोड के लिए मॉडल समर्थन सत्यापित नहीं है।"],
"plan_segment_fallback": ["Segment editing is unsupported; regenerate the affected shot using its first and last frames.","不支持片段编辑，将按首尾帧重新生成受影响镜头。","不支援片段編輯，將依首尾影格重新生成受影響鏡頭。","区間編集には未対応です。最初と最後のフレームで該当ショットを再生成します。","구간 편집을 지원하지 않아 첫 프레임과 마지막 프레임으로 해당 장면을 다시 생성합니다.","No se admite editar segmentos; se regenerará la toma con sus fotogramas inicial y final.","La modification de segments n’est pas prise en charge ; le plan sera régénéré avec ses première et dernière images.","Abschnittsbearbeitung wird nicht unterstützt; die Aufnahme wird mit Anfangs- und Endbild neu erzeugt.","A edição de trechos não é compatível; a cena será regenerada com o primeiro e o último quadro.","Редактирование фрагментов не поддерживается; кадр будет создан заново по первому и последнему изображениям.","تحرير المقاطع غير مدعوم؛ ستُعاد اللقطة باستخدام إطارَي البداية والنهاية.","खंड संपादन समर्थित नहीं है; पहले और अंतिम फ़्रेम से दृश्य दोबारा बनेगा।"],
"plan_frame_fallback": ["Frame editing is unsupported; regenerate the shot using the current frame as a reference.","不支持单帧编辑，将以当前帧为参考重新生成镜头。","不支援單格編輯，將以目前影格為參考重新生成鏡頭。","フレーム編集には未対応です。現在のフレームを参照してショットを再生成します。","프레임 편집을 지원하지 않아 현재 프레임을 참조하여 장면을 다시 생성합니다.","No se admite editar fotogramas; se regenerará la toma usando el actual como referencia.","La modification d’image n’est pas prise en charge ; le plan sera régénéré à partir de l’image actuelle.","Einzelbildbearbeitung wird nicht unterstützt; das aktuelle Bild dient als Referenz für die neue Aufnahme.","A edição de quadros não é compatível; a cena será regenerada usando o quadro atual como referência.","Редактирование отдельных кадров не поддерживается; кадр будет создан заново по текущему изображению.","تحرير الإطارات غير مدعوم؛ ستُعاد اللقطة باستخدام الإطار الحالي كمرجع.","फ़्रेम संपादन समर्थित नहीं है; वर्तमान फ़्रेम को संदर्भ बनाकर दृश्य दोबारा बनेगा।"],
"plan_image_required": ["Text-to-video is unsupported; generate a reference image before image-to-video.","不支持文生视频，请先生成参考图再执行图生视频。","不支援文字生影片，請先生成參考圖再執行圖片生影片。","テキストからの動画生成には未対応です。参照画像を生成してから動画に変換してください。","텍스트로 동영상을 생성할 수 없습니다. 참조 이미지를 먼저 생성하세요.","No se admite texto a vídeo; genera primero una imagen de referencia.","La génération vidéo à partir de texte n’est pas prise en charge ; créez d’abord une image de référence.","Text-zu-Video wird nicht unterstützt; erzeugen Sie zuerst ein Referenzbild.","Texto para vídeo não é compatível; gere primeiro uma imagem de referência.","Генерация видео из текста не поддерживается; сначала создайте опорное изображение.","تحويل النص إلى فيديو غير مدعوم؛ أنشئ صورة مرجعية أولًا.","टेक्स्ट से वीडियो समर्थित नहीं है; पहले संदर्भ छवि बनाएँ।"],
"plan_blocked": ["No verified model capability is available; no request will be sent.","没有已验证的模型能力，不会发送请求。","沒有已驗證的模型能力，不會傳送請求。","検証済みのモデル機能がないため、リクエストは送信しません。","검증된 모델 기능이 없어 요청을 보내지 않습니다.","No hay una capacidad verificada; no se enviará ninguna solicitud.","Aucune capacité vérifiée n’est disponible ; aucune requête ne sera envoyée.","Keine verifizierte Modellfunktion verfügbar; es wird keine Anfrage gesendet.","Não há capacidade verificada; nenhuma solicitação será enviada.","Нет проверенных возможностей модели; запрос не будет отправлен.","لا تتوفر قدرة نموذج مؤكدة؛ لن يُرسل أي طلب.","सत्यापित मॉडल क्षमता उपलब्ध नहीं है; कोई अनुरोध नहीं भेजा जाएगा।"],
"cost.free": ["No generation charge.","无需生成费用。","無需生成費用。","生成料金はかかりません。","생성 요금이 없습니다.","Sin cargo por generación.","Aucun frais de génération.","Keine Generierungskosten.","Sem cobrança de geração.","Без платы за генерацию.","دون رسوم توليد.","जनरेशन शुल्क नहीं।"],
"cost.provider_billed": ["Billed directly by the selected API provider.","由所选API供应商直接计费。","由所選API供應商直接計費。","選択したAPIプロバイダーから直接請求されます。","선택한 API 제공업체가 직접 청구합니다.","Facturado directamente por el proveedor de API seleccionado.","Facturation directe par le fournisseur d’API sélectionné.","Direkte Abrechnung durch den gewählten API-Anbieter.","Cobrado diretamente pelo provedor de API selecionado.","Оплата напрямую выбранному поставщику API.","تُحتسب الرسوم مباشرةً بواسطة مزوّد API المحدد.","चयनित API प्रदाता सीधे शुल्क लेता है।"],
"cost.platform_billed": ["Settled from your NextMux balance using the final hosted route usage.","按最终托管线路实际用量从NextMux余额结算。","依最終託管線路實際用量從NextMux餘額結算。","最終的なホストルートの使用量に基づきNextMux残高から精算されます。","최종 호스팅 경로의 실제 사용량에 따라 NextMux 잔액에서 정산합니다.","Se liquida con tu saldo de NextMux según el uso real de la ruta alojada.","Débité du solde NextMux selon l’utilisation réelle de la route hébergée.","Abrechnung vom NextMux-Guthaben anhand der tatsächlichen Nutzung der gehosteten Route.","Liquidado do saldo NextMux conforme o uso real da rota hospedada.","Списание с баланса NextMux по фактическому использованию размещённого маршрута.","تُسوى من رصيد NextMux وفق الاستخدام الفعلي للمسار المستضاف.","होस्ट किए गए अंतिम मार्ग के वास्तविक उपयोग के अनुसार NextMux बैलेंस से भुगतान।"],
  "invalid": [
    "Invalid {subject}{field}.",
    "{subject}无效{field}。",
    "{subject}無效{field}。",
    "{subject}が無効です{field}。",
    "{subject}이(가) 유효하지 않습니다{field}.",
    "{subject} no válido{field}.",
    "{subject} non valide{field}.",
    "{subject} ist ungültig{field}.",
    "{subject} inválido{field}.",
    "Некорректно: {subject}{field}.",
    "{subject} غير صالح{field}.",
    "{subject} अमान्य है{field}।"
  ],
  "unsupported": [
    "Unsupported {subject}{field}.",
    "不支持此{subject}{field}。",
    "不支援此{subject}{field}。",
    "{subject}はサポートされていません{field}。",
    "{subject}은(는) 지원되지 않습니다{field}.",
    "{subject} no compatible{field}.",
    "{subject} non pris en charge{field}.",
    "{subject} wird nicht unterstützt{field}.",
    "{subject} não compatível{field}.",
    "Не поддерживается: {subject}{field}.",
    "{subject} غير مدعوم{field}.",
    "{subject} समर्थित नहीं है{field}।"
  ],
  "limit": [
    "{subject} exceeds the supported limit{field}.",
    "{subject}超过支持的限制{field}。",
    "{subject}超過支援的限制{field}。",
    "{subject}が上限を超えています{field}。",
    "{subject}이(가) 지원 한도를 초과했습니다{field}.",
    "{subject} supera el límite permitido{field}.",
    "{subject} dépasse la limite autorisée{field}.",
    "{subject} überschreitet die Grenze{field}.",
    "{subject} excede o limite permitido{field}.",
    "Превышен лимит: {subject}{field}.",
    "{subject} يتجاوز الحد المسموح{field}.",
    "{subject} समर्थित सीमा से अधिक है{field}।"
  ],
  "empty_limit": [
    "{subject} is empty or exceeds the size limit{field}.",
    "{subject}为空或超过大小限制{field}。",
    "{subject}為空或超過大小限制{field}。",
    "{subject}が空か、サイズ上限を超えています{field}。",
    "{subject}이(가) 비어 있거나 크기 한도를 초과했습니다{field}.",
    "{subject} está vacío o supera el límite de tamaño{field}.",
    "{subject} est vide ou dépasse la taille limite{field}.",
    "{subject} ist leer oder zu groß{field}.",
    "{subject} está vazio ou excede o limite de tamanho{field}.",
    "Пустое значение или превышен размер: {subject}{field}.",
    "{subject} فارغ أو يتجاوز حد الحجم{field}.",
    "{subject} खाली है या आकार सीमा से अधिक है{field}।"
  ],
  "missing": [
    "{subject} was not found{field}.",
    "找不到{subject}{field}。",
    "找不到{subject}{field}。",
    "{subject}が見つかりません{field}。",
    "{subject}을(를) 찾을 수 없습니다{field}.",
    "No se encontró {subject}{field}.",
    "{subject} introuvable{field}.",
    "{subject} wurde nicht gefunden{field}.",
    "{subject} não encontrado{field}.",
    "Не найдено: {subject}{field}.",
    "لم يتم العثور على {subject}{field}.",
    "{subject} नहीं मिला{field}।"
  ],
  "required": [
    "{subject} is required{field}.",
    "需要{subject}{field}。",
    "需要{subject}{field}。",
    "{subject}が必要です{field}。",
    "{subject}이(가) 필요합니다{field}.",
    "Se requiere {subject}{field}.",
    "{subject} requis{field}.",
    "{subject} ist erforderlich{field}.",
    "{subject} é necessário{field}.",
    "Требуется: {subject}{field}.",
    "{subject} مطلوب{field}.",
    "{subject} आवश्यक है{field}।"
  ],
  "failed": [
    "{subject} failed{field}.",
    "{subject}失败{field}。",
    "{subject}失敗{field}。",
    "{subject}に失敗しました{field}。",
    "{subject}에 실패했습니다{field}.",
    "Falló {subject}{field}.",
    "Échec de {subject}{field}.",
    "{subject} ist fehlgeschlagen{field}.",
    "Falha em {subject}{field}.",
    "Сбой: {subject}{field}.",
    "فشل {subject}{field}.",
    "{subject} विफल हुआ{field}।"
  ],
  "unavailable": [
    "{subject} is unavailable{field}.",
    "{subject}不可用{field}。",
    "{subject}無法使用{field}。",
    "{subject}を利用できません{field}。",
    "{subject}을(를) 사용할 수 없습니다{field}.",
    "{subject} no está disponible{field}.",
    "{subject} indisponible{field}.",
    "{subject} ist nicht verfügbar{field}.",
    "{subject} indisponível{field}.",
    "Недоступно: {subject}{field}.",
    "{subject} غير متاح{field}.",
    "{subject} उपलब्ध नहीं है{field}।"
  ],
  "cancelled": [
    "{subject} was cancelled.",
    "{subject}已取消。",
    "{subject}已取消。",
    "{subject}をキャンセルしました。",
    "{subject}이(가) 취소되었습니다.",
    "Se canceló {subject}.",
    "{subject} annulé.",
    "{subject} wurde abgebrochen.",
    "{subject} cancelado.",
    "Отменено: {subject}.",
    "تم إلغاء {subject}.",
    "{subject} रद्द कर दिया गया।"
  ],
  "timeout": [
    "{subject} timed out{field}.",
    "{subject}超时{field}。",
    "{subject}逾時{field}。",
    "{subject}がタイムアウトしました{field}。",
    "{subject} 시간이 초과되었습니다{field}.",
    "Se agotó el tiempo de {subject}{field}.",
    "Délai dépassé pour {subject}{field}.",
    "Zeitüberschreitung: {subject}{field}.",
    "Tempo esgotado para {subject}{field}.",
    "Истекло время ожидания: {subject}{field}.",
    "انتهت مهلة {subject}{field}.",
    "{subject} का समय समाप्त हुआ{field}।"
  ],
  "rejected": [
    "{subject} was rejected{field}.",
    "{subject}被拒绝{field}。",
    "{subject}遭拒{field}。",
    "{subject}が拒否されました{field}。",
    "{subject}이(가) 거부되었습니다{field}.",
    "Se rechazó {subject}{field}.",
    "{subject} refusé{field}.",
    "{subject} wurde abgelehnt{field}.",
    "{subject} rejeitado{field}.",
    "Отклонено: {subject}{field}.",
    "تم رفض {subject}{field}.",
    "{subject} अस्वीकार किया गया{field}।"
  ],
  "conflict": [
    "{subject} conflicts with the current state{field}.",
    "{subject}与当前状态冲突{field}。",
    "{subject}與目前狀態衝突{field}。",
    "{subject}が現在の状態と競合しています{field}。",
    "{subject}이(가) 현재 상태와 충돌합니다{field}.",
    "{subject} entra en conflicto con el estado actual{field}.",
    "{subject} est incompatible avec l’état actuel{field}.",
    "{subject} steht im Konflikt mit dem aktuellen Zustand{field}.",
    "{subject} está em conflito com o estado atual{field}.",
    "Конфликт с текущим состоянием: {subject}{field}.",
    "{subject} يتعارض مع الحالة الحالية{field}.",
    "{subject} वर्तमान स्थिति से मेल नहीं खाता{field}।"
  ],
  "serialize": [
    "{subject} cannot be serialized.",
    "无法序列化{subject}。",
    "無法序列化{subject}。",
    "{subject}をシリアライズできません。",
    "{subject}을(를) 직렬화할 수 없습니다.",
    "No se puede serializar {subject}.",
    "Impossible de sérialiser {subject}.",
    "{subject} kann nicht serialisiert werden.",
    "Não é possível serializar {subject}.",
    "Невозможно сериализовать: {subject}.",
    "تعذر تسلسل {subject}.",
    "{subject} को क्रमबद्ध नहीं किया जा सकता।"
  ],
  "integer": [
    "{fieldName} must be an integer from {minimum} to {maximum}.",
    "{fieldName}必须是{minimum}到{maximum}的整数。",
    "{fieldName}必須是{minimum}到{maximum}的整數。",
    "{fieldName}は{minimum}から{maximum}の整数にしてください。",
    "{fieldName}은(는) {minimum}부터 {maximum} 사이의 정수여야 합니다.",
    "{fieldName} debe ser un entero entre {minimum} y {maximum}.",
    "{fieldName} doit être un entier entre {minimum} et {maximum}.",
    "{fieldName} muss eine ganze Zahl zwischen {minimum} und {maximum} sein.",
    "{fieldName} deve ser um inteiro entre {minimum} e {maximum}.",
    "{fieldName}: требуется целое число от {minimum} до {maximum}.",
    "يجب أن يكون {fieldName} عددًا صحيحًا بين {minimum} و{maximum}.",
    "{fieldName} को {minimum} से {maximum} के बीच पूर्णांक होना चाहिए।"
  ],
  "range": [
    "{fieldName} must be between {minimum} and {maximum}{unit}.",
    "{fieldName}必须在{minimum}到{maximum}{unit}之间。",
    "{fieldName}必須在{minimum}到{maximum}{unit}之間。",
    "{fieldName}は{minimum}〜{maximum}{unit}にしてください。",
    "{fieldName}은(는) {minimum}~{maximum}{unit} 사이여야 합니다.",
    "{fieldName} debe estar entre {minimum} y {maximum}{unit}.",
    "{fieldName} doit être compris entre {minimum} et {maximum}{unit}.",
    "{fieldName} muss zwischen {minimum} und {maximum}{unit} liegen.",
    "{fieldName} deve estar entre {minimum} e {maximum}{unit}.",
    "{fieldName}: допустимо от {minimum} до {maximum}{unit}.",
    "يجب أن يكون {fieldName} بين {minimum} و{maximum}{unit}.",
    "{fieldName} को {minimum} और {maximum}{unit} के बीच होना चाहिए।"
  ],
  "minimum": [
    "{subject} must be at least {minimum}{unit}.",
    "{subject}至少需要{minimum}{unit}。",
    "{subject}至少需要{minimum}{unit}。",
    "{subject}は{minimum}{unit}以上が必要です。",
    "{subject}은(는) 최소 {minimum}{unit}여야 합니다.",
    "{subject} debe ser de al menos {minimum}{unit}.",
    "{subject} doit être d’au moins {minimum}{unit}.",
    "{subject} muss mindestens {minimum}{unit} betragen.",
    "{subject} deve ter pelo menos {minimum}{unit}.",
    "Минимум для {subject}: {minimum}{unit}.",
    "يجب ألا يقل {subject} عن {minimum}{unit}.",
    "{subject} कम से कम {minimum}{unit} होना चाहिए।"
  ],
  "format": [
    "{subject} requires {format}{field}.",
    "{subject}需要{format}{field}。",
    "{subject}需要{format}{field}。",
    "{subject}には{format}が必要です{field}。",
    "{subject}에는 {format}이(가) 필요합니다{field}.",
    "{subject} requiere {format}{field}.",
    "{subject} nécessite {format}{field}.",
    "{subject} erfordert {format}{field}.",
    "{subject} requer {format}{field}.",
    "Для {subject} требуется {format}{field}.",
    "يتطلب {subject} الصيغة {format}{field}.",
    "{subject} के लिए {format} आवश्यक है{field}।"
  ],
  "relative": [
    "{fieldName} must be a relative path inside nextmux.media.",
    "{fieldName}必须是nextmux.media内的相对路径。",
    "{fieldName}必須是nextmux.media內的相對路徑。",
    "{fieldName}はnextmux.media内の相対パスにしてください。",
    "{fieldName}은(는) nextmux.media 내의 상대 경로여야 합니다.",
    "{fieldName} debe ser una ruta relativa dentro de nextmux.media.",
    "{fieldName} doit être un chemin relatif dans nextmux.media.",
    "{fieldName} muss ein relativer Pfad innerhalb von nextmux.media sein.",
    "{fieldName} deve ser um caminho relativo dentro de nextmux.media.",
    "{fieldName}: требуется относительный путь внутри nextmux.media.",
    "يجب أن يكون {fieldName} مسارًا نسبيًا داخل nextmux.media.",
    "{fieldName} को nextmux.media के भीतर सापेक्ष पथ होना चाहिए।"
  ],
  "read_only": [
    "Imported history is read-only; this action is unavailable.",
    "导入的历史记录为只读，无法执行此操作。",
    "匯入的歷程記錄為唯讀，無法執行此操作。",
    "インポートした履歴は読み取り専用のため、この操作はできません。",
    "가져온 기록은 읽기 전용이므로 이 작업을 사용할 수 없습니다.",
    "El historial importado es de solo lectura; esta acción no está disponible.",
    "L’historique importé est en lecture seule ; cette action est indisponible.",
    "Importierter Verlauf ist schreibgeschützt; diese Aktion ist nicht verfügbar.",
    "O histórico importado é somente leitura; esta ação não está disponível.",
    "Импортированная история доступна только для чтения; действие недоступно.",
    "السجل المستورد للقراءة فقط؛ هذا الإجراء غير متاح.",
    "आयातित इतिहास केवल पढ़ने के लिए है; यह कार्रवाई उपलब्ध नहीं है।"
  ],
  "new_job": [
    "Correct the input and create a new media job.",
    "请修正输入并创建新的媒体任务。",
    "請修正輸入並建立新的媒體工作。",
    "入力を修正して新しいメディアタスクを作成してください。",
    "입력을 수정하고 새 미디어 작업을 만드세요.",
    "Corrige los datos y crea una nueva tarea multimedia.",
    "Corrigez les données et créez une nouvelle tâche multimédia.",
    "Korrigieren Sie die Eingabe und erstellen Sie einen neuen Medienauftrag.",
    "Corrija os dados e crie uma nova tarefa de mídia.",
    "Исправьте данные и создайте новую медиазадачу.",
    "صحح المدخلات وأنشئ مهمة وسائط جديدة.",
    "इनपुट सुधारें और नया मीडिया कार्य बनाएँ।"
  ],
  "wait_stop": [
    "Wait for the current media job to stop before trying this action.",
    "请等待当前媒体任务停止后再执行此操作。",
    "請等待目前媒體工作停止後再執行此操作。",
    "現在のメディアタスクが停止してから実行してください。",
    "현재 미디어 작업이 중지된 후 다시 시도하세요.",
    "Espera a que se detenga la tarea multimedia actual.",
    "Attendez l’arrêt de la tâche multimédia actuelle.",
    "Warten Sie, bis der aktuelle Medienauftrag beendet ist.",
    "Aguarde a interrupção da tarefa de mídia atual.",
    "Дождитесь остановки текущей медиазадачи.",
    "انتظر توقف مهمة الوسائط الحالية قبل المحاولة.",
    "यह कार्रवाई करने से पहले वर्तमान मीडिया कार्य रुकने की प्रतीक्षा करें।"
  ],
  "cost": [
    "Confirm the cost before starting transcription.",
    "开始字幕识别前请确认费用。",
    "開始字幕辨識前請確認費用。",
    "文字起こしを開始する前に料金を確認してください。",
    "전사를 시작하기 전에 비용을 확인하세요.",
    "Confirma el costo antes de iniciar la transcripción.",
    "Confirmez le coût avant de lancer la transcription.",
    "Bestätigen Sie vor der Transkription die Kosten.",
    "Confirme o custo antes de iniciar a transcrição.",
    "Подтвердите стоимость перед транскрипцией.",
    "أكد التكلفة قبل بدء التفريغ النصي.",
    "प्रतिलेखन शुरू करने से पहले लागत की पुष्टि करें।"
  ],
  "consent": [
    "Confirm that this is your voice or that you have permission to use it.",
    "请确认这是你的声音，或你已获授权使用此声音。",
    "請確認這是你的聲音，或你已獲授權使用此聲音。",
    "ご自身の声、または使用許可を得た声であることを確認してください。",
    "본인의 음성이거나 사용 허가를 받은 음성인지 확인하세요.",
    "Confirma que es tu voz o que tienes permiso para usarla.",
    "Confirmez qu’il s’agit de votre voix ou que vous avez l’autorisation de l’utiliser.",
    "Bestätigen Sie, dass es Ihre Stimme ist oder Sie sie verwenden dürfen.",
    "Confirme que a voz é sua ou que você tem permissão para usá-la.",
    "Подтвердите, что это ваш голос или у вас есть разрешение на его использование.",
    "أكد أن هذا صوتك أو أنك تملك إذنًا باستخدامه.",
    "पुष्टि करें कि यह आपकी आवाज़ है या आपको इसका उपयोग करने की अनुमति है।"
  ],
  "recovery_provider": [
    "The app exited before confirming the media result. Review the original request to avoid duplicate charges; it will not be generated again.",
    "应用在媒体结果确认前退出。请核对原请求以避免重复扣费；不会重新生成。",
    "應用程式在媒體結果確認前結束。請核對原請求以避免重複扣費；不會重新生成。",
    "メディア結果の確認前にアプリが終了しました。二重課金を防ぐため元のリクエストを確認してください。再生成は行いません。",
    "미디어 결과를 확인하기 전에 앱이 종료되었습니다. 중복 결제를 피하려면 원래 요청을 확인하세요. 다시 생성하지 않습니다.",
    "La aplicación se cerró antes de confirmar el resultado. Revisa la solicitud original para evitar cargos duplicados; no se volverá a generar.",
    "L’application s’est fermée avant confirmation du résultat. Vérifiez la requête initiale pour éviter une double facturation ; aucune nouvelle génération ne sera lancée.",
    "Die App wurde vor der Ergebnisbestätigung beendet. Prüfen Sie die ursprüngliche Anfrage, um doppelte Kosten zu vermeiden; es wird nicht erneut generiert.",
    "O aplicativo fechou antes de confirmar o resultado. Confira a solicitação original para evitar cobrança duplicada; não haverá nova geração.",
    "Приложение закрылось до подтверждения результата. Проверьте исходный запрос, чтобы избежать повторного списания; повторная генерация не запустится.",
    "أُغلق التطبيق قبل تأكيد النتيجة. راجع الطلب الأصلي لتجنب الرسوم المكررة؛ لن يُعاد التوليد.",
    "मीडिया परिणाम की पुष्टि से पहले ऐप बंद हो गया। दोहरे शुल्क से बचने के लिए मूल अनुरोध जाँचें; दोबारा जनरेट नहीं होगा।"
  ],
  "recovery_local": [
    "The app exited before the local media job completed. You can resume it manually.",
    "应用在本地媒体任务完成前退出，可手动恢复。",
    "應用程式在本機媒體工作完成前結束，可手動恢復。",
    "ローカルメディアタスクの完了前にアプリが終了しました。手動で再開できます。",
    "로컬 미디어 작업 완료 전에 앱이 종료되었습니다. 수동으로 재개할 수 있습니다.",
    "La aplicación se cerró antes de completar la tarea local. Puedes reanudarla manualmente.",
    "L’application s’est fermée avant la fin de la tâche locale. Vous pouvez la reprendre manuellement.",
    "Die App wurde vor Abschluss des lokalen Medienauftrags beendet. Sie können ihn manuell fortsetzen.",
    "O aplicativo fechou antes de concluir a tarefa local. Você pode retomá-la manualmente.",
    "Приложение закрылось до завершения локальной задачи. Её можно возобновить вручную.",
    "أُغلق التطبيق قبل اكتمال المهمة المحلية. يمكنك استئنافها يدويًا.",
    "स्थानीय मीडिया कार्य पूरा होने से पहले ऐप बंद हो गया। आप इसे मैन्युअल रूप से फिर शुरू कर सकते हैं।"
  ],
  "archive_failure": [
    "Failure details were omitted from the archive.",
    "归档中未保留失败详情。",
    "封存檔未保留失敗詳細資料。",
    "アーカイブにはエラーの詳細が含まれていません。",
    "보관 파일에는 실패 세부 정보가 포함되지 않았습니다.",
    "Los detalles del error se omitieron del archivo.",
    "Les détails de l’échec ont été omis de l’archive.",
    "Fehlerdetails wurden im Archiv ausgelassen.",
    "Os detalhes da falha foram omitidos do arquivo.",
    "Подробности сбоя не включены в архив.",
    "لم تُضمَّن تفاصيل الفشل في الأرشيف.",
    "संग्रह में विफलता का विवरण शामिल नहीं किया गया।"
  ]
};
interface MediaMessageDefinition { readonly key: string; readonly en: string; readonly template: string; readonly subject: string; readonly field?: string; readonly defaults?: MediaDomainErrorParams; }
const definitions: readonly MediaMessageDefinition[] = [
{"key":"media.plan_local","en":"Handled by the local subtitle or timeline renderer.","template":"plan_local","subject":"job"},
{"key":"media.plan_verified","en":"The required model capability is verified.","template":"plan_verified","subject":"job"},
{"key":"media.plan_music_unsupported","en":"The model has no verified support for this music mode.","template":"plan_music_unsupported","subject":"job"},
{"key":"media.plan_segment_fallback","en":"Segment editing is unsupported; regenerate the affected shot using its first and last frames.","template":"plan_segment_fallback","subject":"job"},
{"key":"media.plan_frame_fallback","en":"Frame editing is unsupported; regenerate the shot using the current frame as a reference.","template":"plan_frame_fallback","subject":"job"},
{"key":"media.plan_image_required","en":"Text-to-video is unsupported; generate a reference image before image-to-video.","template":"plan_image_required","subject":"job"},
{"key":"media.plan_blocked","en":"No verified model capability is available; no request will be sent.","template":"plan_blocked","subject":"job"},
{"key":"media.cost.free","en":"No generation charge.","template":"cost.free","subject":"job"},
{"key":"media.cost.provider_billed","en":"Billed directly by the selected API provider.","template":"cost.provider_billed","subject":"job"},
{"key":"media.cost.platform_billed","en":"Settled from your NextMux balance using the final hosted route usage.","template":"cost.platform_billed","subject":"job"},
  {
    "key": "media.invalid_field",
    "en": "Invalid {label}",
    "template": "invalid",
    "subject": "field",
    "field": "{label}"
  },
  {
    "key": "media.media_response_exceeds_the_size_limit",
    "en": "Media response exceeds the size limit",
    "template": "limit",
    "subject": "response",
    "field": "byteLength"
  },
  {
    "key": "media.api_key_or_media_model_access_was_denied",
    "en": "API key or media model access was denied",
    "template": "rejected",
    "subject": "provider",
    "field": "apiKey / model.permissions"
  },
  {
    "key": "media.media_api_endpoint_or_model_id_was_not_found",
    "en": "Media API endpoint or model ID was not found",
    "template": "missing",
    "subject": "provider",
    "field": "endpoint / model"
  },
  {
    "key": "media.media_service_request_timed_out",
    "en": "Media service request timed out",
    "template": "timeout",
    "subject": "provider",
    "field": "request"
  },
  {
    "key": "media.media_service_rejected_a_duplicate_request",
    "en": "Media service rejected a duplicate request",
    "template": "conflict",
    "subject": "request",
    "field": "idempotencyKey"
  },
  {
    "key": "media.media_service_is_rate_limited_or_the_account_balance_is_insufficient",
    "en": "Media service is rate limited or the account balance is insufficient",
    "template": "unavailable",
    "subject": "provider",
    "field": "rate_limit / balance"
  },
  {
    "key": "media.media_service_is_temporarily_unavailable",
    "en": "Media service is temporarily unavailable",
    "template": "unavailable",
    "subject": "provider"
  },
  {
    "key": "media.media_service_rejected_the_request_check_the_model_dimensions_and_account_permissions",
    "en": "Media service rejected the request; check the model, dimensions and account permissions",
    "template": "rejected",
    "subject": "request",
    "field": "model / dimensions / permissions"
  },
  {
    "key": "media.media_request_cannot_be_serialized",
    "en": "Media request cannot be serialized",
    "template": "serialize",
    "subject": "request"
  },
  {
    "key": "media.media_request_exceeds_the_size_limit",
    "en": "Media request exceeds the size limit",
    "template": "limit",
    "subject": "request",
    "field": "byteLength"
  },
  {
    "key": "media.media_job_was_cancelled",
    "en": "Media job was cancelled",
    "template": "cancelled",
    "subject": "job"
  },
  {
    "key": "media.media_service_connection_timed_out",
    "en": "Media service connection timed out",
    "template": "timeout",
    "subject": "provider",
    "field": "connection"
  },
  {
    "key": "media.cannot_connect_to_the_media_service",
    "en": "Cannot connect to the media service",
    "template": "unavailable",
    "subject": "provider",
    "field": "connection"
  },
  {
    "key": "media.image_service_did_not_return_valid_base64_data",
    "en": "Image service did not return valid base64 data",
    "template": "invalid",
    "subject": "image",
    "field": "response.base64"
  },
  {
    "key": "media.image_data_is_empty_or_exceeds_the_size_limit",
    "en": "Image data is empty or exceeds the size limit",
    "template": "empty_limit",
    "subject": "image",
    "field": "byteLength"
  },
  {
    "key": "media.image_service_returned_an_unsupported_file_format",
    "en": "Image service returned an unsupported file format",
    "template": "unsupported",
    "subject": "image",
    "field": "format"
  },
  {
    "key": "media.speech_service_returned_an_unsupported_file_format",
    "en": "Speech service returned an unsupported file format",
    "template": "unsupported",
    "subject": "speech",
    "field": "format"
  },
  {
    "key": "media.image_prompt_is_invalid",
    "en": "Image prompt is invalid",
    "template": "invalid",
    "subject": "image",
    "field": "prompt"
  },
  {
    "key": "media.image_service_returned_invalid_data",
    "en": "Image service returned invalid data",
    "template": "invalid",
    "subject": "image",
    "field": "response"
  },
  {
    "key": "media.image_service_rejected_the_request",
    "en": "Image service rejected the request",
    "template": "rejected",
    "subject": "image"
  },
  {
    "key": "media.image_service_returned_an_external_url_enable_base64_output_to_avoid_downloading_from_an_unexpected_address",
    "en": "Image service returned an external URL; enable base64 output to avoid downloading from an unexpected address",
    "template": "format",
    "subject": "image",
    "field": "response",
    "defaults": {
      "format": "base64"
    }
  },
  {
    "key": "media.speech_text_is_invalid",
    "en": "Speech text is invalid",
    "template": "invalid",
    "subject": "speech",
    "field": "text"
  },
  {
    "key": "media.native_music_adapters_require_mp3_output",
    "en": "Native music adapters require MP3 output",
    "template": "format",
    "subject": "music",
    "field": "output",
    "defaults": {
      "format": "MP3"
    }
  },
  {
    "key": "media.audio_duration_is_invalid",
    "en": "Audio duration is invalid",
    "template": "invalid",
    "subject": "audio",
    "field": "durationSeconds"
  },
  {
    "key": "media.music_service_did_not_return_valid_audio_data",
    "en": "Music service did not return valid audio data",
    "template": "invalid",
    "subject": "music",
    "field": "response.audio"
  },
  {
    "key": "media.music_prompt_or_lyrics_are_invalid",
    "en": "Music prompt or lyrics are invalid",
    "template": "invalid",
    "subject": "music",
    "field": "prompt / lyrics"
  },
  {
    "key": "media.music_service_returned_invalid_data",
    "en": "Music service returned invalid data",
    "template": "invalid",
    "subject": "music",
    "field": "response"
  },
  {
    "key": "media.music_service_rejected_the_request",
    "en": "Music service rejected the request",
    "template": "rejected",
    "subject": "music"
  },
  {
    "key": "media.music_service_returned_no_audio",
    "en": "Music service returned no audio",
    "template": "missing",
    "subject": "music",
    "field": "response.audio"
  },
  {
    "key": "media.music_response_was_incomplete_review_the_original_request_before_generating_again",
    "en": "Music response was incomplete; review the original request before generating again",
    "template": "recovery_provider",
    "subject": "music"
  },
  {
    "key": "media.selected_music_model_does_not_match_the_native_protocol",
    "en": "Selected music model does not match the native protocol",
    "template": "conflict",
    "subject": "music",
    "field": "model / protocol"
  },
  {
    "key": "media.fixed_lyrics_cannot_be_combined_with_instrumental_mode",
    "en": "Fixed lyrics cannot be combined with instrumental mode",
    "template": "conflict",
    "subject": "music",
    "field": "lyrics / instrumental"
  },
  {
    "key": "media.lyrics_support_at_most_30_sections_lasting_3_to_120_seconds_each",
    "en": "Lyrics support at most 30 sections lasting 3 to 120 seconds each",
    "template": "limit",
    "subject": "music",
    "field": "lyrics.sections ≤ 30; 3–120 s"
  },
  {
    "key": "media.lyric_section_names_line_counts_or_individual_lines_exceed_the_provider_limit",
    "en": "Lyric section names, line counts or individual lines exceed the provider limit",
    "template": "limit",
    "subject": "music",
    "field": "lyrics.sections.name / lines"
  },
  {
    "key": "media.selected_sound_effect_model_does_not_match_the_native_protocol",
    "en": "Selected sound effect model does not match the native protocol",
    "template": "conflict",
    "subject": "sound_effect",
    "field": "model / protocol"
  },
  {
    "key": "media.sound_effect_description_is_invalid",
    "en": "Sound effect description is invalid",
    "template": "invalid",
    "subject": "sound_effect",
    "field": "text"
  },
  {
    "key": "media.selected_music_model_does_not_support_native_generation",
    "en": "Selected music model does not support native generation",
    "template": "unsupported",
    "subject": "music",
    "field": "model / native_generation"
  },
  {
    "key": "media.comfyui_workflow_cannot_be_serialized",
    "en": "ComfyUI workflow cannot be serialized",
    "template": "serialize",
    "subject": "workflow"
  },
  {
    "key": "media.comfyui_workflow_is_empty_or_exceeds_the_size_limit",
    "en": "ComfyUI workflow is empty or exceeds the size limit",
    "template": "empty_limit",
    "subject": "workflow"
  },
  {
    "key": "media.comfyui_workflow_must_be_an_api_node_object",
    "en": "ComfyUI workflow must be an API node object",
    "template": "format",
    "subject": "workflow",
    "field": "nodes",
    "defaults": {
      "format": "API / JSON object"
    }
  },
  {
    "key": "media.comfyui_workflow_node_count_is_invalid",
    "en": "ComfyUI workflow node count is invalid",
    "template": "invalid",
    "subject": "workflow",
    "field": "nodes.length"
  },
  {
    "key": "media.comfyui_workflow_contains_an_invalid_node_id",
    "en": "ComfyUI workflow contains an invalid node ID",
    "template": "invalid",
    "subject": "workflow",
    "field": "nodes.id"
  },
  {
    "key": "media.comfyui_node_field_is_invalid",
    "en": "ComfyUI node {nodeId} is invalid",
    "template": "invalid",
    "subject": "node",
    "field": "{nodeId}"
  },
  {
    "key": "media.comfyui_workflow_template_version_is_not_supported",
    "en": "ComfyUI workflow template version is not supported",
    "template": "unsupported",
    "subject": "workflow",
    "field": "schemaVersion"
  },
  {
    "key": "media.comfyui_output_node_was_not_found",
    "en": "ComfyUI output node was not found",
    "template": "missing",
    "subject": "node",
    "field": "output"
  },
  {
    "key": "media.comfyui_image_prompt_is_invalid",
    "en": "ComfyUI image prompt is invalid",
    "template": "invalid",
    "subject": "workflow",
    "field": "prompt"
  },
  {
    "key": "media.comfyui_negative_prompt_exceeds_the_size_limit",
    "en": "ComfyUI negative prompt exceeds the size limit",
    "template": "limit",
    "subject": "workflow",
    "field": "negativePrompt"
  },
  {
    "key": "media.comfyui_canvas_dimensions_are_invalid",
    "en": "ComfyUI canvas dimensions are invalid",
    "template": "invalid",
    "subject": "workflow",
    "field": "width / height"
  },
  {
    "key": "media.comfyui_random_seed_is_invalid",
    "en": "ComfyUI random seed is invalid",
    "template": "invalid",
    "subject": "workflow",
    "field": "seed"
  },
  {
    "key": "media.comfyui_workflow_has_no_recognized_image_output_node",
    "en": "ComfyUI workflow has no recognized image output node",
    "template": "missing",
    "subject": "workflow",
    "field": "image.outputNode"
  },
  {
    "key": "media.comfyui_endpoint_is_invalid",
    "en": "ComfyUI endpoint is invalid",
    "template": "invalid",
    "subject": "ComfyUI",
    "field": "endpoint"
  },
  {
    "key": "media.comfyui_endpoint_requires_http_s_without_credentials_or_query_parameters",
    "en": "ComfyUI endpoint requires HTTP(S) without credentials or query parameters",
    "template": "invalid",
    "subject": "ComfyUI",
    "field": "endpoint: HTTP(S); credentials / query"
  },
  {
    "key": "media.comfyui_response_exceeds_the_size_limit",
    "en": "ComfyUI response exceeds the size limit",
    "template": "limit",
    "subject": "ComfyUI",
    "field": "response.byteLength"
  },
  {
    "key": "media.comfyui_access_was_denied",
    "en": "ComfyUI access was denied",
    "template": "rejected",
    "subject": "ComfyUI",
    "field": "access"
  },
  {
    "key": "media.comfyui_api_endpoint_was_not_found_or_its_version_is_incompatible",
    "en": "ComfyUI API endpoint was not found or its version is incompatible",
    "template": "missing",
    "subject": "ComfyUI",
    "field": "endpoint / version"
  },
  {
    "key": "media.comfyui_request_timed_out",
    "en": "ComfyUI request timed out",
    "template": "timeout",
    "subject": "ComfyUI",
    "field": "request"
  },
  {
    "key": "media.comfyui_queue_is_temporarily_busy",
    "en": "ComfyUI queue is temporarily busy",
    "template": "unavailable",
    "subject": "ComfyUI",
    "field": "queue"
  },
  {
    "key": "media.comfyui_is_temporarily_unavailable",
    "en": "ComfyUI is temporarily unavailable",
    "template": "unavailable",
    "subject": "ComfyUI"
  },
  {
    "key": "media.comfyui_rejected_the_request",
    "en": "ComfyUI rejected the request",
    "template": "rejected",
    "subject": "ComfyUI",
    "field": "request"
  },
  {
    "key": "media.comfyui_job_was_cancelled",
    "en": "ComfyUI job was cancelled",
    "template": "cancelled",
    "subject": "ComfyUI"
  },
  {
    "key": "media.comfyui_connection_timed_out",
    "en": "ComfyUI connection timed out",
    "template": "timeout",
    "subject": "ComfyUI",
    "field": "connection"
  },
  {
    "key": "media.cannot_connect_to_comfyui",
    "en": "Cannot connect to ComfyUI",
    "template": "unavailable",
    "subject": "ComfyUI",
    "field": "connection"
  },
  {
    "key": "media.comfyui_returned_invalid_data",
    "en": "ComfyUI returned invalid data",
    "template": "invalid",
    "subject": "ComfyUI",
    "field": "response"
  },
  {
    "key": "media.comfyui_capability_information_is_invalid",
    "en": "ComfyUI capability information is invalid",
    "template": "invalid",
    "subject": "ComfyUI",
    "field": "capabilities"
  },
  {
    "key": "media.comfyui_task_id_is_invalid",
    "en": "ComfyUI task ID is invalid",
    "template": "invalid",
    "subject": "ComfyUI",
    "field": "taskId"
  },
  {
    "key": "media.comfyui_workflow_exceeds_the_request_size_limit",
    "en": "ComfyUI workflow exceeds the request size limit",
    "template": "limit",
    "subject": "workflow",
    "field": "request.byteLength"
  },
  {
    "key": "media.comfyui_workflow_validation_failed",
    "en": "ComfyUI workflow validation failed",
    "template": "invalid",
    "subject": "workflow"
  },
  {
    "key": "media.comfyui_workflow_execution_failed",
    "en": "ComfyUI workflow execution failed",
    "template": "failed",
    "subject": "workflow",
    "field": "execution"
  },
  {
    "key": "media.comfyui_node_execution_failed",
    "en": "ComfyUI node execution failed",
    "template": "failed",
    "subject": "node",
    "field": "execution"
  },
  {
    "key": "media.comfyui_workflow_execution_timed_out",
    "en": "ComfyUI workflow execution timed out",
    "template": "timeout",
    "subject": "workflow",
    "field": "execution"
  },
  {
    "key": "media.comfyui_workflow_completed_without_image_output",
    "en": "ComfyUI workflow completed without image output",
    "template": "missing",
    "subject": "workflow",
    "field": "output.image"
  },
  {
    "key": "media.transcription_was_cancelled",
    "en": "Transcription was cancelled",
    "template": "cancelled",
    "subject": "transcription"
  },
  {
    "key": "media.audio_extraction_or_local_transcription_failed",
    "en": "Audio extraction or local transcription failed",
    "template": "failed",
    "subject": "transcription",
    "field": "audio.extraction / local"
  },
  {
    "key": "media.no_timed_subtitles_are_available",
    "en": "No timed subtitles are available",
    "template": "missing",
    "subject": "subtitle",
    "field": "cues"
  },
  {
    "key": "media.transcription_has_no_valid_timestamps_estimated_subtitles_were_not_created",
    "en": "Transcription has no valid timestamps; estimated subtitles were not created",
    "template": "missing",
    "subject": "transcription",
    "field": "timestamps"
  },
  {
    "key": "media.subtitle_timestamps_exceed_the_supported_range",
    "en": "Subtitle timestamps exceed the supported range",
    "template": "limit",
    "subject": "subtitle",
    "field": "timestamps"
  },
  {
    "key": "media.confirm_the_cost_before_cloud_transcription",
    "en": "Confirm the cost before cloud transcription",
    "template": "cost",
    "subject": "transcription"
  },
  {
    "key": "media.transcription_requires_a_local_media_file_and_valid_duration",
    "en": "Transcription requires a local media file and valid duration",
    "template": "required",
    "subject": "transcription",
    "field": "sourcePath / durationMs"
  },
  {
    "key": "media.transcription_source_start_time_is_invalid",
    "en": "Transcription source start time is invalid",
    "template": "invalid",
    "subject": "transcription",
    "field": "sourceStartMs"
  },
  {
    "key": "media.transcription_source_file_is_unavailable",
    "en": "Transcription source file is unavailable",
    "template": "unavailable",
    "subject": "transcription",
    "field": "sourcePath"
  },
  {
    "key": "media.audio_track_size_limit_is_invalid",
    "en": "Audio track size limit is invalid",
    "template": "invalid",
    "subject": "audio",
    "field": "maxBytes"
  },
  {
    "key": "media.audio_track_is_empty_or_exceeds_the_transcription_size_limit",
    "en": "Audio track is empty or exceeds the transcription size limit",
    "template": "empty_limit",
    "subject": "audio",
    "field": "byteLength"
  },
  {
    "key": "media.local_transcription_returned_no_timed_subtitles",
    "en": "Local transcription returned no timed subtitles",
    "template": "missing",
    "subject": "transcription",
    "field": "cues"
  },
  {
    "key": "media.local_transcription_returned_an_invalid_subtitle_segment",
    "en": "Local transcription returned an invalid subtitle segment",
    "template": "invalid",
    "subject": "subtitle",
    "field": "segment"
  },
  {
    "key": "media.local_transcription_returned_no_timestamps",
    "en": "Local transcription returned no timestamps",
    "template": "missing",
    "subject": "transcription",
    "field": "timestamps"
  },
  {
    "key": "media.local_transcription_components_are_not_configured",
    "en": "Local transcription components are not configured",
    "template": "required",
    "subject": "transcription",
    "field": "executablePath / modelPath"
  },
  {
    "key": "media.local_transcription_components_or_language_model_are_unavailable",
    "en": "Local transcription components or language model are unavailable",
    "template": "unavailable",
    "subject": "transcription",
    "field": "executablePath / modelPath"
  },
  {
    "key": "media.transcription_language_is_invalid",
    "en": "Transcription language is invalid",
    "template": "invalid",
    "subject": "transcription",
    "field": "language"
  },
  {
    "key": "media.transcription_result_exceeds_the_size_limit",
    "en": "Transcription result exceeds the size limit",
    "template": "limit",
    "subject": "transcription",
    "field": "response.byteLength"
  },
  {
    "key": "media.local_transcription_returned_an_invalid_result",
    "en": "Local transcription returned an invalid result",
    "template": "invalid",
    "subject": "transcription",
    "field": "response"
  },
  {
    "key": "media.local_transcription_failed",
    "en": "Local transcription failed",
    "template": "failed",
    "subject": "transcription"
  },
  {
    "key": "media.selected_music_model_does_not_match_the_adapter",
    "en": "Selected music model does not match the adapter",
    "template": "conflict",
    "subject": "music",
    "field": "model / adapter"
  },
  {
    "key": "media.selected_sound_effect_model_does_not_match_the_adapter",
    "en": "Selected sound effect model does not match the adapter",
    "template": "conflict",
    "subject": "sound_effect",
    "field": "model / adapter"
  },
  {
    "key": "media.field_must_be_an_iso_timestamp",
    "en": "{label} must be an ISO timestamp",
    "template": "format",
    "subject": "field",
    "field": "{label}",
    "defaults": {
      "format": "ISO 8601"
    }
  },
  {
    "key": "media.field_must_be_text",
    "en": "{label} must be text",
    "template": "format",
    "subject": "field",
    "field": "{label}",
    "defaults": {
      "format": "string"
    }
  },
  {
    "key": "media.field_has_an_invalid_length",
    "en": "{label} has an invalid length",
    "template": "range",
    "subject": "field",
    "field": "{label}.length"
  },
  {
    "key": "media.field_must_be_an_integer_from_field_to_field",
    "en": "{label} must be an integer from {minimum} to {maximum}",
    "template": "integer",
    "subject": "field",
    "field": "{label}"
  },
  {
    "key": "media.media_job_identifier_is_invalid",
    "en": "Media job identifier is invalid",
    "template": "invalid",
    "subject": "job",
    "field": "id"
  },
  {
    "key": "media.media_worker_identifier_is_invalid",
    "en": "Media worker identifier is invalid",
    "template": "invalid",
    "subject": "worker",
    "field": "id"
  },
  {
    "key": "media.media_idempotency_key_is_invalid",
    "en": "Media idempotency key is invalid",
    "template": "invalid",
    "subject": "job",
    "field": "idempotencyKey"
  },
  {
    "key": "media.media_connection_identifier_is_invalid",
    "en": "Media connection identifier is invalid",
    "template": "invalid",
    "subject": "job",
    "field": "connectionId"
  },
  {
    "key": "media.invalid_managed_media_price_authorization",
    "en": "Invalid managed media price authorization",
    "template": "invalid",
    "subject": "request",
    "field": "keyPriceQuoteId"
  },
  {
    "key": "media.field_is_invalid",
    "en": "{label} is invalid",
    "template": "invalid",
    "subject": "field",
    "field": "{label}"
  },
  {
    "key": "media.field_must_be_a_relative_media_path",
    "en": "{label} must be a relative media path",
    "template": "relative",
    "subject": "field",
    "field": "{label}"
  },
  {
    "key": "media.field_must_stay_inside_nextmux_media",
    "en": "{label} must stay inside nextmux.media",
    "template": "relative",
    "subject": "field",
    "field": "{label}"
  },
  {
    "key": "media.media_cost_declaration_is_invalid",
    "en": "Media cost declaration is invalid",
    "template": "invalid",
    "subject": "job",
    "field": "cost"
  },
  {
    "key": "media.media_billing_mode_is_invalid",
    "en": "Media billing mode is invalid",
    "template": "invalid",
    "subject": "job",
    "field": "cost.billing"
  },
  {
    "key": "media.image_job_input_is_invalid",
    "en": "Image job input is invalid",
    "template": "invalid",
    "subject": "image",
    "field": "input"
  },
  {
    "key": "media.field_characterreferenceuris_is_invalid",
    "en": "{label}.characterReferenceUris is invalid",
    "template": "invalid",
    "subject": "reference",
    "field": "{label}.characterReferenceUris"
  },
  {
    "key": "media.speech_job_input_is_invalid",
    "en": "Speech job input is invalid",
    "template": "invalid",
    "subject": "speech",
    "field": "input"
  },
  {
    "key": "media.speech_format_is_not_supported",
    "en": "Speech format is not supported",
    "template": "unsupported",
    "subject": "speech",
    "field": "format"
  },
  {
    "key": "media.field_job_input_is_invalid",
    "en": "{label} job input is invalid",
    "template": "invalid",
    "subject": "job",
    "field": "{label}.input"
  },
  {
    "key": "media.field_format_is_not_supported",
    "en": "{label} format is not supported",
    "template": "unsupported",
    "subject": "job",
    "field": "{label}.format"
  },
  {
    "key": "media.cover_mode_requires_a_reference_song_a_vocal_reference_cannot_be_combined_with_cover_or_instrumental_mode",
    "en": "Cover mode requires a reference song; a vocal reference cannot be combined with cover or instrumental mode",
    "template": "conflict",
    "subject": "music",
    "field": "mode / referenceSong / vocalReference / instrumental"
  },
  {
    "key": "media.music_instrumental_must_be_true_or_false",
    "en": "music.instrumental must be true or false",
    "template": "format",
    "subject": "music",
    "field": "instrumental",
    "defaults": {
      "format": "boolean"
    }
  },
  {
    "key": "media.music_reference_asset_is_invalid",
    "en": "Music reference asset is invalid",
    "template": "invalid",
    "subject": "reference",
    "field": "music"
  },
  {
    "key": "media.audio_references_require_wav_or_mp3",
    "en": "Audio references require WAV or MP3",
    "template": "format",
    "subject": "reference",
    "field": "audio",
    "defaults": {
      "format": "WAV / MP3"
    }
  },
  {
    "key": "media.confirm_that_this_is_your_voice_or_that_you_have_permission_to_use_it",
    "en": "Confirm that this is your voice or that you have permission to use it",
    "template": "consent",
    "subject": "reference"
  },
  {
    "key": "media.reference_upload_is_invalid",
    "en": "Reference upload is invalid",
    "template": "invalid",
    "subject": "reference",
    "field": "upload"
  },
  {
    "key": "media.reference_upload_identity_is_invalid",
    "en": "Reference upload identity is invalid",
    "template": "invalid",
    "subject": "reference",
    "field": "upload.identity"
  },
  {
    "key": "media.video_job_input_is_invalid",
    "en": "Video job input is invalid",
    "template": "invalid",
    "subject": "video",
    "field": "input"
  },
  {
    "key": "media.video_music_mv_segment_identity_is_invalid",
    "en": "video music MV segment identity is invalid",
    "template": "invalid",
    "subject": "video",
    "field": "musicMvSegmentId / musicMvSnapshot"
  },
  {
    "key": "media.video_musicmvsourceprompt_requires_a_music_mv_segment_identity",
    "en": "video.musicMvSourcePrompt requires a music MV segment identity",
    "template": "required",
    "subject": "video",
    "field": "musicMvSegmentId"
  },
  {
    "key": "media.video_referenceasseturis_is_invalid",
    "en": "video.referenceAssetUris is invalid",
    "template": "invalid",
    "subject": "video",
    "field": "referenceAssetUris"
  },
  {
    "key": "media.video_edit_time_range_is_invalid",
    "en": "Video edit time range is invalid",
    "template": "invalid",
    "subject": "video",
    "field": "editStartSeconds / editEndSeconds"
  },
  {
    "key": "media.video_editing_requires_sourcevideouri",
    "en": "Video editing requires sourceVideoUri",
    "template": "required",
    "subject": "video",
    "field": "sourceVideoUri"
  },
  {
    "key": "media.frame_editing_requires_sourcevideouri",
    "en": "Frame editing requires sourceVideoUri",
    "template": "required",
    "subject": "video",
    "field": "sourceVideoUri / editFrameSeconds"
  },
  {
    "key": "media.frame_editing_cannot_be_combined_with_a_segment_range",
    "en": "Frame editing cannot be combined with a segment range",
    "template": "conflict",
    "subject": "video",
    "field": "editFrameSeconds / editStartSeconds / editEndSeconds"
  },
  {
    "key": "media.video_first_and_last_frame_parameters_are_invalid",
    "en": "Video first and last frame parameters are invalid",
    "template": "invalid",
    "subject": "video",
    "field": "firstFrameUri / lastFrameUri"
  },
  {
    "key": "media.field_must_be_boolean",
    "en": "{label} must be boolean",
    "template": "format",
    "subject": "field",
    "field": "{label}",
    "defaults": {
      "format": "boolean"
    }
  },
  {
    "key": "media.field_must_be_between_0_and_86400_seconds",
    "en": "{label} must be between 0 and 86400 seconds",
    "template": "range",
    "subject": "field",
    "field": "{label}",
    "defaults": {
      "minimum": 0,
      "maximum": 86400,
      "unit": " s"
    }
  },
  {
    "key": "media.field_must_be_greater_than_0_and_at_most_300_seconds",
    "en": "{label} must be greater than 0 and at most 300 seconds",
    "template": "positive_range",
    "subject": "field",
    "field": "{label}",
    "defaults": {
      "minimum": 0,
      "maximum": 300,
      "unit": " s",
      "exclusiveMinimum": true
    }
  },
  {
    "key": "media.subtitle_job_input_is_invalid",
    "en": "Subtitle job input is invalid",
    "template": "invalid",
    "subject": "subtitle",
    "field": "input"
  },
  {
    "key": "media.subtitle_frame_rate_is_not_supported",
    "en": "Subtitle frame rate is not supported",
    "template": "unsupported",
    "subject": "subtitle",
    "field": "frameRate"
  },
  {
    "key": "media.subtitle_job_needs_1_to_100_cues",
    "en": "Subtitle job needs 1 to 100 cues",
    "template": "range",
    "subject": "subtitle",
    "field": "cues.length",
    "defaults": {
      "minimum": 1,
      "maximum": 100
    }
  },
  {
    "key": "media.subtitle_format_is_not_supported",
    "en": "Subtitle format is not supported",
    "template": "unsupported",
    "subject": "subtitle",
    "field": "format"
  },
  {
    "key": "media.subtitle_cues_field_is_invalid",
    "en": "subtitle.cues[{index}] is invalid",
    "template": "invalid",
    "subject": "subtitle",
    "field": "cues[{index}]"
  },
  {
    "key": "media.preview_job_input_is_invalid",
    "en": "Preview job input is invalid",
    "template": "invalid",
    "subject": "job",
    "field": "preview.input"
  },
  {
    "key": "media.preview_frame_rate_is_not_supported",
    "en": "Preview frame rate is not supported",
    "template": "unsupported",
    "subject": "job",
    "field": "preview.frameRate"
  },
  {
    "key": "media.media_job_kind_is_not_supported",
    "en": "Media job kind is not supported",
    "template": "unsupported",
    "subject": "job",
    "field": "kind"
  },
  {
    "key": "media.media_job_request_is_invalid",
    "en": "Media job request is invalid",
    "template": "invalid",
    "subject": "request"
  },
  {
    "key": "media.jobs_field_remotetask_is_invalid",
    "en": "jobs[{label}].remoteTask is invalid",
    "template": "invalid",
    "subject": "job",
    "field": "jobs[{label}].remoteTask"
  },
  {
    "key": "media.jobs_field_remotetask_field_is_invalid",
    "en": "jobs[{label}].remoteTask.{name} is invalid",
    "template": "invalid",
    "subject": "job",
    "field": "jobs[{label}].remoteTask.{name}"
  },
  {
    "key": "media.jobs_field_remotetask_taskid_is_invalid",
    "en": "jobs[{label}].remoteTask.taskId is invalid",
    "template": "invalid",
    "subject": "job",
    "field": "jobs[{label}].remoteTask.taskId"
  },
  {
    "key": "media.media_checkpoint_is_invalid",
    "en": "Media checkpoint is invalid",
    "template": "invalid",
    "subject": "checkpoint"
  },
  {
    "key": "media.media_asset_kind_is_invalid",
    "en": "Media asset kind is invalid",
    "template": "invalid",
    "subject": "checkpoint",
    "field": "assetKind"
  },
  {
    "key": "media.media_asset_identifier_is_invalid",
    "en": "Media asset identifier is invalid",
    "template": "invalid",
    "subject": "checkpoint",
    "field": "assetId"
  },
  {
    "key": "media.media_asset_checksum_is_invalid",
    "en": "Media asset checksum is invalid",
    "template": "invalid",
    "subject": "checkpoint",
    "field": "sha256"
  },
  {
    "key": "media.provider_media_evidence_is_invalid",
    "en": "Provider media evidence is invalid",
    "template": "invalid",
    "subject": "checkpoint",
    "field": "providerEvidence"
  },
  {
    "key": "media.media_track_evidence_is_invalid",
    "en": "Media track evidence is invalid",
    "template": "invalid",
    "subject": "checkpoint",
    "field": "mediaEvidence"
  },
  {
    "key": "media.media_failure_is_invalid",
    "en": "Media failure is invalid",
    "template": "invalid",
    "subject": "job",
    "field": "failure"
  },
  {
    "key": "media.media_recovery_identity_is_invalid",
    "en": "Media recovery identity is invalid",
    "template": "invalid",
    "subject": "job",
    "field": "failure.requestId / recoveryMode"
  },
  {
    "key": "media.media_job_status_is_invalid",
    "en": "Media job status is invalid",
    "template": "invalid",
    "subject": "job",
    "field": "status"
  },
  {
    "key": "media.jobs_field_ownerlease_is_invalid",
    "en": "jobs[{index}].ownerLease is invalid",
    "template": "invalid",
    "subject": "worker",
    "field": "jobs[{index}].ownerLease"
  },
  {
    "key": "media.media_history_contains_unfinished_work",
    "en": "Media history contains unfinished work",
    "template": "conflict",
    "subject": "history",
    "field": "status"
  },
  {
    "key": "media.unknown_archived_media_kind",
    "en": "Unknown archived media kind",
    "template": "unsupported",
    "subject": "history",
    "field": "kind"
  },
  {
    "key": "media.media_history_record_is_invalid",
    "en": "Media history record is invalid",
    "template": "invalid",
    "subject": "history",
    "field": "record"
  },
  {
    "key": "media.media_history_key_digest_is_invalid",
    "en": "Media history key digest is invalid",
    "template": "invalid",
    "subject": "history",
    "field": "idempotencyDigest"
  },
  {
    "key": "media.media_history_record_is_not_canonical_terminal_history",
    "en": "Media history record is not canonical terminal history",
    "template": "invalid",
    "subject": "history",
    "field": "terminalRecord"
  },
  {
    "key": "media.events_field_is_invalid",
    "en": "events[{index}] is invalid",
    "template": "invalid",
    "subject": "job",
    "field": "events[{index}]"
  },
  {
    "key": "media.events_field_type_is_invalid",
    "en": "events[{index}].type is invalid",
    "template": "invalid",
    "subject": "job",
    "field": "events[{index}].type"
  },
  {
    "key": "media.events_field_note_is_invalid",
    "en": "events[{index}].note is invalid",
    "template": "invalid",
    "subject": "job",
    "field": "events[{index}].note"
  },
  {
    "key": "media.jobs_field_is_invalid",
    "en": "jobs[{index}] is invalid",
    "template": "invalid",
    "subject": "job",
    "field": "jobs[{index}]"
  },
  {
    "key": "media.too_many_reference_upload_ids",
    "en": "Too many reference upload IDs",
    "template": "limit",
    "subject": "reference",
    "field": "uploads.length"
  },
  {
    "key": "media.jobs_field_kind_is_invalid",
    "en": "jobs[{index}].kind is invalid",
    "template": "invalid",
    "subject": "job",
    "field": "jobs[{index}].kind"
  },
  {
    "key": "media.jobs_field_references_invalid_comic_entities",
    "en": "jobs[{index}] references invalid comic entities",
    "template": "invalid",
    "subject": "job",
    "field": "jobs[{index}].projectId / sceneId / shotId"
  },
  {
    "key": "media.jobs_field_payloadhash_is_invalid",
    "en": "jobs[{index}].payloadHash is invalid",
    "template": "invalid",
    "subject": "job",
    "field": "jobs[{index}].payloadHash"
  },
  {
    "key": "media.jobs_field_restoredhistoryonly_is_invalid",
    "en": "jobs[{index}].restoredHistoryOnly is invalid",
    "template": "invalid",
    "subject": "job",
    "field": "jobs[{index}].restoredHistoryOnly"
  },
  {
    "key": "media.jobs_field_archivedidempotencydigest_is_invalid",
    "en": "jobs[{index}].archivedIdempotencyDigest is invalid",
    "template": "invalid",
    "subject": "job",
    "field": "jobs[{index}].archivedIdempotencyDigest"
  },
  {
    "key": "media.jobs_field_cost_is_invalid",
    "en": "jobs[{index}].cost is invalid",
    "template": "invalid",
    "subject": "job",
    "field": "jobs[{index}].cost"
  },
  {
    "key": "media.jobs_field_events_is_invalid",
    "en": "jobs[{index}].events is invalid",
    "template": "invalid",
    "subject": "job",
    "field": "jobs[{index}].events"
  },
  {
    "key": "media.jobs_field_exceeded_maxattempts",
    "en": "jobs[{index}] exceeded maxAttempts",
    "template": "limit",
    "subject": "job",
    "field": "jobs[{index}].maxAttempts"
  },
  {
    "key": "media.jobs_field_has_no_successful_output",
    "en": "jobs[{index}] has no successful output",
    "template": "missing",
    "subject": "job",
    "field": "jobs[{index}].output"
  },
  {
    "key": "media.jobs_field_has_no_running_worker",
    "en": "jobs[{index}] has no running worker",
    "template": "missing",
    "subject": "job",
    "field": "jobs[{index}].claimedBy"
  },
  {
    "key": "media.jobs_field_is_not_read_only_terminal_history",
    "en": "jobs[{index}] is not read-only terminal history",
    "template": "invalid",
    "subject": "history",
    "field": "jobs[{index}].status"
  },
  {
    "key": "media.media_queue_file_is_invalid",
    "en": "Media queue file is invalid",
    "template": "invalid",
    "subject": "queue",
    "field": "file"
  },
  {
    "key": "media.media_queue_schema_is_not_supported",
    "en": "Media queue schema is not supported",
    "template": "unsupported",
    "subject": "queue",
    "field": "schemaVersion"
  },
  {
    "key": "media.media_queue_capacity_was_exceeded",
    "en": "Media queue capacity was exceeded",
    "template": "limit",
    "subject": "queue",
    "field": "jobs.length"
  },
  {
    "key": "media.media_queue_contains_duplicate_identifiers",
    "en": "Media queue contains duplicate identifiers",
    "template": "conflict",
    "subject": "queue",
    "field": "jobs.id"
  },
  {
    "key": "media.media_history_belongs_to_a_different_workspace",
    "en": "Media history belongs to a different workspace",
    "template": "conflict",
    "subject": "history",
    "field": "workspaceBinding"
  },
  {
    "key": "media.media_job_history_archive_failed_validation",
    "en": "Media job history archive failed validation",
    "template": "invalid",
    "subject": "history",
    "field": "archive"
  },
  {
    "key": "media.media_queue_root_is_required",
    "en": "Media queue root is required",
    "template": "required",
    "subject": "queue",
    "field": "root"
  },
  {
    "key": "media.media_queue_root_is_not_a_directory",
    "en": "Media queue root is not a directory",
    "template": "invalid",
    "subject": "queue",
    "field": "root.directory"
  },
  {
    "key": "media.media_queue_file_exceeds_the_size_limit",
    "en": "Media queue file exceeds the size limit",
    "template": "limit",
    "subject": "queue",
    "field": "file.byteLength"
  },
  {
    "key": "media.unable_to_read_media_queue_state",
    "en": "Unable to read media queue state",
    "template": "failed",
    "subject": "queue",
    "field": "read"
  },
  {
    "key": "media.media_queue_file_is_not_valid_json",
    "en": "Media queue file is not valid JSON",
    "template": "invalid",
    "subject": "queue",
    "field": "JSON"
  },
  {
    "key": "media.media_job_does_not_exist",
    "en": "Media job does not exist",
    "template": "missing",
    "subject": "job"
  },
  {
    "key": "media.media_history_workspace_binding_is_invalid",
    "en": "Media history workspace binding is invalid",
    "template": "invalid",
    "subject": "history",
    "field": "workspaceBinding"
  },
  {
    "key": "media.choose_an_existing_backup_folder_outside_media_queues",
    "en": "Choose an existing backup folder outside media queues",
    "template": "required",
    "subject": "history",
    "field": "backup.directory"
  },
  {
    "key": "media.there_is_no_finished_media_job_history_to_export",
    "en": "There is no finished media job history to export",
    "template": "missing",
    "subject": "history",
    "field": "completedJobs"
  },
  {
    "key": "media.too_many_finished_jobs_for_one_archive",
    "en": "Too many finished jobs for one archive",
    "template": "limit",
    "subject": "history",
    "field": "completedJobs.length"
  },
  {
    "key": "media.media_job_history_exceeds_the_archive_limit",
    "en": "Media job history exceeds the archive limit",
    "template": "limit",
    "subject": "history",
    "field": "archive.byteLength"
  },
  {
    "key": "media.archive_cannot_be_inside_the_live_media_queue",
    "en": "Archive cannot be inside the live media queue",
    "template": "conflict",
    "subject": "history",
    "field": "archive.path / queue.root"
  },
  {
    "key": "media.media_queue_file_is_not_safe_to_replace",
    "en": "Media queue file is not safe to replace",
    "template": "conflict",
    "subject": "queue",
    "field": "file.replace"
  },
  {
    "key": "media.clear_current_media_jobs_before_restoring_history",
    "en": "Clear current media jobs before restoring history",
    "template": "conflict",
    "subject": "history",
    "field": "queue.jobs"
  },
  {
    "key": "media.media_queue_revision_cannot_advance",
    "en": "Media queue revision cannot advance",
    "template": "limit",
    "subject": "queue",
    "field": "revision"
  },
  {
    "key": "media.restored_media_queue_would_exceed_its_disk_limit",
    "en": "Restored media queue would exceed its disk limit",
    "template": "limit",
    "subject": "queue",
    "field": "diskBytes"
  },
  {
    "key": "media.unable_to_install_media_history_original_queue_was_preserved",
    "en": "Unable to install media history; original queue was preserved",
    "template": "failed",
    "subject": "history",
    "field": "import"
  },
  {
    "key": "media.the_media_idempotency_key_was_already_used_for_different_input",
    "en": "The media idempotency key was already used for different input",
    "template": "conflict",
    "subject": "job",
    "field": "idempotencyKey / input"
  },
  {
    "key": "media.media_queue_can_contain_at_most_field_active_records",
    "en": "Media queue can contain at most {MAX_ACTIVE_JOBS} active records",
    "template": "limit",
    "subject": "queue",
    "field": "jobs.length ≤ {MAX_ACTIVE_JOBS}"
  },
  {
    "key": "media.media_job_identifier_already_exists",
    "en": "Media job identifier already exists",
    "template": "conflict",
    "subject": "job",
    "field": "id"
  },
  {
    "key": "media.media_job_is_not_waiting_for_cost_confirmation",
    "en": "Media job is not waiting for cost confirmation",
    "template": "conflict",
    "subject": "job",
    "field": "awaiting_confirmation"
  },
  {
    "key": "media.media_worker_belongs_to_another_process",
    "en": "Media worker belongs to another process",
    "template": "conflict",
    "subject": "worker",
    "field": "processId"
  },
  {
    "key": "media.media_job_already_has_a_different_output_checkpoint",
    "en": "Media job already has a different output checkpoint",
    "template": "conflict",
    "subject": "checkpoint",
    "field": "output"
  },
  {
    "key": "media.media_output_must_be_checkpointed_before_completion",
    "en": "Media output must be checkpointed before completion",
    "template": "required",
    "subject": "checkpoint",
    "field": "completion"
  },
  {
    "key": "media.completed_media_job_cannot_be_cancelled",
    "en": "Completed media job cannot be cancelled",
    "template": "conflict",
    "subject": "job",
    "field": "succeeded / cancel"
  },
  {
    "key": "media.media_output_is_already_ready_and_is_being_attached_to_the_project",
    "en": "Media output is already ready and is being attached to the project",
    "template": "conflict",
    "subject": "checkpoint",
    "field": "attachment / cancel"
  },
  {
    "key": "media.a_job_submitted_to_the_provider_cannot_be_paused_cancel_it_or_wait_for_completion",
    "en": "A job submitted to the provider cannot be paused; cancel it or wait for completion",
    "template": "conflict",
    "subject": "job",
    "field": "submitted / pause"
  },
  {
    "key": "media.this_media_job_cannot_be_paused",
    "en": "This media job cannot be paused",
    "template": "conflict",
    "subject": "job",
    "field": "pause"
  },
  {
    "key": "media.this_media_job_is_not_paused",
    "en": "This media job is not paused",
    "template": "conflict",
    "subject": "job",
    "field": "paused / resume"
  },
  {
    "key": "media.restored_media_history_cannot_be_retried",
    "en": "Restored media history cannot be retried",
    "template": "read_only",
    "subject": "history"
  },
  {
    "key": "media.media_job_is_not_in_a_retryable_state",
    "en": "Media job is not in a retryable state",
    "template": "conflict",
    "subject": "job",
    "field": "retry"
  },
  {
    "key": "media.this_media_failure_requires_a_new_job_with_corrected_input",
    "en": "This media failure requires a new job with corrected input",
    "template": "new_job",
    "subject": "job"
  },
  {
    "key": "media.media_job_reached_its_retry_limit",
    "en": "Media job reached its retry limit",
    "template": "limit",
    "subject": "job",
    "field": "maxAttempts"
  },
  {
    "key": "media.restored_media_history_cannot_start_a_new_generation",
    "en": "Restored media history cannot start a new generation",
    "template": "read_only",
    "subject": "history"
  },
  {
    "key": "media.wait_for_the_current_media_job_to_stop_before_generating_again",
    "en": "Wait for the current media job to stop before generating again",
    "template": "wait_stop",
    "subject": "job"
  },
  {
    "key": "media.active_media_job_cannot_be_removed_from_history",
    "en": "Active media job cannot be removed from history",
    "template": "wait_stop",
    "subject": "job"
  },
  {
    "key": "media.media_job_is_not_owned_by_this_worker",
    "en": "Media job is not owned by this worker",
    "template": "conflict",
    "subject": "job",
    "field": "claimedBy"
  },
  {
    "key": "media.media_queue_exceeds_the_48_mb_disk_limit",
    "en": "Media queue exceeds the 48 MB disk limit",
    "template": "limit",
    "subject": "queue",
    "field": "diskBytes ≤ 48 MB"
  },
  {
    "key": "media.unable_to_save_media_queue_state",
    "en": "Unable to save media queue state",
    "template": "failed",
    "subject": "queue",
    "field": "save"
  },
  {
    "key": "media.another_nextmux_process_is_updating_the_media_queue",
    "en": "Another NextMux process is updating the media queue",
    "template": "conflict",
    "subject": "queue",
    "field": "processId / lock"
  },
  {
    "key": "media.unable_to_lock_the_media_queue",
    "en": "Unable to lock the media queue",
    "template": "failed",
    "subject": "queue",
    "field": "lock"
  },
  {
    "key": "media.media_queue_lock_was_lost_while_saving",
    "en": "Media queue lock was lost while saving",
    "template": "unavailable",
    "subject": "queue",
    "field": "lock"
  },
  {
    "key": "media.a_legacy_media_queue_lock_is_active_or_remains_close_the_old_application_and_confirm_its_jobs_have_stopped_bef",
    "en": "A legacy media queue lock is active or remains; close the old application and confirm its jobs have stopped before removing the lock",
    "template": "conflict",
    "subject": "queue",
    "field": "legacy.lock"
  },
  {
    "key": "media.media_queue_root_changed_while_locking",
    "en": "Media queue root changed while locking",
    "template": "conflict",
    "subject": "queue",
    "field": "root / lock"
  },
  {
    "key": "media.subtitle_timestamp_is_outside_the_24_hour_limit",
    "en": "Subtitle timestamp is outside the 24 hour limit",
    "template": "range",
    "subject": "subtitle",
    "field": "timestamp",
    "defaults": {
      "minimum": 0,
      "maximum": 86400000,
      "unit": " ms"
    }
  },
  {
    "key": "media.subtitle_export_needs_1_to_field_cues",
    "en": "Subtitle export needs 1 to {maximum} cues",
    "template": "range",
    "subject": "subtitle",
    "field": "cues.length",
    "defaults": {
      "minimum": 1
    }
  },
  {
    "key": "media.voice_sample_too_short",
    "en": "Voice samples must be at least {minimum} seconds",
    "template": "minimum",
    "subject": "reference",
    "defaults": {
      "minimum": 15,
      "unit": " s"
    }
  },
  {
    "key": "media.reference_song_duration_invalid",
    "en": "Reference song duration is invalid",
    "template": "invalid",
    "subject": "reference",
    "field": "referenceSong.durationSeconds"
  },
  {
    "key": "media.local_transcription_unavailable",
    "en": "Local transcription components are unavailable",
    "template": "unavailable",
    "subject": "transcription",
    "field": "local.components"
  },
  {
    "key": "media.recovery_provider_outcome_unknown",
    "en": "The app exited before the media result was confirmed. Review the original request to avoid being charged twice; it will not be generated again.",
    "template": "recovery_provider",
    "subject": "job"
  },
  {
    "key": "media.recovery_local_interrupted",
    "en": "The app exited before the local media job completed. You can resume it manually.",
    "template": "recovery_local",
    "subject": "job"
  },
  {
    "key": "media.archived_failure",
    "en": "Failure details were omitted from the archive",
    "template": "archive_failure",
    "subject": "history"
  }
];
const messages = new Map(definitions.map(item => [item.key, item]));
export const MEDIA_ERROR_MESSAGE_KEYS: readonly string[] = definitions.map(item => item.key);

function interpolate(text: string, params: MediaDomainErrorParams): string {
  return text.replace(/\{([A-Za-z_][\w]*)\}/g, (_match, key: string) => Object.hasOwn(params, key) ? String(params[key] ?? '') : '');
}
export function mediaErrorMessage(messageKey: string, params: MediaDomainErrorParams = {}): string {
  const entry = messages.get(messageKey);
  return entry ? interpolate(entry.en, { ...entry.defaults, ...params }) : 'The media operation could not be completed.';
}
export function formatMediaDomainError(messageKey: string, params: MediaDomainErrorParams = {}, locale = 'en'): string | undefined {
  const entry = messages.get(messageKey);
  if (!entry) return undefined;
  const index = MEDIA_ERROR_LOCALES.indexOf(locale as typeof MEDIA_ERROR_LOCALES[number]);
  if (index <= 0) return mediaErrorMessage(messageKey, params);
  const values: MediaDomainErrorParams = { ...entry.defaults, ...params };
  const subject = subjects[entry.subject]![index]!;
  const fieldName = interpolate(entry.field ?? '', values);
  return interpolate(templates[entry.template]![index]!, { unit: '', ...values, subject, fieldName: fieldName || subject, field: fieldName ? ' (' + fieldName + ')' : '' });
}

/** Completeness means every required locale has a real entry, even when script or tokens match. */
export function mediaErrorCatalogProblems(): readonly string[] {
  const problems: string[] = [];
  for (const [name, table] of Object.entries({ subjects, templates })) {
    for (const [key, values] of Object.entries(table)) {
      for (let index = 0; index < MEDIA_ERROR_LOCALES.length; index += 1) {
        if (!values[index]?.trim()) problems.push(name + '.' + key + ':' + MEDIA_ERROR_LOCALES[index]);
      }
    }
  }
  for (const item of definitions) {
    if (!subjects[item.subject] || !templates[item.template]) problems.push(item.key);
  }
  if (messages.size !== definitions.length) problems.push('duplicate_message_key');
  return problems;
}
