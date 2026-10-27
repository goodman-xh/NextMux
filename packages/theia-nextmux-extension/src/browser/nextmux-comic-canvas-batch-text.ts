/** 批量导入提示词 copy (node-loadable). A language without a key falls back to English. */
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

export type BatchTextKey = 'title' | 'lead' | 'kind' | 'split' | 'split.paragraphs' | 'split.lines' | 'split.separator' | 'separator' | 'head' | 'headHint' | 'tail' | 'tailHint'
    | 'naming' | 'prefix' | 'suffix' | 'template' | 'templateHint' | 'start' | 'step' | 'padding' | 'layout' | 'direction' | 'rowFirst' | 'columnFirst' | 'perRow'
    | 'hSpacing' | 'vSpacing' | 'source' | 'sourceHint' | 'preview' | 'reverse' | 'restore' | 'up' | 'down' | 'empty' | 'omitted' | 'noCharge' | 'add' | 'menu'
    | 'issue.MODEL_REQUIRED' | 'issue.BATCH_EMPTY' | 'issue.NODE_NAME_EMPTY' | 'issue.ASPECT_RATIO_REQUIRED';

const ZH: Record<BatchTextKey, string> = {
    title: '批量导入提示词', lead: '一段提示词变成一个生成节点，一次最多 {max} 个。', kind: '生成', split: '拆分', 'split.paragraphs': '按空行分段', 'split.lines': '每行一个',
    'split.separator': '自定义分隔符', separator: '分隔符', head: '统一开头', headHint: '加在每段前面，例如画风、镜头语言', tail: '统一结尾', tailHint: '加在每段后面，例如画质、比例要求',
    naming: '命名', prefix: '前缀', suffix: '后缀', template: '模板', templateHint: '可用 {prefix}{index}{suffix}{prompt}，{prompt} 取正文前 24 字。', start: '起始编号', step: '步长',
    padding: '补零位数', layout: '排列', direction: '方向', rowFirst: '横向优先', columnFirst: '纵向优先', perRow: '每行', hSpacing: '列间距', vSpacing: '行间距',
    source: '提示词原文', sourceHint: '粘贴多段提示词，按左边的规则拆成多个节点…', preview: '预览（{n}）', reverse: '倒序', restore: '恢复原文顺序', up: '上移', down: '下移',
    empty: '还没有可导入的段落', omitted: '超过 {max} 段，只导入前 {max} 段；剩下的 {n} 段请再导入一次。', noCharge: '只添加节点，不会自动生成，也不会扣费。', add: '添加 {n} 个节点',
    menu: '批量导入提示词', 'issue.MODEL_REQUIRED': '先选择模型', 'issue.BATCH_EMPTY': '还没有可导入的段落', 'issue.NODE_NAME_EMPTY': '节点名称不能为空', 'issue.ASPECT_RATIO_REQUIRED': '先选择画幅'
};

const EN: Record<BatchTextKey, string> = {
    title: 'Import prompts in bulk', lead: 'Each prompt becomes one generation node, up to {max} at a time.', kind: 'Generate', split: 'Split', 'split.paragraphs': 'By blank lines', 'split.lines': 'One per line',
    'split.separator': 'Custom separator', separator: 'Separator', head: 'Shared opening', headHint: 'Added before every prompt, e.g. style or camera language', tail: 'Shared ending', tailHint: 'Added after every prompt, e.g. quality or framing',
    naming: 'Names', prefix: 'Prefix', suffix: 'Suffix', template: 'Template', templateHint: 'Use {prefix}{index}{suffix}{prompt}; {prompt} is the first 24 characters.', start: 'Start at', step: 'Step',
    padding: 'Zero padding', layout: 'Arrange', direction: 'Direction', rowFirst: 'Rows first', columnFirst: 'Columns first', perRow: 'Per row', hSpacing: 'Column gap', vSpacing: 'Row gap',
    source: 'Prompts', sourceHint: 'Paste several prompts; they are split into nodes by the rule on the left…', preview: 'Preview ({n})', reverse: 'Reverse', restore: 'Original order', up: 'Move up', down: 'Move down',
    empty: 'Nothing to import yet', omitted: 'Over {max} prompts: only the first {max} are imported; import the other {n} in another batch.', noCharge: 'Only adds nodes — nothing generates or is charged.', add: 'Add {n} nodes',
    menu: 'Import prompts in bulk', 'issue.MODEL_REQUIRED': 'Choose a model first', 'issue.BATCH_EMPTY': 'Nothing to import yet', 'issue.NODE_NAME_EMPTY': 'Node names cannot be empty', 'issue.ASPECT_RATIO_REQUIRED': 'Choose an aspect ratio first'
};

const ZH_TW: Record<BatchTextKey, string> = {
    title: '批次匯入提示詞', lead: '每段提示詞會成為一個生成節點，一次最多 {max} 個。', kind: '生成', split: '拆分', 'split.paragraphs': '按空白行分段', 'split.lines': '每行一個',
    'split.separator': '自訂分隔符號', separator: '分隔符號', head: '統一開頭', headHint: '加在每段前面，例如畫風、鏡頭語言', tail: '統一結尾', tailHint: '加在每段後面，例如畫質、比例要求',
    naming: '命名', prefix: '前綴', suffix: '後綴', template: '範本', templateHint: '可用 {prefix}{index}{suffix}{prompt}，{prompt} 取正文前 24 字。', start: '起始編號', step: '遞增值',
    padding: '補零位數', layout: '排列', direction: '方向', rowFirst: '橫向優先', columnFirst: '縱向優先', perRow: '每列數量', hSpacing: '欄間距', vSpacing: '列間距',
    source: '提示詞原文', sourceHint: '貼上多段提示詞，依左邊的規則拆成多個節點…', preview: '預覽（{n}）', reverse: '倒序', restore: '恢復原文順序', up: '上移', down: '下移',
    empty: '還沒有可匯入的段落', omitted: '超過 {max} 段，只匯入前 {max} 段；剩下的 {n} 段請再匯入一次。', noCharge: '只新增節點，不會自動生成，也不會扣費。', add: '新增 {n} 個節點',
    menu: '批次匯入提示詞', 'issue.MODEL_REQUIRED': '請先選擇模型', 'issue.BATCH_EMPTY': '還沒有可匯入的段落', 'issue.NODE_NAME_EMPTY': '節點名稱不能空白', 'issue.ASPECT_RATIO_REQUIRED': '請先選擇畫面比例'
};

const JA: Record<BatchTextKey, string> = {
    title: 'プロンプトを一括インポート', lead: '各プロンプトが1つの生成ノードになります。一度に最大 {max} 個まで。', kind: '生成', split: '分割', 'split.paragraphs': '空行で区切る', 'split.lines': '1行につき1つ',
    'split.separator': '区切り文字を指定', separator: '区切り文字', head: '共通の冒頭', headHint: '各プロンプトの前に追加（画風やカメラ表現など）', tail: '共通の末尾', tailHint: '各プロンプトの後に追加（画質や画面比率など）',
    naming: '名前', prefix: '接頭辞', suffix: '接尾辞', template: 'テンプレート', templateHint: '{prefix}{index}{suffix}{prompt} が使えます。{prompt} は本文の先頭24文字です。', start: '開始番号', step: '増分',
    padding: 'ゼロ埋め桁数', layout: '整列', direction: '方向', rowFirst: '横方向を優先', columnFirst: '縦方向を優先', perRow: '1行の個数', hSpacing: '列の間隔', vSpacing: '行の間隔',
    source: 'プロンプト原文', sourceHint: '複数のプロンプトを貼り付けると、左のルールでノードに分割されます…', preview: 'プレビュー（{n}）', reverse: '逆順', restore: '原文の順序に戻す', up: '上へ移動', down: '下へ移動',
    empty: 'インポートできる段落がまだありません', omitted: '{max} 段落を超えています。最初の {max} 段落のみインポートします。残りの {n} 段落はもう一度インポートしてください。', noCharge: 'ノードの追加のみです。自動生成や課金は行われません。', add: '{n} 個のノードを追加',
    menu: 'プロンプトを一括インポート', 'issue.MODEL_REQUIRED': '先にモデルを選んでください', 'issue.BATCH_EMPTY': 'インポートできる段落がまだありません', 'issue.NODE_NAME_EMPTY': 'ノード名を入力してください', 'issue.ASPECT_RATIO_REQUIRED': '先に画面比率を選んでください'
};

const KO: Record<BatchTextKey, string> = {
    title: '프롬프트 한꺼번에 가져오기', lead: '각 프롬프트가 하나의 생성 노드가 됩니다. 한 번에 최대 {max}개까지 가져올 수 있어요.', kind: '생성', split: '나누기', 'split.paragraphs': '빈 줄로 나누기', 'split.lines': '한 줄에 하나씩',
    'split.separator': '사용자 지정 구분자', separator: '구분자', head: '공통 시작 문구', headHint: '각 프롬프트 앞에 추가합니다. 예: 화풍, 카메라 표현', tail: '공통 끝 문구', tailHint: '각 프롬프트 뒤에 추가합니다. 예: 화질, 화면 비율',
    naming: '이름', prefix: '접두사', suffix: '접미사', template: '템플릿', templateHint: '{prefix}{index}{suffix}{prompt}를 사용할 수 있어요. {prompt}는 본문의 처음 24자입니다.', start: '시작 번호', step: '증가 값',
    padding: '0 채우기 자릿수', layout: '정리', direction: '방향', rowFirst: '가로 우선', columnFirst: '세로 우선', perRow: '행당 개수', hSpacing: '열 간격', vSpacing: '행 간격',
    source: '프롬프트 원문', sourceHint: '여러 프롬프트를 붙여 넣으면 왼쪽 규칙에 따라 노드로 나뉩니다…', preview: '미리 보기 ({n})', reverse: '역순', restore: '원문 순서로 복원', up: '위로 이동', down: '아래로 이동',
    empty: '가져올 문단이 아직 없어요', omitted: '{max}개를 초과했어요. 처음 {max}개만 가져옵니다. 나머지 {n}개는 다시 가져와 주세요.', noCharge: '노드만 추가합니다. 자동으로 생성하거나 요금을 부과하지 않아요.', add: '노드 {n}개 추가',
    menu: '프롬프트 한꺼번에 가져오기', 'issue.MODEL_REQUIRED': '먼저 모델을 선택하세요', 'issue.BATCH_EMPTY': '가져올 문단이 아직 없어요', 'issue.NODE_NAME_EMPTY': '노드 이름은 비워 둘 수 없어요', 'issue.ASPECT_RATIO_REQUIRED': '먼저 화면 비율을 선택하세요'
};

const ES: Record<BatchTextKey, string> = {
    title: 'Importar descripciones en lote', lead: 'Cada descripción se convierte en un nodo de generación, hasta {max} a la vez.', kind: 'Generar', split: 'Dividir', 'split.paragraphs': 'Por líneas en blanco', 'split.lines': 'Una por línea',
    'split.separator': 'Separador personalizado', separator: 'Separador', head: 'Inicio común', headHint: 'Se añade antes de cada descripción, por ejemplo, el estilo o el lenguaje de cámara', tail: 'Final común', tailHint: 'Se añade después de cada descripción, por ejemplo, la calidad o la proporción',
    naming: 'Nombres', prefix: 'Prefijo', suffix: 'Sufijo', template: 'Plantilla', templateHint: 'Usa {prefix}{index}{suffix}{prompt}; {prompt} son los primeros 24 caracteres del texto.', start: 'Número inicial', step: 'Incremento',
    padding: 'Dígitos con ceros iniciales', layout: 'Organizar', direction: 'Dirección', rowFirst: 'Primero las filas', columnFirst: 'Primero las columnas', perRow: 'Por fila', hSpacing: 'Espacio entre columnas', vSpacing: 'Espacio entre filas',
    source: 'Descripciones originales', sourceHint: 'Pega varias descripciones; se dividirán en nodos según la regla de la izquierda…', preview: 'Vista previa ({n})', reverse: 'Invertir orden', restore: 'Restaurar orden original', up: 'Subir', down: 'Bajar',
    empty: 'Aún no hay párrafos para importar', omitted: 'Hay más de {max} descripciones: solo se importarán las primeras {max}. Importa las otras {n} en otro lote.', noCharge: 'Solo se añaden nodos. No se genera nada automáticamente ni se aplica ningún cargo.', add: 'Añadir {n} nodos',
    menu: 'Importar descripciones en lote', 'issue.MODEL_REQUIRED': 'Elige primero un modelo', 'issue.BATCH_EMPTY': 'Aún no hay párrafos para importar', 'issue.NODE_NAME_EMPTY': 'El nombre del nodo no puede estar vacío', 'issue.ASPECT_RATIO_REQUIRED': 'Elige primero una proporción'
};

const FR: Record<BatchTextKey, string> = {
    title: 'Importer des descriptions en lot', lead: 'Chaque description devient un nœud de génération, jusqu’à {max} à la fois.', kind: 'Générer', split: 'Séparer', 'split.paragraphs': 'Par lignes vides', 'split.lines': 'Une par ligne',
    'split.separator': 'Séparateur personnalisé', separator: 'Séparateur', head: 'Début commun', headHint: 'Ajouté avant chaque description, par exemple le style ou le langage de caméra', tail: 'Fin commune', tailHint: 'Ajoutée après chaque description, par exemple la qualité ou le format',
    naming: 'Noms', prefix: 'Préfixe', suffix: 'Suffixe', template: 'Modèle de nom', templateHint: 'Utilisez {prefix}{index}{suffix}{prompt} ; {prompt} correspond aux 24 premiers caractères du texte.', start: 'Numéro de départ', step: 'Incrément',
    padding: 'Nombre de chiffres avec zéros', layout: 'Organiser', direction: 'Direction', rowFirst: 'Lignes d’abord', columnFirst: 'Colonnes d’abord', perRow: 'Par ligne', hSpacing: 'Espacement des colonnes', vSpacing: 'Espacement des lignes',
    source: 'Descriptions originales', sourceHint: 'Collez plusieurs descriptions ; elles seront séparées en nœuds selon la règle à gauche…', preview: 'Aperçu ({n})', reverse: 'Inverser l’ordre', restore: 'Rétablir l’ordre original', up: 'Monter', down: 'Descendre',
    empty: 'Aucun paragraphe à importer pour le moment', omitted: 'Plus de {max} descriptions : seules les {max} premières seront importées. Importez les {n} restantes dans un autre lot.', noCharge: 'Seuls des nœuds sont ajoutés. Aucune génération automatique ni aucun frais.', add: 'Ajouter {n} nœuds',
    menu: 'Importer des descriptions en lot', 'issue.MODEL_REQUIRED': 'Choisissez d’abord un modèle', 'issue.BATCH_EMPTY': 'Aucun paragraphe à importer pour le moment', 'issue.NODE_NAME_EMPTY': 'Le nom du nœud ne peut pas être vide', 'issue.ASPECT_RATIO_REQUIRED': 'Choisissez d’abord un format'
};

const DE: Record<BatchTextKey, string> = {
    title: 'Beschreibungen gesammelt importieren', lead: 'Jede Beschreibung wird zu einem Erzeugungsknoten, bis zu {max} auf einmal.', kind: 'Erzeugen', split: 'Aufteilen', 'split.paragraphs': 'An Leerzeilen', 'split.lines': 'Eine pro Zeile',
    'split.separator': 'Eigenes Trennzeichen', separator: 'Trennzeichen', head: 'Gemeinsamer Anfang', headHint: 'Wird vor jede Beschreibung gesetzt, z. B. Stil oder Kamerasprache', tail: 'Gemeinsames Ende', tailHint: 'Wird nach jede Beschreibung gesetzt, z. B. Qualität oder Seitenverhältnis',
    naming: 'Namen', prefix: 'Präfix', suffix: 'Suffix', template: 'Vorlage', templateHint: 'Verwende {prefix}{index}{suffix}{prompt}; {prompt} sind die ersten 24 Zeichen des Textes.', start: 'Startnummer', step: 'Schrittweite',
    padding: 'Stellen mit führenden Nullen', layout: 'Anordnen', direction: 'Richtung', rowFirst: 'Zeilen zuerst', columnFirst: 'Spalten zuerst', perRow: 'Pro Zeile', hSpacing: 'Spaltenabstand', vSpacing: 'Zeilenabstand',
    source: 'Originalbeschreibungen', sourceHint: 'Füge mehrere Beschreibungen ein; sie werden nach der Regel links in Knoten aufgeteilt…', preview: 'Vorschau ({n})', reverse: 'Reihenfolge umkehren', restore: 'Originalreihenfolge wiederherstellen', up: 'Nach oben', down: 'Nach unten',
    empty: 'Noch keine Absätze zum Importieren', omitted: 'Mehr als {max} Beschreibungen: Nur die ersten {max} werden importiert. Importiere die übrigen {n} in einem weiteren Durchgang.', noCharge: 'Es werden nur Knoten hinzugefügt. Es wird nichts automatisch erzeugt und es fallen keine Kosten an.', add: '{n} Knoten hinzufügen',
    menu: 'Beschreibungen gesammelt importieren', 'issue.MODEL_REQUIRED': 'Wähle zuerst ein Modell', 'issue.BATCH_EMPTY': 'Noch keine Absätze zum Importieren', 'issue.NODE_NAME_EMPTY': 'Der Knotenname darf nicht leer sein', 'issue.ASPECT_RATIO_REQUIRED': 'Wähle zuerst ein Seitenverhältnis'
};

const PT_BR: Record<BatchTextKey, string> = {
    title: 'Importar descrições em lote', lead: 'Cada descrição vira um nó de geração, até {max} por vez.', kind: 'Gerar', split: 'Dividir', 'split.paragraphs': 'Por linhas em branco', 'split.lines': 'Uma por linha',
    'split.separator': 'Separador personalizado', separator: 'Separador', head: 'Início comum', headHint: 'Adicionado antes de cada descrição, por exemplo, estilo ou linguagem de câmera', tail: 'Final comum', tailHint: 'Adicionado depois de cada descrição, por exemplo, qualidade ou proporção',
    naming: 'Nomes', prefix: 'Prefixo', suffix: 'Sufixo', template: 'Modelo de nome', templateHint: 'Use {prefix}{index}{suffix}{prompt}; {prompt} são os primeiros 24 caracteres do texto.', start: 'Número inicial', step: 'Incremento',
    padding: 'Dígitos com zeros à esquerda', layout: 'Organizar', direction: 'Direção', rowFirst: 'Linhas primeiro', columnFirst: 'Colunas primeiro', perRow: 'Por linha', hSpacing: 'Espaço entre colunas', vSpacing: 'Espaço entre linhas',
    source: 'Descrições originais', sourceHint: 'Cole várias descrições; elas serão divididas em nós pela regra à esquerda…', preview: 'Prévia ({n})', reverse: 'Inverter ordem', restore: 'Restaurar ordem original', up: 'Mover para cima', down: 'Mover para baixo',
    empty: 'Ainda não há parágrafos para importar', omitted: 'Mais de {max} descrições: só as primeiras {max} serão importadas. Importe as outras {n} em outro lote.', noCharge: 'Apenas adiciona nós. Nada é gerado automaticamente e não há cobrança.', add: 'Adicionar {n} nós',
    menu: 'Importar descrições em lote', 'issue.MODEL_REQUIRED': 'Escolha um modelo primeiro', 'issue.BATCH_EMPTY': 'Ainda não há parágrafos para importar', 'issue.NODE_NAME_EMPTY': 'O nome do nó não pode ficar vazio', 'issue.ASPECT_RATIO_REQUIRED': 'Escolha uma proporção primeiro'
};

const RU: Record<BatchTextKey, string> = {
    title: 'Импорт описаний пакетом', lead: 'Каждое описание станет узлом генерации, до {max} за раз.', kind: 'Создать', split: 'Разделить', 'split.paragraphs': 'По пустым строкам', 'split.lines': 'По одному на строку',
    'split.separator': 'Свой разделитель', separator: 'Разделитель', head: 'Общее начало', headHint: 'Добавляется перед каждым описанием, например стиль или работа камеры', tail: 'Общее окончание', tailHint: 'Добавляется после каждого описания, например качество или соотношение сторон',
    naming: 'Названия', prefix: 'Префикс', suffix: 'Суффикс', template: 'Шаблон', templateHint: 'Используйте {prefix}{index}{suffix}{prompt}; {prompt} — первые 24 символа текста.', start: 'Начальный номер', step: 'Шаг',
    padding: 'Число разрядов с ведущими нулями', layout: 'Упорядочить', direction: 'Направление', rowFirst: 'Сначала строки', columnFirst: 'Сначала столбцы', perRow: 'В строке', hSpacing: 'Расстояние между столбцами', vSpacing: 'Расстояние между строками',
    source: 'Исходные описания', sourceHint: 'Вставьте несколько описаний — они будут разделены на узлы по правилу слева…', preview: 'Предпросмотр ({n})', reverse: 'Обратный порядок', restore: 'Вернуть исходный порядок', up: 'Вверх', down: 'Вниз',
    empty: 'Пока нет абзацев для импорта', omitted: 'Описаний больше {max}: будут импортированы только первые {max}. Импортируйте оставшиеся {n} отдельным пакетом.', noCharge: 'Будут добавлены только узлы. Генерация не запускается автоматически, плата не взимается.', add: 'Добавить узлы: {n}',
    menu: 'Импорт описаний пакетом', 'issue.MODEL_REQUIRED': 'Сначала выберите модель', 'issue.BATCH_EMPTY': 'Пока нет абзацев для импорта', 'issue.NODE_NAME_EMPTY': 'Название узла не может быть пустым', 'issue.ASPECT_RATIO_REQUIRED': 'Сначала выберите соотношение сторон'
};

const AR: Record<BatchTextKey, string> = {
    title: 'استيراد الأوصاف دفعة واحدة', lead: 'يتحول كل وصف إلى عقدة إنشاء، بحد أقصى {max} في كل دفعة.', kind: 'إنشاء', split: 'تقسيم', 'split.paragraphs': 'حسب الأسطر الفارغة', 'split.lines': 'وصف واحد في كل سطر',
    'split.separator': 'فاصل مخصص', separator: 'الفاصل', head: 'بداية مشتركة', headHint: 'تُضاف قبل كل وصف، مثل الأسلوب أو لغة الكاميرا', tail: 'نهاية مشتركة', tailHint: 'تُضاف بعد كل وصف، مثل الجودة أو نسبة الأبعاد',
    naming: 'الأسماء', prefix: 'البادئة', suffix: 'اللاحقة', template: 'القالب', templateHint: 'استخدم {prefix}{index}{suffix}{prompt}؛ يمثل {prompt} أول 24 حرفًا من النص.', start: 'رقم البداية', step: 'مقدار الزيادة',
    padding: 'عدد الخانات مع أصفار بادئة', layout: 'ترتيب', direction: 'الاتجاه', rowFirst: 'الصفوف أولًا', columnFirst: 'الأعمدة أولًا', perRow: 'لكل صف', hSpacing: 'المسافة بين الأعمدة', vSpacing: 'المسافة بين الصفوف',
    source: 'الأوصاف الأصلية', sourceHint: 'الصق عدة أوصاف؛ ستُقسّم إلى عقد وفق القاعدة على اليسار…', preview: 'معاينة ({n})', reverse: 'عكس الترتيب', restore: 'استعادة الترتيب الأصلي', up: 'نقل لأعلى', down: 'نقل لأسفل',
    empty: 'لا توجد فقرات للاستيراد بعد', omitted: 'عدد الأوصاف يتجاوز {max}: سيُستورد أول {max} فقط. استورد الأوصاف المتبقية وعددها {n} في دفعة أخرى.', noCharge: 'تُضاف العقد فقط. لن يبدأ الإنشاء تلقائيًا ولن تُفرض رسوم.', add: 'إضافة {n} عقد',
    menu: 'استيراد الأوصاف دفعة واحدة', 'issue.MODEL_REQUIRED': 'اختر نموذجًا أولًا', 'issue.BATCH_EMPTY': 'لا توجد فقرات للاستيراد بعد', 'issue.NODE_NAME_EMPTY': 'لا يمكن ترك اسم العقدة فارغًا', 'issue.ASPECT_RATIO_REQUIRED': 'اختر نسبة الأبعاد أولًا'
};

const HI: Record<BatchTextKey, string> = {
    title: 'एक साथ कई प्रॉम्प्ट इंपोर्ट करें', lead: 'हर प्रॉम्प्ट एक बनाने वाला नोड बनेगा। एक बार में अधिकतम {max} प्रॉम्प्ट इंपोर्ट कर सकते हैं।', kind: 'बनाएँ', split: 'बाँटें', 'split.paragraphs': 'ख़ाली पंक्तियों से बाँटें', 'split.lines': 'हर पंक्ति में एक',
    'split.separator': 'अपना विभाजक', separator: 'विभाजक', head: 'साझा शुरुआत', headHint: 'हर प्रॉम्प्ट से पहले जोड़ें, जैसे शैली या कैमरा निर्देशन', tail: 'साझा अंत', tailHint: 'हर प्रॉम्प्ट के बाद जोड़ें, जैसे गुणवत्ता या आस्पेक्ट रेशियो',
    naming: 'नाम', prefix: 'उपसर्ग', suffix: 'प्रत्यय', template: 'टेम्पलेट', templateHint: '{prefix}{index}{suffix}{prompt} इस्तेमाल करें; {prompt} में मूल टेक्स्ट के पहले 24 अक्षर होंगे।', start: 'शुरुआती संख्या', step: 'बढ़ोतरी',
    padding: 'शून्य जोड़कर अंकों की संख्या', layout: 'व्यवस्थित करें', direction: 'दिशा', rowFirst: 'पहले पंक्तियाँ', columnFirst: 'पहले स्तंभ', perRow: 'हर पंक्ति में', hSpacing: 'स्तंभों के बीच दूरी', vSpacing: 'पंक्तियों के बीच दूरी',
    source: 'मूल प्रॉम्प्ट', sourceHint: 'कई प्रॉम्प्ट चिपकाएँ; बाईं ओर के नियम के अनुसार उन्हें नोड में बाँटा जाएगा…', preview: 'प्रीव्यू ({n})', reverse: 'क्रम उलटें', restore: 'मूल क्रम बहाल करें', up: 'ऊपर ले जाएँ', down: 'नीचे ले जाएँ',
    empty: 'इंपोर्ट करने के लिए अभी कोई अनुच्छेद नहीं है', omitted: '{max} से ज़्यादा प्रॉम्प्ट हैं। केवल पहले {max} इंपोर्ट होंगे; बाकी {n} को अगली बार इंपोर्ट करें।', noCharge: 'केवल नोड जुड़ेंगे। अपने आप कुछ नहीं बनेगा और कोई शुल्क नहीं लगेगा।', add: '{n} नोड जोड़ें',
    menu: 'एक साथ कई प्रॉम्प्ट इंपोर्ट करें', 'issue.MODEL_REQUIRED': 'पहले मॉडल चुनें', 'issue.BATCH_EMPTY': 'इंपोर्ट करने के लिए अभी कोई अनुच्छेद नहीं है', 'issue.NODE_NAME_EMPTY': 'नोड का नाम ख़ाली नहीं हो सकता', 'issue.ASPECT_RATIO_REQUIRED': 'पहले आस्पेक्ट रेशियो चुनें'
};

const TEXT: Readonly<Record<string, Readonly<Record<BatchTextKey, string>>>> = {
    'zh-CN': ZH, 'zh-TW': ZH_TW, en: EN, ja: JA, ko: KO, es: ES, fr: FR, de: DE, 'pt-BR': PT_BR, ru: RU, ar: AR, hi: HI
};
export const COMIC_CANVAS_BATCH_LOCALES = Object.keys(TEXT);

function uncheckedBatchText(locale: string, key: BatchTextKey, values?: Readonly<Record<string, string | number>>): string {
    const raw = (TEXT[locale] ?? (locale.startsWith('zh') ? TEXT['zh-CN'] : undefined))?.[key];
    if (typeof raw !== 'string') throw new Error('missing');
    return raw.replace(/\{(\w+)\}/g, (match, name: string) => values && values[name] !== undefined ? String(values[name]) : match);
}

export function batchText(locale: string, key: BatchTextKey, ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedBatchText>>): string {
    return totalCopy(locale, key, language => uncheckedBatchText(language, key, ...rest));
}
