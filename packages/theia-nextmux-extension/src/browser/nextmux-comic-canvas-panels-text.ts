/** 画布 panels copy: locator, pins, settings, arrange, clipboard (node-loadable). A missing language falls back to English. */
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

export type PanelTextKey =
    | 'locate' | 'locateHint' | 'filter.all' | 'filter.picture' | 'filter.clip' | 'filter.sound' | 'filter.text' | 'filter.character' | 'noMatch' | 'pins' | 'noPins' | 'clearPins' | 'clearColor'
    | 'pin' | 'unpin' | 'color.red' | 'color.orange' | 'color.yellow' | 'color.lime' | 'color.green' | 'color.teal' | 'color.cyan' | 'color.blue' | 'color.indigo' | 'color.purple' | 'color.pink' | 'color.grey'
    | 'arrangeGrid' | 'arrangeWires' | 'arrangeName' | 'groupLimit' | 'copied' | 'pasted' | 'pasteRefused' | 'clipboardUnavailable' | 'submitIn' | 'cancelSubmit'
    | 'settings' | 'resetDefaults' | 'section.interaction' | 'section.wires' | 'section.grid' | 'section.layout' | 'section.generation'
    | 'set.panSensitivity' | 'set.blankAreaAction' | 'set.blankAreaAction.rightClick' | 'set.blankAreaAction.doubleClick' | 'set.wheelAction' | 'set.wheelAction.pan' | 'set.wheelAction.zoom'
    | 'set.snapGrid' | 'set.alignmentGuides' | 'set.wireWidth' | 'set.wireHoverHighlight' | 'set.wireAnimation' | 'set.wireFocusOnly' | 'set.gridSpacing' | 'set.gridDotSize' | 'set.showGrid'
    | 'set.minimap' | 'set.arrangeHorizontalSpacing' | 'set.arrangeVerticalSpacing' | 'set.groupPadding' | 'set.submitDelaySeconds' | 'set.notifyOnCompletion' | 'off'
    | 'comparePause' | 'compareUnmute' | 'compareMute' | 'compareAudioLeft' | 'compareAudioRight' | 'compareReset' | 'compareClearPreview' | 'compareHelp' | 'compareHelpKeys'
    | 'camera' | 'cameraHint' | 'cameraPresets' | 'cameraCategory.zoom' | 'cameraCategory.horizontal' | 'cameraCategory.vertical' | 'cameraCategory.special' | 'cameraSpeed' | 'cameraConflict' | 'cameraClear' | 'cameraApply' | 'cameraNone' | 'clipsReady';

const ZH: Record<PanelTextKey, string> = {
    clipboardUnavailable: '无法访问剪贴板，请重试。',
    comparePause: "暂停",
    compareUnmute: "取消静音",
    compareMute: "静音",
    compareAudioLeft: "监听左侧",
    compareAudioRight: "监听右侧",
    compareReset: "重置视图",
    compareClearPreview: "清空预览",
    compareHelp: "快捷键帮助",
    compareHelpKeys: "V 切换视图 · C 分割线居中 · X 交换左右\n←/→：图片分割线 ±2%，Shift ±10%；视频 ±1 秒，Shift ±5 秒\n素材条：←/→ 相邻项，Home/End 首尾\n滚轮在指针处缩放 · +/- 缩放 · 0/双击重置 · 中键或放大后拖动画面平移\n空格播放/暂停 · M 静音 · ? 帮助\nEsc：关闭帮助 → 清空预览 → 关闭窗口。输入文字或窗口失焦时不触发快捷键。",
    locate: '节点定位', locateHint: '搜索节点名称或类型', 'filter.all': '全部', 'filter.picture': '图', 'filter.clip': '视频', 'filter.sound': '音频', 'filter.text': '文本', 'filter.character': '角色',
    noMatch: '没有匹配的节点', pins: 'Pin', noPins: '还没有 Pin 的节点', clearPins: '清空全部 Pin', clearColor: '清空此颜色', pin: 'Pin', unpin: '取消 Pin',
    'color.red': '红', 'color.orange': '橙', 'color.yellow': '黄', 'color.lime': '黄绿', 'color.green': '绿', 'color.teal': '青绿', 'color.cyan': '青', 'color.blue': '蓝',
    'color.indigo': '靛蓝', 'color.purple': '紫', 'color.pink': '粉', 'color.grey': '灰',
    arrangeGrid: '整理成网格', arrangeWires: '顺着连线整理', arrangeName: '按名称排列', groupLimit: '一组最多 {limit} 个节点（含组内节点），这次选了 {count} 个',
    copied: '已复制 {n} 个节点', pasted: '已粘贴 {n} 个节点', pasteRefused: '剪贴板里不是画布节点', submitIn: '{n} 秒后提交', cancelSubmit: '取消提交',
    settings: '画布设置', resetDefaults: '恢复默认', 'section.interaction': '交互', 'section.wires': '连线', 'section.grid': '网格与小地图', 'section.layout': '整理与分组', 'section.generation': '生成',
    'set.panSensitivity': '平移灵敏度', 'set.blankAreaAction': '空白处打开菜单', 'set.blankAreaAction.rightClick': '右键', 'set.blankAreaAction.doubleClick': '双击',
    'set.wheelAction': '滚轮', 'set.wheelAction.pan': '平移', 'set.wheelAction.zoom': '缩放', 'set.snapGrid': '拖动吸附网格', 'set.alignmentGuides': '对齐辅助线',
    'set.wireWidth': '连线粗细', 'set.wireHoverHighlight': '悬停高亮连线', 'set.wireAnimation': '连线流动动画', 'set.wireFocusOnly': '只显示选中节点的连线',
    'set.gridSpacing': '网格间距', 'set.gridDotSize': '网格点大小', 'set.showGrid': '显示网格', 'set.minimap': '小地图', 'set.arrangeHorizontalSpacing': '整理水平间距',
    'set.arrangeVerticalSpacing': '整理垂直间距', 'set.groupPadding': '打组边距', 'set.submitDelaySeconds': '生成前倒计时', 'set.notifyOnCompletion': '生成完成后通知', off: '关闭',
    camera: '运镜', cameraHint: '选一个组合，或最多两个动作加速度；会写在提示词最前面。', cameraPresets: '组合', 'cameraCategory.zoom': '推拉缩放', 'cameraCategory.horizontal': '水平移动',
    'cameraCategory.vertical': '垂直移动', 'cameraCategory.special': '特殊视角', cameraSpeed: '速度', cameraConflict: '这两个动作方向相反，模型可能难以兼顾。', cameraClear: '清除运镜', cameraApply: '应用到提示词', cameraNone: '无运镜', clipsReady: '{done}/{total} 个镜头已有视频'
};

const EN: Record<PanelTextKey, string> = {
    clipboardUnavailable: 'The clipboard is unavailable. Please try again.',
    comparePause: "Pause",
    compareUnmute: "Unmute",
    compareMute: "Mute",
    compareAudioLeft: "Listen to left",
    compareAudioRight: "Listen to right",
    compareReset: "Reset view",
    compareClearPreview: "Clear preview",
    compareHelp: "Keyboard help",
    compareHelpKeys: "V switch view · C centre divider · X swap sides\n←/→: image divider ±2%, Shift ±10%; video ±1 s, Shift ±5 s\nMedia strip: ←/→ adjacent item, Home/End first/last\nWheel zooms at pointer · +/- zoom · 0/double-click reset · Middle-drag or drag a zoomed view to pan\nSpace play/pause · M mute · ? help\nEsc: close help → clear preview → close window. Shortcuts stay inactive while typing or when the window is unfocused.",
    locate: 'Find a node', locateHint: 'Search node names or types', 'filter.all': 'All', 'filter.picture': 'Pictures', 'filter.clip': 'Clips', 'filter.sound': 'Sound', 'filter.text': 'Text', 'filter.character': 'Characters',
    noMatch: 'No matching nodes', pins: 'Pins', noPins: 'No pinned nodes yet', clearPins: 'Clear all pins', clearColor: 'Clear this colour', pin: 'Pin', unpin: 'Unpin',
    'color.red': 'Red', 'color.orange': 'Orange', 'color.yellow': 'Yellow', 'color.lime': 'Lime', 'color.green': 'Green', 'color.teal': 'Teal', 'color.cyan': 'Cyan', 'color.blue': 'Blue',
    'color.indigo': 'Indigo', 'color.purple': 'Purple', 'color.pink': 'Pink', 'color.grey': 'Grey',
    arrangeGrid: 'Arrange as a grid', arrangeWires: 'Arrange along the wires', arrangeName: 'Arrange by name', groupLimit: 'A group holds at most {limit} nodes (inner nodes included); this selection has {count}',
    copied: 'Copied {n} nodes', pasted: 'Pasted {n} nodes', pasteRefused: 'The clipboard holds no canvas nodes', submitIn: 'Submitting in {n} s', cancelSubmit: 'Cancel',
    settings: 'Canvas settings', resetDefaults: 'Restore defaults', 'section.interaction': 'Interaction', 'section.wires': 'Wires', 'section.grid': 'Grid and minimap', 'section.layout': 'Arranging and groups', 'section.generation': 'Generation',
    'set.panSensitivity': 'Pan sensitivity', 'set.blankAreaAction': 'Menu on empty space', 'set.blankAreaAction.rightClick': 'Right-click', 'set.blankAreaAction.doubleClick': 'Double-click',
    'set.wheelAction': 'Scroll wheel', 'set.wheelAction.pan': 'Pans', 'set.wheelAction.zoom': 'Zooms', 'set.snapGrid': 'Snap to grid while dragging', 'set.alignmentGuides': 'Alignment guides',
    'set.wireWidth': 'Wire width', 'set.wireHoverHighlight': 'Highlight wires on hover', 'set.wireAnimation': 'Animate wires', 'set.wireFocusOnly': 'Only the selected node’s wires',
    'set.gridSpacing': 'Grid spacing', 'set.gridDotSize': 'Grid dot size', 'set.showGrid': 'Show grid', 'set.minimap': 'Minimap', 'set.arrangeHorizontalSpacing': 'Arrange: horizontal gap',
    'set.arrangeVerticalSpacing': 'Arrange: vertical gap', 'set.groupPadding': 'Group padding', 'set.submitDelaySeconds': 'Countdown before generating', 'set.notifyOnCompletion': 'Notify when done', off: 'Off',
    camera: 'Camera', cameraHint: 'Pick a combination, or up to two moves and a speed; it goes at the start of the prompt.', cameraPresets: 'Combinations', 'cameraCategory.zoom': 'Push and zoom', 'cameraCategory.horizontal': 'Horizontal',
    'cameraCategory.vertical': 'Vertical', 'cameraCategory.special': 'Special views', cameraSpeed: 'Speed', cameraConflict: 'These moves pull in opposite directions; the model may not manage both.', cameraClear: 'Clear camera', cameraApply: 'Apply to prompt', cameraNone: 'No camera move', clipsReady: '{done} of {total} shots have a clip'
};

const ZH_TW: Record<PanelTextKey, string> = {
    clipboardUnavailable: '無法存取剪貼簿，請重試。',
    comparePause: "暫停",
    compareUnmute: "取消靜音",
    compareMute: "靜音",
    compareAudioLeft: "聆聽左側",
    compareAudioRight: "聆聽右側",
    compareReset: "重設檢視",
    compareClearPreview: "清空預覽",
    compareHelp: "快捷鍵說明",
    compareHelpKeys: "V 切換檢視 · C 分割線置中 · X 交換左右\n←/→：圖片分割線 ±2%，Shift ±10%；影片 ±1 秒，Shift ±5 秒\n素材列：←/→ 相鄰項，Home/End 首尾\n滾輪在游標處縮放 · +/- 縮放 · 0/連按兩下重設 · 中鍵或放大後拖曳畫面平移\n空白鍵播放/暫停 · M 靜音 · ? 說明\nEsc：關閉說明 → 清空預覽 → 關閉視窗。輸入文字或視窗失焦時不觸發快捷鍵。",
    clipsReady: '{done}/{total} 個鏡頭已有影片',
    locate: '節點定位', locateHint: '搜尋節點名稱或類型', 'filter.all': '全部', 'filter.picture': '圖片', 'filter.clip': '影片', 'filter.sound': '音訊', 'filter.text': '文字', 'filter.character': '角色',
    noMatch: '沒有符合的節點', pins: '釘選', noPins: '還沒有釘選的節點', clearPins: '清除全部釘選', clearColor: '清除此顏色的釘選', pin: '釘選', unpin: '取消釘選',
    'color.red': '紅', 'color.orange': '橙', 'color.yellow': '黃', 'color.lime': '黃綠', 'color.green': '綠', 'color.teal': '青綠', 'color.cyan': '青', 'color.blue': '藍',
    'color.indigo': '靛藍', 'color.purple': '紫', 'color.pink': '粉紅', 'color.grey': '灰',
    arrangeGrid: '整理成格線', arrangeWires: '沿著連線整理', arrangeName: '依名稱排列', groupLimit: '一個群組最多 {limit} 個節點（含群組內節點），這次選了 {count} 個',
    copied: '已複製 {n} 個節點', pasted: '已貼上 {n} 個節點', pasteRefused: '剪貼簿裡沒有畫布節點', submitIn: '{n} 秒後提交', cancelSubmit: '取消提交',
    settings: '畫布設定', resetDefaults: '還原預設值', 'section.interaction': '互動', 'section.wires': '連線', 'section.grid': '格線與小地圖', 'section.layout': '整理與群組', 'section.generation': '生成',
    'set.panSensitivity': '平移靈敏度', 'set.blankAreaAction': '在空白處開啟選單', 'set.blankAreaAction.rightClick': '右鍵', 'set.blankAreaAction.doubleClick': '連按兩下',
    'set.wheelAction': '滾輪', 'set.wheelAction.pan': '平移', 'set.wheelAction.zoom': '縮放', 'set.snapGrid': '拖曳時貼齊格線', 'set.alignmentGuides': '對齊輔助線',
    'set.wireWidth': '連線粗細', 'set.wireHoverHighlight': '游標停留時突顯連線', 'set.wireAnimation': '連線流動動畫', 'set.wireFocusOnly': '只顯示所選節點的連線',
    'set.gridSpacing': '格線間距', 'set.gridDotSize': '格線點大小', 'set.showGrid': '顯示格線', 'set.minimap': '小地圖', 'set.arrangeHorizontalSpacing': '整理水平間距',
    'set.arrangeVerticalSpacing': '整理垂直間距', 'set.groupPadding': '群組內邊距', 'set.submitDelaySeconds': '生成前倒數', 'set.notifyOnCompletion': '生成完成後通知', off: '關閉',
    camera: '運鏡', cameraHint: '選一個組合，或最多兩個動作加上速度；會寫在提示詞最前面。', cameraPresets: '組合', 'cameraCategory.zoom': '推拉縮放', 'cameraCategory.horizontal': '水平移動',
    'cameraCategory.vertical': '垂直移動', 'cameraCategory.special': '特殊視角', cameraSpeed: '速度', cameraConflict: '這兩個動作方向相反，模型可能難以兼顧。', cameraClear: '清除運鏡', cameraApply: '套用至提示詞', cameraNone: '無運鏡'
};

const JA: Record<PanelTextKey, string> = {
    clipboardUnavailable: 'クリップボードにアクセスできません。もう一度お試しください。',
    comparePause: "一時停止",
    compareUnmute: "ミュート解除",
    compareMute: "ミュート",
    compareAudioLeft: "左の音声",
    compareAudioRight: "右の音声",
    compareReset: "表示をリセット",
    compareClearPreview: "プレビューをクリア",
    compareHelp: "キー操作",
    compareHelpKeys: "V 表示切替 · C 境界を中央へ · X 左右交換\n←/→：画像の境界 ±2%、Shift ±10%；動画 ±1秒、Shift ±5秒\n素材列：←/→ 前後、Home/End 最初/最後\nホイールでカーソル位置を拡大縮小 · +/- 拡大縮小 · 0/ダブルクリックでリセット · 中ボタンまたは拡大後のドラッグで移動\nSpace 再生/一時停止 · M ミュート · ? ヘルプ\nEsc：ヘルプを閉じる → プレビューをクリア → ウィンドウを閉じる。文字入力中やフォーカスが外れている間は無効です。",
    clipsReady: '{total} カット中 {done} カットに動画あり',
    locate: 'ノードを探す', locateHint: 'ノードの名前や種類で検索', 'filter.all': 'すべて', 'filter.picture': '画像', 'filter.clip': '動画', 'filter.sound': '音声', 'filter.text': 'テキスト', 'filter.character': 'キャラクター',
    noMatch: '一致するノードがありません', pins: 'ピン留め', noPins: 'ピン留めしたノードはまだありません', clearPins: 'すべてのピン留めを解除', clearColor: 'この色のピン留めを解除', pin: 'ピン留め', unpin: 'ピン留めを解除',
    'color.red': '赤', 'color.orange': 'オレンジ', 'color.yellow': '黄', 'color.lime': '黄緑', 'color.green': '緑', 'color.teal': '青緑', 'color.cyan': 'シアン', 'color.blue': '青',
    'color.indigo': '藍', 'color.purple': '紫', 'color.pink': 'ピンク', 'color.grey': 'グレー',
    arrangeGrid: 'グリッド状に整列', arrangeWires: '接続に沿って整列', arrangeName: '名前順に整列', groupLimit: 'グループ内のノードを含めて最大 {limit} 個までです。今回の選択は {count} 個です',
    copied: '{n} 個のノードをコピーしました', pasted: '{n} 個のノードを貼り付けました', pasteRefused: 'クリップボードにキャンバスのノードがありません', submitIn: '{n} 秒後に送信', cancelSubmit: '送信をキャンセル',
    settings: 'キャンバス設定', resetDefaults: '初期設定に戻す', 'section.interaction': '操作', 'section.wires': '接続', 'section.grid': 'グリッドとミニマップ', 'section.layout': '整列とグループ', 'section.generation': '生成',
    'set.panSensitivity': 'パンの感度', 'set.blankAreaAction': '空白でメニューを開く操作', 'set.blankAreaAction.rightClick': '右クリック', 'set.blankAreaAction.doubleClick': 'ダブルクリック',
    'set.wheelAction': 'マウスホイール', 'set.wheelAction.pan': 'パン', 'set.wheelAction.zoom': '拡大・縮小', 'set.snapGrid': 'ドラッグ中にグリッドに吸着', 'set.alignmentGuides': '整列ガイド',
    'set.wireWidth': '接続線の太さ', 'set.wireHoverHighlight': 'ホバー時に接続線を強調', 'set.wireAnimation': '接続線をアニメーション表示', 'set.wireFocusOnly': '選択したノードの接続線だけ表示',
    'set.gridSpacing': 'グリッドの間隔', 'set.gridDotSize': 'グリッドの点の大きさ', 'set.showGrid': 'グリッドを表示', 'set.minimap': 'ミニマップ', 'set.arrangeHorizontalSpacing': '整列時の横の間隔',
    'set.arrangeVerticalSpacing': '整列時の縦の間隔', 'set.groupPadding': 'グループの内側の余白', 'set.submitDelaySeconds': '生成前のカウントダウン', 'set.notifyOnCompletion': '生成完了時に通知', off: 'オフ',
    camera: 'カメラワーク', cameraHint: '組み合わせを選ぶか、最大2つの動きと速度を選んでください。プロンプトの先頭に追加します。', cameraPresets: '組み合わせ', 'cameraCategory.zoom': 'ドリーイン・アウトとズーム', 'cameraCategory.horizontal': '水平移動',
    'cameraCategory.vertical': '垂直移動', 'cameraCategory.special': '特殊な視点', cameraSpeed: '速度', cameraConflict: 'この2つの動きは逆方向です。モデルが両方を表現できない場合があります。', cameraClear: 'カメラワークをクリア', cameraApply: 'プロンプトに適用', cameraNone: 'カメラワークなし'
};

const KO: Record<PanelTextKey, string> = {
    clipboardUnavailable: '클립보드에 접근할 수 없습니다. 다시 시도해 주세요.',
    comparePause: "일시 정지",
    compareUnmute: "음소거 해제",
    compareMute: "음소거",
    compareAudioLeft: "왼쪽 소리 듣기",
    compareAudioRight: "오른쪽 소리 듣기",
    compareReset: "보기 초기화",
    compareClearPreview: "미리보기 비우기",
    compareHelp: "단축키 도움말",
    compareHelpKeys: "V 보기 전환 · C 구분선 중앙 · X 좌우 교환\n←/→: 이미지 구분선 ±2%, Shift ±10%; 영상 ±1초, Shift ±5초\n미디어 목록: ←/→ 이전/다음, Home/End 처음/끝\n휠로 포인터 위치 확대 · +/- 확대/축소 · 0/두 번 클릭 초기화 · 가운데 버튼 또는 확대 후 드래그로 이동\nSpace 재생/일시 정지 · M 음소거 · ? 도움말\nEsc: 도움말 닫기 → 미리보기 비우기 → 창 닫기. 입력 중이거나 창에 초점이 없으면 단축키가 동작하지 않습니다.",
    clipsReady: '{total}개 중 {done}개 장면에 영상 있음',
    locate: '노드 찾기', locateHint: '노드 이름이나 종류 검색', 'filter.all': '전체', 'filter.picture': '이미지', 'filter.clip': '영상', 'filter.sound': '오디오', 'filter.text': '텍스트', 'filter.character': '캐릭터',
    noMatch: '일치하는 노드가 없습니다', pins: '고정한 노드', noPins: '아직 고정한 노드가 없습니다', clearPins: '모든 고정 해제', clearColor: '이 색상의 고정 해제', pin: '고정', unpin: '고정 해제',
    'color.red': '빨강', 'color.orange': '주황', 'color.yellow': '노랑', 'color.lime': '연두', 'color.green': '초록', 'color.teal': '청록', 'color.cyan': '시안', 'color.blue': '파랑',
    'color.indigo': '남색', 'color.purple': '보라', 'color.pink': '분홍', 'color.grey': '회색',
    arrangeGrid: '격자로 정리', arrangeWires: '연결을 따라 정리', arrangeName: '이름순으로 정리', groupLimit: '그룹에는 내부 노드를 포함해 최대 {limit}개까지 넣을 수 있습니다. 현재 {count}개를 선택했습니다',
    copied: '노드 {n}개를 복사했습니다', pasted: '노드 {n}개를 붙여넣었습니다', pasteRefused: '클립보드에 캔버스 노드가 없습니다', submitIn: '{n}초 후 제출', cancelSubmit: '제출 취소',
    settings: '캔버스 설정', resetDefaults: '기본값으로 복원', 'section.interaction': '조작', 'section.wires': '연결', 'section.grid': '격자와 미니맵', 'section.layout': '정리와 그룹', 'section.generation': '생성',
    'set.panSensitivity': '화면 이동 감도', 'set.blankAreaAction': '빈 곳에서 메뉴 열기', 'set.blankAreaAction.rightClick': '오른쪽 클릭', 'set.blankAreaAction.doubleClick': '두 번 클릭',
    'set.wheelAction': '마우스 휠', 'set.wheelAction.pan': '화면 이동', 'set.wheelAction.zoom': '확대·축소', 'set.snapGrid': '드래그할 때 격자에 맞추기', 'set.alignmentGuides': '정렬 안내선',
    'set.wireWidth': '연결선 두께', 'set.wireHoverHighlight': '마우스를 올리면 연결선 강조', 'set.wireAnimation': '연결선 애니메이션', 'set.wireFocusOnly': '선택한 노드의 연결선만 표시',
    'set.gridSpacing': '격자 간격', 'set.gridDotSize': '격자 점 크기', 'set.showGrid': '격자 표시', 'set.minimap': '미니맵', 'set.arrangeHorizontalSpacing': '정리할 때 가로 간격',
    'set.arrangeVerticalSpacing': '정리할 때 세로 간격', 'set.groupPadding': '그룹 안쪽 여백', 'set.submitDelaySeconds': '생성 전 카운트다운', 'set.notifyOnCompletion': '생성 완료 시 알림', off: '끄기',
    camera: '카메라 움직임', cameraHint: '조합을 선택하거나 동작을 최대 두 개 고르고 속도를 정하세요. 프롬프트 맨 앞에 추가됩니다.', cameraPresets: '조합', 'cameraCategory.zoom': '돌리와 줌', 'cameraCategory.horizontal': '수평 이동',
    'cameraCategory.vertical': '수직 이동', 'cameraCategory.special': '특수 시점', cameraSpeed: '속도', cameraConflict: '두 동작의 방향이 반대라 모델이 모두 표현하기 어려울 수 있습니다.', cameraClear: '카메라 움직임 지우기', cameraApply: '프롬프트에 적용', cameraNone: '카메라 움직임 없음'
};

const ES: Record<PanelTextKey, string> = {
    clipboardUnavailable: 'No se puede acceder al portapapeles. Vuelve a intentarlo.',
    comparePause: "Pausar",
    compareUnmute: "Activar sonido",
    compareMute: "Silenciar",
    compareAudioLeft: "Escuchar izquierda",
    compareAudioRight: "Escuchar derecha",
    compareReset: "Restablecer vista",
    compareClearPreview: "Vaciar vista previa",
    compareHelp: "Ayuda de teclado",
    compareHelpKeys: "V cambiar vista · C centrar divisor · X intercambiar\n←/→: divisor ±2%, Shift ±10%; vídeo ±1 s, Shift ±5 s\nTira de medios: ←/→ elemento adyacente, Home/End primero/último\nRueda: zoom en el puntero · +/- zoom · 0/doble clic restablecer · Arrastrar con botón central o tras ampliar para desplazar\nEspacio reproducir/pausar · M silenciar · ? ayuda\nEsc: cerrar ayuda → vaciar vista previa → cerrar ventana. Sin atajos al escribir o si la ventana no tiene el foco.",
    clipsReady: '{done} de {total} planos tienen vídeo',
    locate: 'Buscar nodo', locateHint: 'Buscar por nombre o tipo de nodo', 'filter.all': 'Todos', 'filter.picture': 'Imágenes', 'filter.clip': 'Vídeos', 'filter.sound': 'Audio', 'filter.text': 'Texto', 'filter.character': 'Personajes',
    noMatch: 'No hay nodos coincidentes', pins: 'Fijados', noPins: 'Aún no hay nodos fijados', clearPins: 'Desfijar todos', clearColor: 'Desfijar los de este color', pin: 'Fijar', unpin: 'Desfijar',
    'color.red': 'Rojo', 'color.orange': 'Naranja', 'color.yellow': 'Amarillo', 'color.lime': 'Verde lima', 'color.green': 'Verde', 'color.teal': 'Verde azulado', 'color.cyan': 'Cian', 'color.blue': 'Azul',
    'color.indigo': 'Índigo', 'color.purple': 'Morado', 'color.pink': 'Rosa', 'color.grey': 'Gris',
    arrangeGrid: 'Organizar en cuadrícula', arrangeWires: 'Organizar según las conexiones', arrangeName: 'Ordenar por nombre', groupLimit: 'Un grupo admite hasta {limit} nodos, incluidos los internos; has seleccionado {count}',
    copied: 'Se han copiado {n} nodos', pasted: 'Se han pegado {n} nodos', pasteRefused: 'El portapapeles no contiene nodos del lienzo', submitIn: 'Se enviará en {n} s', cancelSubmit: 'Cancelar envío',
    settings: 'Ajustes del lienzo', resetDefaults: 'Restablecer valores predeterminados', 'section.interaction': 'Interacción', 'section.wires': 'Conexiones', 'section.grid': 'Cuadrícula y minimapa', 'section.layout': 'Organización y grupos', 'section.generation': 'Generación',
    'set.panSensitivity': 'Sensibilidad del desplazamiento', 'set.blankAreaAction': 'Abrir menú en un espacio vacío', 'set.blankAreaAction.rightClick': 'Clic derecho', 'set.blankAreaAction.doubleClick': 'Doble clic',
    'set.wheelAction': 'Rueda del ratón', 'set.wheelAction.pan': 'Desplazar', 'set.wheelAction.zoom': 'Zoom', 'set.snapGrid': 'Ajustar a la cuadrícula al arrastrar', 'set.alignmentGuides': 'Guías de alineación',
    'set.wireWidth': 'Grosor de las conexiones', 'set.wireHoverHighlight': 'Resaltar conexiones al pasar el cursor', 'set.wireAnimation': 'Animar conexiones', 'set.wireFocusOnly': 'Mostrar solo las conexiones del nodo seleccionado',
    'set.gridSpacing': 'Espaciado de la cuadrícula', 'set.gridDotSize': 'Tamaño de los puntos de la cuadrícula', 'set.showGrid': 'Mostrar cuadrícula', 'set.minimap': 'Minimapa', 'set.arrangeHorizontalSpacing': 'Espaciado horizontal al organizar',
    'set.arrangeVerticalSpacing': 'Espaciado vertical al organizar', 'set.groupPadding': 'Margen interior del grupo', 'set.submitDelaySeconds': 'Cuenta atrás antes de generar', 'set.notifyOnCompletion': 'Avisar al terminar la generación', off: 'Desactivado',
    camera: 'Movimiento de cámara', cameraHint: 'Elige una combinación o hasta dos movimientos y una velocidad; se añadirán al inicio de la descripción.', cameraPresets: 'Combinaciones', 'cameraCategory.zoom': 'Acercamiento, alejamiento y zoom', 'cameraCategory.horizontal': 'Movimiento horizontal',
    'cameraCategory.vertical': 'Movimiento vertical', 'cameraCategory.special': 'Vistas especiales', cameraSpeed: 'Velocidad', cameraConflict: 'Estos movimientos van en direcciones opuestas; puede que el modelo no consiga combinar ambos.', cameraClear: 'Borrar movimiento de cámara', cameraApply: 'Aplicar a la descripción', cameraNone: 'Sin movimiento de cámara'
};

const FR: Record<PanelTextKey, string> = {
    clipboardUnavailable: 'Le presse-papiers est inaccessible. Réessayez.',
    comparePause: "Pause",
    compareUnmute: "Activer le son",
    compareMute: "Couper le son",
    compareAudioLeft: "Écouter à gauche",
    compareAudioRight: "Écouter à droite",
    compareReset: "Réinitialiser la vue",
    compareClearPreview: "Vider l’aperçu",
    compareHelp: "Aide clavier",
    compareHelpKeys: "V changer de vue · C centrer la séparation · X permuter\n←/→ : séparation ±2 %, Shift ±10 % ; vidéo ±1 s, Shift ±5 s\nBande de médias : ←/→ élément voisin, Home/End premier/dernier\nMolette : zoom au pointeur · +/- zoom · 0/double clic réinitialiser · Glisser avec le bouton central ou après zoom pour déplacer\nEspace lecture/pause · M couper le son · ? aide\nEsc : fermer l’aide → vider l’aperçu → fermer la fenêtre. Raccourcis inactifs pendant la saisie ou sans focus.",
    clipsReady: '{done} plans sur {total} ont une vidéo',
    locate: 'Trouver un nœud', locateHint: 'Rechercher par nom ou type de nœud', 'filter.all': 'Tous', 'filter.picture': 'Images', 'filter.clip': 'Vidéos', 'filter.sound': 'Audio', 'filter.text': 'Texte', 'filter.character': 'Personnages',
    noMatch: 'Aucun nœud correspondant', pins: 'Épinglés', noPins: 'Aucun nœud épinglé pour le moment', clearPins: 'Tout désépingler', clearColor: 'Désépingler cette couleur', pin: 'Épingler', unpin: 'Désépingler',
    'color.red': 'Rouge', 'color.orange': 'Orange', 'color.yellow': 'Jaune', 'color.lime': 'Vert citron', 'color.green': 'Vert', 'color.teal': 'Bleu-vert', 'color.cyan': 'Cyan', 'color.blue': 'Bleu',
    'color.indigo': 'Indigo', 'color.purple': 'Violet', 'color.pink': 'Rose', 'color.grey': 'Gris',
    arrangeGrid: 'Organiser en grille', arrangeWires: 'Organiser selon les connexions', arrangeName: 'Trier par nom', groupLimit: 'Un groupe peut contenir jusqu’à {limit} nœuds, nœuds internes compris ; vous en avez sélectionné {count}',
    copied: '{n} nœuds copiés', pasted: '{n} nœuds collés', pasteRefused: 'Le presse-papiers ne contient aucun nœud du canevas', submitIn: 'Envoi dans {n} s', cancelSubmit: 'Annuler l’envoi',
    settings: 'Paramètres du canevas', resetDefaults: 'Rétablir les valeurs par défaut', 'section.interaction': 'Interaction', 'section.wires': 'Connexions', 'section.grid': 'Grille et minicarte', 'section.layout': 'Organisation et groupes', 'section.generation': 'Génération',
    'set.panSensitivity': 'Sensibilité du déplacement', 'set.blankAreaAction': 'Ouvrir le menu dans un espace vide', 'set.blankAreaAction.rightClick': 'Clic droit', 'set.blankAreaAction.doubleClick': 'Double-clic',
    'set.wheelAction': 'Molette de la souris', 'set.wheelAction.pan': 'Déplacement', 'set.wheelAction.zoom': 'Zoom', 'set.snapGrid': 'Aligner sur la grille pendant le déplacement', 'set.alignmentGuides': 'Guides d’alignement',
    'set.wireWidth': 'Épaisseur des connexions', 'set.wireHoverHighlight': 'Mettre les connexions en surbrillance au survol', 'set.wireAnimation': 'Animer les connexions', 'set.wireFocusOnly': 'Afficher uniquement les connexions du nœud sélectionné',
    'set.gridSpacing': 'Espacement de la grille', 'set.gridDotSize': 'Taille des points de la grille', 'set.showGrid': 'Afficher la grille', 'set.minimap': 'Minicarte', 'set.arrangeHorizontalSpacing': 'Espacement horizontal lors de l’organisation',
    'set.arrangeVerticalSpacing': 'Espacement vertical lors de l’organisation', 'set.groupPadding': 'Marge intérieure des groupes', 'set.submitDelaySeconds': 'Compte à rebours avant la génération', 'set.notifyOnCompletion': 'Notifier à la fin de la génération', off: 'Désactivé',
    camera: 'Mouvement de caméra', cameraHint: 'Choisissez une combinaison ou jusqu’à deux mouvements et une vitesse ; ils seront ajoutés au début de la description.', cameraPresets: 'Combinaisons', 'cameraCategory.zoom': 'Travelling et zoom', 'cameraCategory.horizontal': 'Mouvement horizontal',
    'cameraCategory.vertical': 'Mouvement vertical', 'cameraCategory.special': 'Vues spéciales', cameraSpeed: 'Vitesse', cameraConflict: 'Ces mouvements vont dans des directions opposées ; le modèle risque de ne pas pouvoir combiner les deux.', cameraClear: 'Effacer le mouvement de caméra', cameraApply: 'Appliquer à la description', cameraNone: 'Aucun mouvement de caméra'
};

const DE: Record<PanelTextKey, string> = {
    clipboardUnavailable: 'Die Zwischenablage ist nicht verfügbar. Bitte erneut versuchen.',
    comparePause: "Pause",
    compareUnmute: "Ton einschalten",
    compareMute: "Stummschalten",
    compareAudioLeft: "Linke Tonspur",
    compareAudioRight: "Rechte Tonspur",
    compareReset: "Ansicht zurücksetzen",
    compareClearPreview: "Vorschau leeren",
    compareHelp: "Tastaturhilfe",
    compareHelpKeys: "V Ansicht wechseln · C Trennlinie zentrieren · X Seiten tauschen\n←/→: Bildtrennlinie ±2 %, Shift ±10 %; Video ±1 s, Shift ±5 s\nMedienleiste: ←/→ Nachbar, Home/End Anfang/Ende\nMausrad zoomt am Zeiger · +/- Zoom · 0/Doppelklick zurücksetzen · Mittlere Taste ziehen oder vergrößerte Ansicht ziehen zum Verschieben\nLeertaste Wiedergabe/Pause · M stummschalten · ? Hilfe\nEsc: Hilfe schließen → Vorschau leeren → Fenster schließen. Beim Tippen oder ohne Fensterfokus sind Kürzel inaktiv.",
    clipsReady: '{done} von {total} Einstellungen haben ein Video',
    locate: 'Knoten finden', locateHint: 'Nach Knotennamen oder Typ suchen', 'filter.all': 'Alle', 'filter.picture': 'Bilder', 'filter.clip': 'Videos', 'filter.sound': 'Audio', 'filter.text': 'Text', 'filter.character': 'Figuren',
    noMatch: 'Keine passenden Knoten', pins: 'Angeheftet', noPins: 'Noch keine angehefteten Knoten', clearPins: 'Alle Anheftungen lösen', clearColor: 'Anheftungen dieser Farbe lösen', pin: 'Anheften', unpin: 'Loslösen',
    'color.red': 'Rot', 'color.orange': 'Orange', 'color.yellow': 'Gelb', 'color.lime': 'Gelbgrün', 'color.green': 'Grün', 'color.teal': 'Blaugrün', 'color.cyan': 'Cyan', 'color.blue': 'Blau',
    'color.indigo': 'Indigo', 'color.purple': 'Violett', 'color.pink': 'Rosa', 'color.grey': 'Grau',
    arrangeGrid: 'Im Raster anordnen', arrangeWires: 'Entlang der Verbindungen anordnen', arrangeName: 'Nach Namen anordnen', groupLimit: 'Eine Gruppe enthält höchstens {limit} Knoten, einschließlich innerer Knoten; ausgewählt sind {count}',
    copied: '{n} Knoten kopiert', pasted: '{n} Knoten eingefügt', pasteRefused: 'Die Zwischenablage enthält keine Knoten der Arbeitsfläche', submitIn: 'Senden in {n} s', cancelSubmit: 'Senden abbrechen',
    settings: 'Einstellungen der Arbeitsfläche', resetDefaults: 'Standardwerte wiederherstellen', 'section.interaction': 'Bedienung', 'section.wires': 'Verbindungen', 'section.grid': 'Raster und Minikarte', 'section.layout': 'Anordnung und Gruppen', 'section.generation': 'Erzeugung',
    'set.panSensitivity': 'Empfindlichkeit beim Verschieben', 'set.blankAreaAction': 'Menü auf freier Fläche öffnen', 'set.blankAreaAction.rightClick': 'Rechtsklick', 'set.blankAreaAction.doubleClick': 'Doppelklick',
    'set.wheelAction': 'Mausrad', 'set.wheelAction.pan': 'Verschieben', 'set.wheelAction.zoom': 'Zoomen', 'set.snapGrid': 'Beim Ziehen am Raster einrasten', 'set.alignmentGuides': 'Ausrichtungslinien',
    'set.wireWidth': 'Breite der Verbindungslinien', 'set.wireHoverHighlight': 'Verbindungen beim Darüberfahren hervorheben', 'set.wireAnimation': 'Verbindungen animieren', 'set.wireFocusOnly': 'Nur Verbindungen des ausgewählten Knotens anzeigen',
    'set.gridSpacing': 'Rasterabstand', 'set.gridDotSize': 'Größe der Rasterpunkte', 'set.showGrid': 'Raster anzeigen', 'set.minimap': 'Minikarte', 'set.arrangeHorizontalSpacing': 'Horizontaler Abstand beim Anordnen',
    'set.arrangeVerticalSpacing': 'Vertikaler Abstand beim Anordnen', 'set.groupPadding': 'Innenabstand der Gruppen', 'set.submitDelaySeconds': 'Countdown vor der Erzeugung', 'set.notifyOnCompletion': 'Nach der Erzeugung benachrichtigen', off: 'Aus',
    camera: 'Kamerabewegung', cameraHint: 'Wähle eine Kombination oder bis zu zwei Bewegungen und eine Geschwindigkeit; sie werden am Anfang der Beschreibung eingefügt.', cameraPresets: 'Kombinationen', 'cameraCategory.zoom': 'Kamerafahrt und Zoom', 'cameraCategory.horizontal': 'Horizontale Bewegung',
    'cameraCategory.vertical': 'Vertikale Bewegung', 'cameraCategory.special': 'Besondere Perspektiven', cameraSpeed: 'Geschwindigkeit', cameraConflict: 'Diese Bewegungen gehen in entgegengesetzte Richtungen; das Modell kann möglicherweise nicht beide umsetzen.', cameraClear: 'Kamerabewegung entfernen', cameraApply: 'Auf die Beschreibung anwenden', cameraNone: 'Keine Kamerabewegung'
};

const PT_BR: Record<PanelTextKey, string> = {
    clipboardUnavailable: 'A área de transferência está indisponível. Tente novamente.',
    comparePause: "Pausar",
    compareUnmute: "Ativar som",
    compareMute: "Silenciar",
    compareAudioLeft: "Ouvir à esquerda",
    compareAudioRight: "Ouvir à direita",
    compareReset: "Redefinir visualização",
    compareClearPreview: "Limpar prévia",
    compareHelp: "Ajuda do teclado",
    compareHelpKeys: "V alternar visualização · C centralizar divisão · X trocar lados\n←/→: divisão da imagem ±2%, Shift ±10%; vídeo ±1 s, Shift ±5 s\nFaixa de mídias: ←/→ item vizinho, Home/End primeiro/último\nRoda: zoom no ponteiro · +/- zoom · 0/clique duplo redefinir · Arraste com o botão central ou após ampliar para deslocar\nEspaço reproduzir/pausar · M silenciar · ? ajuda\nEsc: fechar ajuda → limpar prévia → fechar janela. Atalhos inativos ao digitar ou quando a janela não tem foco.",
    clipsReady: '{done} de {total} planos têm vídeo',
    locate: 'Encontrar nó', locateHint: 'Buscar pelo nome ou tipo de nó', 'filter.all': 'Todos', 'filter.picture': 'Imagens', 'filter.clip': 'Vídeos', 'filter.sound': 'Áudio', 'filter.text': 'Texto', 'filter.character': 'Personagens',
    noMatch: 'Nenhum nó encontrado', pins: 'Fixados', noPins: 'Ainda não há nós fixados', clearPins: 'Desafixar todos', clearColor: 'Desafixar os desta cor', pin: 'Fixar', unpin: 'Desafixar',
    'color.red': 'Vermelho', 'color.orange': 'Laranja', 'color.yellow': 'Amarelo', 'color.lime': 'Verde-lima', 'color.green': 'Verde', 'color.teal': 'Verde-azulado', 'color.cyan': 'Ciano', 'color.blue': 'Azul',
    'color.indigo': 'Índigo', 'color.purple': 'Roxo', 'color.pink': 'Rosa', 'color.grey': 'Cinza',
    arrangeGrid: 'Organizar em grade', arrangeWires: 'Organizar pelas conexões', arrangeName: 'Organizar por nome', groupLimit: 'Um grupo aceita até {limit} nós, incluindo os internos; você selecionou {count}',
    copied: '{n} nós copiados', pasted: '{n} nós colados', pasteRefused: 'A área de transferência não contém nós da tela', submitIn: 'Envio em {n} s', cancelSubmit: 'Cancelar envio',
    settings: 'Configurações da tela', resetDefaults: 'Restaurar padrões', 'section.interaction': 'Interação', 'section.wires': 'Conexões', 'section.grid': 'Grade e minimapa', 'section.layout': 'Organização e grupos', 'section.generation': 'Geração',
    'set.panSensitivity': 'Sensibilidade do deslocamento', 'set.blankAreaAction': 'Abrir menu no espaço vazio', 'set.blankAreaAction.rightClick': 'Clique direito', 'set.blankAreaAction.doubleClick': 'Clique duplo',
    'set.wheelAction': 'Roda do mouse', 'set.wheelAction.pan': 'Deslocar', 'set.wheelAction.zoom': 'Zoom', 'set.snapGrid': 'Alinhar à grade ao arrastar', 'set.alignmentGuides': 'Guias de alinhamento',
    'set.wireWidth': 'Espessura das conexões', 'set.wireHoverHighlight': 'Destacar conexões ao passar o cursor', 'set.wireAnimation': 'Animar conexões', 'set.wireFocusOnly': 'Mostrar apenas as conexões do nó selecionado',
    'set.gridSpacing': 'Espaçamento da grade', 'set.gridDotSize': 'Tamanho dos pontos da grade', 'set.showGrid': 'Mostrar grade', 'set.minimap': 'Minimapa', 'set.arrangeHorizontalSpacing': 'Espaçamento horizontal ao organizar',
    'set.arrangeVerticalSpacing': 'Espaçamento vertical ao organizar', 'set.groupPadding': 'Margem interna dos grupos', 'set.submitDelaySeconds': 'Contagem regressiva antes de gerar', 'set.notifyOnCompletion': 'Avisar ao concluir a geração', off: 'Desativado',
    camera: 'Movimento de câmera', cameraHint: 'Escolha uma combinação ou até dois movimentos e uma velocidade; serão adicionados ao início da descrição.', cameraPresets: 'Combinações', 'cameraCategory.zoom': 'Aproximação, afastamento e zoom', 'cameraCategory.horizontal': 'Movimento horizontal',
    'cameraCategory.vertical': 'Movimento vertical', 'cameraCategory.special': 'Vistas especiais', cameraSpeed: 'Velocidade', cameraConflict: 'Esses movimentos seguem direções opostas; o modelo pode ter dificuldade para combinar os dois.', cameraClear: 'Limpar movimento de câmera', cameraApply: 'Aplicar à descrição', cameraNone: 'Sem movimento de câmera'
};

const RU: Record<PanelTextKey, string> = {
    clipboardUnavailable: 'Буфер обмена недоступен. Повторите попытку.',
    comparePause: "Пауза",
    compareUnmute: "Включить звук",
    compareMute: "Выключить звук",
    compareAudioLeft: "Звук слева",
    compareAudioRight: "Звук справа",
    compareReset: "Сбросить вид",
    compareClearPreview: "Очистить просмотр",
    compareHelp: "Помощь по клавишам",
    compareHelpKeys: "V сменить вид · C разделитель по центру · X поменять стороны\n←/→: разделитель ±2%, Shift ±10%; видео ±1 с, Shift ±5 с\nЛента: ←/→ соседний элемент, Home/End первый/последний\nКолесо: масштаб у указателя · +/- масштаб · 0/двойной щелчок сброс · Перетаскивание средней кнопкой или после увеличения перемещает вид\nПробел пуск/пауза · M звук · ? помощь\nEsc: закрыть помощь → очистить просмотр → закрыть окно. При вводе текста или без фокуса сочетания не действуют.",
    clipsReady: 'Видео есть у {done} из {total} кадров',
    locate: 'Найти узел', locateHint: 'Поиск по названию или типу узла', 'filter.all': 'Все', 'filter.picture': 'Изображения', 'filter.clip': 'Видео', 'filter.sound': 'Аудио', 'filter.text': 'Текст', 'filter.character': 'Персонажи',
    noMatch: 'Подходящих узлов нет', pins: 'Закреплённые', noPins: 'Закреплённых узлов пока нет', clearPins: 'Открепить все', clearColor: 'Открепить узлы этого цвета', pin: 'Закрепить', unpin: 'Открепить',
    'color.red': 'Красный', 'color.orange': 'Оранжевый', 'color.yellow': 'Жёлтый', 'color.lime': 'Лаймовый', 'color.green': 'Зелёный', 'color.teal': 'Сине-зелёный', 'color.cyan': 'Голубой', 'color.blue': 'Синий',
    'color.indigo': 'Индиго', 'color.purple': 'Фиолетовый', 'color.pink': 'Розовый', 'color.grey': 'Серый',
    arrangeGrid: 'Упорядочить по сетке', arrangeWires: 'Упорядочить по связям', arrangeName: 'Упорядочить по названию', groupLimit: 'В группе может быть до {limit} узлов, включая вложенные; выбрано: {count}',
    copied: 'Скопировано узлов: {n}', pasted: 'Вставлено узлов: {n}', pasteRefused: 'В буфере обмена нет узлов холста', submitIn: 'Отправка через {n} с', cancelSubmit: 'Отменить отправку',
    settings: 'Настройки холста', resetDefaults: 'Восстановить значения по умолчанию', 'section.interaction': 'Управление', 'section.wires': 'Связи', 'section.grid': 'Сетка и мини-карта', 'section.layout': 'Размещение и группы', 'section.generation': 'Генерация',
    'set.panSensitivity': 'Чувствительность перемещения', 'set.blankAreaAction': 'Открывать меню на пустом месте', 'set.blankAreaAction.rightClick': 'Правой кнопкой', 'set.blankAreaAction.doubleClick': 'Двойным щелчком',
    'set.wheelAction': 'Колесо мыши', 'set.wheelAction.pan': 'Перемещение', 'set.wheelAction.zoom': 'Масштабирование', 'set.snapGrid': 'Привязка к сетке при перетаскивании', 'set.alignmentGuides': 'Направляющие выравнивания',
    'set.wireWidth': 'Толщина связей', 'set.wireHoverHighlight': 'Подсвечивать связи при наведении', 'set.wireAnimation': 'Анимировать связи', 'set.wireFocusOnly': 'Показывать только связи выбранного узла',
    'set.gridSpacing': 'Шаг сетки', 'set.gridDotSize': 'Размер точек сетки', 'set.showGrid': 'Показывать сетку', 'set.minimap': 'Мини-карта', 'set.arrangeHorizontalSpacing': 'Горизонтальный интервал при размещении',
    'set.arrangeVerticalSpacing': 'Вертикальный интервал при размещении', 'set.groupPadding': 'Внутренние отступы групп', 'set.submitDelaySeconds': 'Обратный отсчёт перед генерацией', 'set.notifyOnCompletion': 'Уведомлять о завершении генерации', off: 'Выкл.',
    camera: 'Движение камеры', cameraHint: 'Выберите комбинацию или до двух движений и скорость; они будут добавлены в начало описания.', cameraPresets: 'Комбинации', 'cameraCategory.zoom': 'Наезд, отъезд и зум', 'cameraCategory.horizontal': 'Горизонтальное движение',
    'cameraCategory.vertical': 'Вертикальное движение', 'cameraCategory.special': 'Особые ракурсы', cameraSpeed: 'Скорость', cameraConflict: 'Эти движения направлены в противоположные стороны; модели может быть трудно совместить их.', cameraClear: 'Убрать движение камеры', cameraApply: 'Применить к описанию', cameraNone: 'Без движения камеры'
};

const AR: Record<PanelTextKey, string> = {
    clipboardUnavailable: 'الحافظة غير متاحة. يرجى المحاولة مرة أخرى.',
    comparePause: "إيقاف مؤقت",
    compareUnmute: "تشغيل الصوت",
    compareMute: "كتم الصوت",
    compareAudioLeft: "الاستماع لليسار",
    compareAudioRight: "الاستماع لليمين",
    compareReset: "إعادة ضبط العرض",
    compareClearPreview: "مسح المعاينة",
    compareHelp: "مساعدة الاختصارات",
    compareHelpKeys: "V تبديل العرض · C توسيط الفاصل · X تبديل الجانبين\n←/→: فاصل الصورة ±2%، مع Shift ±10%؛ الفيديو ±1 ثانية، مع Shift ±5 ثوانٍ\nشريط الوسائط: ←/→ العنصر المجاور، Home/End الأول/الأخير\nالعجلة تكبّر عند المؤشر · +/- تكبير وتصغير · 0/نقر مزدوج لإعادة الضبط · السحب بالزر الأوسط أو بعد التكبير لتحريك العرض\nالمسافة تشغيل/إيقاف · M كتم · ? مساعدة\nEsc: إغلاق المساعدة ← مسح المعاينة ← إغلاق النافذة. لا تعمل الاختصارات أثناء الكتابة أو عندما تفقد النافذة التركيز.",
    clipsReady: '{done} من {total} لقطات لها فيديو',
    locate: 'العثور على عقدة', locateHint: 'ابحث باسم العقدة أو نوعها', 'filter.all': 'الكل', 'filter.picture': 'صور', 'filter.clip': 'فيديو', 'filter.sound': 'صوت', 'filter.text': 'نص', 'filter.character': 'شخصيات',
    noMatch: 'لا توجد عقد مطابقة', pins: 'العقد المثبتة', noPins: 'لا توجد عقد مثبتة بعد', clearPins: 'إلغاء تثبيت الكل', clearColor: 'إلغاء تثبيت عقد هذا اللون', pin: 'تثبيت', unpin: 'إلغاء التثبيت',
    'color.red': 'أحمر', 'color.orange': 'برتقالي', 'color.yellow': 'أصفر', 'color.lime': 'أخضر ليموني', 'color.green': 'أخضر', 'color.teal': 'أخضر مزرق', 'color.cyan': 'سماوي', 'color.blue': 'أزرق',
    'color.indigo': 'نيلي', 'color.purple': 'بنفسجي', 'color.pink': 'وردي', 'color.grey': 'رمادي',
    arrangeGrid: 'ترتيب في شبكة', arrangeWires: 'ترتيب حسب الاتصالات', arrangeName: 'ترتيب حسب الاسم', groupLimit: 'تضم المجموعة حتى {limit} عقدة، بما فيها العقد الداخلية؛ عدد العقد المحددة: {count}',
    copied: 'عدد العقد المنسوخة: {n}', pasted: 'عدد العقد الملصقة: {n}', pasteRefused: 'لا تحتوي الحافظة على عقد من اللوحة', submitIn: 'الإرسال بعد {n} ث', cancelSubmit: 'إلغاء الإرسال',
    settings: 'إعدادات اللوحة', resetDefaults: 'استعادة الإعدادات الافتراضية', 'section.interaction': 'التفاعل', 'section.wires': 'الاتصالات', 'section.grid': 'الشبكة والخريطة المصغرة', 'section.layout': 'الترتيب والمجموعات', 'section.generation': 'الإنشاء',
    'set.panSensitivity': 'حساسية التحريك', 'set.blankAreaAction': 'فتح القائمة في المساحة الفارغة', 'set.blankAreaAction.rightClick': 'النقر بزر الفأرة الأيمن', 'set.blankAreaAction.doubleClick': 'النقر مرتين',
    'set.wheelAction': 'عجلة الفأرة', 'set.wheelAction.pan': 'تحريك', 'set.wheelAction.zoom': 'تكبير وتصغير', 'set.snapGrid': 'محاذاة إلى الشبكة أثناء السحب', 'set.alignmentGuides': 'أدلة المحاذاة',
    'set.wireWidth': 'سُمك خطوط الاتصال', 'set.wireHoverHighlight': 'تمييز الاتصالات عند مرور المؤشر', 'set.wireAnimation': 'تحريك خطوط الاتصال', 'set.wireFocusOnly': 'عرض اتصالات العقدة المحددة فقط',
    'set.gridSpacing': 'تباعد الشبكة', 'set.gridDotSize': 'حجم نقاط الشبكة', 'set.showGrid': 'عرض الشبكة', 'set.minimap': 'خريطة مصغرة', 'set.arrangeHorizontalSpacing': 'التباعد الأفقي عند الترتيب',
    'set.arrangeVerticalSpacing': 'التباعد العمودي عند الترتيب', 'set.groupPadding': 'الهوامش الداخلية للمجموعات', 'set.submitDelaySeconds': 'العد التنازلي قبل الإنشاء', 'set.notifyOnCompletion': 'إشعار عند اكتمال الإنشاء', off: 'إيقاف',
    camera: 'حركة الكاميرا', cameraHint: 'اختر مجموعة حركات، أو حركتين كحد أقصى مع السرعة؛ ستُضاف إلى بداية الوصف.', cameraPresets: 'مجموعات الحركات', 'cameraCategory.zoom': 'اقتراب وابتعاد وزوم', 'cameraCategory.horizontal': 'حركة أفقية',
    'cameraCategory.vertical': 'حركة عمودية', 'cameraCategory.special': 'زوايا خاصة', cameraSpeed: 'السرعة', cameraConflict: 'هاتان الحركتان في اتجاهين متعاكسين؛ قد يصعب على النموذج الجمع بينهما.', cameraClear: 'مسح حركة الكاميرا', cameraApply: 'تطبيق على الوصف', cameraNone: 'بدون حركة كاميرا'
};

const HI: Record<PanelTextKey, string> = {
    clipboardUnavailable: 'क्लिपबोर्ड उपलब्ध नहीं है। कृपया फिर से कोशिश करें।',
    comparePause: "रोकें",
    compareUnmute: "आवाज़ चालू करें",
    compareMute: "म्यूट करें",
    compareAudioLeft: "बाईं आवाज़ सुनें",
    compareAudioRight: "दाईं आवाज़ सुनें",
    compareReset: "दृश्य रीसेट करें",
    compareClearPreview: "पूर्वावलोकन साफ़ करें",
    compareHelp: "कीबोर्ड सहायता",
    compareHelpKeys: "V दृश्य बदलें · C विभाजक बीच में · X पक्ष बदलें\n←/→: चित्र विभाजक ±2%, Shift ±10%; वीडियो ±1 सेकंड, Shift ±5 सेकंड\nमीडिया पट्टी: ←/→ पास का आइटम, Home/End पहला/आखिरी\nव्हील से पॉइंटर पर ज़ूम · +/- ज़ूम · 0/डबल-क्लिक रीसेट · बीच वाले बटन से या ज़ूम के बाद खींचकर दृश्य खिसकाएँ\nSpace चलाएँ/रोकें · M म्यूट · ? सहायता\nEsc: सहायता बंद करें → पूर्वावलोकन साफ़ करें → विंडो बंद करें। टाइप करते समय या विंडो का फ़ोकस हटने पर शॉर्टकट निष्क्रिय हैं।",
    clipsReady: '{total} में से {done} शॉट का वीडियो तैयार',
    locate: 'नोड ढूँढें', locateHint: 'नोड के नाम या प्रकार से खोजें', 'filter.all': 'सभी', 'filter.picture': 'तस्वीरें', 'filter.clip': 'वीडियो', 'filter.sound': 'ऑडियो', 'filter.text': 'टेक्स्ट', 'filter.character': 'किरदार',
    noMatch: 'कोई मेल खाता नोड नहीं मिला', pins: 'पिन किए गए नोड', noPins: 'अभी कोई नोड पिन नहीं किया गया है', clearPins: 'सभी पिन हटाएँ', clearColor: 'इस रंग के पिन हटाएँ', pin: 'पिन करें', unpin: 'पिन हटाएँ',
    'color.red': 'लाल', 'color.orange': 'नारंगी', 'color.yellow': 'पीला', 'color.lime': 'पीला-हरा', 'color.green': 'हरा', 'color.teal': 'नीला-हरा', 'color.cyan': 'सियान', 'color.blue': 'नीला',
    'color.indigo': 'इंडिगो', 'color.purple': 'बैंगनी', 'color.pink': 'गुलाबी', 'color.grey': 'धूसर',
    arrangeGrid: 'ग्रिड में व्यवस्थित करें', arrangeWires: 'कनेक्शन के अनुसार व्यवस्थित करें', arrangeName: 'नाम के अनुसार व्यवस्थित करें', groupLimit: 'एक समूह में अंदर के नोड सहित अधिकतम {limit} नोड हो सकते हैं; अभी {count} चुने गए हैं',
    copied: '{n} नोड कॉपी किए गए', pasted: '{n} नोड पेस्ट किए गए', pasteRefused: 'क्लिपबोर्ड में कैनवास के नोड नहीं हैं', submitIn: '{n} सेकंड में भेजा जाएगा', cancelSubmit: 'भेजना रद्द करें',
    settings: 'कैनवास सेटिंग', resetDefaults: 'डिफ़ॉल्ट सेटिंग बहाल करें', 'section.interaction': 'इंटरैक्शन', 'section.wires': 'कनेक्शन', 'section.grid': 'ग्रिड और मिनीमैप', 'section.layout': 'व्यवस्था और समूह', 'section.generation': 'बनाना',
    'set.panSensitivity': 'पैन की संवेदनशीलता', 'set.blankAreaAction': 'खाली जगह पर मेनू खोलें', 'set.blankAreaAction.rightClick': 'दायाँ क्लिक', 'set.blankAreaAction.doubleClick': 'दोहरा क्लिक',
    'set.wheelAction': 'माउस व्हील', 'set.wheelAction.pan': 'पैन करें', 'set.wheelAction.zoom': 'ज़ूम करें', 'set.snapGrid': 'खींचते समय ग्रिड से सटाएँ', 'set.alignmentGuides': 'संरेखण की गाइड',
    'set.wireWidth': 'कनेक्शन की मोटाई', 'set.wireHoverHighlight': 'कर्सर ले जाने पर कनेक्शन उभारें', 'set.wireAnimation': 'कनेक्शन का ऐनिमेशन दिखाएँ', 'set.wireFocusOnly': 'केवल चुने गए नोड के कनेक्शन दिखाएँ',
    'set.gridSpacing': 'ग्रिड की दूरी', 'set.gridDotSize': 'ग्रिड के बिंदुओं का आकार', 'set.showGrid': 'ग्रिड दिखाएँ', 'set.minimap': 'मिनीमैप', 'set.arrangeHorizontalSpacing': 'व्यवस्थित करते समय क्षैतिज दूरी',
    'set.arrangeVerticalSpacing': 'व्यवस्थित करते समय लंबवत दूरी', 'set.groupPadding': 'समूह के अंदर की खाली जगह', 'set.submitDelaySeconds': 'बनाने से पहले उलटी गिनती', 'set.notifyOnCompletion': 'बनने पर सूचना दें', off: 'बंद',
    camera: 'कैमरे की गति', cameraHint: 'एक संयोजन चुनें, या अधिकतम दो चालें और गति चुनें; इन्हें प्रॉम्प्ट की शुरुआत में जोड़ा जाएगा।', cameraPresets: 'संयोजन', 'cameraCategory.zoom': 'आगे-पीछे और ज़ूम', 'cameraCategory.horizontal': 'क्षैतिज चाल',
    'cameraCategory.vertical': 'लंबवत चाल', 'cameraCategory.special': 'खास कोण', cameraSpeed: 'गति', cameraConflict: 'ये दोनों चालें उलटी दिशाओं में हैं; मॉडल को दोनों साथ दिखाने में मुश्किल हो सकती है।', cameraClear: 'कैमरे की गति हटाएँ', cameraApply: 'प्रॉम्प्ट में लागू करें', cameraNone: 'कैमरा स्थिर'
};

const TEXT: Readonly<Record<string, Readonly<Record<PanelTextKey, string>>>> = { 'zh-CN': ZH, 'zh-TW': ZH_TW, en: EN, ja: JA, ko: KO, es: ES, fr: FR, de: DE, 'pt-BR': PT_BR, ru: RU, ar: AR, hi: HI };
export const COMIC_CANVAS_PANEL_LOCALES = Object.keys(TEXT);

function uncheckedPanelText(locale: string, key: PanelTextKey, values?: Readonly<Record<string, string | number>>): string {
    const raw = (TEXT[locale] ?? (locale.startsWith('zh') ? TEXT['zh-CN'] : undefined))?.[key];
    if (typeof raw !== 'string') throw new Error('missing');
    return raw.replace(/\{(\w+)\}/g, (match, name: string) => values && values[name] !== undefined ? String(values[name]) : match);
}

export function panelText(locale: string, key: PanelTextKey, ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedPanelText>>): string {
    return totalCopy(locale, key, language => uncheckedPanelText(language, key, ...rest));
}
