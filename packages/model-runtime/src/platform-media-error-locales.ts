/** Browser-safe semantic media/export messages. User titles and paths are parameters, never translation keys. */
import { formatPlatformMediaArchiveError } from './platform-media-archive-locales.js';
export const PLATFORM_MEDIA_LOCALES = ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'] as const;
type Params = Readonly<Record<string, string | number | boolean | null>>;
export const PLATFORM_MEDIA_MESSAGES: Readonly<Record<string, readonly string[]>> = {
    video_has_no_audio: ['{title}: This video has no audio track to detach.', '{title}：此视频没有可分离的音轨。', '{title}：此影片沒有可分離的音軌。', '{title}：この動画には分離できる音声トラックがありません。', '{title}: 이 동영상에는 분리할 오디오 트랙이 없습니다.', '{title}: Este vídeo no tiene ninguna pista de audio que separar.', '{title} : Cette vidéo ne contient aucune piste audio à détacher.', '{title}: Dieses Video hat keine Audiospur zum Abtrennen.', '{title}: Este vídeo não tem uma faixa de áudio para separar.', '{title}: В этом видео нет звуковой дорожки для отделения.', '{title}: لا يحتوي هذا الفيديو على مسار صوتي لفصله.', '{title}: इस वीडियो में अलग करने के लिए कोई ऑडियो ट्रैक नहीं है।'],
    reference_link_sign_in_image: ["This API only reads pictures from a web link. Sign in to NextMux and your reference picture is hosted for 6 hours for it to read, then deleted — or choose an API that accepts uploaded pictures.", "这个接口只能通过网页链接读取图片。登录 NextMux 后，参考图会临时托管 6 小时供它读取，到期自动删除；也可以换一个能直接上传图片的接口。", "這個介面只能透過網頁連結讀取圖片。登入 NextMux 後，參考圖會暫時託管 6 小時供它讀取，到期自動刪除；也可以換一個能直接上傳圖片的介面。", "この API は画像を Web リンクからしか読み込めません。NextMux にサインインすると参照画像を 6 時間だけ預かって読み込ませ、その後削除します。画像を直接アップロードできる API に切り替えることもできます。", "이 API는 웹 링크로만 이미지를 읽습니다. NextMux에 로그인하면 참조 이미지를 6시간 동안 호스팅한 뒤 자동으로 삭제합니다. 이미지를 직접 업로드할 수 있는 API로 바꿀 수도 있습니다.", "Esta API solo lee imágenes desde un enlace web. Inicia sesión en NextMux y tu imagen de referencia se aloja 6 horas para que la lea y luego se borra; o elige una API que acepte imágenes subidas.", "Cette API ne lit les images que via un lien web. Connectez-vous à NextMux : votre image de référence est hébergée 6 heures pour qu’elle la lise, puis supprimée. Vous pouvez aussi choisir une API qui accepte l’envoi d’images.", "Diese API liest Bilder nur über einen Weblink. Melde dich bei NextMux an, dann wird dein Referenzbild 6 Stunden bereitgestellt und danach gelöscht – oder wähle eine API, die hochgeladene Bilder annimmt.", "Esta API só lê imagens por um link da web. Entre no NextMux e sua imagem de referência fica hospedada por 6 horas para ser lida e depois é apagada; ou escolha uma API que aceite imagens enviadas.", "Этот API читает изображения только по веб-ссылке. Войдите в NextMux: эталонное изображение будет размещено на 6 часов, затем удалено. Или выберите API, который принимает загруженные изображения.", "تقرأ هذه الواجهة الصور من رابط ويب فقط. سجّل الدخول إلى NextMux لتُستضاف صورتك المرجعية 6 ساعات ثم تُحذف، أو اختر واجهة تقبل رفع الصور.", "यह API चित्र केवल वेब लिंक से पढ़ता है। NextMux में साइन इन करें: आपका संदर्भ चित्र 6 घंटे होस्ट होकर हट जाएगा — या ऐसा API चुनें जो अपलोड किए चित्र ले।"],
    reference_link_sign_in_audio: ["This music API only reads audio from a web link. Sign in to NextMux and your reference audio is hosted for 6 hours for it to read, then deleted — or choose an API that accepts uploaded audio.", "这个音乐接口只能通过网页链接读取音频。登录 NextMux 后，参考音频会临时托管 6 小时供它读取，到期自动删除；也可以换一个能直接上传音频的接口。", "這個音樂介面只能透過網頁連結讀取音訊。登入 NextMux 後，參考音訊會暫時託管 6 小時供它讀取，到期自動刪除；也可以換一個能直接上傳音訊的介面。", "この音楽 API は音声を Web リンクからしか読み込めません。NextMux にサインインすると参照音声を 6 時間だけ預かり、その後削除します。音声を直接アップロードできる API に切り替えることもできます。", "이 음악 API는 웹 링크로만 오디오를 읽습니다. NextMux에 로그인하면 참조 오디오를 6시간 동안 호스팅한 뒤 자동으로 삭제합니다. 오디오를 직접 업로드할 수 있는 API로 바꿀 수도 있습니다.", "Esta API de música solo lee audio desde un enlace web. Inicia sesión en NextMux y tu audio de referencia se aloja 6 horas y luego se borra; o elige una API que acepte audio subido.", "Cette API musicale ne lit l’audio que via un lien web. Connectez-vous à NextMux : votre audio de référence est hébergé 6 heures, puis supprimé. Vous pouvez aussi choisir une API qui accepte l’envoi d’audio.", "Diese Musik-API liest Audio nur über einen Weblink. Melde dich bei NextMux an, dann wird dein Referenz-Audio 6 Stunden bereitgestellt und danach gelöscht – oder wähle eine API, die hochgeladenes Audio annimmt.", "Esta API de música só lê áudio por um link da web. Entre no NextMux e seu áudio de referência fica hospedado por 6 horas e depois é apagado; ou escolha uma API que aceite áudio enviado.", "Этот музыкальный API читает аудио только по веб-ссылке. Войдите в NextMux: эталонное аудио будет размещено на 6 часов, затем удалено. Или выберите API, который принимает загруженное аудио.", "تقرأ واجهة الموسيقى هذه الصوت من رابط ويب فقط. سجّل الدخول إلى NextMux ليُستضاف الصوت المرجعي 6 ساعات ثم يُحذف، أو اختر واجهة تقبل رفع الصوت.", "यह संगीत API ऑडियो केवल वेब लिंक से पढ़ता है। NextMux में साइन इन करें: आपका संदर्भ ऑडियो 6 घंटे होस्ट होकर हट जाएगा — या ऐसा API चुनें जो अपलोड किया ऑडियो ले।"],
    submission_unknown: ["The request was sent but the provider never answered, so the task may already be running and billed there. NextMux will not send it again by itself: check the provider's dashboard, then generate again if needed.", "请求已发出，但服务商没有回应，任务可能已在服务商那里开始并计费。为避免重复扣费，NextMux 不会自动重发：请先到服务商后台确认，需要时再重新生成。", "請求已送出，但服務商沒有回應，任務可能已在服務商那裡開始並計費。為避免重複扣款，NextMux 不會自動重送：請先到服務商後台確認，需要時再重新產生。", "リクエストは送信されましたがプロバイダーから応答がなく、タスクはすでに実行・課金されている可能性があります。二重課金を避けるため NextMux は自動で再送しません。プロバイダーの管理画面を確認し、必要なら再生成してください。", "요청은 보냈지만 제공업체의 응답이 없어 작업이 이미 실행되고 과금되었을 수 있습니다. 중복 과금을 막기 위해 NextMux는 자동으로 다시 보내지 않습니다. 제공업체 대시보드를 확인한 뒤 필요하면 다시 생성하세요.", "La solicitud se envió pero el proveedor no respondió; la tarea puede estar ya en curso y facturada. NextMux no la reenviará solo: revise el panel del proveedor y genere de nuevo si hace falta.", "La requête a été envoyée mais le fournisseur n’a pas répondu : la tâche est peut-être déjà lancée et facturée. NextMux ne la renverra pas de lui-même : vérifiez le tableau de bord du fournisseur, puis relancez si besoin.", "Die Anfrage wurde gesendet, aber der Anbieter hat nicht geantwortet; die Aufgabe läuft womöglich schon und wird berechnet. NextMux sendet sie nicht selbst erneut: im Dashboard des Anbieters prüfen und bei Bedarf neu erzeugen.", "A solicitação foi enviada, mas o provedor não respondeu; a tarefa pode já estar em execução e cobrada. O NextMux não a reenviará sozinho: verifique o painel do provedor e gere de novo se precisar.", "Запрос отправлен, но поставщик не ответил: задача, возможно, уже выполняется и оплачивается. NextMux не будет отправлять её повторно сам: проверьте панель поставщика и при необходимости создайте заново.", "أُرسل الطلب لكن المزوّد لم يرد، وقد تكون المهمة بدأت واحتُسبت عنده. لن يعيد NextMux إرسالها تلقائيًا: تحقّق من لوحة المزوّد ثم أعد الإنشاء عند الحاجة.", "अनुरोध भेजा गया पर प्रदाता ने जवाब नहीं दिया, इसलिए कार्य वहाँ पहले ही चल रहा और शुल्क लग चुका हो सकता है। NextMux इसे अपने-आप दोबारा नहीं भेजेगा: प्रदाता का डैशबोर्ड देखें, ज़रूरत हो तो फिर से बनाएँ।"],
    transfer_idle_timeout: ['Media transfer received no data within {timeoutMs} ms.', '媒体传输在 {timeoutMs} 毫秒内未收到数据。', '媒體傳輸在 {timeoutMs} 毫秒內未收到資料。', 'メディア転送で {timeoutMs} ミリ秒間データを受信できませんでした。', '미디어 전송 중 {timeoutMs} 밀리초 동안 데이터를 받지 못했습니다.', 'La transferencia multimedia no recibió datos en {timeoutMs} ms.', 'Le transfert multimédia n’a reçu aucune donnée pendant {timeoutMs} ms.', 'Bei der Medienübertragung wurden innerhalb von {timeoutMs} ms keine Daten empfangen.', 'A transferência de mídia não recebeu dados em {timeoutMs} ms.', 'При передаче медиа данные не поступали в течение {timeoutMs} мс.', 'لم يتلقَّ نقل الوسائط أي بيانات خلال {timeoutMs} مللي ثانية.', 'मीडिया स्थानांतरण को {timeoutMs} मिलीसेकंड में कोई डेटा नहीं मिला।'],
    transfer_total_timeout: ['Media transfer exceeded its total time limit ({timeoutMs} ms).', '媒体传输超过总时限（{timeoutMs} 毫秒）。', '媒體傳輸超過總時限（{timeoutMs} 毫秒）。', 'メディア転送が総時間制限（{timeoutMs} ミリ秒）を超えました。', '미디어 전송이 전체 시간 제한({timeoutMs} 밀리초)을 초과했습니다.', 'La transferencia multimedia superó su tiempo total permitido ({timeoutMs} ms).', 'Le transfert multimédia a dépassé sa durée totale autorisée ({timeoutMs} ms).', 'Die Medienübertragung hat ihr Gesamtzeitlimit ({timeoutMs} ms) überschritten.', 'A transferência de mídia excedeu o tempo total permitido ({timeoutMs} ms).', 'Передача медиа превысила общий лимит времени ({timeoutMs} мс).', 'تجاوز نقل الوسائط الحد الزمني الإجمالي ({timeoutMs} مللي ثانية).', 'मीडिया स्थानांतरण ने कुल समय सीमा ({timeoutMs} मिलीसेकंड) पार कर ली।'],
    video_container_invalid: ['The response is not a valid supported video file.', '响应不是有效且受支持的视频文件。', '回應不是有效且受支援的影片檔案。', '応答は対応している有効な動画ファイルではありません。', '응답이 지원되는 유효한 동영상 파일이 아닙니다.', 'La respuesta no es un archivo de vídeo válido y compatible.', 'La réponse n’est pas un fichier vidéo valide et pris en charge.', 'Die Antwort ist keine gültige unterstützte Videodatei.', 'A resposta não é um arquivo de vídeo válido e compatível.', 'Ответ не является допустимым поддерживаемым видеофайлом.', 'الاستجابة ليست ملف فيديو صالحًا ومدعومًا.', 'प्रतिक्रिया मान्य और समर्थित वीडियो फ़ाइल नहीं है।'],
    price_confirmation: ["Confirm the updated model price and create a new task. The original task will not retry automatically.", "请确认更新后的模型价格并创建新任务；原任务不会自动重试。", "請確認更新後的模型價格並建立新任務；原任務不會自動重試。", "更新されたモデル料金を確認して新しいタスクを作成してください。元のタスクは自動再試行されません。", "변경된 모델 가격을 확인하고 새 작업을 만드세요. 기존 작업은 자동으로 재시도하지 않습니다.", "Confirme el precio actualizado y cree otra tarea. La original no se reintentará automáticamente.", "Confirmez le tarif actualisé et créez une nouvelle tâche. La tâche initiale ne sera pas relancée automatiquement.", "Aktualisierten Modellpreis bestätigen und neue Aufgabe erstellen. Die ursprüngliche Aufgabe wird nicht automatisch wiederholt.", "Confirme o preço atualizado e crie outra tarefa. A original não será repetida automaticamente.", "Подтвердите обновлённую цену и создайте новую задачу. Исходная задача не будет повторена автоматически.", "أكد سعر النموذج المحدّث وأنشئ مهمة جديدة. لن تُعاد المهمة الأصلية تلقائيًا.", "मॉडल की नई कीमत की पुष्टि करके नया कार्य बनाएँ। मूल कार्य स्वतः फिर नहीं चलेगा।"],
    speech_protocol_unsupported: ["This speech route requires an OpenAI-compatible speech API.", "此配音线路需要兼容 OpenAI 的语音接口。", "此配音路由需要相容 OpenAI 的語音介面。", "この音声ルートには OpenAI 互換の音声 API が必要です。", "이 음성 경로에는 OpenAI 호환 음성 API가 필요합니다.", "Esta ruta de voz requiere una API de voz compatible con OpenAI.", "Cette route vocale nécessite une API vocale compatible avec OpenAI.", "Diese Sprachroute benötigt eine OpenAI-kompatible Sprach-API.", "Esta rota de voz requer uma API de voz compatível com OpenAI.", "Этот голосовой маршрут требует речевой API, совместимый с OpenAI.", "يتطلب هذا المسار الصوتي واجهة صوتية متوافقة مع OpenAI.", "इस वॉइस रूट को OpenAI-संगत वॉइस API चाहिए।"],
    "export_read_only": ["Imported export records are read-only.", "导入的成片记录仅供查看。", "匯入的成片記錄僅供檢視。", "インポートした書き出し履歴は読み取り専用です。", "가져온 내보내기 기록은 읽기 전용입니다.", "Los registros importados son de solo lectura.", "Les historiques importés sont en lecture seule.", "Importierte Exportaufzeichnungen sind schreibgeschützt.", "Os registros importados são somente leitura.", "Импортированные записи доступны только для чтения.", "سجلات التصدير المستوردة للقراءة فقط.", "आयातित निर्यात रिकॉर्ड केवल पढ़ने के लिए हैं।"],
    "mv_alignment": ["Song or lyrics changed. Align lyrics and segments again before exporting the MV.", "歌曲或歌词已变化，请重新对齐歌词和分段再导出 MV。", "歌曲或歌詞已變更，請重新對齊歌詞和分段再匯出 MV。", "楽曲または歌詞が変更されました。MV の書き出し前に歌詞とセグメントを再調整してください。", "노래 또는 가사가 변경되었습니다. MV를 내보내기 전에 가사와 구간을 다시 정렬하세요.", "La canción o letra cambió. Alinee de nuevo la letra y los segmentos antes de exportar.", "La chanson ou les paroles ont changé. Réalignez les paroles et les segments avant l’exportation.", "Song oder Text geändert. Vor dem MV-Export Text und Segmente neu ausrichten.", "A música ou letra mudou. Alinhe novamente a letra e os segmentos antes de exportar.", "Песня или текст изменены. Перед экспортом заново выровняйте текст и сегменты.", "تغيّرت الأغنية أو الكلمات. أعد محاذاة الكلمات والمقاطع قبل التصدير.", "गीत या बोल बदल गए। MV निर्यात से पहले बोल और खंड फिर मिलाएँ।"],
    "mv_contiguous": ["MV segments must cover the whole song without gaps or overlaps.", "MV 分段必须无间隙、无重叠地覆盖整首歌曲。", "MV 分段必須無間隙、無重疊地涵蓋整首歌曲。", "MV セグメントは隙間や重複なく楽曲全体を覆う必要があります。", "MV 구간은 간격이나 겹침 없이 노래 전체를 포함해야 합니다.", "Los segmentos deben cubrir toda la canción sin huecos ni solapamientos.", "Les segments doivent couvrir toute la chanson sans intervalle ni chevauchement.", "MV-Segmente müssen den gesamten Song ohne Lücken oder Überlappungen abdecken.", "Os segmentos devem cobrir toda a música sem lacunas ou sobreposições.", "Сегменты должны покрывать всю песню без пробелов и перекрытий.", "يجب أن تغطي المقاطع الأغنية كاملة دون فجوات أو تداخل.", "MV खंड पूरे गीत को बिना अंतर या ओवरलैप के ढकें।"],
    "mv_frame": ["Each MV segment must last at least one frame.", "MV 每段不能短于一帧。", "MV 每段不能短於一幀。", "各 MV セグメントは 1 フレーム以上必要です。", "각 MV 구간은 최소 한 프레임이어야 합니다.", "Cada segmento debe durar al menos un fotograma.", "Chaque segment doit durer au moins une image.", "Jedes MV-Segment muss mindestens ein Bild dauern.", "Cada segmento deve durar pelo menos um quadro.", "Каждый сегмент должен длиться хотя бы один кадр.", "يجب ألا تقل مدة كل مقطع عن إطار واحد.", "हर MV खंड कम से कम एक फ़्रेम लंबा हो।"],
    "visual_missing": ["{title}: no video or image is available.", "{title}：没有可用的视频或画面。", "{title}：沒有可用的影片或畫面。", "{title}：利用できる動画や画像がありません。", "{title}: 사용 가능한 동영상이나 이미지가 없습니다.", "{title}: no hay vídeo ni imagen disponible.", "{title} : aucune vidéo ou image disponible.", "{title}: kein Video oder Bild verfügbar.", "{title}: não há vídeo ou imagem disponível.", "{title}: нет доступного видео или изображения.", "{title}: لا يتوفر فيديو أو صورة.", "{title}: वीडियो या छवि उपलब्ध नहीं है।"],
    "dialogue_audio_missing": ["{title}: dialogue has no voice or video audio. Add audio or enable placeholder drafts.", "{title}：对白没有配音或视频原声。请添加声音或启用占位草稿。", "{title}：對白沒有配音或影片原聲。請新增聲音或啟用預留草稿。", "{title}：台詞に音声がありません。音声を追加するか仮素材の下書きを有効にしてください。", "{title}: 대사 음성이 없습니다. 오디오를 추가하거나 자리 표시자 초안을 켜세요.", "{title}: diálogo sin audio. Añada audio o active los borradores con marcadores.", "{title} : dialogue sans audio. Ajoutez du son ou activez les brouillons provisoires.", "{title}: Dialog ohne Ton. Audio hinzufügen oder Platzhalterentwürfe aktivieren.", "{title}: diálogo sem áudio. Adicione áudio ou ative rascunhos com espaços reservados.", "{title}: диалог без звука. Добавьте звук или включите черновики с заглушками.", "{title}: الحوار بلا صوت. أضف صوتًا أو فعّل المسودات البديلة.", "{title}: संवाद में ऑडियो नहीं। ऑडियो जोड़ें या प्लेसहोल्डर ड्राफ़्ट चालू करें।"],
    "disk_space": ["Not enough disk space; at least {required} GB is needed.", "磁盘空间不足，至少需要 {required} GB。", "磁碟空間不足，至少需要 {required} GB。", "ディスク容量が不足しています。少なくとも {required} GB 必要です。", "디스크 공간이 부족합니다. 최소 {required} GB가 필요합니다.", "Espacio insuficiente; se necesitan al menos {required} GB.", "Espace insuffisant ; au moins {required} Go sont nécessaires.", "Nicht genug Speicherplatz; mindestens {required} GB erforderlich.", "Espaço insuficiente; são necessários pelo menos {required} GB.", "Недостаточно места; требуется хотя бы {required} ГБ.", "مساحة القرص غير كافية؛ يلزم {required} GB على الأقل.", "डिस्क स्थान कम है; कम से कम {required} GB चाहिए।"],
    "https_required": ["Media connections must use HTTPS.", "媒体连接必须使用 HTTPS。", "媒體連線必須使用 HTTPS。", "メディア接続には HTTPS が必要です。", "미디어 연결은 HTTPS를 사용해야 합니다.", "Las conexiones multimedia deben usar HTTPS.", "Les connexions multimédias doivent utiliser HTTPS.", "Medienverbindungen müssen HTTPS verwenden.", "As conexões de mídia devem usar HTTPS.", "Медиаподключения должны использовать HTTPS.", "يجب أن تستخدم اتصالات الوسائط HTTPS.", "मीडिया कनेक्शन में HTTPS आवश्यक है।"],
    "reference_audio_size": ["Reference audio must be WAV or MP3, at most 64 MB.", "参考音频须为 WAV 或 MP3，且不超过 64 MB。", "參考音訊須為 WAV 或 MP3，且不超過 64 MB。", "参照音声は 64 MB 以下の WAV または MP3 にしてください。", "참조 오디오는 64 MB 이하의 WAV 또는 MP3여야 합니다.", "El audio de referencia debe ser WAV o MP3 de hasta 64 MB.", "L’audio de référence doit être WAV ou MP3, de 64 Mo maximum.", "Referenzaudio muss WAV oder MP3 sein, höchstens 64 MB.", "O áudio de referência deve ser WAV ou MP3 de até 64 MB.", "Эталонное аудио: WAV или MP3, не более 64 МБ.", "الصوت المرجعي يجب أن يكون WAV أو MP3 بحجم لا يتجاوز 64 MB.", "संदर्भ ऑडियो WAV या MP3 हो, अधिकतम 64 MB।"],
    "voice_sample_short": ["A readable voice sample of at least 15 seconds is required.", "声音样本必须可读取且至少 15 秒。", "聲音樣本必須可讀取且至少 15 秒。", "15 秒以上の読み取り可能な音声サンプルが必要です。", "읽을 수 있는 최소 15초 음성 샘플이 필요합니다.", "Se requiere una muestra de voz legible de al menos 15 segundos.", "Un échantillon vocal lisible d’au moins 15 secondes est requis.", "Eine lesbare Sprachprobe von mindestens 15 Sekunden ist erforderlich.", "É necessária uma amostra de voz legível de pelo menos 15 segundos.", "Требуется читаемый образец голоса длительностью от 15 секунд.", "يلزم نموذج صوتي قابل للقراءة لا يقل عن 15 ثانية.", "कम से कम 15 सेकंड का पढ़ने योग्य आवाज़ नमूना चाहिए।"],
    "attachment_stale": ["The project or shot changed. The generated file was kept but was not attached automatically.", "工程或镜头已变化，生成文件已保留，但未自动关联。", "專案或鏡頭已變更，產生的檔案已保留，但未自動關聯。", "プロジェクトまたはショットが変更されました。生成ファイルは保存されましたが自動で関連付けられていません。", "프로젝트 또는 숏이 변경되었습니다. 생성 파일은 보관되었지만 자동 연결되지 않았습니다.", "El proyecto o plano cambió. Se conservó el archivo, pero no se vinculó automáticamente.", "Le projet ou le plan a changé. Le fichier a été conservé sans association automatique.", "Projekt oder Einstellung geändert. Die Datei wurde gespeichert, aber nicht automatisch zugeordnet.", "O projeto ou tomada mudou. O arquivo foi mantido, sem associação automática.", "Проект или кадр изменён. Файл сохранён, но не привязан автоматически.", "تغيّر المشروع أو اللقطة. حُفظ الملف دون ربطه تلقائيًا.", "प्रोजेक्ट या शॉट बदल गया। बनी फ़ाइल रखी गई, पर स्वतः जोड़ी नहीं गई।"],
    export_checking: ['Checking shots and local assets', '正在检查镜头与本地素材', '正在檢查鏡頭與本機素材', 'ショットとローカル素材を確認中', '숏과 로컬 미디어 확인 중', 'Comprobando planos y archivos locales', 'Vérification des plans et des médias locaux', 'Einstellungen und lokale Medien werden geprüft', 'Verificando tomadas e arquivos locais', 'Проверка кадров и локальных материалов', 'جارٍ فحص اللقطات والملفات المحلية', 'शॉट और स्थानीय सामग्री जाँची जा रही है'],
    export_rendering: ['Rendering shot {current} / {total}', '正在处理第 {current} / {total} 个镜头', '正在處理第 {current} / {total} 個鏡頭', 'ショット {current} / {total} を処理中', '숏 {current} / {total} 렌더링 중', 'Procesando plano {current} / {total}', 'Rendu du plan {current} / {total}', 'Einstellung {current} / {total} wird gerendert', 'Renderizando tomada {current} / {total}', 'Обработка кадра {current} / {total}', 'جارٍ معالجة اللقطة {current} / {total}', 'शॉट {current} / {total} रेंडर हो रहा है'],
    export_timeline: ['Shots are ready; merging the timeline', '镜头已就绪，正在合并时间线', '鏡頭已就緒，正在合併時間軸', 'ショットの処理完了。タイムラインを結合中', '숏 준비 완료, 타임라인 병합 중', 'Planos listos; combinando la línea de tiempo', 'Plans prêts ; assemblage de la chronologie', 'Einstellungen sind fertig; Zeitleiste wird zusammengefügt', 'Tomadas prontas; combinando a linha do tempo', 'Кадры готовы; объединение временной шкалы', 'اللقطات جاهزة؛ جارٍ دمج الخط الزمني', 'शॉट तैयार हैं; टाइमलाइन जोड़ी जा रही है'],
    export_muxing: ['Merging video and audio', '正在合并画面与声音', '正在合併畫面與聲音', '映像と音声を結合中', '영상과 음성 병합 중', 'Combinando vídeo y audio', 'Assemblage de la vidéo et de l’audio', 'Video und Audio werden zusammengefügt', 'Combinando vídeo e áudio', 'Объединение видео и звука', 'جارٍ دمج الفيديو والصوت', 'वीडियो और ऑडियो जोड़े जा रहे हैं'],
    export_subtitles: ['Writing the subtitle track', '正在写入可开关字幕轨道', '正在寫入可切換字幕軌', '字幕トラックを書き込み中', '자막 트랙 작성 중', 'Escribiendo la pista de subtítulos', 'Écriture de la piste de sous-titres', 'Untertitelspur wird geschrieben', 'Gravando a faixa de legendas', 'Запись дорожки субтитров', 'جارٍ كتابة مسار الترجمة', 'उपशीर्षक ट्रैक लिखा जा रहा है'],
    export_burning: ['Burning subtitles and finishing encoding', '正在烧录字幕并完成编码', '正在燒錄字幕並完成編碼', '字幕を焼き込み、エンコードを完了中', '자막 삽입 및 인코딩 완료 중', 'Incrustando subtítulos y finalizando la codificación', 'Incrustation des sous-titres et fin de l’encodage', 'Untertitel werden eingebrannt und Kodierung wird abgeschlossen', 'Incorporando legendas e concluindo a codificação', 'Встраивание субтитров и завершение кодирования', 'جارٍ دمج الترجمة وإنهاء الترميز', 'उपशीर्षक जोड़े जा रहे हैं और एन्कोडिंग पूरी हो रही है'],
    export_completed: ['Film exported', '成片已导出', '成片已匯出', '動画を書き出しました', '영상 내보내기 완료', 'Vídeo exportado', 'Film exporté', 'Film exportiert', 'Vídeo exportado', 'Фильм экспортирован', 'تم تصدير الفيلم', 'फ़िल्म निर्यात हो गई'],
    export_stopping: ['Stopping export safely', '正在安全停止导出', '正在安全停止匯出', '書き出しを安全に停止中', '내보내기를 안전하게 중지 중', 'Deteniendo la exportación de forma segura', 'Arrêt sécurisé de l’exportation', 'Export wird sicher beendet', 'Interrompendo a exportação com segurança', 'Безопасная остановка экспорта', 'جارٍ إيقاف التصدير بأمان', 'निर्यात सुरक्षित रूप से रोका जा रहा है'],
    export_cancelled: ['Export cancelled; temporary files were cleaned up', '导出已取消，临时文件已清理', '匯出已取消，暫存檔案已清理', '書き出しをキャンセルし、一時ファイルを削除しました', '내보내기 취소, 임시 파일 정리 완료', 'Exportación cancelada; archivos temporales eliminados', 'Exportation annulée ; fichiers temporaires supprimés', 'Export abgebrochen; temporäre Dateien wurden entfernt', 'Exportação cancelada; arquivos temporários removidos', 'Экспорт отменён; временные файлы удалены', 'أُلغي التصدير وحُذفت الملفات المؤقتة', 'निर्यात रद्द; अस्थायी फ़ाइलें हटाई गईं'],
    export_disconnected: ['The connection closed before export started', '连接已关闭，尚未开始导出', '連線已關閉，尚未開始匯出', '書き出し開始前に接続が閉じられました', '내보내기 시작 전에 연결이 종료되었습니다', 'La conexión se cerró antes de iniciar la exportación', 'La connexion a été fermée avant le début de l’exportation', 'Die Verbindung wurde vor Exportbeginn geschlossen', 'A conexão foi encerrada antes da exportação', 'Соединение закрыто до начала экспорта', 'أُغلق الاتصال قبل بدء التصدير', 'निर्यात शुरू होने से पहले कनेक्शन बंद हो गया'],
    export_interrupted: ['The app closed before export finished. You can start export again.', '应用在导出完成前退出，可以重新开始导出', '應用程式在匯出完成前結束，可以重新開始匯出', '書き出し完了前にアプリが終了しました。再度開始できます。', '내보내기 완료 전에 앱이 종료되었습니다. 다시 시작할 수 있습니다.', 'La aplicación se cerró antes de terminar. Puede volver a exportar.', 'L’application s’est fermée avant la fin. Vous pouvez relancer l’exportation.', 'Die App wurde vor Abschluss geschlossen. Sie können den Export erneut starten.', 'O aplicativo fechou antes de concluir. Você pode exportar novamente.', 'Приложение закрылось до завершения. Можно повторить экспорт.', 'أُغلق التطبيق قبل اكتمال التصدير. يمكنك بدء التصدير مجددًا.', 'निर्यात पूरा होने से पहले ऐप बंद हो गया। आप फिर शुरू कर सकते हैं।'],
    export_failed: ['Could not export the film. See diagnostic details.', '成片导出失败，请查看诊断详情', '成片匯出失敗，請查看診斷詳情', '動画を書き出せませんでした。診断情報を確認してください。', '영상을 내보내지 못했습니다. 진단 정보를 확인하세요.', 'No se pudo exportar el vídeo. Consulte los detalles.', 'Impossible d’exporter le film. Consultez le diagnostic.', 'Der Film konnte nicht exportiert werden. Siehe Diagnosedetails.', 'Não foi possível exportar o vídeo. Veja os detalhes.', 'Не удалось экспортировать фильм. См. сведения диагностики.', 'تعذّر تصدير الفيلم. راجع تفاصيل التشخيص.', 'फ़िल्म निर्यात नहीं हो सकी। निदान विवरण देखें।'],
    video_unavailable: ['{title}: video unavailable; trying a still image', '{title}：视频不可用，将尝试静态画面', '{title}：影片無法使用，將嘗試靜態畫面', '{title}：動画を利用できないため静止画を試します', '{title}: 동영상을 사용할 수 없어 정지 이미지를 시도합니다', '{title}: vídeo no disponible; se intentará usar una imagen', '{title} : vidéo indisponible ; tentative avec une image fixe', '{title}: Video nicht verfügbar; Standbild wird versucht', '{title}: vídeo indisponível; tentando uma imagem estática', '{title}: видео недоступно; будет использовано изображение', '{title}: الفيديو غير متاح؛ ستُجرّب صورة ثابتة', '{title}: वीडियो उपलब्ध नहीं; स्थिर छवि आज़माई जाएगी'],
    image_unavailable: ['{title}: image unavailable', '{title}：画面不可用', '{title}：畫面無法使用', '{title}：画像を利用できません', '{title}: 이미지를 사용할 수 없습니다', '{title}: imagen no disponible', '{title} : image indisponible', '{title}: Bild nicht verfügbar', '{title}: imagem indisponível', '{title}: изображение недоступно', '{title}: الصورة غير متاحة', '{title}: छवि उपलब्ध नहीं'],
    audio_unavailable: ['{title}: voice audio unavailable; using silence or the video audio', '{title}：配音不可用，将保留静音或视频原声', '{title}：配音無法使用，將保留靜音或影片原聲', '{title}：音声を利用できないため無音または動画の音声を使用します', '{title}: 음성을 사용할 수 없어 무음 또는 동영상 원본 소리를 사용합니다', '{title}: voz no disponible; se usará silencio o el audio del vídeo', '{title} : voix indisponible ; silence ou audio de la vidéo', '{title}: Sprachaufnahme nicht verfügbar; Stille oder Videoton wird verwendet', '{title}: voz indisponível; usando silêncio ou áudio do vídeo', '{title}: озвучка недоступна; тишина или звук видео', '{title}: التعليق الصوتي غير متاح؛ سيُستخدم الصمت أو صوت الفيديو', '{title}: वॉइस ऑडियो उपलब्ध नहीं; मौन या वीडियो का ऑडियो इस्तेमाल होगा'],
    music_unavailable: ['{title}: background music unavailable', '{title}：背景音乐不可用', '{title}：背景音樂無法使用', '{title}：BGMを利用できません', '{title}: 배경 음악을 사용할 수 없습니다', '{title}: música de fondo no disponible', '{title} : musique de fond indisponible', '{title}: Hintergrundmusik nicht verfügbar', '{title}: música de fundo indisponível', '{title}: фоновая музыка недоступна', '{title}: الموسيقى الخلفية غير متاحة', '{title}: पृष्ठभूमि संगीत उपलब्ध नहीं'],
    effect_unavailable: ['{title}: sound effect unavailable', '{title}：音效不可用', '{title}：音效無法使用', '{title}：効果音を利用できません', '{title}: 효과음을 사용할 수 없습니다', '{title}: efecto de sonido no disponible', '{title} : effet sonore indisponible', '{title}: Soundeffekt nicht verfügbar', '{title}: efeito sonoro indisponível', '{title}: звуковой эффект недоступен', '{title}: المؤثر الصوتي غير متاح', '{title}: ध्वनि प्रभाव उपलब्ध नहीं'],
    placeholder: ['{title}: using a solid-color placeholder', '{title}：使用纯色占位画面', '{title}：使用純色預留畫面', '{title}：単色の仮画像を使用します', '{title}: 단색 자리 표시자 사용', '{title}: se usa un fondo de color sólido', '{title} : utilisation d’un fond uni provisoire', '{title}: einfarbiger Platzhalter wird verwendet', '{title}: usando um espaço reservado de cor sólida', '{title}: используется одноцветная заглушка', '{title}: استخدام صورة بديلة بلون واحد', '{title}: एक रंग की प्लेसहोल्डर छवि इस्तेमाल हो रही है'],
    silent_dialogue: ['{title}: dialogue has no audio; this draft uses silence', '{title}：对白缺少声音，本次草稿为静音', '{title}：對白缺少聲音，本次草稿為靜音', '{title}：台詞の音声がないため、この下書きは無音です', '{title}: 대사 음성이 없어 이 초안은 무음입니다', '{title}: el diálogo no tiene audio; este borrador es silencioso', '{title} : dialogue sans audio ; ce brouillon est muet', '{title}: Dialog ohne Ton; dieser Entwurf ist stumm', '{title}: diálogo sem áudio; este rascunho usa silêncio', '{title}: диалог без звука; этот черновик будет беззвучным', '{title}: الحوار بلا صوت؛ هذه المسودة صامتة', '{title}: संवाद का ऑडियो नहीं है; यह ड्राफ़्ट मौन है'],
    no_subtitles: ['The project has no dialogue; no subtitle track was created', '工程没有对白，未生成字幕轨道', '專案沒有對白，未產生字幕軌', '台詞がないため字幕トラックは作成されませんでした', '대사가 없어 자막 트랙을 만들지 않았습니다', 'El proyecto no tiene diálogo; no se crearon subtítulos', 'Le projet n’a pas de dialogue ; aucun sous-titre créé', 'Das Projekt enthält keinen Dialog; keine Untertitelspur erstellt', 'O projeto não tem diálogo; nenhuma legenda foi criada', 'В проекте нет диалогов; субтитры не созданы', 'المشروع بلا حوار؛ لم يُنشأ مسار ترجمة', 'प्रोजेक्ट में संवाद नहीं हैं; उपशीर्षक ट्रैक नहीं बना'],
    save_warning: ['Could not save to {path}; the film remains in the project export folder', '无法保存到 {path}；成片保留在工程导出目录', '無法儲存至 {path}；成片保留在專案匯出目錄', '{path} に保存できませんでした。動画はプロジェクトの書き出しフォルダーにあります', '{path}에 저장하지 못했습니다. 영상은 프로젝트 내보내기 폴더에 있습니다', 'No se pudo guardar en {path}; el vídeo sigue en la carpeta de exportación del proyecto', 'Impossible d’enregistrer dans {path} ; le film reste dans le dossier d’exportation du projet', 'Speichern unter {path} fehlgeschlagen; der Film bleibt im Exportordner des Projekts', 'Não foi possível salvar em {path}; o vídeo permanece na pasta de exportação do projeto', 'Не удалось сохранить в {path}; фильм остался в папке экспорта проекта', 'تعذّر الحفظ في {path}؛ يبقى الفيلم في مجلد تصدير المشروع', '{path} में सहेज नहीं सके; फ़िल्म प्रोजेक्ट के निर्यात फ़ोल्डर में है'],
    revision_warning: ['The project is now r{current}; this film uses r{exported}', '工程已更新到 r{current}；本次成片使用 r{exported}', '專案已更新至 r{current}；本次成片使用 r{exported}', 'プロジェクトは r{current} に更新済みです。この動画は r{exported} を使用しています', '프로젝트는 r{current}입니다. 이 영상은 r{exported}를 사용합니다', 'El proyecto está en r{current}; este vídeo usa r{exported}', 'Le projet est en r{current} ; ce film utilise r{exported}', 'Das Projekt ist jetzt r{current}; dieser Film verwendet r{exported}', 'O projeto está em r{current}; este vídeo usa r{exported}', 'Проект обновлён до r{current}; фильм использует r{exported}', 'المشروع الآن r{current}؛ هذا الفيلم يستخدم r{exported}', 'प्रोजेक्ट अब r{current} है; इस फ़िल्म में r{exported} है'],
    export_notice: ['Export notice. See original details.', '导出提示，请查看原始详情', '匯出提示，請查看原始詳情', '書き出しの通知。元の詳細を確認してください。', '내보내기 알림. 원본 정보를 확인하세요.', 'Aviso de exportación. Consulte los detalles originales.', 'Avis d’exportation. Consultez les détails d’origine.', 'Exporthinweis. Siehe ursprüngliche Details.', 'Aviso de exportação. Veja os detalhes originais.', 'Уведомление об экспорте. См. исходные сведения.', 'تنبيه تصدير. راجع التفاصيل الأصلية.', 'निर्यात सूचना। मूल विवरण देखें।'],
};

const templates: Readonly<Record<string, readonly string[]>> = {
  "invalid": [
    "{field}: invalid.",
    "{field}无效。",
    "{field}無效。",
    "{field}が無効です。",
    "{field}: 유효하지 않습니다.",
    "{field}: no válido.",
    "{field} : invalide.",
    "{field}: ungültig.",
    "{field}: inválido.",
    "{field}: неверное значение.",
    "{field}: غير صالح.",
    "{field}: अमान्य है।"
  ],
  "missing": [
    "{field}: not found.",
    "找不到{field}。",
    "找不到{field}。",
    "{field}が見つかりません。",
    "{field}: 찾을 수 없습니다.",
    "{field}: no se encuentra.",
    "{field} : introuvable.",
    "{field}: nicht gefunden.",
    "{field}: não encontrado.",
    "{field}: не найдено.",
    "{field}: غير موجود.",
    "{field}: नहीं मिला।"
  ],
  "unsupported": [
    "{field}: not supported.",
    "不支持{field}。",
    "不支援{field}。",
    "{field}には対応していません。",
    "{field}: 지원하지 않습니다.",
    "{field}: no compatible.",
    "{field} : non pris en charge.",
    "{field}: nicht unterstützt.",
    "{field}: não compatível.",
    "{field}: не поддерживается.",
    "{field}: غير مدعوم.",
    "{field}: समर्थित नहीं है।"
  ],
  "unavailable": [
    "{field}: unavailable.",
    "{field}不可用。",
    "{field}無法使用。",
    "{field}を利用できません。",
    "{field}: 사용할 수 없습니다.",
    "{field}: no disponible.",
    "{field} : indisponible.",
    "{field}: nicht verfügbar.",
    "{field}: indisponível.",
    "{field}: недоступно.",
    "{field}: غير متاح.",
    "{field}: उपलब्ध नहीं है।"
  ],
  "required": [
    "{field}: required.",
    "需要{field}。",
    "需要{field}。",
    "{field}が必要です。",
    "{field}: 필요합니다.",
    "{field}: obligatorio.",
    "{field} : requis.",
    "{field}: erforderlich.",
    "{field}: obrigatório.",
    "{field}: требуется.",
    "{field}: مطلوب.",
    "{field}: आवश्यक है।"
  ],
  "absolute": [
    "{field}: select an absolute local path.",
    "{field}：请选择本机绝对路径。",
    "{field}：請選擇本機絕對路徑。",
    "{field}：ローカルの絶対パスを選択してください。",
    "{field}: 로컬 절대 경로를 선택하세요.",
    "{field}: seleccione una ruta local absoluta.",
    "{field} : sélectionnez un chemin local absolu.",
    "{field}: absoluten lokalen Pfad auswählen.",
    "{field}: selecione um caminho local absoluto.",
    "{field}: выберите абсолютный локальный путь.",
    "{field}: اختر مسارًا محليًا مطلقًا.",
    "{field}: स्थानीय पूर्ण पथ चुनें।"
  ],
  "file": [
    "{field}: must be a regular file.",
    "{field}：必须是普通文件。",
    "{field}：必須是一般檔案。",
    "{field}：通常のファイルを指定してください。",
    "{field}: 일반 파일이어야 합니다.",
    "{field}: debe ser un archivo normal.",
    "{field} : doit être un fichier ordinaire.",
    "{field}: muss eine reguläre Datei sein.",
    "{field}: deve ser um arquivo comum.",
    "{field}: требуется обычный файл.",
    "{field}: يجب أن يكون ملفًا عاديًا.",
    "{field}: सामान्य फ़ाइल होनी चाहिए।"
  ],
  "changed": [
    "{field}: changed. Recreate the task with the current input.",
    "{field}已变化，请使用当前输入重新创建任务。",
    "{field}已變更，請使用目前輸入重新建立任務。",
    "{field}が変更されました。現在の入力でタスクを再作成してください。",
    "{field}: 변경되었습니다. 현재 입력으로 작업을 다시 만드세요.",
    "{field}: ha cambiado. Vuelva a crear la tarea con los datos actuales.",
    "{field} : a changé. Recréez la tâche avec les données actuelles.",
    "{field}: geändert. Aufgabe mit aktuellen Eingaben neu erstellen.",
    "{field}: mudou. Recrie a tarefa com os dados atuais.",
    "{field}: изменено. Создайте задачу заново с актуальными данными.",
    "{field}: تغيّر. أعد إنشاء المهمة بالمدخلات الحالية.",
    "{field}: बदल गया है। वर्तमान इनपुट से कार्य फिर बनाएँ।"
  ],
  "limit": [
    "{field}: limit {limit} {unit}.",
    "{field}：上限为 {limit} {unit}。",
    "{field}：上限為 {limit} {unit}。",
    "{field}：上限は {limit} {unit} です。",
    "{field}: 최대 {limit} {unit}.",
    "{field}: límite de {limit} {unit}.",
    "{field} : limite de {limit} {unit}.",
    "{field}: Grenze {limit} {unit}.",
    "{field}: limite de {limit} {unit}.",
    "{field}: предел {limit} {unit}.",
    "{field}: الحد {limit} {unit}.",
    "{field}: सीमा {limit} {unit}।"
  ],
  "empty_limit": [
    "{field}: the file is empty or exceeds {limit} {unit}.",
    "{field}：文件为空或超过 {limit} {unit}。",
    "{field}：檔案為空或超過 {limit} {unit}。",
    "{field}：ファイルが空か {limit} {unit} を超えています。",
    "{field}: 파일이 비어 있거나 {limit} {unit}를 초과합니다.",
    "{field}: el archivo está vacío o supera {limit} {unit}.",
    "{field} : fichier vide ou supérieur à {limit} {unit}.",
    "{field}: Datei ist leer oder größer als {limit} {unit}.",
    "{field}: arquivo vazio ou maior que {limit} {unit}.",
    "{field}: файл пуст или превышает {limit} {unit}.",
    "{field}: الملف فارغ أو يتجاوز {limit} {unit}.",
    "{field}: फ़ाइल खाली है या {limit} {unit} से बड़ी है।"
  ],
  "busy": [
    "{field}: another operation is running. Wait or cancel it first.",
    "{field}：另一个操作仍在运行，请先等待完成或取消。",
    "{field}：另一項操作仍在執行，請先等待完成或取消。",
    "{field}：別の操作が実行中です。完了を待つかキャンセルしてください。",
    "{field}: 다른 작업이 실행 중입니다. 기다리거나 먼저 취소하세요.",
    "{field}: hay otra operación en curso. Espere o cancélela primero.",
    "{field} : une autre opération est en cours. Attendez ou annulez-la.",
    "{field}: ein anderer Vorgang läuft. Warten oder zuerst abbrechen.",
    "{field}: outra operação está em andamento. Aguarde ou cancele primeiro.",
    "{field}: выполняется другая операция. Дождитесь окончания или отмените её.",
    "{field}: عملية أخرى قيد التشغيل. انتظر أو ألغها أولًا.",
    "{field}: दूसरी प्रक्रिया चल रही है। पहले प्रतीक्षा करें या रद्द करें।"
  ],
  "failed": [
    "{field}: the operation failed. See diagnostic details.",
    "{field}操作失败，请查看诊断详情。",
    "{field}操作失敗，請查看診斷詳情。",
    "{field}の操作に失敗しました。診断情報を確認してください。",
    "{field}: 작업에 실패했습니다. 진단 정보를 확인하세요.",
    "{field}: falló la operación. Consulte los detalles.",
    "{field} : échec de l’opération. Consultez le diagnostic.",
    "{field}: Vorgang fehlgeschlagen. Siehe Diagnosedetails.",
    "{field}: a operação falhou. Veja os detalhes.",
    "{field}: операция не удалась. См. сведения диагностики.",
    "{field}: فشلت العملية. راجع تفاصيل التشخيص.",
    "{field}: प्रक्रिया विफल। निदान विवरण देखें।"
  ],
  "outside": [
    "{field}: must remain inside the project media directory.",
    "{field}必须位于工程媒体目录内。",
    "{field}必須位於專案媒體目錄內。",
    "{field}はプロジェクトのメディアフォルダー内に配置してください。",
    "{field}: 프로젝트 미디어 폴더 안에 있어야 합니다.",
    "{field}: debe permanecer en la carpeta de medios del proyecto.",
    "{field} : doit rester dans le dossier média du projet.",
    "{field}: muss im Medienordner des Projekts bleiben.",
    "{field}: deve ficar na pasta de mídia do projeto.",
    "{field}: должно находиться в папке материалов проекта.",
    "{field}: يجب أن يبقى داخل مجلد وسائط المشروع.",
    "{field}: प्रोजेक्ट मीडिया फ़ोल्डर में होना चाहिए।"
  ],
  "symlink": [
    "{field}: symbolic links are not allowed.",
    "{field}不允许使用符号链接。",
    "{field}不允許使用符號連結。",
    "{field}ではシンボリックリンクを使用できません。",
    "{field}: 심볼릭 링크를 사용할 수 없습니다.",
    "{field}: no se permiten enlaces simbólicos.",
    "{field} : liens symboliques interdits.",
    "{field}: symbolische Links sind nicht erlaubt.",
    "{field}: links simbólicos não são permitidos.",
    "{field}: символические ссылки запрещены.",
    "{field}: الروابط الرمزية غير مسموحة.",
    "{field}: प्रतीकात्मक लिंक की अनुमति नहीं है।"
  ],
  "format": [
    "{field}: supported formats: {formats}.",
    "{field}支持的格式：{formats}。",
    "{field}支援的格式：{formats}。",
    "{field}の対応形式：{formats}。",
    "{field}: 지원 형식: {formats}.",
    "{field}: formatos compatibles: {formats}.",
    "{field} : formats pris en charge : {formats}.",
    "{field}: unterstützte Formate: {formats}.",
    "{field}: formatos aceitos: {formats}.",
    "{field}: поддерживаемые форматы: {formats}.",
    "{field}: الصيغ المدعومة: {formats}.",
    "{field}: समर्थित प्रारूप: {formats}।"
  ],
  "cancelled": [
    "{field}: cancelled.",
    "{field}已取消。",
    "{field}已取消。",
    "{field}をキャンセルしました。",
    "{field}: 취소되었습니다.",
    "{field}: cancelado.",
    "{field} : annulé.",
    "{field}: abgebrochen.",
    "{field}: cancelado.",
    "{field}: отменено.",
    "{field}: أُلغي.",
    "{field}: रद्द हो गया।"
  ],
  "timeout": [
    "{field}: timed out.",
    "{field}超时。",
    "{field}逾時。",
    "{field}がタイムアウトしました。",
    "{field}: 시간이 초과되었습니다.",
    "{field}: se agotó el tiempo.",
    "{field} : délai dépassé.",
    "{field}: Zeitüberschreitung.",
    "{field}: tempo esgotado.",
    "{field}: время ожидания истекло.",
    "{field}: انتهت المهلة.",
    "{field}: समय समाप्त हो गया।"
  ],
  "http": [
    "{field}: HTTP {status}.",
    "{field}：HTTP {status}。",
    "{field}：HTTP {status}。",
    "{field}：HTTP {status}。",
    "{field}: HTTP {status}.",
    "{field}: HTTP {status}.",
    "{field} : HTTP {status}.",
    "{field}: HTTP {status}.",
    "{field}: HTTP {status}.",
    "{field}: HTTP {status}.",
    "{field}: HTTP {status}.",
    "{field}: HTTP {status}।"
  ],
  "locked": [
    "{field}: the write lock was lost. Refresh before trying again.",
    "{field}写入锁已失效，请刷新后重试。",
    "{field}寫入鎖已失效，請重新整理後再試。",
    "{field}の書き込みロックが失われました。更新してから再試行してください。",
    "{field}: 쓰기 잠금이 해제되었습니다. 새로 고친 후 다시 시도하세요.",
    "{field}: se perdió el bloqueo. Actualice antes de reintentar.",
    "{field} : verrou perdu. Actualisez avant de réessayer.",
    "{field}: Schreibsperre verloren. Vor erneutem Versuch aktualisieren.",
    "{field}: bloqueio de gravação perdido. Atualize antes de tentar novamente.",
    "{field}: блокировка записи потеряна. Обновите перед повтором.",
    "{field}: فُقد قفل الكتابة. حدّث قبل المحاولة مجددًا.",
    "{field}: लेखन लॉक खो गया। फिर कोशिश से पहले रीफ़्रेश करें।"
  ],
  "confirm_platform": [
    "Confirm payment from the platform balance before creating this media task.",
    "请先确认使用平台余额支付此媒体任务。",
    "請先確認使用平台餘額支付此媒體任務。",
    "このメディアタスクの作成前にプラットフォーム残高での支払いを確認してください。",
    "미디어 작업을 만들기 전에 플랫폼 잔액 결제를 확인하세요.",
    "Confirme el pago con el saldo de la plataforma antes de crear esta tarea.",
    "Confirmez le paiement avec le solde de la plateforme avant de créer cette tâche.",
    "Zahlung aus dem Plattformguthaben vor Erstellung dieser Aufgabe bestätigen.",
    "Confirme o pagamento com o saldo da plataforma antes de criar esta tarefa.",
    "Подтвердите оплату с баланса платформы перед созданием задачи.",
    "أكد الدفع من رصيد المنصة قبل إنشاء مهمة الوسائط.",
    "मीडिया कार्य बनाने से पहले प्लेटफ़ॉर्म शेष से भुगतान की पुष्टि करें।"
  ],
  "confirm_provider": [
    "Confirm direct provider billing before creating this media task.",
    "请先确认由供应商直接计费再创建媒体任务。",
    "請先確認由供應商直接計費再建立媒體任務。",
    "メディアタスクの作成前にプロバイダーによる直接課金を確認してください。",
    "미디어 작업을 만들기 전에 공급자 직접 청구를 확인하세요.",
    "Confirme la facturación directa del proveedor antes de crear esta tarea.",
    "Confirmez la facturation directe du fournisseur avant de créer cette tâche.",
    "Direkte Abrechnung durch den Anbieter vor Erstellung der Aufgabe bestätigen.",
    "Confirme a cobrança direta pelo provedor antes de criar esta tarefa.",
    "Подтвердите прямую оплату поставщику перед созданием задачи.",
    "أكد فوترة مزوّد الخدمة المباشرة قبل إنشاء المهمة.",
    "कार्य बनाने से पहले प्रदाता की सीधे बिलिंग की पुष्टि करें।"
  ],
  "local_billing": [
    "Local subtitle and preview tasks cannot use remote billing.",
    "本地字幕和预览任务不能使用远程计费。",
    "本機字幕和預覽任務不能使用遠端計費。",
    "ローカルの字幕・プレビュータスクはリモート課金を使用できません。",
    "로컬 자막 및 미리보기 작업은 원격 청구를 사용할 수 없습니다.",
    "Las tareas locales de subtítulos y vista previa no pueden usar facturación remota.",
    "Les tâches locales de sous-titres et d’aperçu ne peuvent pas être facturées à distance.",
    "Lokale Untertitel- und Vorschauaufgaben können nicht remote abgerechnet werden.",
    "Tarefas locais de legendas e prévia não podem usar cobrança remota.",
    "Локальные задачи субтитров и предпросмотра не могут оплачиваться удалённо.",
    "لا يمكن فوترة مهام الترجمة والمعاينة المحلية عن بُعد.",
    "स्थानीय उपशीर्षक और पूर्वावलोकन कार्यों में दूरस्थ बिलिंग नहीं हो सकती।"
  ]
};
const subjects: Readonly<Record<string, readonly string[]>> = {
  "request": [
    "Media task input",
    "媒体任务输入",
    "媒體任務輸入",
    "メディアタスクの入力",
    "미디어 작업 입력",
    "Entrada de la tarea multimedia",
    "Entrée de la tâche multimédia",
    "Eingabe der Medienaufgabe",
    "Entrada da tarefa de mídia",
    "Входные данные медиазадачи",
    "مدخلات مهمة الوسائط",
    "मीडिया कार्य इनपुट"
  ],
  "ffmpeg_path": [
    "FFmpeg path",
    "FFmpeg 路径",
    "FFmpeg 路徑",
    "FFmpeg パス",
    "FFmpeg 경로",
    "Ruta de FFmpeg",
    "Chemin de FFmpeg",
    "FFmpeg-Pfad",
    "Caminho do FFmpeg",
    "Путь FFmpeg",
    "مسار FFmpeg",
    "FFmpeg पथ"
  ],
  "comfy_config": [
    "ComfyUI address and workflow",
    "ComfyUI 地址和工作流",
    "ComfyUI 位址和工作流程",
    "ComfyUI アドレスとワークフロー",
    "ComfyUI 주소 및 워크플로",
    "Dirección y flujo de ComfyUI",
    "Adresse et workflow ComfyUI",
    "ComfyUI-Adresse und Workflow",
    "Endereço e fluxo do ComfyUI",
    "Адрес и процесс ComfyUI",
    "عنوان وسير عمل ComfyUI",
    "ComfyUI पता और वर्कफ़्लो"
  ],
  "workflow": [
    "ComfyUI workflow JSON",
    "ComfyUI 工作流 JSON",
    "ComfyUI 工作流程 JSON",
    "ComfyUI ワークフロー JSON",
    "ComfyUI 워크플로 JSON",
    "JSON del flujo de ComfyUI",
    "JSON du workflow ComfyUI",
    "ComfyUI-Workflow-JSON",
    "JSON do fluxo ComfyUI",
    "JSON процесса ComfyUI",
    "JSON لسير عمل ComfyUI",
    "ComfyUI वर्कफ़्लो JSON"
  ],
  "asr": [
    "Local transcription component and model",
    "本地转录组件和模型",
    "本機轉錄元件和模型",
    "ローカル文字起こしコンポーネントとモデル",
    "로컬 음성 인식 구성 요소 및 모델",
    "Componente y modelo de transcripción local",
    "Composant et modèle de transcription locale",
    "Lokale Transkriptionskomponente und Modell",
    "Componente e modelo de transcrição local",
    "Компонент и модель локальной транскрипции",
    "مكوّن ونموذج النسخ المحلي",
    "स्थानीय लिप्यंतरण घटक और मॉडल"
  ],
  "runtime": [
    "Media runtime settings",
    "媒体运行时设置",
    "媒體執行環境設定",
    "メディア実行環境の設定",
    "미디어 런타임 설정",
    "Configuración del entorno multimedia",
    "Paramètres de l’environnement multimédia",
    "Medien-Laufzeiteinstellungen",
    "Configurações do ambiente de mídia",
    "Настройки среды мультимедиа",
    "إعدادات بيئة تشغيل الوسائط",
    "मीडिया रनटाइम सेटिंग"
  ],
  "export": [
    "Film export",
    "成片导出",
    "成片匯出",
    "動画の書き出し",
    "영상 내보내기",
    "Exportación del vídeo",
    "Exportation du film",
    "Filmexport",
    "Exportação do vídeo",
    "Экспорт фильма",
    "تصدير الفيلم",
    "फ़िल्म निर्यात"
  ],
  "project": [
    "Comic project",
    "漫剧工程",
    "漫劇專案",
    "コミックプロジェクト",
    "만화 프로젝트",
    "Proyecto de cómic",
    "Projet de bande dessinée",
    "Comicprojekt",
    "Projeto de quadrinhos",
    "Проект комикса",
    "مشروع القصص المصورة",
    "कॉमिक प्रोजेक्ट"
  ],
  "episode": [
    "Episode",
    "剧集",
    "劇集",
    "エピソード",
    "에피소드",
    "Episodio",
    "Épisode",
    "Episode",
    "Episódio",
    "Эпизод",
    "الحلقة",
    "एपिसोड"
  ],
  "shot": [
    "Shot",
    "镜头",
    "鏡頭",
    "ショット",
    "숏",
    "Plano",
    "Plan",
    "Einstellung",
    "Tomada",
    "Кадр",
    "اللقطة",
    "शॉट"
  ],
  "canvas": [
    "Canvas dimensions",
    "画布尺寸",
    "畫布尺寸",
    "キャンバスの寸法",
    "캔버스 크기",
    "Dimensiones del lienzo",
    "Dimensions du canevas",
    "Leinwandabmessungen",
    "Dimensões da tela",
    "Размеры холста",
    "أبعاد اللوحة",
    "कैनवास माप"
  ],
  "song_segments": [
    "MV song and segments",
    "MV 歌曲与分段",
    "MV 歌曲與分段",
    "MV の楽曲とセグメント",
    "MV 노래 및 구간",
    "Canción y segmentos del MV",
    "Chanson et segments du clip",
    "MV-Song und Segmente",
    "Música e segmentos do MV",
    "Песня и сегменты клипа",
    "أغنية ومقاطع الفيديو الموسيقي",
    "MV गीत और खंड"
  ],
  "canvas_duration": [
    "Shot canvas or duration",
    "镜头画布或时长",
    "鏡頭畫布或時長",
    "ショットのキャンバスまたは長さ",
    "숏 캔버스 또는 길이",
    "Lienzo o duración del plano",
    "Canevas ou durée du plan",
    "Leinwand oder Dauer der Einstellung",
    "Tela ou duração da tomada",
    "Холст или длительность кадра",
    "لوحة اللقطة أو مدتها",
    "शॉट कैनवास या अवधि"
  ],
  "music_mode": [
    "Music mode and API configuration",
    "音乐模式及接口配置",
    "音樂模式及介面設定",
    "音楽モードと API 設定",
    "음악 모드 및 API 설정",
    "Modo musical y configuración de API",
    "Mode musical et configuration API",
    "Musikmodus und API-Konfiguration",
    "Modo musical e configuração de API",
    "Музыкальный режим и настройки API",
    "وضع الموسيقى وإعدادات API",
    "संगीत मोड और API कॉन्फ़िगरेशन"
  ],
  "reference_audio": [
    "Reference audio",
    "参考音频",
    "參考音訊",
    "参照音声",
    "참조 오디오",
    "Audio de referencia",
    "Audio de référence",
    "Referenzaudio",
    "Áudio de referência",
    "Эталонное аудио",
    "الصوت المرجعي",
    "संदर्भ ऑडियो"
  ],
  "media_route": [
    "Selected media route",
    "所选媒体线路",
    "所選媒體路由",
    "選択したメディアルート",
    "선택한 미디어 경로",
    "Ruta multimedia seleccionada",
    "Route multimédia sélectionnée",
    "Ausgewählte Medienroute",
    "Rota de mídia selecionada",
    "Выбранный маршрут мультимедиа",
    "مسار الوسائط المحدد",
    "चयनित मीडिया रूट"
  ],
  "format": [
    "Media format",
    "媒体格式",
    "媒體格式",
    "メディア形式",
    "미디어 형식",
    "Formato multimedia",
    "Format multimédia",
    "Medienformat",
    "Formato de mídia",
    "Формат мультимедиа",
    "صيغة الوسائط",
    "मीडिया प्रारूप"
  ],
  "model": [
    "Selected media model",
    "所选媒体模型",
    "所選媒體模型",
    "選択したメディアモデル",
    "선택한 미디어 모델",
    "Modelo multimedia seleccionado",
    "Modèle multimédia sélectionné",
    "Ausgewähltes Medienmodell",
    "Modelo de mídia selecionado",
    "Выбранная медиамодель",
    "نموذج الوسائط المحدد",
    "चयनित मीडिया मॉडल"
  ],
  "dialogue_time": [
    "Dialogue timestamps",
    "对白时间码",
    "對白時間碼",
    "台詞のタイムコード",
    "대사 타임코드",
    "Marcas de tiempo del diálogo",
    "Horodatage des dialogues",
    "Dialogzeitmarken",
    "Marcas de tempo do diálogo",
    "Временные метки диалогов",
    "توقيتات الحوار",
    "संवाद समय चिह्न"
  ],
  "shot_media": [
    "Shot assets or duration",
    "镜头素材或时长",
    "鏡頭素材或時長",
    "ショットの素材または長さ",
    "숏 미디어 또는 길이",
    "Archivos o duración del plano",
    "Médias ou durée du plan",
    "Medien oder Dauer der Einstellung",
    "Arquivos ou duração da tomada",
    "Материалы или длительность кадра",
    "ملفات اللقطة أو مدتها",
    "शॉट सामग्री या अवधि"
  ],
  "connection": [
    "Media connection",
    "媒体连接",
    "媒體連線",
    "メディア接続",
    "미디어 연결",
    "Conexión multimedia",
    "Connexion multimédia",
    "Medienverbindung",
    "Conexão de mídia",
    "Медиаподключение",
    "اتصال الوسائط",
    "मीडिया कनेक्शन"
  ],
  "credential": [
    "Media connection credential in the system keychain",
    "系统钥匙串中的媒体连接凭据",
    "系統鑰匙圈中的媒體連線憑證",
    "システムキーチェーン内のメディア接続資格情報",
    "시스템 키체인의 미디어 연결 자격 증명",
    "Credencial multimedia del llavero del sistema",
    "Identifiant multimédia du trousseau système",
    "Medienzugangsdaten im Systemschlüsselbund",
    "Credencial de mídia nas chaves do sistema",
    "Учётные данные медиаподключения в системном хранилище",
    "بيانات اعتماد الوسائط في سلسلة مفاتيح النظام",
    "सिस्टम कीचेन में मीडिया कनेक्शन क्रेडेंशियल"
  ],
  "path": [
    "Media file path",
    "媒体文件路径",
    "媒體檔案路徑",
    "メディアファイルのパス",
    "미디어 파일 경로",
    "Ruta del archivo multimedia",
    "Chemin du fichier multimédia",
    "Pfad der Mediendatei",
    "Caminho do arquivo de mídia",
    "Путь к медиафайлу",
    "مسار ملف الوسائط",
    "मीडिया फ़ाइल पथ"
  ],
  "asset": [
    "{title}: media asset",
    "{title}：媒体素材",
    "{title}：媒體素材",
    "{title}：メディア素材",
    "{title}: 미디어 파일",
    "{title}: archivo multimedia",
    "{title} : média",
    "{title}: Mediendatei",
    "{title}: arquivo de mídia",
    "{title}: медиафайл",
    "{title}: ملف الوسائط",
    "{title}: मीडिया सामग्री"
  ],
  "subtitles": [
    "Subtitle cues",
    "字幕条目",
    "字幕項目",
    "字幕キュー",
    "자막 항목",
    "Entradas de subtítulos",
    "Repères de sous-titres",
    "Untertitel-Einträge",
    "Entradas de legenda",
    "Реплики субтитров",
    "مقاطع الترجمة",
    "उपशीर्षक अंश"
  ],
  "output": [
    "Generated media file",
    "生成的媒体文件",
    "產生的媒體檔案",
    "生成されたメディアファイル",
    "생성된 미디어 파일",
    "Archivo multimedia generado",
    "Fichier multimédia généré",
    "Generierte Mediendatei",
    "Arquivo de mídia gerado",
    "Созданный медиафайл",
    "ملف الوسائط المُنشأ",
    "बनाई गई मीडिया फ़ाइल"
  ],
  "endpoint": [
    "Media API URL",
    "媒体 API 地址",
    "媒體 API 位址",
    "メディア API URL",
    "미디어 API URL",
    "URL de API multimedia",
    "URL de l’API multimédia",
    "Medien-API-URL",
    "URL da API de mídia",
    "URL медиа-API",
    "عنوان API للوسائط",
    "मीडिया API URL"
  ],
  "image": [
    "Reference image",
    "参考图",
    "參考圖",
    "参照画像",
    "참조 이미지",
    "Imagen de referencia",
    "Image de référence",
    "Referenzbild",
    "Imagem de referência",
    "Эталонное изображение",
    "الصورة المرجعية",
    "संदर्भ छवि"
  ],
  "first_frame": [
    "First frame before setting an end frame",
    "设置尾帧前的首帧",
    "設定尾幀前的首幀",
    "終了フレーム設定前の開始フレーム",
    "마지막 프레임 설정 전 첫 프레임",
    "Primer fotograma antes de configurar el final",
    "Première image avant de définir la dernière",
    "Startbild vor Festlegung des Endbilds",
    "Primeiro quadro antes de definir o último",
    "Начальный кадр перед заданием конечного",
    "الإطار الأول قبل تحديد الإطار الأخير",
    "अंतिम फ़्रेम से पहले पहला फ़्रेम"
  ],
  "job_id": [
    "Provider task ID",
    "供应商任务编号",
    "供應商任務編號",
    "プロバイダーのタスク ID",
    "공급자 작업 ID",
    "ID de tarea del proveedor",
    "ID de tâche du fournisseur",
    "Aufgaben-ID des Anbieters",
    "ID da tarefa do provedor",
    "ID задачи поставщика",
    "معرّف مهمة المزوّد",
    "प्रदाता कार्य ID"
  ],
  "download": [
    "Media download",
    "媒体下载",
    "媒體下載",
    "メディアのダウンロード",
    "미디어 다운로드",
    "Descarga multimedia",
    "Téléchargement multimédia",
    "Medien-Download",
    "Download de mídia",
    "Загрузка мультимедиа",
    "تنزيل الوسائط",
    "मीडिया डाउनलोड"
  ],
  "api_key": [
    "API key",
    "API 密钥",
    "API 金鑰",
    "API キー",
    "API 키",
    "Clave API",
    "Clé API",
    "API-Schlüssel",
    "Chave API",
    "Ключ API",
    "مفتاح API",
    "API कुंजी"
  ],
  "ffmpeg": [
    "FFmpeg",
    "FFmpeg",
    "FFmpeg",
    "FFmpeg",
    "FFmpeg",
    "FFmpeg",
    "FFmpeg",
    "FFmpeg",
    "FFmpeg",
    "FFmpeg",
    "FFmpeg",
    "FFmpeg"
  ],
  "comfy": [
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
  ],
  "provider": [
    "{provider}",
    "{provider}",
    "{provider}",
    "{provider}",
    "{provider}",
    "{provider}",
    "{provider}",
    "{provider}",
    "{provider}",
    "{provider}",
    "{provider}",
    "{provider}"
  ]
};
export function formatPlatformMediaError(messageKey: string, params: Params = {}, locale = 'en'): string | undefined {
    if (messageKey.startsWith('platform_media.archive.')) return formatPlatformMediaArchiveError(messageKey, params, locale);
    if (!messageKey.startsWith('platform_media.')) return undefined;
    const key = messageKey.slice('platform_media.'.length);
    const row = Object.prototype.hasOwnProperty.call(PLATFORM_MEDIA_MESSAGES, key) ? PLATFORM_MEDIA_MESSAGES[key] : undefined;
    const reason = Object.prototype.hasOwnProperty.call(PLATFORM_MEDIA_REASONS, key) ? PLATFORM_MEDIA_REASONS[key] : undefined;
    const template = row || (reason && templates[reason.template]);
    if (!template) return undefined;
    const index = PLATFORM_MEDIA_LOCALES.indexOf(locale as typeof PLATFORM_MEDIA_LOCALES[number]);
    const at = index < 0 ? 0 : index;
    const rawParams: Params = { ...reason?.params, ...params };
    const field = reason?.subject ? subjects[reason.subject][at].replace(/\{(\w+)\}/g, (token, name: string) => String(rawParams[name] ?? token)) : undefined;
    const values: Params = { ...rawParams, ...(field === undefined ? {} : { field }) };
    const interpolate = (text: string): string => text.replace(/\{(\w+)\}/g, (token, name: string) => String(values[name] ?? token));
    return interpolate(template[at]);
}

export const PLATFORM_MEDIA_REASONS: Readonly<Record<string, { template: string; subject?: string; params?: Params }>> = {
  "request_invalid": {
    "template": "invalid",
    "subject": "request"
  },
  "ffmpeg_path_invalid": {
    "template": "invalid",
    "subject": "ffmpeg_path"
  },
  "ffmpeg_path_absolute": {
    "template": "absolute",
    "subject": "ffmpeg_path"
  },
  "ffmpeg_path_not_file": {
    "template": "file",
    "subject": "ffmpeg_path"
  },
  "comfy_config_pair_required": {
    "template": "required",
    "subject": "comfy_config"
  },
  "workflow_absolute": {
    "template": "absolute",
    "subject": "workflow"
  },
  "asr_pair_required": {
    "template": "required",
    "subject": "asr"
  },
  "asr_absolute": {
    "template": "absolute",
    "subject": "asr"
  },
  "asr_not_file": {
    "template": "file",
    "subject": "asr"
  },
  "runtime_save_failed": {
    "template": "failed",
    "subject": "runtime"
  },
  "export_settings_invalid": {
    "template": "invalid",
    "subject": "export"
  },
  "export_busy": {
    "template": "busy",
    "subject": "export"
  },
  "project_missing": {
    "template": "missing",
    "subject": "project"
  },
  "episode_missing": {
    "template": "missing",
    "subject": "episode"
  },
  "export_shots_missing": {
    "template": "missing",
    "subject": "shot"
  },
  "export_id_invalid": {
    "template": "invalid",
    "subject": "export"
  },
  "export_missing": {
    "template": "missing",
    "subject": "export"
  },
  "project_changed": {
    "template": "changed",
    "subject": "project"
  },
  "shot_missing": {
    "template": "missing",
    "subject": "shot"
  },
  "canvas_changed": {
    "template": "changed",
    "subject": "canvas"
  },
  "mv_segments_changed": {
    "template": "changed",
    "subject": "song_segments"
  },
  "shot_canvas_duration_changed": {
    "template": "changed",
    "subject": "canvas_duration"
  },
  "music_mode_missing": {
    "template": "missing",
    "subject": "music_mode"
  },
  "music_mode_unsupported": {
    "template": "unsupported",
    "subject": "music_mode"
  },
  "music_mode_required": {
    "template": "required",
    "subject": "music_mode"
  },
  "managed_music_mode_missing": {
    "template": "missing",
    "subject": "music_mode"
  },
  "music_model_mode_unsupported": {
    "template": "unsupported",
    "subject": "music_mode"
  },
  "reference_audio_missing": {
    "template": "missing",
    "subject": "reference_audio"
  },
  "reference_audio_changed": {
    "template": "changed",
    "subject": "reference_audio"
  },
  "managed_effects_unsupported": {
    "template": "unsupported",
    "subject": "media_route"
  },
  "media_model_unsupported": {
    "template": "unsupported",
    "subject": "model"
  },
  "dialogue_time_changed": {
    "template": "changed",
    "subject": "dialogue_time"
  },
  "shot_media_changed": {
    "template": "changed",
    "subject": "shot_media"
  },
  "media_connection_missing": {
    "template": "missing",
    "subject": "connection"
  },
  "media_credential_missing": {
    "template": "missing",
    "subject": "credential"
  },
  "export_process_busy": {
    "template": "busy",
    "subject": "export"
  },
  "export_lock_lost": {
    "template": "locked",
    "subject": "export"
  },
  "export_history_lock_lost": {
    "template": "locked",
    "subject": "export"
  },
  "export_history_busy": {
    "template": "busy",
    "subject": "export"
  },
  "media_directory_outside": {
    "template": "outside",
    "subject": "path"
  },
  "export_directory_outside": {
    "template": "outside",
    "subject": "path"
  },
  "export_path_invalid": {
    "template": "invalid",
    "subject": "path"
  },
  "mv_song_missing": {
    "template": "missing",
    "subject": "song_segments"
  },
  "mv_song_unavailable": {
    "template": "unavailable",
    "subject": "song_segments"
  },
  "export_mp4_invalid": {
    "template": "invalid",
    "subject": "output"
  },
  "media_cancelled": {
    "template": "cancelled",
    "subject": "request"
  },
  "comfy_missing": {
    "template": "missing",
    "subject": "comfy"
  },
  "effect_model_protocol_mismatch": {
    "template": "unsupported",
    "subject": "model"
  },
  "music_model_protocol_mismatch": {
    "template": "unsupported",
    "subject": "model"
  },
  "music_protocol_missing": {
    "template": "missing",
    "subject": "music_mode"
  },
  "remote_kind_unsupported": {
    "template": "unsupported",
    "subject": "media_route"
  },
  "managed_route_invalid": {
    "template": "invalid",
    "subject": "media_route"
  },
  "media_dispatch_stopped": {
    "template": "cancelled",
    "subject": "request"
  },
  "output_format_unsupported": {
    "template": "unsupported",
    "subject": "format"
  },
  "managed_media_offline": {
    "template": "unavailable",
    "subject": "media_route"
  },
  "api_unavailable": {
    "template": "unavailable",
    "subject": "endpoint"
  },
  "media_template_missing": {
    "template": "missing",
    "subject": "endpoint"
  },
  "first_frame_required": {
    "template": "required",
    "subject": "first_frame"
  },
  "media_timeout": {
    "template": "timeout",
    "subject": "request"
  },
  "service_timeout": {
    "template": "timeout",
    "subject": "endpoint"
  },
  "managed_media_timeout": {
    "template": "timeout",
    "subject": "request"
  },
  "output_invalid": {
    "template": "invalid",
    "subject": "output"
  },
  "output_symlink": {
    "template": "symlink",
    "subject": "output"
  },
  "input_path_invalid": {
    "template": "invalid",
    "subject": "path"
  },
  "input_outside": {
    "template": "outside",
    "subject": "path"
  },
  "input_symlink": {
    "template": "symlink",
    "subject": "path"
  },
  "ffmpeg_start_failed": {
    "template": "failed",
    "subject": "ffmpeg"
  },
  "ffmpeg_timeout": {
    "template": "timeout",
    "subject": "ffmpeg"
  },
  "ffmpeg_render_failed": {
    "template": "failed",
    "subject": "ffmpeg"
  },
  "import_path_invalid": {
    "template": "invalid",
    "subject": "path"
  },
  "import_path_outside": {
    "template": "outside",
    "subject": "path"
  },
  "media_operation_failed": {
    "template": "failed",
    "subject": "request"
  },
  "runtime_size_invalid": {
    "template": "invalid",
    "subject": "runtime"
  },
  "runtime_corrupt": {
    "template": "invalid",
    "subject": "runtime"
  },
  "runtime_format_invalid": {
    "template": "invalid",
    "subject": "runtime"
  },
  "runtime_version_unsupported": {
    "template": "unsupported",
    "subject": "runtime"
  },
  "runtime_ffmpeg_path_invalid": {
    "template": "invalid",
    "subject": "ffmpeg_path"
  },
  "runtime_comfy_invalid": {
    "template": "invalid",
    "subject": "comfy_config"
  },
  "runtime_comfy_url_invalid": {
    "template": "invalid",
    "subject": "endpoint"
  },
  "runtime_asr_invalid": {
    "template": "invalid",
    "subject": "asr"
  },
  "runtime_asr_path_invalid": {
    "template": "invalid",
    "subject": "asr"
  },
  "workflow_path_invalid": {
    "template": "invalid",
    "subject": "workflow"
  },
  "workflow_path_not_file": {
    "template": "file",
    "subject": "workflow"
  },
  "workflow_json_invalid": {
    "template": "invalid",
    "subject": "workflow"
  },
  "stock_key_invalid": {
    "template": "invalid",
    "subject": "api_key"
  },
  "stock_provider_invalid": {
    "template": "invalid",
    "subject": "provider"
  },
  "stock_response_invalid": {
    "template": "invalid",
    "subject": "provider"
  },
  "stock_download_url_invalid": {
    "template": "invalid",
    "subject": "endpoint"
  },
  "receipt_media_unavailable": {
    "template": "unavailable",
    "subject": "output"
  },
  "route_kind_unsupported": {
    "template": "unsupported",
    "subject": "media_route"
  },
  "export_shots_limit": {
    "template": "limit",
    "subject": "shot",
    "params": {
      "limit": 5000,
      "unit": ""
    }
  },
  "export_duration_limit": {
    "template": "limit",
    "subject": "export",
    "params": {
      "limit": 24,
      "unit": "h"
    }
  },
  "subtitle_cue_limit": {
    "template": "limit",
    "subject": "subtitles",
    "params": {
      "limit": 20000,
      "unit": ""
    }
  },
  "workflow_size": {
    "template": "empty_limit",
    "subject": "workflow",
    "params": {
      "limit": 8,
      "unit": "MB"
    }
  },
  "reference_image_size": {
    "template": "limit",
    "subject": "image",
    "params": {
      "limit": 10,
      "unit": "MB"
    }
  },
  "stock_file_size": {
    "template": "limit",
    "subject": "download",
    "params": {
      "limit": 300,
      "unit": "MB"
    }
  },
  "image_output_size": {
    "template": "empty_limit",
    "subject": "output",
    "params": {
      "limit": "{limit}",
      "unit": "B"
    }
  },
  "media_output_size": {
    "template": "empty_limit",
    "subject": "output",
    "params": {
      "limit": "{limit}",
      "unit": "B"
    }
  },
  "managed_music_format": {
    "template": "format",
    "subject": "format",
    "params": {
      "formats": "MP3 / WAV"
    }
  },
  "music_format": {
    "template": "format",
    "subject": "format",
    "params": {
      "formats": "MP3"
    }
  },
  "reference_image_format": {
    "template": "format",
    "subject": "image",
    "params": {
      "formats": "PNG / JPEG / WebP"
    }
  },
  "reference_audio_format": {
    "template": "format",
    "subject": "reference_audio",
    "params": {
      "formats": "WAV / MP3"
    }
  },
  "confirm_platform": {
    "template": "confirm_platform"
  },
  "confirm_provider": {
    "template": "confirm_provider"
  },
  "local_billing": {
    "template": "local_billing"
  },
  "asset_not_ready": {
    "template": "unavailable",
    "subject": "asset"
  },
  "asset_not_file": {
    "template": "file",
    "subject": "asset"
  },
  "asset_changed": {
    "template": "changed",
    "subject": "asset"
  },
  "segment_invalid": {
    "template": "invalid",
    "subject": "asset"
  },
  "provider_edit_unsupported": {
    "template": "unsupported",
    "subject": "provider"
  },
  "provider_url_invalid": {
    "template": "invalid",
    "subject": "endpoint"
  },
  "provider_job_missing": {
    "template": "missing",
    "subject": "job_id"
  },
  "provider_file_missing": {
    "template": "missing",
    "subject": "output"
  },
  "provider_image_format": {
    "template": "format",
    "subject": "output",
    "params": {
      "formats": "PNG / JPEG / WebP"
    }
  },
  "reference_audio_duration_invalid": {
    "template": "invalid",
    "subject": "reference_audio"
  },
  "reference_audio_ffmpeg_required": {
    "template": "required",
    "subject": "ffmpeg"
  },
  "speech_protocol_unsupported": {
    "template": "format",
    "subject": "connection",
    "params": {
      "formats": "OpenAI-compatible speech API"
    }
  },
  "import_selection_limit": {
    "template": "limit",
    "subject": "request",
    "params": {
      "limit": 50,
      "unit": ""
    }
  },
  "connection_id_invalid": {
    "template": "invalid",
    "subject": "connection"
  },
  "stock_unavailable": {
    "template": "unavailable",
    "subject": "provider"
  },
  "video_model_input_invalid": {
    "template": "invalid",
    "subject": "model"
  },
  "video_saved_job_invalid": {
    "template": "invalid",
    "subject": "job_id"
  },
  "video_managed_job_invalid": {
    "template": "invalid",
    "subject": "job_id"
  },
  "video_provider_job_invalid": {
    "template": "invalid",
    "subject": "job_id"
  },
  "video_generation_timeout": {
    "template": "timeout",
    "subject": "request"
  },
  "video_download_failed": {
    "template": "failed",
    "subject": "download"
  },
  "video_service_timeout": {
    "template": "timeout",
    "subject": "endpoint"
  },
  "video_service_offline": {
    "template": "unavailable",
    "subject": "media_route"
  },
  "video_reference_size": {
    "template": "limit",
    "subject": "image",
    "params": {
      "limit": 5,
      "unit": "MB"
    }
  },
  "video_download_url_invalid": {
    "template": "invalid",
    "subject": "endpoint"
  },
  "video_redirect_limit": {
    "template": "limit",
    "subject": "download",
    "params": {
      "limit": 3,
      "unit": ""
    }
  },
  "video_empty": {
    "template": "missing",
    "subject": "output"
  },
  "video_size_limit": {
    "template": "limit",
    "subject": "output"
  },
  "video_format_unsupported": {
    "template": "format",
    "subject": "output",
    "params": {
      "formats": "MP4 / WebM"
    }
  },
  "video_incomplete": {
    "template": "invalid",
    "subject": "output"
  },
  "video_edit_unsupported": {
    "template": "unsupported",
    "subject": "media_route"
  },
  "video_reference_unsupported": {
    "template": "unsupported",
    "subject": "image"
  },
  "ffmpeg_unavailable": {
    "template": "unavailable",
    "subject": "ffmpeg"
  },
  "comfy_unavailable": {
    "template": "unavailable",
    "subject": "comfy"
  }
};
