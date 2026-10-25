/** The portable catalogue retains stable IDs. UI names are translated separately. */
export type DirectorCatalogueCategory = "pose" | "prop" | "camera" | "template" | "body" | "joint" | "axis";
const locales = ["zh-CN", "en", "zh-TW", "ja", "ko", "es", "fr", "de", "pt-BR", "ru", "ar", "hi"] as const;
type Locale = typeof locales[number];
const ids = {
  pose: "stand tpose walk run jump kick throw push sit squat kneel kneel2 lie wave point hands_up celebrate bow present akimbo cross_arms think lean stretch phone photo fight dance".split(" "),
  prop: "cube cube_red cube_blue cube_green sphere sphere_red sphere_blue sphere_green cuboid cylinder cone pyramid torus capsule plane chair table_rect table_round sofa wall_2m wall_3m pillar stairs tree_small tree_large rock bush car bicycle streetlamp bench trash_bin arrow_marker area_marker image_board".split(" "),
  camera: "front_medium front_close front_wide side_follow side_close back_medium top_overview top_45 low_angle low_wide over_shoulder over_shoulder_r bird_eye dutch_angle tracking_wide pov_eye".split(" "),
  template: "empty talking_head product_demo board_present dialogue_two sofa_interview street_interview roundtable classroom stage_speech press_conf cafe_chat park_rest street_walk farewell car_dialogue chase fight_scene dance_stage victory".split(" "),
  body: "mannequin mannequin_female mannequin_child mannequin_stocky mannequin_slim group3 group5".split(" "),
  joint: "body torso head l_arm r_arm l_elbow r_elbow l_wrist r_wrist l_leg r_leg l_knee r_knee l_ankle r_ankle".split(" "),
  axis: "bend turn tilt nod raise straddle".split(" "),
} satisfies Record<DirectorCatalogueCategory, string[]>;
type Catalogue = Record<DirectorCatalogueCategory, string>;
/** Pipe-separated names follow the stable IDs above. Every supported locale is complete. */
const translations: Record<Locale, Catalogue> = {
  "zh-CN": {
    pose: "站立|T 型|行走|跑步|跳跃|踢球|投掷|推|坐姿|蹲下|单膝跪|双膝跪|躺|招手|指向|举手|庆祝|鞠躬|演讲|叉腰|抱臂|思考|倚靠|伸懒腰|看手机|拍照|格斗|舞蹈",
    prop: "灰色立方体|红色立方体|蓝色立方体|绿色立方体|灰色球体|红色球体|蓝色球体|绿色球体|长方体|圆柱|圆锥|四棱锥|圆环|胶囊|平面|椅子|方桌|圆桌|沙发|2 米墙|3 米墙|柱|楼梯|小树|大树|石头|灌木|轿车|自行车|路灯|长椅|垃圾桶|方向箭头|区域标记|图片板",
    camera: "正面中景|正面特写|正面全景|侧面跟拍|侧面近景|背面中景|俯拍全景|45° 俯拍|低角度仰拍|低角度广角|左过肩|右过肩|鸟瞰|荷兰角|远景跟踪|第一人称视角",
    template: "空白场景|单人口播|产品讲解|展板讲解|双人对话|访谈节目|街头采访|圆桌讨论|课堂教学|舞台演讲|新闻发布会|咖啡厅会面|公园小憩|街头同行|街头道别|车内对话|追逐戏|对峙打斗|舞蹈表演|庆祝时刻",
    body: "标准素体|女性素体|儿童素体|壮实素体|纤细素体|3 人群众|5 人群众",
    joint: "身体|躯干|头部|左臂|右臂|左肘|右肘|左腕|右腕|左腿|右腿|左膝|右膝|左踝|右踝",
    axis: "弯曲|转动|侧倾|点头|抬起|外展",
  },
  en: {
    pose: "Stand|T pose|Walk|Run|Jump|Kick|Throw|Push|Sit|Squat|Kneel on one knee|Kneel on both knees|Lie down|Wave|Point|Hands up|Celebrate|Bow|Present|Hands on hips|Cross arms|Think|Lean|Stretch|Use phone|Take photo|Fight|Dance",
    prop: "Grey cube|Red cube|Blue cube|Green cube|Grey sphere|Red sphere|Blue sphere|Green sphere|Cuboid|Cylinder|Cone|Pyramid|Torus|Capsule|Plane|Chair|Rectangular table|Round table|Sofa|2 m wall|3 m wall|Pillar|Stairs|Small tree|Large tree|Rock|Bush|Car|Bicycle|Streetlight|Bench|Bin|Direction arrow|Area marker|Picture board",
    camera: "Front medium|Front close-up|Front wide|Side tracking|Side close-up|Rear medium|Top overview|45° overhead|Low angle|Low wide angle|Left over-shoulder|Right over-shoulder|Bird’s eye|Dutch angle|Wide tracking|First-person view",
    template: "Empty scene|Talking head|Product demo|Board presentation|Two-person dialogue|Interview show|Street interview|Roundtable|Classroom|Stage speech|Press conference|Café meeting|Park rest|Walking together|Farewell|Car dialogue|Chase|Fight confrontation|Dance performance|Celebration",
    body: "Standard mannequin|Female mannequin|Child mannequin|Stocky mannequin|Slim mannequin|Crowd of 3|Crowd of 5",
    joint: "Body|Torso|Head|Left arm|Right arm|Left elbow|Right elbow|Left wrist|Right wrist|Left leg|Right leg|Left knee|Right knee|Left ankle|Right ankle",
    axis: "Bend|Turn|Tilt|Nod|Raise|Abduction",
  },
  "zh-TW": {
    pose: "站立|T 型|行走|跑步|跳躍|踢球|投擲|推|坐姿|蹲下|單膝跪|雙膝跪|躺|招手|指向|舉手|慶祝|鞠躬|演講|叉腰|抱臂|思考|倚靠|伸懶腰|看手機|拍照|格鬥|舞蹈",
    prop: "灰色立方體|紅色立方體|藍色立方體|綠色立方體|灰色球體|紅色球體|藍色球體|綠色球體|長方體|圓柱|圓錐|四角錐|圓環|膠囊|平面|椅子|方桌|圓桌|沙發|2 公尺牆|3 公尺牆|柱|樓梯|小樹|大樹|石頭|灌木|轎車|自行車|路燈|長椅|垃圾桶|方向箭頭|區域標記|圖片板",
    camera: "正面中景|正面特寫|正面全景|側面跟拍|側面近景|背面中景|俯拍全景|45° 俯拍|低角度仰拍|低角度廣角|左過肩|右過肩|鳥瞰|荷蘭角|遠景跟蹤|第一人稱視角",
    template: "空白場景|單人口播|產品講解|展板講解|雙人對話|訪談節目|街頭採訪|圓桌討論|課堂教學|舞臺演講|新聞發布會|咖啡廳會面|公園小憩|街頭同行|街頭道別|車內對話|追逐戲|對峙打鬥|舞蹈表演|慶祝時刻",
    body: "標準素體|女性素體|兒童素體|壯實素體|纖細素體|3 人群眾|5 人群眾",
    joint: "身體|軀幹|頭部|左臂|右臂|左肘|右肘|左腕|右腕|左腿|右腿|左膝|右膝|左踝|右踝",
    axis: "彎曲|轉動|側傾|點頭|抬起|外展",
  },
  ja: {
    pose: "立つ|T ポーズ|歩く|走る|ジャンプ|蹴る|投げる|押す|座る|しゃがむ|片膝をつく|両膝をつく|横になる|手を振る|指す|両手を上げる|祝う|お辞儀|説明する|腰に手を当てる|腕を組む|考える|寄りかかる|伸びをする|スマホを見る|写真を撮る|格闘|踊る",
    prop: "灰色の立方体|赤い立方体|青い立方体|緑の立方体|灰色の球|赤い球|青い球|緑の球|直方体|円柱|円錐|四角錐|円環|カプセル|平面|椅子|長方形の机|丸机|ソファ|2 m の壁|3 m の壁|柱|階段|小さな木|大きな木|岩|茂み|車|自転車|街灯|ベンチ|ごみ箱|方向矢印|範囲マーカー|画像ボード",
    camera: "正面ミディアム|正面クローズアップ|正面ワイド|側面追跡|側面クローズアップ|背面ミディアム|真上の全景|45° 俯瞰|ローアングル|ローアングル広角|左肩越し|右肩越し|鳥瞰|ダッチアングル|ワイド追跡|一人称視点",
    template: "空のシーン|一人で解説|製品紹介|ボード説明|二人の会話|インタビュー番組|街頭インタビュー|座談会|授業|舞台でのスピーチ|記者会見|カフェで会う|公園で休む|一緒に歩く|別れ|車内の会話|追跡劇|対決と格闘|ダンス公演|お祝い",
    body: "標準素体|女性素体|子ども素体|がっしりした素体|細身の素体|3 人の群衆|5 人の群衆",
    joint: "全身|胴体|頭|左腕|右腕|左肘|右肘|左手首|右手首|左脚|右脚|左膝|右膝|左足首|右足首",
    axis: "曲げる|回す|傾ける|うなずく|上げる|外転",
  },
  ko: {
    pose: "서기|T 자세|걷기|달리기|점프|발차기|던지기|밀기|앉기|쪼그려 앉기|한쪽 무릎 꿇기|양쪽 무릎 꿇기|눕기|손 흔들기|가리키기|손 들기|축하|인사|발표|허리에 손|팔짱|생각|기대기|기지개|휴대폰 보기|사진 찍기|격투|춤",
    prop: "회색 정육면체|빨간 정육면체|파란 정육면체|초록 정육면체|회색 구|빨간 구|파란 구|초록 구|직육면체|원기둥|원뿔|사각뿔|도넛|캡슐|평면|의자|사각 탁자|원형 탁자|소파|2 m 벽|3 m 벽|기둥|계단|작은 나무|큰 나무|바위|덤불|자동차|자전거|가로등|벤치|쓰레기통|방향 화살표|영역 표시|이미지 보드",
    camera: "정면 미디엄|정면 클로즈업|정면 와이드|측면 추적|측면 클로즈업|후면 미디엄|위에서 전체|45° 내려다보기|로우 앵글|낮은 광각|왼쪽 어깨 너머|오른쪽 어깨 너머|조감|더치 앵글|와이드 추적|1인칭 시점",
    template: "빈 장면|1인 설명|제품 시연|보드 설명|두 사람 대화|인터뷰 프로그램|거리 인터뷰|원탁 토론|수업|무대 연설|기자 회견|카페 만남|공원 휴식|함께 걷기|작별|차 안 대화|추격|대치와 격투|춤 공연|축하 순간",
    body: "표준 마네킹|여성 마네킹|어린이 마네킹|건장한 마네킹|마른 마네킹|3명 군중|5명 군중",
    joint: "몸|몸통|머리|왼팔|오른팔|왼쪽 팔꿈치|오른쪽 팔꿈치|왼쪽 손목|오른쪽 손목|왼쪽 다리|오른쪽 다리|왼쪽 무릎|오른쪽 무릎|왼쪽 발목|오른쪽 발목",
    axis: "굽힘|회전|기울기|끄덕임|올리기|벌리기",
  },
  es: {
    pose: "De pie|Pose T|Caminar|Correr|Saltar|Patear|Lanzar|Empujar|Sentarse|En cuclillas|Una rodilla|Ambas rodillas|Acostarse|Saludar|Señalar|Manos arriba|Celebrar|Reverencia|Presentar|Manos en la cintura|Brazos cruzados|Pensar|Apoyarse|Estirarse|Usar el móvil|Fotografiar|Pelear|Bailar",
    prop: "Cubo gris|Cubo rojo|Cubo azul|Cubo verde|Esfera gris|Esfera roja|Esfera azul|Esfera verde|Prisma rectangular|Cilindro|Cono|Pirámide|Toro|Cápsula|Plano|Silla|Mesa rectangular|Mesa redonda|Sofá|Pared de 2 m|Pared de 3 m|Columna|Escaleras|Árbol pequeño|Árbol grande|Roca|Arbusto|Coche|Bicicleta|Farola|Banco|Papelera|Flecha de dirección|Marcador de área|Panel de imagen",
    camera: "Frontal medio|Primer plano frontal|Frontal general|Seguimiento lateral|Primer plano lateral|Trasero medio|Vista cenital general|Picado a 45°|Contrapicado|Contrapicado angular|Sobre hombro izquierdo|Sobre hombro derecho|Vista de pájaro|Ángulo holandés|Seguimiento general|Primera persona",
    template: "Escena vacía|Presentador|Demostración de producto|Presentación con panel|Diálogo de dos|Programa de entrevistas|Entrevista callejera|Mesa redonda|Clase|Discurso en escenario|Rueda de prensa|Encuentro en café|Descanso en parque|Paseo juntos|Despedida|Diálogo en coche|Persecución|Enfrentamiento|Actuación de baile|Celebración",
    body: "Maniquí estándar|Maniquí femenino|Maniquí infantil|Maniquí robusto|Maniquí delgado|Grupo de 3|Grupo de 5",
    joint: "Cuerpo|Torso|Cabeza|Brazo izquierdo|Brazo derecho|Codo izquierdo|Codo derecho|Muñeca izquierda|Muñeca derecha|Pierna izquierda|Pierna derecha|Rodilla izquierda|Rodilla derecha|Tobillo izquierdo|Tobillo derecho",
    axis: "Flexión|Giro|Inclinación|Asentir|Elevación|Abducción",
  },
  fr: {
    pose: "Debout|Pose T|Marcher|Courir|Sauter|Donner un coup de pied|Lancer|Pousser|S’asseoir|S’accroupir|Un genou au sol|Deux genoux au sol|S’allonger|Saluer|Pointer|Mains en l’air|Célébrer|S’incliner|Présenter|Mains sur les hanches|Bras croisés|Réfléchir|S’appuyer|S’étirer|Utiliser le téléphone|Photographier|Combattre|Danser",
    prop: "Cube gris|Cube rouge|Cube bleu|Cube vert|Sphère grise|Sphère rouge|Sphère bleue|Sphère verte|Pavé droit|Cylindre|Cône|Pyramide|Tore|Capsule|Plan|Chaise|Table rectangulaire|Table ronde|Canapé|Mur de 2 m|Mur de 3 m|Pilier|Escalier|Petit arbre|Grand arbre|Rocher|Buisson|Voiture|Vélo|Lampadaire|Banc|Poubelle|Flèche de direction|Repère de zone|Panneau d’image",
    camera: "Face plan moyen|Face gros plan|Face plan large|Suivi latéral|Côté gros plan|Dos plan moyen|Vue du dessus|Plongée à 45°|Contre-plongée|Contre-plongée grand angle|Épaule gauche|Épaule droite|Vue aérienne|Angle incliné|Suivi plan large|Vue subjective",
    template: "Scène vide|Présentation face caméra|Démonstration produit|Présentation sur panneau|Dialogue à deux|Émission d’entretien|Entretien de rue|Table ronde|Cours|Discours sur scène|Conférence de presse|Rencontre au café|Repos au parc|Marche ensemble|Adieux|Dialogue en voiture|Poursuite|Confrontation|Spectacle de danse|Célébration",
    body: "Mannequin standard|Mannequin féminin|Mannequin enfant|Mannequin trapu|Mannequin mince|Groupe de 3|Groupe de 5",
    joint: "Corps|Torse|Tête|Bras gauche|Bras droit|Coude gauche|Coude droit|Poignet gauche|Poignet droit|Jambe gauche|Jambe droite|Genou gauche|Genou droit|Cheville gauche|Cheville droite",
    axis: "Flexion|Rotation|Inclinaison|Hochement|Élévation|Abduction",
  },
  de: {
    pose: "Stehen|T-Pose|Gehen|Laufen|Springen|Treten|Werfen|Schieben|Sitzen|Hocken|Ein Knie am Boden|Beide Knie am Boden|Liegen|Winken|Zeigen|Hände hoch|Feiern|Verbeugen|Präsentieren|Hände an die Hüften|Arme verschränken|Nachdenken|Anlehnen|Strecken|Handy benutzen|Fotografieren|Kämpfen|Tanzen",
    prop: "Grauer Würfel|Roter Würfel|Blauer Würfel|Grüner Würfel|Graue Kugel|Rote Kugel|Blaue Kugel|Grüne Kugel|Quader|Zylinder|Kegel|Pyramide|Torus|Kapsel|Ebene|Stuhl|Rechteckiger Tisch|Runder Tisch|Sofa|2 m Wand|3 m Wand|Säule|Treppe|Kleiner Baum|Großer Baum|Fels|Busch|Auto|Fahrrad|Straßenlaterne|Bank|Mülleimer|Richtungspfeil|Bereichsmarkierung|Bildtafel",
    camera: "Front halbnah|Front Nahaufnahme|Front weit|Seitliche Verfolgung|Seitliche Nahaufnahme|Rücken halbnah|Übersicht von oben|45° Aufsicht|Untersicht|Weite Untersicht|Über linke Schulter|Über rechte Schulter|Vogelperspektive|Schräger Winkel|Weite Verfolgung|Ich-Perspektive",
    template: "Leere Szene|Einzelmoderation|Produktvorführung|Tafelpräsentation|Dialog zu zweit|Interviewshow|Straßeninterview|Gesprächsrunde|Unterricht|Bühnenrede|Pressekonferenz|Treffen im Café|Parkpause|Gemeinsamer Spaziergang|Abschied|Dialog im Auto|Verfolgung|Konfrontation|Tanzauftritt|Feier",
    body: "Standardfigur|Weibliche Figur|Kinderfigur|Kräftige Figur|Schlanke Figur|Gruppe mit 3|Gruppe mit 5",
    joint: "Körper|Rumpf|Kopf|Linker Arm|Rechter Arm|Linker Ellenbogen|Rechter Ellenbogen|Linkes Handgelenk|Rechtes Handgelenk|Linkes Bein|Rechtes Bein|Linkes Knie|Rechtes Knie|Linker Knöchel|Rechter Knöchel",
    axis: "Beugung|Drehung|Neigung|Nicken|Heben|Abspreizen",
  },
  "pt-BR": {
    pose: "Em pé|Pose T|Andar|Correr|Pular|Chutar|Arremessar|Empurrar|Sentar|Agachar|Um joelho no chão|Dois joelhos no chão|Deitar|Acenar|Apontar|Mãos para cima|Comemorar|Reverência|Apresentar|Mãos na cintura|Braços cruzados|Pensar|Apoiar-se|Alongar|Usar celular|Fotografar|Lutar|Dançar",
    prop: "Cubo cinza|Cubo vermelho|Cubo azul|Cubo verde|Esfera cinza|Esfera vermelha|Esfera azul|Esfera verde|Paralelepípedo|Cilindro|Cone|Pirâmide|Toro|Cápsula|Plano|Cadeira|Mesa retangular|Mesa redonda|Sofá|Parede de 2 m|Parede de 3 m|Coluna|Escada|Árvore pequena|Árvore grande|Rocha|Arbusto|Carro|Bicicleta|Poste de luz|Banco|Lixeira|Seta de direção|Marcador de área|Painel de imagem",
    camera: "Frontal médio|Close frontal|Frontal aberto|Acompanhamento lateral|Close lateral|Traseiro médio|Vista superior geral|Vista superior a 45°|Ângulo baixo|Ângulo baixo aberto|Sobre o ombro esquerdo|Sobre o ombro direito|Vista aérea|Ângulo holandês|Acompanhamento aberto|Primeira pessoa",
    template: "Cena vazia|Apresentação individual|Demonstração de produto|Apresentação com painel|Diálogo de duas pessoas|Programa de entrevistas|Entrevista de rua|Mesa-redonda|Aula|Discurso no palco|Coletiva de imprensa|Encontro no café|Descanso no parque|Caminhada juntos|Despedida|Diálogo no carro|Perseguição|Confronto|Apresentação de dança|Comemoração",
    body: "Manequim padrão|Manequim feminino|Manequim infantil|Manequim robusto|Manequim esguio|Grupo de 3|Grupo de 5",
    joint: "Corpo|Tronco|Cabeça|Braço esquerdo|Braço direito|Cotovelo esquerdo|Cotovelo direito|Pulso esquerdo|Pulso direito|Perna esquerda|Perna direita|Joelho esquerdo|Joelho direito|Tornozelo esquerdo|Tornozelo direito",
    axis: "Flexão|Rotação|Inclinação|Aceno da cabeça|Elevação|Abdução",
  },
  ru: {
    pose: "Стоять|Т-поза|Идти|Бежать|Прыгать|Пинать|Бросать|Толкать|Сидеть|Присесть|На одном колене|На двух коленях|Лежать|Махать рукой|Указывать|Руки вверх|Праздновать|Кланяться|Выступать|Руки на поясе|Скрестить руки|Думать|Опереться|Потянуться|Смотреть телефон|Фотографировать|Драться|Танцевать",
    prop: "Серый куб|Красный куб|Синий куб|Зелёный куб|Серая сфера|Красная сфера|Синяя сфера|Зелёная сфера|Параллелепипед|Цилиндр|Конус|Пирамида|Тор|Капсула|Плоскость|Стул|Прямоугольный стол|Круглый стол|Диван|Стена 2 м|Стена 3 м|Колонна|Лестница|Маленькое дерево|Большое дерево|Камень|Куст|Автомобиль|Велосипед|Фонарь|Скамья|Урна|Стрелка направления|Метка области|Панель изображения",
    camera: "Спереди средний план|Спереди крупный план|Спереди общий план|Слежение сбоку|Сбоку крупный план|Сзади средний план|Общий вид сверху|Сверху под 45°|Нижний ракурс|Нижний широкий ракурс|Через левое плечо|Через правое плечо|Вид с высоты|Наклонный ракурс|Слежение общим планом|От первого лица",
    template: "Пустая сцена|Ведущий в кадре|Демонстрация продукта|Презентация у доски|Диалог двоих|Шоу-интервью|Уличное интервью|Круглый стол|Урок|Речь на сцене|Пресс-конференция|Встреча в кафе|Отдых в парке|Совместная прогулка|Прощание|Диалог в машине|Погоня|Противостояние|Танцевальное выступление|Праздник",
    body: "Стандартный манекен|Женский манекен|Детский манекен|Коренастый манекен|Стройный манекен|Группа из 3|Группа из 5",
    joint: "Тело|Торс|Голова|Левая рука|Правая рука|Левый локоть|Правый локоть|Левое запястье|Правое запястье|Левая нога|Правая нога|Левое колено|Правое колено|Левая лодыжка|Правая лодыжка",
    axis: "Сгибание|Поворот|Наклон|Кивок|Подъём|Отведение",
  },
  ar: {
    pose: "وقوف|وضعية T|مشي|جري|قفز|ركل|رمي|دفع|جلوس|قرفصاء|ركوع على ركبة|ركوع على الركبتين|استلقاء|تلويح|إشارة|رفع اليدين|احتفال|انحناء للتحية|تقديم|اليدان على الخصر|تشبيك الذراعين|تفكير|اتكاء|تمدد|استخدام الهاتف|التقاط صورة|قتال|رقص",
    prop: "مكعب رمادي|مكعب أحمر|مكعب أزرق|مكعب أخضر|كرة رمادية|كرة حمراء|كرة زرقاء|كرة خضراء|متوازي مستطيلات|أسطوانة|مخروط|هرم|حلقة|كبسولة|سطح|كرسي|طاولة مستطيلة|طاولة مستديرة|أريكة|جدار 2 م|جدار 3 م|عمود|درج|شجرة صغيرة|شجرة كبيرة|صخرة|شجيرة|سيارة|دراجة|مصباح شارع|مقعد|سلة مهملات|سهم اتجاه|علامة منطقة|لوحة صورة",
    camera: "أمامي متوسط|أمامي قريب|أمامي واسع|تتبع جانبي|جانبي قريب|خلفي متوسط|نظرة عامة من الأعلى|علوي بزاوية 45°|زاوية منخفضة|زاوية منخفضة واسعة|فوق الكتف الأيسر|فوق الكتف الأيمن|عين الطائر|زاوية مائلة|تتبع واسع|منظور الشخص الأول",
    template: "مشهد فارغ|مقدم واحد|شرح منتج|عرض على لوحة|حوار شخصين|برنامج مقابلات|مقابلة في الشارع|نقاش طاولة مستديرة|درس|خطاب على المسرح|مؤتمر صحفي|لقاء في مقهى|استراحة في الحديقة|مشي معاً|وداع|حوار في سيارة|مطاردة|مواجهة وقتال|عرض رقص|احتفال",
    body: "دمية قياسية|دمية أنثوية|دمية طفل|دمية ممتلئة|دمية نحيفة|مجموعة من 3|مجموعة من 5",
    joint: "الجسم|الجذع|الرأس|الذراع الأيسر|الذراع الأيمن|المرفق الأيسر|المرفق الأيمن|المعصم الأيسر|المعصم الأيمن|الساق اليسرى|الساق اليمنى|الركبة اليسرى|الركبة اليمنى|الكاحل الأيسر|الكاحل الأيمن",
    axis: "ثني|دوران|ميل|إيماء|رفع|إبعاد",
  },
  hi: {
    pose: "खड़े होना|T मुद्रा|चलना|दौड़ना|कूदना|लात मारना|फेंकना|धक्का देना|बैठना|उकड़ूँ बैठना|एक घुटने पर|दोनों घुटनों पर|लेटना|हाथ हिलाना|इशारा करना|हाथ उठाना|जश्न|झुककर प्रणाम|प्रस्तुति|कमर पर हाथ|बाँहें मोड़ना|सोचना|टेक लगाना|अंगड़ाई|फ़ोन देखना|फ़ोटो लेना|लड़ाई|नृत्य",
    prop: "धूसर घन|लाल घन|नीला घन|हरा घन|धूसर गोला|लाल गोला|नीला गोला|हरा गोला|घनाभ|बेलन|शंकु|पिरामिड|वलय|कैप्सूल|समतल|कुर्सी|आयताकार मेज़|गोल मेज़|सोफ़ा|2 मीटर दीवार|3 मीटर दीवार|स्तंभ|सीढ़ियाँ|छोटा पेड़|बड़ा पेड़|चट्टान|झाड़ी|कार|साइकिल|सड़क का दीप|बेंच|कूड़ादान|दिशा का तीर|क्षेत्र चिह्न|चित्र बोर्ड",
    camera: "सामने मध्यम|सामने क्लोज़अप|सामने व्यापक|बगल से ट्रैकिंग|बगल क्लोज़अप|पीछे मध्यम|ऊपर से पूरा दृश्य|45° ऊपर से|नीचा कोण|नीचा व्यापक कोण|बाएँ कंधे के ऊपर|दाएँ कंधे के ऊपर|विहंगम दृश्य|तिरछा कोण|व्यापक ट्रैकिंग|प्रथम पुरुष दृश्य",
    template: "खाली दृश्य|एकल वक्ता|उत्पाद प्रदर्शन|बोर्ड प्रस्तुति|दो लोगों का संवाद|साक्षात्कार कार्यक्रम|सड़क पर साक्षात्कार|गोलमेज़ चर्चा|कक्षा|मंच पर भाषण|पत्रकार सम्मेलन|कैफ़े में मुलाक़ात|पार्क में विश्राम|साथ टहलना|विदाई|कार में संवाद|पीछा|आमना-सामना और लड़ाई|नृत्य प्रदर्शन|जश्न",
    body: "मानक पुतला|महिला पुतला|बाल पुतला|मज़बूत पुतला|पतला पुतला|3 लोगों का समूह|5 लोगों का समूह",
    joint: "शरीर|धड़|सिर|बायाँ बाजू|दायाँ बाजू|बाईं कोहनी|दाईं कोहनी|बाईं कलाई|दाईं कलाई|बायाँ पैर|दायाँ पैर|बायाँ घुटना|दायाँ घुटना|बायाँ टखना|दायाँ टखना",
    axis: "मोड़ना|घुमाना|झुकाना|सिर हिलाना|उठाना|बाहर फैलाना",
  },
};
const table = Object.fromEntries(locales.map(locale => [locale, Object.fromEntries((Object.keys(ids) as DirectorCatalogueCategory[]).map(category => {
  const names = translations[locale][category].split("|");
  if (names.length !== ids[category].length) throw new Error(`Incomplete director catalogue ${locale}/${category}`);
  return [category, Object.fromEntries(ids[category].map((id, i) => [id, names[i]!]))];
}))])) as Record<Locale, Record<DirectorCatalogueCategory, Record<string, string>>>;
export function directorCatalogueText(locale: string, category: DirectorCatalogueCategory, id: string): string {
  const language = locales.includes(locale as Locale) ? locale as Locale : "en";
  return table[language][category][id] ?? table.en[category][id] ?? id;
}
export const DIRECTOR_CATALOGUE_LOCALES: readonly string[] = locales;
