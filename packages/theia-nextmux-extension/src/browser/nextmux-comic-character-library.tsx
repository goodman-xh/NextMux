import * as React from '@theia/core/shared/react';
import URI from '@theia/core/lib/common/uri';
import type { DesktopComicCharacterLibraryEntry } from '../common/nextmux-platform-protocol';
import { ImeInput, ImeTextarea } from './nextmux-ime-field';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

/**
 * The character library: characters saved from any comic, reusable in any episode or project.
 * Each keeps its reference pictures and its written look (face, hair, build, outfit). Casting
 * picks from here to fill a role, and every shot a character appears in sends those pictures to
 * the image or video model as references, so the face stays the same.
 */
type Key = 'title' | 'lead' | 'empty' | 'emptyHint' | 'remove' | 'confirmRemove' | 'pictures' | 'noPicture' | 'close' | 'how' | 'button'
    | 'create' | 'name' | 'appearance' | 'appearanceHint' | 'look' | 'createGo' | 'creating' | 'noImageModel' | 'edit' | 'save' | 'cancel' | 'model'
    | 'upload' | 'uploadHint' | 'saveUpload' | 'removeUpload' | 'createLead' | 'previewEmpty';

const TEXT: Record<string, Record<Key, string>> = {
    'zh-CN': { title: '人物库', lead: '选角时生成或上传的人物都会保存在这里，任何项目的选角都能再次选用，出场时保持同一张脸。', empty: '人物库还是空的', emptyHint: '选角时生成或上传的人物会自动保存到这里；也可以点“新建人物”，写一段外貌描述直接生成。', remove: '删除', confirmRemove: '确认删除', pictures: '{count} 张参考图', noPicture: '没有参考图，只保持文字设定', close: '关闭', how: '参考图越清晰（正脸、全身、纯色背景）越稳定；换装或换年龄时建议另存一个版本。', button: '人物库' , create: '新建人物', name: '名字', appearance: '外貌描述', appearanceHint: '年龄、脸型、发型、服装', look: '形象', createGo: '生成定妆照并保存', creating: '正在绘制定妆照…', noImageModel: '先在模型中心选一个图片模型，才能生成定妆照。', edit: '编辑', save: '保存', cancel: '取消', model: '用 {model} 绘制', upload: "上传图片", uploadHint: "PNG / JPEG / WebP，不超过 10 MB，短边至少 512 像素；一人、正脸、全身、纯色背景最稳定。", saveUpload: "保存人物", removeUpload: "移除图片", createLead: "写下外貌，AI 会画一张全身定妆照；也可以直接上传一张照片。", previewEmpty: "定妆照会出现在这里" },
    'zh-TW': { title: '人物庫', lead: '選角時生成或上傳的人物都會儲存在這裡，任何專案的選角都能再次選用，出場時保持同一張臉。', empty: '人物庫還是空的', emptyHint: '選角時生成或上傳的人物會自動儲存到這裡；也可以點「新增人物」，寫一段外貌描述直接生成。', remove: '刪除', confirmRemove: '確認刪除', pictures: '{count} 張參考圖', noPicture: '沒有參考圖，只保持文字設定', close: '關閉', how: '參考圖越清晰（正臉、全身、純色背景）越穩定；換裝或換年齡時建議另存一個版本。', button: '人物庫' , create: '新增人物', name: '名字', appearance: '外貌描述', appearanceHint: '年齡、臉型、髮型、服裝', look: '形象', createGo: '生成定妝照並儲存', creating: '正在繪製定妝照…', noImageModel: '先在模型中心選一個圖片模型，才能生成定妝照。', edit: '編輯', save: '儲存', cancel: '取消', model: '用 {model} 繪製', upload: "上傳圖片", uploadHint: "PNG / JPEG / WebP，不超過 10 MB，短邊至少 512 像素；一人、正臉、全身、純色背景最穩定。", saveUpload: "儲存人物", removeUpload: "移除圖片", createLead: "寫下外貌，AI 會畫一張全身定妝照；也可以直接上傳一張照片。", previewEmpty: "定妝照會出現在這裡" },
    en: { title: 'Character library', lead: 'Everyone you draw or upload while casting is kept here, ready to cast again in any project with the same face.', empty: 'The library is empty', emptyHint: 'Characters drawn or uploaded while casting are kept here automatically. Or choose “New character” and describe one.', remove: 'Delete', confirmRemove: 'Confirm', pictures: '{count} reference pictures', noPicture: 'No picture — the written look only', close: 'Close', how: 'Clear pictures (front face, full body, plain background) hold best; save a new version for a new outfit or age.', button: 'Characters' , create: 'New character', name: 'Name', appearance: 'Looks', appearanceHint: 'Age, face, hair, clothing', look: 'Rendering', createGo: 'Draw the portrait and save', creating: 'Drawing the portrait…', noImageModel: 'Pick an image model in the Model Center to draw portraits.', edit: 'Edit', save: 'Save', cancel: 'Cancel', model: 'Drawn with {model}', upload: "Upload a picture", uploadHint: "PNG / JPEG / WebP, up to 10 MB, short side at least 512 px; one person, front face, full body, plain background holds best.", saveUpload: "Save character", removeUpload: "Remove picture", createLead: "Describe the look and AI draws a full-length portrait — or upload a photo of your own.", previewEmpty: "The portrait appears here" },
    ja: { title: 'キャラクターライブラリ', lead: 'キャスティングで描いた・アップロードした人物はここに保存され、どのプロジェクトでも同じ顔のまま再び起用できます。', empty: 'ライブラリは空です', emptyHint: 'キャスティングで描いたりアップロードしたりしたキャラクターは自動でここに保存されます。「新しいキャラクター」から外見を書いて作ることもできます。', remove: '削除', confirmRemove: '削除する', pictures: '参考画像 {count} 枚', noPicture: '参考画像なし（文字設定のみ）', close: '閉じる', how: '正面・全身・無地背景のはっきりした画像ほど安定します。衣装や年齢を変えるときは別バージョンで保存を。', button: 'キャラクター' , create: '新しいキャラクター', name: '名前', appearance: '外見', appearanceHint: '年齢・顔立ち・髪型・服装', look: '表現', createGo: '立ち絵を描いて保存', creating: '立ち絵を描いています…', noImageModel: '立ち絵を描くには、モデルセンターで画像モデルを選んでください。', edit: '編集', save: '保存', cancel: 'キャンセル', model: '{model} で描画', upload: "画像をアップロード", uploadHint: "PNG / JPEG / WebP、10 MB まで、短辺 512 px 以上。1 人・正面・全身・無地背景が最も安定します。", saveUpload: "キャラクターを保存", removeUpload: "画像を外す", createLead: "外見を書くと AI が全身の立ち絵を描きます。手持ちの写真をアップロードすることもできます。", previewEmpty: "立ち絵はここに表示されます" },
    ko: { title: '캐릭터 라이브러리', lead: '캐스팅에서 그리거나 올린 인물은 모두 여기에 저장되어, 어느 프로젝트에서든 같은 얼굴로 다시 캐스팅할 수 있습니다.', empty: '라이브러리가 비어 있습니다', emptyHint: '캐스팅에서 그리거나 올린 캐릭터는 자동으로 여기에 저장됩니다. ‘새 캐릭터’에서 외모를 적어 바로 만들 수도 있습니다.', remove: '삭제', confirmRemove: '삭제 확인', pictures: '참고 이미지 {count}장', noPicture: '참고 이미지 없음 · 글 설정만 유지', close: '닫기', how: '정면·전신·단색 배경의 선명한 이미지일수록 안정적입니다. 의상이나 나이가 바뀌면 새 버전으로 저장하세요.', button: '캐릭터' , create: '새 캐릭터', name: '이름', appearance: '외모', appearanceHint: '나이, 얼굴형, 헤어, 의상', look: '표현', createGo: '프로필을 그려 저장', creating: '프로필을 그리는 중…', noImageModel: '프로필을 그리려면 모델 센터에서 이미지 모델을 고르세요.', edit: '편집', save: '저장', cancel: '취소', model: '{model}로 그림', upload: "이미지 올리기", uploadHint: "PNG / JPEG / WebP, 10 MB 이하, 짧은 변 512px 이상. 한 사람·정면·전신·단색 배경이 가장 안정적입니다.", saveUpload: "캐릭터 저장", removeUpload: "이미지 빼기", createLead: "외모를 적으면 AI가 전신 프로필을 그립니다. 가진 사진을 올려도 됩니다.", previewEmpty: "프로필이 여기에 표시됩니다" },
    es: { title: 'Biblioteca de personajes', lead: 'Aquí se guarda cada personaje que dibujas o subes en el casting, listo para volver en cualquier proyecto con la misma cara.', empty: 'La biblioteca está vacía', emptyHint: 'Los personajes dibujados o subidos en el casting se guardan aquí solos. También puedes pulsar «Nuevo personaje» y describir uno.', remove: 'Eliminar', confirmRemove: 'Confirmar', pictures: '{count} imágenes de referencia', noPicture: 'Sin imagen: solo el aspecto escrito', close: 'Cerrar', how: 'Las imágenes claras (cara de frente, cuerpo entero, fondo liso) funcionan mejor; guarda otra versión para otro vestuario o edad.', button: 'Personajes' , create: 'Nuevo personaje', name: 'Nombre', appearance: 'Aspecto', appearanceHint: 'Edad, rostro, peinado, ropa', look: 'Estilo del personaje', createGo: 'Dibujar el retrato y guardar', creating: 'Dibujando el retrato…', noImageModel: 'Elige un modelo de imagen en el Centro de modelos para dibujar retratos.', edit: 'Editar', save: 'Guardar', cancel: 'Cancelar', model: 'Dibujado con {model}', upload: "Subir una imagen", uploadHint: "PNG / JPEG / WebP, hasta 10 MB, lado corto de al menos 512 px; una persona, de frente, cuerpo entero y fondo liso funciona mejor.", saveUpload: "Guardar personaje", removeUpload: "Quitar imagen", createLead: "Describe su aspecto y la IA dibuja un retrato de cuerpo entero, o sube una foto tuya.", previewEmpty: "El retrato aparecerá aquí" },
    fr: { title: 'Bibliothèque de personnages', lead: 'Chaque personnage dessiné ou importé pendant le casting est gardé ici, prêt à revenir dans n’importe quel projet avec le même visage.', empty: 'La bibliothèque est vide', emptyHint: 'Les personnages dessinés ou importés pendant le casting arrivent ici tout seuls. Vous pouvez aussi choisir « Nouveau personnage » et en décrire un.', remove: 'Supprimer', confirmRemove: 'Confirmer', pictures: '{count} images de référence', noPicture: 'Pas d’image : description seule', close: 'Fermer', how: 'Des images nettes (visage de face, en pied, fond uni) tiennent le mieux ; enregistrez une nouvelle version pour une autre tenue ou un autre âge.', button: 'Personnages' , create: 'Nouveau personnage', name: 'Nom', appearance: 'Apparence', appearanceHint: 'Âge, visage, coiffure, tenue', look: 'Rendu', createGo: 'Dessiner le portrait et enregistrer', creating: 'Dessin du portrait…', noImageModel: "Choisissez un modèle d'image dans le Centre des modèles pour dessiner des portraits.", edit: 'Modifier', save: 'Enregistrer', cancel: 'Annuler', model: 'Dessiné avec {model}', upload: "Importer une image", uploadHint: "PNG / JPEG / WebP, 10 Mo maximum, petit côté d’au moins 512 px ; une seule personne, de face, en pied, sur fond uni tient le mieux.", saveUpload: "Enregistrer le personnage", removeUpload: "Retirer l’image", createLead: "Décrivez son apparence et l’IA dessine un portrait en pied, ou importez votre propre photo.", previewEmpty: "Le portrait apparaîtra ici" },
    de: { title: 'Figurenbibliothek', lead: 'Jede beim Casting gezeichnete oder hochgeladene Figur landet hier und kann in jedem Projekt mit demselben Gesicht wieder besetzt werden.', empty: 'Die Bibliothek ist leer', emptyHint: 'Beim Casting gezeichnete oder hochgeladene Figuren landen automatisch hier. Oder „Neue Figur“ wählen und eine beschreiben.', remove: 'Löschen', confirmRemove: 'Bestätigen', pictures: '{count} Referenzbilder', noPicture: 'Kein Bild – nur die Beschreibung', close: 'Schließen', how: 'Klare Bilder (Gesicht frontal, ganzer Körper, schlichter Hintergrund) halten am besten; für neue Kleidung oder ein anderes Alter eine neue Version speichern.', button: 'Figuren' , create: 'Neue Figur', name: 'Name', appearance: 'Aussehen', appearanceHint: 'Alter, Gesicht, Frisur, Kleidung', look: 'Darstellung', createGo: 'Porträt zeichnen und speichern', creating: 'Porträt wird gezeichnet…', noImageModel: 'Wählen Sie im Modellcenter ein Bildmodell, um Porträts zu zeichnen.', edit: 'Bearbeiten', save: 'Speichern', cancel: 'Abbrechen', model: 'Gezeichnet mit {model}', upload: "Bild hochladen", uploadHint: "PNG / JPEG / WebP, höchstens 10 MB, kurze Seite mindestens 512 px; eine Person, frontal, ganzer Körper, schlichter Hintergrund hält am besten.", saveUpload: "Figur speichern", removeUpload: "Bild entfernen", createLead: "Beschreiben Sie das Aussehen und die KI zeichnet ein Ganzkörperporträt – oder laden Sie ein eigenes Foto hoch.", previewEmpty: "Hier erscheint das Porträt" },
    'pt-BR': { title: 'Biblioteca de personagens', lead: 'Todo personagem desenhado ou enviado no elenco fica guardado aqui, pronto para voltar em qualquer projeto com o mesmo rosto.', empty: 'A biblioteca está vazia', emptyHint: 'Personagens desenhados ou enviados no elenco ficam aqui automaticamente. Ou clique em “Novo personagem” e descreva um.', remove: 'Excluir', confirmRemove: 'Confirmar', pictures: '{count} imagens de referência', noPicture: 'Sem imagem: só a aparência descrita', close: 'Fechar', how: 'Imagens nítidas (rosto de frente, corpo inteiro, fundo liso) funcionam melhor; salve outra versão para outro figurino ou idade.', button: 'Personagens' , create: 'Novo personagem', name: 'Nome', appearance: 'Aparência', appearanceHint: 'Idade, rosto, cabelo, roupa', look: 'Estilo do personagem', createGo: 'Desenhar o retrato e salvar', creating: 'Desenhando o retrato…', noImageModel: 'Escolha um modelo de imagem na Central de modelos para desenhar retratos.', edit: 'Editar', save: 'Salvar', cancel: 'Cancelar', model: 'Desenhado com {model}', upload: "Enviar uma imagem", uploadHint: "PNG / JPEG / WebP, até 10 MB, lado menor de pelo menos 512 px; uma pessoa, de frente, corpo inteiro e fundo liso funciona melhor.", saveUpload: "Salvar personagem", removeUpload: "Remover imagem", createLead: "Descreva a aparência e a IA desenha um retrato de corpo inteiro, ou envie uma foto sua.", previewEmpty: "O retrato aparece aqui" },
    ru: { title: 'Библиотека персонажей', lead: 'Все персонажи, нарисованные или загруженные при кастинге, хранятся здесь и возвращаются в любом проекте с тем же лицом.', empty: 'Библиотека пуста', emptyHint: 'Персонажи, нарисованные или загруженные при кастинге, сохраняются здесь сами. Или нажмите «Новый персонаж» и опишите его.', remove: 'Удалить', confirmRemove: 'Подтвердить', pictures: 'Референсов: {count}', noPicture: 'Без картинки — только описание', close: 'Закрыть', how: 'Лучше всего работают чёткие картинки (лицо анфас, в полный рост, однотонный фон); для нового костюма или возраста сохраните новую версию.', button: 'Персонажи' , create: 'Новый персонаж', name: 'Имя', appearance: 'Внешность', appearanceHint: 'Возраст, лицо, причёска, одежда', look: 'Подача', createGo: 'Нарисовать портрет и сохранить', creating: 'Рисуем портрет…', noImageModel: 'Чтобы рисовать портреты, выберите модель изображений в Центре моделей.', edit: 'Изменить', save: 'Сохранить', cancel: 'Отмена', model: 'Нарисовано: {model}', upload: "Загрузить изображение", uploadHint: "PNG / JPEG / WebP, до 10 МБ, короткая сторона не меньше 512 px; лучше всего один человек анфас в полный рост на однотонном фоне.", saveUpload: "Сохранить персонажа", removeUpload: "Убрать изображение", createLead: "Опишите внешность — ИИ нарисует портрет в полный рост. Или загрузите своё фото.", previewEmpty: "Здесь появится портрет" },
    ar: { title: 'مكتبة الشخصيات', lead: 'كل شخصية ترسمها أو ترفعها أثناء اختيار الأدوار تُحفظ هنا، جاهزة للعودة في أي مشروع بالوجه نفسه.', empty: 'المكتبة فارغة', emptyHint: 'الشخصيات التي تُرسم أو تُرفع أثناء اختيار الأدوار تُحفظ هنا تلقائيًا. أو اختر «شخصية جديدة» وصِف واحدة.', remove: 'حذف', confirmRemove: 'تأكيد', pictures: '{count} صور مرجعية', noPicture: 'بلا صورة: الوصف فقط', close: 'إغلاق', how: 'الصور الواضحة (وجه أمامي، جسم كامل، خلفية سادة) هي الأثبت؛ احفظ نسخة جديدة لملابس أو عمر مختلف.', button: 'الشخصيات' , create: 'شخصية جديدة', name: 'الاسم', appearance: 'المظهر', appearanceHint: 'العمر، الوجه، الشعر، الملابس', look: 'أسلوب الشخصية', createGo: 'ارسم الصورة واحفظ', creating: 'جارٍ رسم الصورة…', noImageModel: 'اختر نموذج صور من مركز النماذج لرسم الصور.', edit: 'تعديل', save: 'حفظ', cancel: 'إلغاء', model: 'مرسومة بـ {model}', upload: "رفع صورة", uploadHint: "PNG / JPEG / WebP، حتى 10 ميغابايت، والضلع الأقصر 512 بكسل على الأقل؛ الأفضل شخص واحد من الأمام بكامل الجسم على خلفية سادة.", saveUpload: "حفظ الشخصية", removeUpload: "إزالة الصورة", createLead: "صِف المظهر ليرسم الذكاء الاصطناعي صورة كاملة للجسم، أو ارفع صورة لديك.", previewEmpty: "ستظهر الصورة هنا" },
    hi: { title: 'किरदार लाइब्रेरी', lead: 'कास्टिंग में बनाए या अपलोड किए गए सभी किरदार यहाँ सहेजे जाते हैं, और किसी भी प्रोजेक्ट में उसी चेहरे के साथ फिर चुने जा सकते हैं।', empty: 'लाइब्रेरी ख़ाली है', emptyHint: 'कास्टिंग में बनाए या अपलोड किए गए किरदार अपने आप यहाँ सहेजे जाते हैं। या “नया किरदार” चुनकर उसका रूप लिखें।', remove: 'हटाएँ', confirmRemove: 'पक्का करें', pictures: '{count} संदर्भ तस्वीरें', noPicture: 'तस्वीर नहीं — सिर्फ़ लिखा रूप', close: 'बंद करें', how: 'साफ़ तस्वीरें (सामने से चेहरा, पूरा शरीर, सादा पृष्ठभूमि) सबसे स्थिर रहती हैं; नई पोशाक या उम्र के लिए नया संस्करण सहेजें।', button: 'किरदार' , create: 'नया किरदार', name: 'नाम', appearance: 'रूप', appearanceHint: 'उम्र, चेहरा, बाल, कपड़े', look: 'प्रस्तुति', createGo: 'तस्वीर बनाकर सहेजें', creating: 'तस्वीर बन रही है…', noImageModel: 'तस्वीर बनाने के लिए मॉडल सेंटर में कोई इमेज मॉडल चुनें।', edit: 'बदलें', save: 'सहेजें', cancel: 'रद्द करें', model: '{model} से बनी', upload: "तस्वीर अपलोड करें", uploadHint: "PNG / JPEG / WebP, 10 MB तक, छोटी भुजा कम से कम 512 px; एक व्यक्ति, सामने से, पूरा शरीर, सादा पृष्ठभूमि सबसे स्थिर रहती है।", saveUpload: "पात्र सहेजें", removeUpload: "तस्वीर हटाएँ", createLead: "रूप लिखें, AI पूरे शरीर की तस्वीर बनाएगा — या अपनी कोई फ़ोटो अपलोड करें।", previewEmpty: "तस्वीर यहाँ दिखेगी" },
};

function uncheckedCharacterLibraryText(locale: string, key: Key, values: Record<string, string | number> = {}): string {
    const table = TEXT[locale] || TEXT[locale.split('-')[0]] || TEXT.en;
    return (table[key] || TEXT.en[key]).replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ''));
}

export interface LibraryCharacterDraft {
    readonly name: string;
    readonly appearance: string;
    readonly look: string;
    /** An uploaded picture instead of a drawn portrait. */
    readonly imagePath?: string;
    readonly imageName?: string;
}

export function ComicCharacterLibrarySheet(props: {
    readonly locale: string;
    readonly entries: readonly DesktopComicCharacterLibraryEntry[];
    readonly busy: boolean;
    /** The image model new portraits are drawn with (none: 新建 explains where to pick one). */
    readonly imageModel?: string;
    readonly lookOptions: readonly { readonly id: string; readonly label: string }[];
    readonly creating: boolean;
    readonly error?: string;
    readonly onDelete: (bundleId: string) => void;
    /** appearance is only sent when it was changed, so renaming never rewrites it. */
    readonly onSave: (bundleId: string, patch: { readonly name: string; readonly appearance?: string }) => Promise<boolean> | void;
    readonly onCreate: (draft: LibraryCharacterDraft) => void;
    readonly onPickImage: () => Promise<{ readonly path: string; readonly name: string } | undefined>;
    /** 加入人物库 from a conversation: the new-character form opens with this picture. */
    readonly seed?: { readonly imagePath: string; readonly imageName: string };
    readonly onClose: () => void;
}): React.ReactElement {
    const t = (key: Key, values?: Record<string, string | number>) => characterLibraryText(props.locale, key, values);
    const [confirm, setConfirm] = React.useState('');
    const [editing, setEditing] = React.useState<{ readonly bundleId: string; readonly name: string; readonly appearance: string }>();
    const [draft, setDraft] = React.useState<LibraryCharacterDraft | undefined>(() => props.seed
        ? { name: '', appearance: '', look: props.lookOptions[0]?.id || 'live', imagePath: props.seed.imagePath, imageName: props.seed.imageName } : undefined);
    const panel = React.useRef<HTMLElement>(null);
    React.useEffect(() => { panel.current?.focus(); }, []);
    // The new character is in the grid once drawn: close the form.
    const wasCreating = React.useRef(false);
    React.useEffect(() => {
        if (wasCreating.current && !props.creating && !props.error) setDraft(undefined);
        wasCreating.current = props.creating;
    }, [props.creating, props.error]);
    const locked = props.busy || props.creating;
    const startDraft = () => setDraft({ name: '', appearance: '', look: props.lookOptions[0]?.id || 'live' });
    // Closing the form never closes the library under it.
    const closeDraft = () => { if (!props.creating) { setDraft(undefined); panel.current?.focus(); } };
    return <div className='nmx-sheet-backdrop nmx-dialog-backdrop nmx-cast-backdrop' onMouseDown={() => { if (!locked && !draft) props.onClose(); }}>
        <section ref={panel} tabIndex={-1} className='nmx-cast-library' role='dialog' aria-modal='true' aria-labelledby='nmx-cast-title'
            onMouseDown={event => event.stopPropagation()}
            onKeyDown={event => {
                if (event.key !== 'Escape') return;
                event.preventDefault(); event.stopPropagation();
                if (draft) closeDraft(); else if (editing) setEditing(undefined); else if (!locked) props.onClose();
            }}>
            <header>
                <span className='nmx-cast-mark' aria-hidden='true'><i className='codicon codicon-organization'></i></span>
                <div className='nmx-cast-heading'>
                    <h2 id='nmx-cast-title'>{t('title')}{props.entries.length > 0 && <span className='nmx-cast-total'>{props.entries.length}</span>}</h2>
                    <p>{t('lead')}</p>
                </div>
                {props.entries.length > 0 && <button type='button' className='nmx-cast-new' disabled={locked} onClick={startDraft}>
                    <i className='codicon codicon-add' aria-hidden='true'></i>{t('create')}</button>}
                <button type='button' className='nmx-cast-close' data-nmx-layer-close aria-label={t('close')} title={t('close')} disabled={locked}
                    onClick={props.onClose}><i className='codicon codicon-close' aria-hidden='true'></i></button>
            </header>
            <div className='nmx-cast-body'>
                {props.entries.length === 0 ? <div className='nmx-cast-empty'>
                    <span className='nmx-cast-empty-mark' aria-hidden='true'><i className='codicon codicon-person-add'></i></span>
                    <strong>{t('empty')}</strong><span className='nmx-cast-empty-hint'>{t('emptyHint')}</span>
                    <button type='button' className='nmx-cast-new' disabled={locked} onClick={startDraft}><i className='codicon codicon-add' aria-hidden='true'></i>{t('create')}</button>
                </div> : <ul className='nmx-cast-grid'>
                    {props.entries.map(entry => {
                        const picture = entry.thumbnailPath ? URI.fromFilePath(entry.thumbnailPath).toString() : '';
                        const edit = editing?.bundleId === entry.bundleId ? editing : undefined;
                        const confirming = confirm === entry.bundleId;
                        return <li key={entry.bundleId} className={`nmx-cast-card${edit ? ' is-editing' : ''}`}>
                            <div className='nmx-cast-picture'>
                                {picture ? <img src={picture} alt='' loading='lazy' /> : <span data-nmx-literal>{Array.from(entry.name || '?')[0]}</span>}
                                <em className='nmx-cast-count'><i className={`codicon codicon-${entry.referenceCount ? 'file-media' : 'note'}`} aria-hidden='true'></i>
                                    {entry.referenceCount ? t('pictures', { count: entry.referenceCount }) : t('noPicture')}</em>
                                {!edit && <div className='nmx-cast-tools'>
                                    <button type='button' disabled={locked} aria-label={t('edit')} title={t('edit')}
                                        onClick={() => setEditing({ bundleId: entry.bundleId, name: entry.name, appearance: entry.appearance || '' })}><i className='codicon codicon-edit' aria-hidden='true'></i></button>
                                    <button type='button' className={`is-danger${confirming ? ' is-confirm' : ''}`} disabled={locked}
                                        aria-label={confirming ? t('confirmRemove') : t('remove')} title={confirming ? t('confirmRemove') : t('remove')}
                                        onClick={() => { if (confirming) { setConfirm(''); props.onDelete(entry.bundleId); } else setConfirm(entry.bundleId); }}
                                        onBlur={() => { if (confirming) setConfirm(''); }}>
                                        <i className='codicon codicon-trash' aria-hidden='true'></i>{confirming && <span>{t('confirmRemove')}</span>}</button>
                                </div>}
                            </div>
                            {edit ? <div className='nmx-cast-copy is-editing'>
                                <ImeInput aria-label={t('name')} maxLength={60} value={edit.name} onChange={event => setEditing({ ...edit, name: event.currentTarget.value })} />
                                <ImeTextarea aria-label={t('appearance')} rows={4} maxLength={8000} value={edit.appearance} onChange={event => setEditing({ ...edit, appearance: event.currentTarget.value })} />
                                <div className='nmx-cast-edit-actions'>
                                    <button type='button' className='nmx-secondary-button' onClick={() => setEditing(undefined)}>{t('cancel')}</button>
                                    <button type='button' className='nmx-primary-button' disabled={locked || !edit.name.trim()}
                                        onClick={() => {
                                            // The editor closes only once the change is saved; a failure keeps what was typed and says why.
                                            const saved = props.onSave(entry.bundleId, { name: edit.name.trim(), ...(edit.appearance.trim() !== (entry.appearance || '').trim() ? { appearance: edit.appearance.trim() } : {}) });
                                            void Promise.resolve(saved).then(ok => { if (ok !== false) setEditing(current => current?.bundleId === entry.bundleId ? undefined : current); });
                                        }}>{t('save')}</button>
                                </div>
                                {props.error && !draft && <div className='nmx-agent-inline-error' role='alert'>{props.error}</div>}
                            </div> : <div className='nmx-cast-copy'>
                                <strong data-nmx-literal>{entry.name}{entry.identityVersion && <em data-nmx-literal>{entry.identityVersion}</em>}</strong>
                                <p data-nmx-literal title={entry.appearance || entry.description || undefined}>{entry.appearance || entry.description || '\u00a0'}</p>
                            </div>}
                        </li>;
                    })}
                </ul>}
            </div>
            <footer><i className='codicon codicon-lightbulb' aria-hidden='true'></i><span className='nmx-cast-tip'>{t('how')}</span></footer>
            {draft && <CharacterCreateDialog t={t} draft={draft} setDraft={setDraft} lookOptions={props.lookOptions} creating={props.creating} locked={locked}
                {...(props.imageModel ? { imageModel: props.imageModel } : {})} {...(props.error ? { error: props.error } : {})}
                onPickImage={props.onPickImage} onCreate={props.onCreate} onClose={closeDraft} />}
        </section>
    </div>;
}

/** 新建人物: its own layer over the library — closing it leaves the library open. */
function CharacterCreateDialog(props: {
    readonly t: (key: Key, values?: Record<string, string | number>) => string;
    readonly draft: LibraryCharacterDraft;
    readonly setDraft: React.Dispatch<React.SetStateAction<LibraryCharacterDraft | undefined>>;
    readonly lookOptions: readonly { readonly id: string; readonly label: string }[];
    readonly creating: boolean;
    readonly locked: boolean;
    readonly imageModel?: string;
    readonly error?: string;
    readonly onPickImage: () => Promise<{ readonly path: string; readonly name: string } | undefined>;
    readonly onCreate: (draft: LibraryCharacterDraft) => void;
    readonly onClose: () => void;
}): React.ReactElement {
    const { t, draft, setDraft } = props;
    const nameField = React.useRef<HTMLInputElement>(null);
    React.useEffect(() => { nameField.current?.focus(); }, []);
    // A name, and either a picture of one's own or a description the image model can draw.
    const ready = Boolean(draft.name.trim() && (draft.imagePath || (draft.appearance.trim() && props.imageModel)));
    const preview = draft.imagePath ? URI.fromFilePath(draft.imagePath).toString() : '';
    const pick = () => void props.onPickImage().then(picked => {
        if (picked) setDraft(current => current && { ...current, imagePath: picked.path, imageName: picked.name });
    });
    return <div className='nmx-cast-create-layer' onMouseDown={event => { event.stopPropagation(); if (event.target === event.currentTarget) props.onClose(); }}>
        <form className='nmx-cast-create' role='dialog' aria-modal='true' aria-labelledby='nmx-cast-create-title'
            onSubmit={event => { event.preventDefault(); if (ready && !props.locked) props.onCreate(draft); }}>
            <header>
                <div><h3 id='nmx-cast-create-title'>{t('create')}</h3><p>{t('createLead')}</p></div>
                <button type='button' className='nmx-cast-close' data-nmx-layer-close aria-label={t('cancel')} title={t('cancel')} disabled={props.creating}
                    onClick={props.onClose}><i className='codicon codicon-close' aria-hidden='true'></i></button>
            </header>
            <div className='nmx-cast-create-body'>
                <div className='nmx-cast-create-side'>
                <div className={`nmx-cast-create-preview${preview ? ' has-picture' : ''}${props.creating ? ' is-creating' : ''}`}>
                    {preview ? <img src={preview} alt='' /> : <span className='nmx-cast-silhouette' aria-hidden='true'><i className='codicon codicon-person'></i></span>}
                    {props.creating ? <span className='nmx-cast-create-status'><i className='codicon codicon-loading codicon-modifier-spin' aria-hidden='true'></i>{t('creating')}</span>
                        : !preview && <span className='nmx-cast-create-status'>{t('previewEmpty')}</span>}
                    {preview ? <button type='button' className='nmx-cast-upload-remove' aria-label={t('removeUpload')} title={t('removeUpload')} disabled={props.creating}
                        onClick={() => setDraft({ ...draft, imagePath: undefined, imageName: undefined })}><i className='codicon codicon-close' aria-hidden='true'></i></button>
                        : <button type='button' className='nmx-cast-upload-button' disabled={props.creating} onClick={pick}>
                            <i className='codicon codicon-cloud-upload' aria-hidden='true'></i>{t('upload')}</button>}
                </div>
                <span className='nmx-cast-upload-hint' data-nmx-literal={draft.imageName ? true : undefined} title={draft.imageName || undefined}>
                    {draft.imageName ? <><i className='codicon codicon-file-media' aria-hidden='true'></i><span>{draft.imageName}</span></> : t('uploadHint')}</span>
                </div>
                <div className='nmx-cast-create-fields'>
                    <label><span>{t('name')}</span><ImeInput ref={nameField} maxLength={60} value={draft.name} disabled={props.creating}
                        onChange={event => setDraft({ ...draft, name: event.currentTarget.value })} /></label>
                    <div className='nmx-cast-looks' role='radiogroup' aria-label={t('look')}>
                        <span>{t('look')}</span>
                        <div>{props.lookOptions.map(option => <button key={option.id} type='button' role='radio' aria-checked={draft.look === option.id}
                            className={draft.look === option.id ? 'is-selected' : ''} disabled={props.creating}
                            onClick={() => setDraft({ ...draft, look: option.id })}>{option.label}</button>)}</div>
                    </div>
                    <label><span>{t('appearance')}</span><ImeTextarea rows={5} maxLength={2000} value={draft.appearance} placeholder={t('appearanceHint')} disabled={props.creating}
                        onChange={event => setDraft({ ...draft, appearance: event.currentTarget.value })} /></label>
                </div>
            </div>
            {props.error && <div className='nmx-agent-inline-error' role='alert'>{props.error}</div>}
            <footer>
                <span className='nmx-cast-create-model'>{draft.imagePath ? '' : props.imageModel ? <><i className='codicon codicon-sparkle' aria-hidden='true'></i>{t('model', { model: props.imageModel })}</> : t('noImageModel')}</span>
                <button type='button' className='nmx-secondary-button' disabled={props.creating} onClick={props.onClose}>{t('cancel')}</button>
                <button type='submit' className='nmx-primary-button' disabled={props.locked || !ready}>
                    {props.creating ? <i className='codicon codicon-loading codicon-modifier-spin' aria-hidden='true'></i> : <i className={`codicon codicon-${draft.imagePath ? 'save' : 'sparkle'}`} aria-hidden='true'></i>}
                    {t(draft.imagePath ? 'saveUpload' : 'createGo')}</button>
            </footer>
        </form>
    </div>;
}

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function characterLibraryText(locale: Parameters<typeof uncheckedCharacterLibraryText>[0], key: Parameters<typeof uncheckedCharacterLibraryText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedCharacterLibraryText>>): string {
    return totalCopy(locale, key, language => uncheckedCharacterLibraryText(language, key, ...rest));
}
