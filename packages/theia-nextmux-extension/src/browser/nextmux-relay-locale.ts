import type { NextMuxDesktopLocale } from './nextmux-locale';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

const en = {
    // Column explanations (the drawer's head and sort tooltips).
    columnMerchant: "Relays: each relay's name, public code and store introduction", columnQuality: "Quality: smoothed approval after completed requests, (positive votes + 50) ÷ (all votes + 50); starts at 100%", columnAuthenticity: "Authenticity: whether the models a relay actually serves match the official originals", columnLatency: "Latency: recent time to first token (lower is faster)", columnPrice: "Avg. multiplier: a relay's average billing multiplier over official prices, across its multiplier-priced models", columnApiName: "API: name and endpoint of your own API connection", columnFavorite: "Favorites: save relays you use often for quick switching",
    searchSourceModels: 'Search models',
    sourceTabs: 'Route sources', merchantSources: 'Relays', favoriteSources: 'Favorites', myApiSources: 'My APIs', searchSources: 'Search name or ID',
    noMatchingSources: 'No matching sources', noFavorites: 'No favorite relays yet', noMyApis: 'No API connections added',
    chooseSourceFirst: 'Choose a relay or add your API first', noSourceModels: 'No models available from this source',
    signInRequired: 'Sign in to use',
    signInNotice: 'Relays need sign-in. Your own APIs work without it.',
    modelsLoading: 'Loading…', modelsPartial: 'More models are available', modelsFailed: 'Model directory could not be loaded', modelsNotLoaded: 'Models have not been loaded yet',
    modelsUnavailable: 'Some models are temporarily unavailable',
    directoryLoading: 'Loading…', directoryUnavailable: 'Public directory unavailable', previousPage: 'Previous page', nextPage: 'Next page', pageSort: 'Sorting this page',
    selectRelay: 'Choose relay', relayTitle: 'Relays', relaySubtitle: "Relays require sign-in; your own API does not.", relayFull: 'This relay is at capacity and is temporarily unavailable for selection.',
    relaySort: 'Relay sorting', quality: 'Quality', authenticity: 'Authenticity', apiName: 'API', authenticityPending: 'No authenticity data yet: measured when a model is listed, then from everyday use', availability: 'Availability', latency: 'Latency', price: 'Multiplier',
    automaticBest: 'Automatic best', automaticRealtime: 'Selected automatically in real time', directLocal: 'Direct from this device',
    modelCount: '{count} models', official: 'Official', local: 'Local', noRelay: 'No relay is currently available',
    savedRelayUnavailable: 'Saved direct route unavailable', relaySwitched: 'The own API this chat used was removed; switched to {label}.', openModelCenter: 'Open model center', addFavorite: 'Add to favorites', removeFavorite: 'Remove from favorites'
} as const;

type RelayTextKey = keyof typeof en;

const translations: Record<NextMuxDesktopLocale, Record<RelayTextKey, string>> = {
    en,
    'zh-CN': {
        // Column explanations (the drawer's head and sort tooltips).
        columnMerchant: "商家信息：中转商名称、编号与店铺简介", columnQuality: "质量：完成请求后的平滑好评率，（点赞数 + 50）÷（全部评价 + 50），初始为 100%", columnAuthenticity: "真实性：中转商实际提供的模型与官方原版是否一致", columnLatency: "延迟：近期请求的首字响应耗时（越低越快）", columnPrice: "平均倍率：中转商按倍率计价的模型相对官方原价的平均计费倍率", columnApiName: "API 名称：你已添加的自有 API 连接名称与端点", columnFavorite: "收藏：把常用中转商加入收藏，便于快速切换",
        searchSourceModels: '搜索模型',
        sourceTabs: '线路来源', merchantSources: '中转商', favoriteSources: '收藏', myApiSources: '我的 API', searchSources: '搜索名称或 ID',
        noMatchingSources: '没有匹配的来源', noFavorites: '还没有收藏中转商', noMyApis: '尚未添加 API 连接',
        chooseSourceFirst: '请先选择中转商或添加自有 API', noSourceModels: '此来源暂无可用模型',
        signInRequired: '登录后可用',
        signInNotice: '中转商需登录，自有 API 免登录。',
        modelsLoading: '加载中…', modelsPartial: '已加载部分模型，还有下一页', modelsFailed: '模型目录加载失败，可重试', modelsNotLoaded: '尚未加载此商家的模型',
        modelsUnavailable: '部分模型暂时不可用',
        directoryLoading: '加载中…', directoryUnavailable: '公开商家目录暂不可用', previousPage: '上一页', nextPage: '下一页', pageSort: '当前页排序',
        selectRelay: '选择中转商', relayTitle: '中转商', relaySubtitle: "中转商需登录后使用；你自己的 API 无需登录。", relayFull: '该中转商已满载，暂不可选', relaySort: '中转商排序',
        quality: '质量', authenticity: '真实性', apiName: 'API 名称', authenticityPending: '暂无真实性数据：上架时检测，之后在日常使用中持续评估', availability: '可用率', latency: '延迟', price: '倍率', automaticBest: '自动最优',
        automaticRealtime: '实时自动选择', directLocal: '本机官方直连', modelCount: '{count} 个模型', official: '官方',
        local: '本机', noRelay: '暂无可用中转商', savedRelayUnavailable: '已保存的直连线路不可用', relaySwitched: '原来的直连线路已删除，已改用 {label}。', openModelCenter: '前往模型中心', addFavorite: '收藏中转商', removeFavorite: '取消收藏'
    },
    'zh-TW': {
        // Column explanations (the drawer's head and sort tooltips).
        columnMerchant: "商家資訊：中轉商名稱、編號與店鋪簡介", columnQuality: "品質：完成請求後的平滑好評率，（讚數 + 50）÷（全部評價 + 50），初始為 100%", columnAuthenticity: "真實性：中轉商實際提供的模型與官方原版是否一致", columnLatency: "延遲：近期請求的首字回應耗時（越低越快）", columnPrice: "平均倍率：中轉商按倍率計價的模型相對官方原價的平均計費倍率", columnApiName: "API 名稱：你已新增的自有 API 連線名稱與端點", columnFavorite: "收藏：將常用中轉商加入收藏，方便快速切換",
        searchSourceModels: '搜尋模型',
        sourceTabs: '線路來源', merchantSources: '中轉商', favoriteSources: '收藏', myApiSources: '我的 API', searchSources: '搜尋名稱或 ID',
        noMatchingSources: '沒有符合的來源', noFavorites: '尚未收藏中轉商', noMyApis: '尚未新增 API 連線',
        chooseSourceFirst: '請先選擇中轉商或新增自有 API', noSourceModels: '此來源目前沒有可用模型',
        signInRequired: '登入後可用',
        signInNotice: '中轉商需登入，自有 API 免登入。',
        modelsLoading: '載入中…', modelsPartial: '已載入部分模型，還有下一頁', modelsFailed: '模型目錄載入失敗，可重試', modelsNotLoaded: '尚未載入此商家的模型',
        modelsUnavailable: '部分模型暫時無法使用',
        directoryLoading: '載入中…', directoryUnavailable: '公開商家目錄暫時無法使用', previousPage: '上一頁', nextPage: '下一頁', pageSort: '目前頁面排序',
        selectRelay: '選擇中轉商', relayTitle: '中轉商', relaySubtitle: "中轉商需登入後使用；你自己的 API 無需登入。", relayFull: '該中轉商已滿載，暫不可選', relaySort: '中轉商排序',
        quality: '品質', authenticity: '真實性', apiName: 'API 名稱', authenticityPending: '尚無真實性資料：上架時檢測，之後在日常使用中持續評估', availability: '可用率', latency: '延遲', price: '倍率', automaticBest: '自動最佳',
        automaticRealtime: '即時自動選擇', directLocal: '本機官方直連', modelCount: '{count} 個模型', official: '官方',
        local: '本機', noRelay: '目前沒有可用中轉商', savedRelayUnavailable: '已儲存的直連線路無法使用', relaySwitched: '原來的直連線路已刪除，已改用 {label}。', openModelCenter: '前往模型中心', addFavorite: '收藏中轉商', removeFavorite: '取消收藏'
    },
    ja: {
        // Column explanations (the drawer's head and sort tooltips).
        columnMerchant: "リレー：各リレーの名前、公開番号、ショップ紹介", columnQuality: "品質：完了したリクエストへの評価（平滑化）。（賛成票 + 50）÷（全投票 + 50）で、初期値は 100%", columnAuthenticity: "真正性：リレーが実際に提供するモデルが公式のオリジナルと一致しているか", columnLatency: "遅延：最近のリクエストで最初のトークンが届くまでの時間（短いほど高速）", columnPrice: "平均倍率：リレーの倍率課金モデルにおける、公式価格に対する平均課金倍率", columnApiName: "API 名：追加した自分の API 接続の名前とエンドポイント", columnFavorite: "お気に入り：よく使うリレーを保存してすばやく切り替え",
        searchSourceModels: 'モデルを検索',
        sourceTabs: 'ルートの接続元', merchantSources: 'リレー', favoriteSources: 'お気に入り', myApiSources: '自分の API', searchSources: '名前または ID を検索',
        noMatchingSources: '一致する接続元はありません', noFavorites: 'お気に入りのリレーはありません', noMyApis: 'API 接続が追加されていません',
        chooseSourceFirst: 'リレーを選択するか、自分の API を追加してください', noSourceModels: 'この接続元に利用可能なモデルはありません',
        signInRequired: 'サインイン後に利用可',
        signInNotice: '中継サービスはサインインが必要です。自分の API は不要です。',
        modelsLoading: '読み込み中…', modelsPartial: '次のページにもモデルがあります', modelsFailed: 'モデル一覧を読み込めませんでした', modelsNotLoaded: 'モデルはまだ読み込まれていません',
        modelsUnavailable: '一部のモデルは現在利用できません',
        directoryLoading: '読み込み中…', directoryUnavailable: '公開一覧を取得できません', previousPage: '前のページ', nextPage: '次のページ', pageSort: 'このページの並べ替え',
        selectRelay: 'リレーを選択', relayTitle: 'リレー', relaySubtitle: "中継サービスにはログインが必要です。自分の API はログイン不要です。", relayFull: 'このリレーは満員のため、現在選択できません。', relaySort: 'リレーの並び順',
        quality: '品質', authenticity: '真正性', apiName: 'API 名', authenticityPending: '真正性データはまだありません。掲載時に検査し、その後は日常の利用から評価します', availability: '稼働率', latency: '遅延', price: '倍率', automaticBest: '自動最適',
        automaticRealtime: 'リアルタイムで自動選択', directLocal: 'この端末から直接接続', modelCount: '{count} モデル', official: '公式',
        local: 'ローカル', noRelay: '利用可能なリレーはありません', savedRelayUnavailable: '保存済みの直接ルートは利用できません', relaySwitched: '以前の直接接続は削除されたため、{label} に切り替えました。', openModelCenter: 'モデルセンターを開く', addFavorite: 'お気に入りに追加', removeFavorite: 'お気に入りから削除'
    },
    ko: {
        // Column explanations (the drawer's head and sort tooltips).
        columnMerchant: "중계: 각 중계의 이름, 공개 번호, 상점 소개", columnQuality: "품질: 완료된 요청 평가(보정). (추천 수 + 50) ÷ (전체 투표 + 50), 초기값 100%", columnAuthenticity: "진위성: 중계가 실제로 제공하는 모델이 공식 원본과 일치하는지 여부", columnLatency: "지연: 최근 요청에서 첫 토큰까지 걸린 시간(낮을수록 빠름)", columnPrice: "평균 배율: 중계의 배율 과금 모델이 공식 가격 대비 적용하는 평균 배율", columnApiName: "API 이름: 추가한 내 API 연결의 이름과 엔드포인트", columnFavorite: "즐겨찾기: 자주 쓰는 중계를 저장해 빠르게 전환",
        searchSourceModels: '모델 검색',
        sourceTabs: '경로 소스', merchantSources: '중계', favoriteSources: '즐겨찾기', myApiSources: '내 API', searchSources: '이름 또는 ID 검색',
        noMatchingSources: '일치하는 소스가 없습니다', noFavorites: '즐겨찾는 중계가 없습니다', noMyApis: '추가된 API 연결이 없습니다',
        chooseSourceFirst: '중계를 선택하거나 내 API를 추가하세요', noSourceModels: '이 소스에 사용 가능한 모델이 없습니다',
        signInRequired: '로그인 후 사용',
        signInNotice: '중계 서비스는 로그인이 필요합니다. 내 API는 필요 없습니다.',
        modelsLoading: '로드 중…', modelsPartial: '다음 페이지에 모델이 더 있습니다', modelsFailed: '모델 목록을 불러오지 못했습니다', modelsNotLoaded: '모델을 아직 불러오지 않았습니다',
        modelsUnavailable: '일부 모델을 일시적으로 사용할 수 없습니다',
        directoryLoading: '로드 중…', directoryUnavailable: '공개 목록을 사용할 수 없음', previousPage: '이전 페이지', nextPage: '다음 페이지', pageSort: '현재 페이지 정렬',
        selectRelay: '중계 선택', relayTitle: '중계', relaySubtitle: "중계 서비스는 로그인이 필요하며, 자신의 API는 로그인 없이 사용할 수 있습니다.", relayFull: '이 중계는 가득 차서 일시적으로 선택할 수 없습니다.', relaySort: '중계 정렬',
        quality: '품질', authenticity: '진위성', apiName: 'API 이름', authenticityPending: '진위성 데이터가 아직 없습니다. 등록 시 검사하고 이후 일상 사용에서 평가합니다', availability: '가용성', latency: '지연', price: '배율', automaticBest: '자동 최적',
        automaticRealtime: '실시간 자동 선택', directLocal: '이 기기에서 직접 연결', modelCount: '모델 {count}개', official: '공식',
        local: '로컬', noRelay: '사용 가능한 중계가 없습니다', savedRelayUnavailable: '저장된 직접 경로를 사용할 수 없음', relaySwitched: '이전 직접 연결이 삭제되어 {label}(으)로 전환했습니다.', openModelCenter: '모델 센터 열기', addFavorite: '즐겨찾기에 추가', removeFavorite: '즐겨찾기에서 제거'
    },
    es: {
        // Column explanations (the drawer's head and sort tooltips).
        columnMerchant: "Intermediarios: nombre, código público y presentación de la tienda de cada intermediario", columnQuality: "Calidad: aprobación suavizada tras solicitudes completadas, (votos positivos + 50) ÷ (todos los votos + 50); empieza en 100 %", columnAuthenticity: "Autenticidad: si los modelos que sirve realmente un intermediario coinciden con los originales oficiales", columnLatency: "Latencia: tiempo reciente hasta el primer token (menos es más rápido)", columnPrice: "Multiplicador medio: multiplicador de cobro medio sobre el precio oficial en los modelos con precio por multiplicador", columnApiName: "API: nombre y endpoint de tu conexión de API propia", columnFavorite: "Favoritos: guarda los intermediarios que más usas para cambiar rápido",
        searchSourceModels: 'Buscar modelos',
        sourceTabs: 'Orígenes de ruta', merchantSources: 'Intermediarios', favoriteSources: 'Favoritos', myApiSources: 'Mis API', searchSources: 'Buscar nombre o ID',
        noMatchingSources: 'No hay orígenes coincidentes', noFavorites: 'Aún no hay intermediarios favoritos', noMyApis: 'No se han añadido conexiones API',
        chooseSourceFirst: 'Elige un intermediario o añade tu API', noSourceModels: 'Este origen no tiene modelos disponibles',
        signInRequired: 'Inicia sesión para usar',
        signInNotice: 'Los relays requieren iniciar sesión; tus propias API no.',
        modelsLoading: 'Cargando…', modelsPartial: 'Hay más modelos disponibles', modelsFailed: 'No se pudo cargar el directorio de modelos', modelsNotLoaded: 'Los modelos aún no se han cargado',
        modelsUnavailable: 'Algunos modelos no están disponibles temporalmente',
        directoryLoading: 'Cargando…', directoryUnavailable: 'Directorio público no disponible', previousPage: 'Página anterior', nextPage: 'Página siguiente', pageSort: 'Orden de esta página',
        selectRelay: 'Elegir intermediario', relayTitle: 'Intermediarios', relaySubtitle: "Los intermediarios requieren iniciar sesión; tu propia API no.", relayFull: 'Este intermediario está al máximo de capacidad y no se puede seleccionar temporalmente.', relaySort: 'Ordenar intermediarios',
        quality: 'Calidad', authenticity: 'Autenticidad', apiName: 'API', authenticityPending: 'Aún no hay datos de autenticidad: se mide al publicar el modelo y luego con el uso diario', availability: 'Disponibilidad', latency: 'Latencia', price: 'Multiplicador', automaticBest: 'Mejor automático',
        automaticRealtime: 'Selección automática en tiempo real', directLocal: 'Conexión directa desde este equipo', modelCount: '{count} modelos', official: 'Oficial',
        local: 'Local', noRelay: 'No hay intermediarios disponibles', savedRelayUnavailable: 'La ruta directa guardada no está disponible', relaySwitched: 'La conexión directa guardada se eliminó; se cambió a {label}.', openModelCenter: 'Abrir centro de modelos', addFavorite: 'Añadir a favoritos', removeFavorite: 'Quitar de favoritos'
    },
    fr: {
        // Column explanations (the drawer's head and sort tooltips).
        columnMerchant: "Relais : nom, code public et présentation de la boutique de chaque relais", columnQuality: "Qualité : approbation lissée après requêtes terminées, (votes positifs + 50) ÷ (tous les votes + 50) ; commence à 100 %", columnAuthenticity: "Authenticité : les modèles réellement servis par un relais correspondent-ils aux originaux officiels", columnLatency: "Latence : délai récent avant le premier jeton (plus bas, plus rapide)", columnPrice: "Multiplicateur moyen : multiplicateur de facturation moyen par rapport au prix officiel, sur les modèles facturés au multiplicateur", columnApiName: "API : nom et point de terminaison de votre connexion API", columnFavorite: "Favoris : enregistrez les relais que vous utilisez souvent pour changer rapidement",
        searchSourceModels: 'Rechercher des modèles',
        sourceTabs: 'Sources de routage', merchantSources: 'Relais', favoriteSources: 'Favoris', myApiSources: 'Mes API', searchSources: 'Rechercher un nom ou un ID',
        noMatchingSources: 'Aucune source correspondante', noFavorites: 'Aucun relais favori', noMyApis: 'Aucune connexion API ajoutée',
        chooseSourceFirst: 'Choisissez un relais ou ajoutez votre API', noSourceModels: 'Aucun modèle disponible pour cette source',
        signInRequired: 'Connectez-vous pour utiliser',
        signInNotice: 'Les relais nécessitent une connexion ; vos propres API non.',
        modelsLoading: 'Chargement…', modelsPartial: 'D’autres modèles sont disponibles', modelsFailed: 'Impossible de charger la liste des modèles', modelsNotLoaded: 'Les modèles ne sont pas encore chargés',
        modelsUnavailable: 'Certains modèles sont temporairement indisponibles',
        directoryLoading: 'Chargement…', directoryUnavailable: 'Annuaire public indisponible', previousPage: 'Page précédente', nextPage: 'Page suivante', pageSort: 'Tri de cette page',
        selectRelay: 'Choisir un relais', relayTitle: 'Relais', relaySubtitle: "Les relais nécessitent une connexion ; votre propre API n’en a pas besoin.", relayFull: 'Ce relais est à pleine capacité et ne peut pas être sélectionné pour le moment.', relaySort: 'Tri des relais',
        quality: 'Qualité', authenticity: 'Authenticité', apiName: 'API', authenticityPending: 'Pas encore de données d’authenticité : mesurée à la publication, puis à l’usage', availability: 'Disponibilité', latency: 'Latence', price: 'Multiplicateur', automaticBest: 'Meilleur automatique',
        automaticRealtime: 'Sélection automatique en temps réel', directLocal: 'Connexion directe depuis cet appareil', modelCount: '{count} modèles', official: 'Officiel',
        local: 'Local', noRelay: 'Aucun relais disponible', savedRelayUnavailable: 'La route directe enregistrée est indisponible', relaySwitched: 'La connexion directe enregistrée a été supprimée ; passage à {label}.', openModelCenter: 'Ouvrir le centre des modèles', addFavorite: 'Ajouter aux favoris', removeFavorite: 'Retirer des favoris'
    },
    de: {
        // Column explanations (the drawer's head and sort tooltips).
        columnMerchant: "Relays: Name, öffentliche Nummer und Shop-Vorstellung jedes Relays", columnQuality: "Qualität: geglättete Zustimmung nach abgeschlossenen Anfragen, (positive Stimmen + 50) ÷ (alle Stimmen + 50); beginnt bei 100 %", columnAuthenticity: "Echtheit: ob die tatsächlich gelieferten Modelle eines Relays den offiziellen Originalen entsprechen", columnLatency: "Latenz: aktuelle Zeit bis zum ersten Token (niedriger ist schneller)", columnPrice: "Ø Multiplikator: durchschnittlicher Abrechnungsmultiplikator gegenüber dem offiziellen Preis bei multiplikatorbasierten Modellen", columnApiName: "API: Name und Endpunkt Ihrer eigenen API-Verbindung", columnFavorite: "Favoriten: häufig genutzte Relays speichern und schnell wechseln",
        searchSourceModels: 'Modelle suchen',
        sourceTabs: 'Routenquellen', merchantSources: 'Relays', favoriteSources: 'Favoriten', myApiSources: 'Meine APIs', searchSources: 'Name oder ID suchen',
        noMatchingSources: 'Keine passende Quelle', noFavorites: 'Noch keine favorisierten Relays', noMyApis: 'Keine API-Verbindungen hinzugefügt',
        chooseSourceFirst: 'Relay wählen oder eigene API hinzufügen', noSourceModels: 'Keine Modelle aus dieser Quelle verfügbar',
        signInRequired: 'Nach Anmeldung nutzbar',
        signInNotice: 'Relays erfordern eine Anmeldung, deine eigenen APIs nicht.',
        modelsLoading: 'Wird geladen…', modelsPartial: 'Weitere Modelle sind verfügbar', modelsFailed: 'Modellverzeichnis konnte nicht geladen werden', modelsNotLoaded: 'Modelle wurden noch nicht geladen',
        modelsUnavailable: 'Einige Modelle sind vorübergehend nicht verfügbar',
        directoryLoading: 'Wird geladen…', directoryUnavailable: 'Öffentliches Verzeichnis nicht verfügbar', previousPage: 'Vorherige Seite', nextPage: 'Nächste Seite', pageSort: 'Sortierung dieser Seite',
        selectRelay: 'Relay wählen', relayTitle: 'Relays', relaySubtitle: "Relays erfordern eine Anmeldung; Ihre eigene API nicht.", relayFull: 'Dieser Vermittler ist ausgelastet und kann vorübergehend nicht ausgewählt werden.', relaySort: 'Relay-Sortierung',
        quality: 'Qualität', authenticity: 'Echtheit', apiName: 'API', authenticityPending: 'Noch keine Echtheitsdaten: beim Listen geprüft, danach aus der täglichen Nutzung bewertet', availability: 'Verfügbarkeit', latency: 'Latenz', price: 'Multiplikator', automaticBest: 'Automatisch optimal',
        automaticRealtime: 'Automatische Echtzeitauswahl', directLocal: 'Direkt von diesem Gerät', modelCount: '{count} Modelle', official: 'Offiziell',
        local: 'Lokal', noRelay: 'Derzeit ist kein Relay verfügbar', savedRelayUnavailable: 'Gespeicherte Direktroute nicht verfügbar', relaySwitched: 'Die gespeicherte Direktverbindung wurde entfernt; gewechselt zu {label}.', openModelCenter: 'Modellzentrum öffnen', addFavorite: 'Zu Favoriten hinzufügen', removeFavorite: 'Aus Favoriten entfernen'
    },
    'pt-BR': {
        // Column explanations (the drawer's head and sort tooltips).
        columnMerchant: "Relays: nome, código público e apresentação da loja de cada relay", columnQuality: "Qualidade: aprovação suavizada após solicitações concluídas, (votos positivos + 50) ÷ (todos os votos + 50); começa em 100%", columnAuthenticity: "Autenticidade: se os modelos que um relay realmente entrega correspondem aos originais oficiais", columnLatency: "Latência: tempo recente até o primeiro token (menor é mais rápido)", columnPrice: "Multiplicador médio: multiplicador de cobrança médio sobre o preço oficial nos modelos cobrados por multiplicador", columnApiName: "API: nome e endpoint da sua conexão de API própria", columnFavorite: "Favoritos: salve os relays que você usa com frequência para trocar rapidamente",
        searchSourceModels: 'Buscar modelos',
        sourceTabs: 'Origens de rota', merchantSources: 'Relays', favoriteSources: 'Favoritos', myApiSources: 'Minhas APIs', searchSources: 'Buscar nome ou ID',
        noMatchingSources: 'Nenhuma origem correspondente', noFavorites: 'Nenhum relay favorito', noMyApis: 'Nenhuma conexão API adicionada',
        chooseSourceFirst: 'Escolha um relay ou adicione sua API', noSourceModels: 'Nenhum modelo disponível nesta origem',
        signInRequired: 'Entre para usar',
        signInNotice: 'Relays exigem login; suas próprias APIs não.',
        modelsLoading: 'Carregando…', modelsPartial: 'Há mais modelos disponíveis', modelsFailed: 'Não foi possível carregar os modelos', modelsNotLoaded: 'Os modelos ainda não foram carregados',
        modelsUnavailable: 'Alguns modelos estão temporariamente indisponíveis',
        directoryLoading: 'Carregando…', directoryUnavailable: 'Diretório público indisponível', previousPage: 'Página anterior', nextPage: 'Próxima página', pageSort: 'Ordenação desta página',
        selectRelay: 'Escolher relay', relayTitle: 'Relays', relaySubtitle: "Os intermediários exigem login; sua própria API não.", relayFull: 'Este intermediário está lotado e não pode ser selecionado temporariamente.', relaySort: 'Ordenação dos relays',
        quality: 'Qualidade', authenticity: 'Autenticidade', apiName: 'API', authenticityPending: 'Ainda sem dados de autenticidade: medida ao listar o modelo e depois pelo uso diário', availability: 'Disponibilidade', latency: 'Latência', price: 'Multiplicador', automaticBest: 'Melhor automático',
        automaticRealtime: 'Seleção automática em tempo real', directLocal: 'Conexão direta deste dispositivo', modelCount: '{count} modelos', official: 'Oficial',
        local: 'Local', noRelay: 'Nenhum relay disponível', savedRelayUnavailable: 'A rota direta salva não está disponível', relaySwitched: 'A conexão direta salva foi removida; mudamos para {label}.', openModelCenter: 'Abrir central de modelos', addFavorite: 'Adicionar aos favoritos', removeFavorite: 'Remover dos favoritos'
    },
    ru: {
        // Column explanations (the drawer's head and sort tooltips).
        columnMerchant: "Посредники: название, публичный код и описание магазина каждого посредника", columnQuality: "Качество: сглаженное одобрение после завершённых запросов, (положительные + 50) ÷ (все голоса + 50); начинается со 100 %", columnAuthenticity: "Подлинность: совпадают ли модели, которые посредник на самом деле отдаёт, с официальными оригиналами", columnLatency: "Задержка: недавнее время до первого токена (меньше — быстрее)", columnPrice: "Средний множитель: средний множитель оплаты к официальной цене по моделям с оплатой по множителю", columnApiName: "API: название и адрес вашего собственного API-подключения", columnFavorite: "Избранное: сохраните часто используемых посредников для быстрого переключения",
        searchSourceModels: 'Поиск моделей',
        sourceTabs: 'Источники маршрута', merchantSources: 'Посредники', favoriteSources: 'Избранное', myApiSources: 'Мои API', searchSources: 'Поиск по имени или ID',
        noMatchingSources: 'Совпадений нет', noFavorites: 'Нет избранных посредников', noMyApis: 'Подключения API не добавлены',
        chooseSourceFirst: 'Выберите посредника или добавьте свой API', noSourceModels: 'Нет доступных моделей у этого источника',
        signInRequired: 'Доступно после входа',
        signInNotice: 'Для ретрансляторов нужен вход; для своих API — нет.',
        modelsLoading: 'Загрузка…', modelsPartial: 'Доступны дополнительные модели', modelsFailed: 'Не удалось загрузить каталог моделей', modelsNotLoaded: 'Модели ещё не загружены',
        modelsUnavailable: 'Некоторые модели временно недоступны',
        directoryLoading: 'Загрузка…', directoryUnavailable: 'Публичный каталог недоступен', previousPage: 'Предыдущая страница', nextPage: 'Следующая страница', pageSort: 'Сортировка этой страницы',
        selectRelay: 'Выбрать посредника', relayTitle: 'Посредники', relaySubtitle: "Для ретрансляторов нужен вход; для собственного API — нет.", relayFull: 'Этот посредник полностью занят и временно недоступен для выбора.', relaySort: 'Сортировка посредников',
        quality: 'Качество', authenticity: 'Подлинность', apiName: 'API', authenticityPending: 'Данных о подлинности пока нет: проверяется при размещении, затем по обычному использованию', availability: 'Доступность', latency: 'Задержка', price: 'Множитель', automaticBest: 'Автоматически лучший',
        automaticRealtime: 'Автовыбор в реальном времени', directLocal: 'Прямое подключение с устройства', modelCount: '{count} моделей', official: 'Официальный',
        local: 'Локально', noRelay: 'Нет доступных посредников', savedRelayUnavailable: 'Сохранённый прямой маршрут недоступен', relaySwitched: 'Сохранённое прямое подключение удалено; выбрано {label}.', openModelCenter: 'Открыть центр моделей', addFavorite: 'Добавить в избранное', removeFavorite: 'Удалить из избранного'
    },
    ar: {
        // Column explanations (the drawer's head and sort tooltips).
        columnMerchant: "الوسطاء: اسم كل وسيط ورمزه العام ونبذة عن متجره", columnQuality: "الجودة: نسبة رضا مُنعَّمة بعد الطلبات المكتملة، (الأصوات الإيجابية + 50) ÷ (جميع الأصوات + 50)؛ تبدأ من 100٪", columnAuthenticity: "الأصالة: هل تطابق النماذج التي يقدّمها الوسيط فعليًا النماذج الرسمية الأصلية", columnLatency: "زمن الاستجابة: الوقت الأخير حتى أول رمز (الأقل أسرع)", columnPrice: "متوسط المضاعف: متوسط مضاعف الفوترة مقارنة بالسعر الرسمي للنماذج المسعّرة بالمضاعف", columnApiName: "واجهة API: اسم اتصال API الخاص بك وعنوانه", columnFavorite: "المفضلة: احفظ الوسطاء الذين تستخدمهم كثيرًا للتبديل السريع",
        searchSourceModels: 'البحث عن نماذج',
        sourceTabs: 'مصادر المسارات', merchantSources: 'الوسطاء', favoriteSources: 'المفضلة', myApiSources: 'واجهات API الخاصة بي', searchSources: 'البحث بالاسم أو المعرّف',
        noMatchingSources: 'لا توجد مصادر مطابقة', noFavorites: 'لا توجد وسطاء مفضلة', noMyApis: 'لم تتم إضافة اتصالات API',
        chooseSourceFirst: 'اختر وسيطاً أو أضف واجهة API الخاصة بك', noSourceModels: 'لا توجد نماذج متاحة من هذا المصدر',
        signInRequired: 'متاح بعد تسجيل الدخول',
        signInNotice: 'تتطلب المُرحِّلات تسجيل الدخول؛ واجهاتك البرمجية الخاصة لا تتطلبه.',
        modelsLoading: 'جارٍ التحميل…', modelsPartial: 'توجد نماذج إضافية', modelsFailed: 'تعذر تحميل دليل النماذج', modelsNotLoaded: 'لم يتم تحميل النماذج بعد',
        modelsUnavailable: 'بعض النماذج غير متاحة مؤقتًا',
        directoryLoading: 'جارٍ التحميل…', directoryUnavailable: 'الدليل العام غير متاح', previousPage: 'الصفحة السابقة', nextPage: 'الصفحة التالية', pageSort: 'ترتيب هذه الصفحة',
        selectRelay: 'اختيار وسيط', relayTitle: 'الوسطاء', relaySubtitle: "يتطلب استخدام الوسطاء تسجيل الدخول؛ أما API الخاصة بك فلا.", relayFull: 'هذا الوسيط ممتلئ السعة ولا يمكن اختياره مؤقتًا.', relaySort: 'ترتيب الوسطاء',
        quality: 'الجودة', authenticity: 'الأصالة', apiName: 'واجهة API', authenticityPending: 'لا توجد بيانات أصالة بعد: تُقاس عند إدراج النموذج ثم من الاستخدام اليومي', availability: 'التوفر', latency: 'زمن الاستجابة', price: 'المضاعف', automaticBest: 'الأفضل تلقائياً',
        automaticRealtime: 'اختيار تلقائي لحظي', directLocal: 'اتصال مباشر من هذا الجهاز', modelCount: '{count} نموذج', official: 'رسمي',
        local: 'محلي', noRelay: 'لا يوجد وسيط متاح حالياً', savedRelayUnavailable: 'المسار المباشر المحفوظ غير متاح', relaySwitched: 'أُزيل الاتصال المباشر المحفوظ؛ تم التبديل إلى {label}.', openModelCenter: 'فتح مركز النماذج', addFavorite: 'إضافة إلى المفضلة', removeFavorite: 'إزالة من المفضلة'
    },
    hi: {
        // Column explanations (the drawer's head and sort tooltips).
        columnMerchant: "रिले: हर रिले का नाम, सार्वजनिक कोड और स्टोर परिचय", columnQuality: "गुणवत्ता: पूर्ण अनुरोधों के बाद समायोजित स्वीकृति, (सकारात्मक वोट + 50) ÷ (सभी वोट + 50); शुरुआत 100% से", columnAuthenticity: "प्रामाणिकता: रिले जो मॉडल वास्तव में देता है, क्या वे आधिकारिक मूल मॉडल से मेल खाते हैं", columnLatency: "विलंब: हाल के अनुरोधों में पहले टोकन तक का समय (कम यानी तेज़)", columnPrice: "औसत गुणक: गुणक-आधारित मॉडलों पर आधिकारिक मूल्य की तुलना में औसत बिलिंग गुणक", columnApiName: "API: आपके अपने API कनेक्शन का नाम और एंडपॉइंट", columnFavorite: "पसंदीदा: अक्सर इस्तेमाल होने वाले रिले सहेजें और तुरंत बदलें",
        searchSourceModels: 'मॉडल खोजें',
        sourceTabs: 'मार्ग स्रोत', merchantSources: 'रिले', favoriteSources: 'पसंदीदा', myApiSources: 'मेरे API', searchSources: 'नाम या ID खोजें',
        noMatchingSources: 'कोई मेल खाता स्रोत नहीं', noFavorites: 'कोई पसंदीदा रिले नहीं', noMyApis: 'कोई API कनेक्शन नहीं जोड़ा गया',
        chooseSourceFirst: 'रिले चुनें या अपना API जोड़ें', noSourceModels: 'इस स्रोत में कोई मॉडल उपलब्ध नहीं है',
        signInRequired: 'साइन इन के बाद उपलब्ध',
        signInNotice: 'रिले के लिए साइन इन ज़रूरी है; आपके अपने API के लिए नहीं।',
        modelsLoading: 'लोड हो रहा है…', modelsPartial: 'और मॉडल उपलब्ध हैं', modelsFailed: 'मॉडल निर्देशिका लोड नहीं हो सकी', modelsNotLoaded: 'मॉडल अभी लोड नहीं हुए हैं',
        modelsUnavailable: 'कुछ मॉडल अभी उपलब्ध नहीं हैं',
        directoryLoading: 'लोड हो रहा है…', directoryUnavailable: 'सार्वजनिक निर्देशिका उपलब्ध नहीं है', previousPage: 'पिछला पृष्ठ', nextPage: 'अगला पृष्ठ', pageSort: 'इस पृष्ठ का क्रम',
        selectRelay: 'रिले चुनें', relayTitle: 'रिले', relaySubtitle: "रिले के लिए साइन इन करें; आपके अपने API के लिए इसकी आवश्यकता नहीं है।", relayFull: 'यह रिले क्षमता पर है और अभी चुना नहीं जा सकता।', relaySort: 'रिले क्रम',
        quality: 'गुणवत्ता', authenticity: 'प्रामाणिकता', apiName: 'API', authenticityPending: 'अभी प्रामाणिकता डेटा नहीं है: मॉडल सूचीबद्ध होने पर जाँच, फिर रोज़ के उपयोग से आकलन', availability: 'उपलब्धता', latency: 'विलंब', price: 'गुणक', automaticBest: 'स्वचालित सर्वोत्तम',
        automaticRealtime: 'रीयल-टाइम स्वचालित चयन', directLocal: 'इस डिवाइस से सीधा कनेक्शन', modelCount: '{count} मॉडल', official: 'आधिकारिक',
        local: 'स्थानीय', noRelay: 'अभी कोई रिले उपलब्ध नहीं है', savedRelayUnavailable: 'सहेजा गया सीधा मार्ग उपलब्ध नहीं है', relaySwitched: 'सहेजा गया सीधा कनेक्शन हटा दिया गया; {label} पर स्विच किया गया।', openModelCenter: 'मॉडल केंद्र खोलें', addFavorite: 'पसंदीदा में जोड़ें', removeFavorite: 'पसंदीदा से हटाएँ'
    }
};

function uncheckedRelayText(
    locale: NextMuxDesktopLocale,
    key: RelayTextKey,
    values: Readonly<Record<string, string | number>> = {}
): string {
    return translations[locale][key].replace(/\{([a-z]+)\}/gi, (_match, name: string) => String(values[name] ?? ''));
}

/** A favorited relay that is no longer in the public directory (U072). */
const delisted: Readonly<Record<NextMuxDesktopLocale, string>> = {
    en: 'Delisted', 'zh-CN': '已下架', 'zh-TW': '已下架', ja: '掲載終了', ko: '판매 중지', es: 'Retirado', fr: 'Retiré',
    de: 'Nicht mehr gelistet', 'pt-BR': 'Removido', ru: 'Снят с каталога', ar: 'أُزيل من القائمة', hi: 'सूची से हटाया गया'
};

export function relayDelistedText(locale: NextMuxDesktopLocale): string {
    return delisted[locale];
}

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function relayText(locale: Parameters<typeof uncheckedRelayText>[0], key: Parameters<typeof uncheckedRelayText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedRelayText>>): string {
    return totalCopy(locale, key, language => uncheckedRelayText(language, key, ...rest));
}
