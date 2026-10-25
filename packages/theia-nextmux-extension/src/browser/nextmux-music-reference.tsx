import * as React from '@theia/core/shared/react';
import type { ComicMusicSettings, ComicProject } from '@nextmux/comic-core';
import type { MediaApiTemplate } from '@nextmux/model-runtime/media-template';
import { modelSupportsMusicReference, type ModelContract } from '@nextmux/model-runtime/model-contract';
import { officialMediaCapabilities } from '@nextmux/model-runtime/presets';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

const locales = ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'] as const;
type Labels = readonly [string, string, string, string, string, string, string, string, string, string, string, string];
export const MUSIC_REFERENCE_LABELS = {
    mode: ['Mode', '创作模式', '創作模式', '制作モード', '제작 모드', 'Modo', 'Mode', 'Modus', 'Modo', 'Режим', 'النمط', 'मोड'],
    generate: ['Original song', '原创歌曲', '原創歌曲', 'オリジナル曲', '오리지널 곡', 'Canción original', 'Chanson originale', 'Eigener Song', 'Música original', 'Новая песня', 'أغنية أصلية', 'मौलिक गीत'],
    cover: ['Cover', '翻唱', '翻唱', 'カバー', '커버', 'Versión', 'Reprise', 'Cover', 'Cover', 'Кавер', 'إعادة أداء', 'कवर'],
    coverHint: ['Upload a song to restyle it. This does not clone a voice.', '上传歌曲后换风格重唱，不代表克隆音色。', '上傳歌曲後換風格重唱，不代表複製音色。', '曲をアップロードしてスタイルを変更します。声の複製ではありません。', '곡을 업로드하여 스타일을 바꿉니다. 음성 복제 기능이 아닙니다.', 'Sube una canción para cambiar su estilo. No clona voces.', 'Importez une chanson pour changer son style. Cela ne clone pas la voix.', 'Song hochladen und den Stil ändern. Dabei wird keine Stimme geklont.', 'Envie uma música para mudar o estilo. Isso não clona a voz.', 'Загрузите песню, чтобы изменить стиль. Голос не клонируется.', 'ارفع أغنية لتغيير أسلوبها. هذا لا يستنسخ الصوت.', 'गीत अपलोड करके उसकी शैली बदलें। इससे आवाज़ की क्लोनिंग नहीं होती।'],
    voice: ['Singing voice', '演唱声音', '演唱聲音', '歌声', '노래 목소리', 'Voz de canto', 'Voix chantée', 'Gesangsstimme', 'Voz de canto', 'Голос для пения', 'صوت الغناء', 'गायन की आवाज़'],
    default: ['Default', '默认', '預設', 'デフォルト', '기본', 'Predeterminada', 'Par défaut', 'Standard', 'Padrão', 'По умолчанию', 'الافتراضي', 'डिफ़ॉल्ट'],
    myVoice: ['My voice', '我的声音', '我的聲音', '自分の声', '내 목소리', 'Mi voz', 'Ma voix', 'Meine Stimme', 'Minha voz', 'Мой голос', 'صوتي', 'मेरी आवाज़'],
    reset: ['Use default mode', '恢复默认模式', '恢復預設模式', '標準モードに戻す', '기본 모드로 복원', 'Usar modo predeterminado', 'Revenir au mode par défaut', 'Standardmodus verwenden', 'Usar modo padrão', 'Вернуть обычный режим', 'استخدام النمط الافتراضي', 'डिफ़ॉल्ट मोड अपनाएँ'],
    vocalReference: ['Vocal reference', '参考人声', '參考人聲', '参考歌声', '참고 음성', 'Voz de referencia', 'Voix de référence', 'Stimmreferenz', 'Voz de referência', 'Образец голоса', 'عينة صوتية', 'संदर्भ आवाज़'],
    referenceSong: ['Reference song', '参考歌曲', '參考歌曲', '参考曲', '참고 곡', 'Canción de referencia', 'Chanson de référence', 'Referenzsong', 'Música de referência', 'Исходная песня', 'الأغنية المرجعية', 'संदर्भ गीत'],
    importVoice: ['Upload vocal sample', '上传人声样本', '上傳人聲樣本', '声のサンプルを追加', '음성 샘플 업로드', 'Subir muestra de voz', 'Importer un échantillon vocal', 'Stimmprobe hochladen', 'Enviar amostra de voz', 'Загрузить образец голоса', 'رفع عينة صوتية', 'आवाज़ का नमूना अपलोड करें'],
    importSong: ['Upload song', '上传歌曲', '上傳歌曲', '曲を追加', '곡 업로드', 'Subir canción', 'Importer une chanson', 'Song hochladen', 'Enviar música', 'Загрузить песню', 'رفع أغنية', 'गीत अपलोड करें'],
    sampleHint: ['WAV/MP3, at least 15 seconds. Dry vocals recommended; accompaniment may reduce quality.', 'WAV/MP3，至少 15 秒。建议清唱或干声，伴奏可能影响效果。', 'WAV/MP3，至少 15 秒。建議清唱或乾聲，伴奏可能影響效果。', 'WAV/MP3、15 秒以上。伴奏なしの声を推奨します。伴奏は品質に影響する場合があります。', 'WAV/MP3, 15초 이상. 반주 없는 목소리를 권장합니다. 반주는 품질에 영향을 줄 수 있습니다.', 'WAV/MP3, mínimo 15 segundos. Se recomienda voz sin acompañamiento, que puede reducir la calidad.', 'WAV/MP3, au moins 15 secondes. Voix seule recommandée ; l’accompagnement peut réduire la qualité.', 'WAV/MP3, mindestens 15 Sekunden. Trockene Stimme empfohlen; Begleitung kann die Qualität mindern.', 'WAV/MP3, pelo menos 15 segundos. Prefira voz sem acompanhamento, que pode reduzir a qualidade.', 'WAV/MP3, от 15 секунд. Рекомендуется голос без сопровождения: музыка может снизить качество.', 'WAV/MP3، 15 ثانية على الأقل. يُنصح بصوت دون مؤثرات أو موسيقى؛ المصاحبة قد تقلل الجودة.', 'WAV/MP3, कम से कम 15 सेकंड। बिना संगीत की साफ़ आवाज़ बेहतर है; संगीत गुणवत्ता घटा सकता है।'],
    consent: ['This is my voice or I am authorised to use it', '这是我的声音或我已获得授权', '這是我的聲音或我已獲得授權', 'これは自分の声、または使用許可を得た声です', '제 목소리이거나 사용 권한을 받았습니다', 'Esta es mi voz o tengo autorización para usarla', 'C’est ma voix ou je suis autorisé à l’utiliser', 'Das ist meine Stimme oder ich darf sie verwenden', 'Esta é minha voz ou tenho autorização para usá-la', 'Это мой голос или у меня есть разрешение', 'هذا صوتي أو لدي إذن باستخدامه', 'यह मेरी आवाज़ है या मुझे इसके उपयोग की अनुमति है'],
    needConsent: ['Confirm permission to use this voice.', '请勾选人声使用授权。', '請勾選人聲使用授權。', '声の使用許可を確認してください。', '음성 사용 권한을 확인해 주세요.', 'Confirma el permiso para usar esta voz.', 'Confirmez l’autorisation d’utiliser cette voix.', 'Bitte die Erlaubnis zur Stimmnutzung bestätigen.', 'Confirme a autorização para usar esta voz.', 'Подтвердите разрешение на использование голоса.', 'أكد الإذن باستخدام هذا الصوت.', 'इस आवाज़ के उपयोग की अनुमति की पुष्टि करें।'],
    needVoice: ['Upload a vocal sample first.', '请先上传人声样本。', '請先上傳人聲樣本。', '声のサンプルを追加してください。', '먼저 음성 샘플을 업로드해 주세요.', 'Sube primero una muestra de voz.', 'Importez d’abord un échantillon vocal.', 'Bitte zuerst eine Stimmprobe hochladen.', 'Envie uma amostra de voz primeiro.', 'Сначала загрузите образец голоса.', 'ارفع عينة صوتية أولاً.', 'पहले आवाज़ का नमूना अपलोड करें।'],
    needSong: ['Upload a reference song first.', '请先上传参考歌曲。', '請先上傳參考歌曲。', '参考曲を追加してください。', '먼저 참고 곡을 업로드해 주세요.', 'Sube primero una canción de referencia.', 'Importez d’abord une chanson de référence.', 'Bitte zuerst einen Referenzsong hochladen.', 'Envie uma música de referência primeiro.', 'Сначала загрузите исходную песню.', 'ارفع أغنية مرجعية أولاً.', 'पहले संदर्भ गीत अपलोड करें।'],
    format: ['Choose a WAV or MP3 file.', '请选择 WAV 或 MP3 文件。', '請選擇 WAV 或 MP3 檔案。', 'WAV または MP3 を選択してください。', 'WAV 또는 MP3 파일을 선택해 주세요.', 'Elige un archivo WAV o MP3.', 'Choisissez un fichier WAV ou MP3.', 'Bitte eine WAV- oder MP3-Datei wählen.', 'Escolha um arquivo WAV ou MP3.', 'Выберите файл WAV или MP3.', 'اختر ملف WAV أو MP3.', 'WAV या MP3 फ़ाइल चुनें।'],
    duration: ['The vocal sample must be at least 15 seconds.', '人声样本必须至少 15 秒。', '人聲樣本必須至少 15 秒。', '声のサンプルは 15 秒以上必要です。', '음성 샘플은 15초 이상이어야 합니다.', 'La muestra de voz debe durar al menos 15 segundos.', 'L’échantillon vocal doit durer au moins 15 secondes.', 'Die Stimmprobe muss mindestens 15 Sekunden lang sein.', 'A amostra de voz deve ter pelo menos 15 segundos.', 'Образец голоса должен длиться от 15 секунд.', 'يجب ألا تقل العينة الصوتية عن 15 ثانية.', 'आवाज़ का नमूना कम से कम 15 सेकंड का होना चाहिए।'],
    unknownDuration: ['Could not read the audio duration. Choose another file.', '无法读取音频时长，请重新选择文件。', '無法讀取音訊時長，請重新選擇檔案。', '音声の長さを読み取れません。別のファイルを選択してください。', '오디오 길이를 읽을 수 없습니다. 다른 파일을 선택해 주세요.', 'No se pudo leer la duración. Elige otro archivo.', 'Durée audio illisible. Choisissez un autre fichier.', 'Die Audiolänge konnte nicht gelesen werden. Bitte andere Datei wählen.', 'Não foi possível ler a duração. Escolha outro arquivo.', 'Не удалось определить длительность. Выберите другой файл.', 'تعذر قراءة مدة الصوت. اختر ملفاً آخر.', 'ऑडियो की अवधि नहीं पढ़ी जा सकी। दूसरी फ़ाइल चुनें।'],
    unsupported: ['This model or route does not support the selected music mode.', '当前模型或线路不支持所选音乐模式。', '目前模型或線路不支援所選音樂模式。', 'このモデルまたは接続は選択した音楽モードに対応していません。', '현재 모델 또는 연결은 선택한 음악 모드를 지원하지 않습니다.', 'Este modelo o conexión no admite el modo seleccionado.', 'Ce modèle ou cette connexion ne prend pas en charge ce mode.', 'Dieses Modell oder diese Verbindung unterstützt den gewählten Musikmodus nicht.', 'Este modelo ou conexão não oferece suporte ao modo selecionado.', 'Модель или подключение не поддерживает выбранный режим.', 'لا يدعم هذا النموذج أو الاتصال نمط الموسيقى المحدد.', 'यह मॉडल या कनेक्शन चुने गए संगीत मोड का समर्थन नहीं करता।'],
    incompatible: ['Turn off instrumental mode to use a vocal reference or cover.', '使用参考人声或翻唱前，请关闭纯音乐。', '使用參考人聲或翻唱前，請關閉純音樂。', '参考歌声やカバーを使うにはインストゥルメンタルを解除してください。', '참고 음성이나 커버를 사용하려면 연주곡 모드를 꺼 주세요.', 'Desactiva el modo instrumental para usar una voz o una versión.', 'Désactivez le mode instrumental pour une voix de référence ou une reprise.', 'Für Stimmreferenz oder Cover bitte den Instrumentalmodus ausschalten.', 'Desative o modo instrumental para usar voz de referência ou cover.', 'Отключите инструментальный режим для образца голоса или кавера.', 'أوقف النمط الآلي لاستخدام عينة صوتية أو إعادة أداء.', 'संदर्भ आवाज़ या कवर के लिए वाद्य मोड बंद करें।'],
} as const satisfies Record<string, Labels>;
export type MusicReferenceKey = keyof typeof MUSIC_REFERENCE_LABELS;
function uncheckedMusicReferenceText(locale: NextMuxDesktopLocale, key: MusicReferenceKey): string {
    return MUSIC_REFERENCE_LABELS[key][Math.max(0, locales.indexOf(locale))];
}

export interface MusicReferenceSupport { readonly vocalReference: boolean; readonly cover: boolean }
/** A configured input is an explicit declaration by the API owner, never a name heuristic. */
export function musicReferenceSupport(protocol: string | undefined, template?: MediaApiTemplate, model?: ModelContract): MusicReferenceSupport {
    const executable = protocol === 'async_media_template' && template?.kind === 'music';
    const capabilities = executable ? officialMediaCapabilities('async_media_template', 'configured', { mediaTemplate: template }) : [];
    const supports = (capability: 'vocal_reference' | 'cover', configured: boolean): boolean => Boolean(executable && configured && capabilities.includes(capability)
        && modelSupportsMusicReference({ modelCapabilityDeclarations: model?.capabilityDeclarations, routeCapabilityDeclarations: {
            [capability]: { support: 'supported', source: 'merchant_declaration', scope: 'route' }
        } }, capability));
    return { vocalReference: supports('vocal_reference', Boolean(template?.vocalReference)), cover: supports('cover', Boolean(template?.referenceSong)) };
}
type Asset = ComicProject['assets'][number];
export function musicReferenceProblem(settings: ComicMusicSettings, support: MusicReferenceSupport, assets: readonly Asset[]): MusicReferenceKey | undefined {
    const cover = settings.mode === 'cover';
    const voice = !cover && settings.vocalSource === 'my_voice';
    if (!cover && !voice) return undefined;
    if (cover ? !support.cover : !support.vocalReference) return 'unsupported';
    if (settings.instrumental) return 'incompatible';
    const asset = assets.find(item => item.id === (cover ? settings.referenceSongAssetId : settings.vocalReferenceAssetId) && item.status === 'ready');
    if (!asset) return cover ? 'needSong' : 'needVoice';
    if (!['audio/mpeg', 'audio/wav'].includes(asset.mimeType || '') || !/\.(wav|mp3)$/i.test(asset.uri)) return 'format';
    if (!Number.isFinite(asset.durationMs) || !asset.durationMs || asset.durationMs <= 0) return 'unknownDuration';
    if (voice && asset.durationMs < 15_000) return 'duration';
    if (voice && settings.vocalReferenceConsent !== true) return 'needConsent';
    return undefined;
}

export function MusicReferenceFields(props: {
    readonly locale: NextMuxDesktopLocale; readonly settings: ComicMusicSettings; readonly support: MusicReferenceSupport;
    readonly assets: readonly Asset[]; readonly disabled: boolean;
    readonly onSettings: (patch: Partial<ComicMusicSettings>) => void;
    readonly onImport: (kind: 'vocalReference' | 'referenceSong') => void;
}): React.ReactElement {
    const t = (key: MusicReferenceKey): string => musicReferenceText(props.locale, key);
    const cover = props.settings.mode === 'cover';
    const voice = props.settings.vocalSource === 'my_voice';
    const chosen = props.assets.find(item => item.id === (cover ? props.settings.referenceSongAssetId : props.settings.vocalReferenceAssetId));
    const problem = musicReferenceProblem(props.settings, props.support, props.assets);
    return <div className='nmx-music-sound'>
        {props.support.cover && <label><span>{t('mode')}</span><select disabled={props.disabled} value={cover ? 'cover' : 'generate'}
            onChange={event => props.onSettings({ mode: event.currentTarget.value === 'cover' ? 'cover' : 'generate', vocalSource: 'default' })}>
            <option value='generate'>{t('generate')}</option><option value='cover' disabled={!props.support.cover}>{t('cover')}</option>
        </select></label>}
        {!cover && props.support.vocalReference && <label><span>{t('voice')}</span><select disabled={props.disabled} value={voice ? 'my_voice' : 'default'}
            onChange={event => props.onSettings({ vocalSource: event.currentTarget.value === 'my_voice' ? 'my_voice' : 'default' })}>
            <option value='default'>{t('default')}</option><option value='my_voice' disabled={!props.support.vocalReference}>{t('myVoice')}</option>
        </select></label>}
        {(cover || voice) && problem === 'unsupported' && <>
            <p className='nmx-music-note is-warn' role='status'>{t('unsupported')}</p>
            <button type='button' disabled={props.disabled} onClick={() => props.onSettings({ mode: 'generate', vocalSource: 'default' })}>{t('reset')}</button>
        </>}
        {(cover || voice) && problem !== 'unsupported' && <>
            <p className='nmx-music-note'>{t(cover ? 'coverHint' : 'sampleHint')}</p>
            <button type='button' disabled={props.disabled} onClick={() => props.onImport(cover ? 'referenceSong' : 'vocalReference')}>{t(cover ? 'importSong' : 'importVoice')}</button>
            {chosen && <p data-nmx-literal>{chosen.model || chosen.uri.split('/').pop()} · {chosen.durationMs ? `${(chosen.durationMs / 1000).toFixed(1)} s` : ''}</p>}
            {!cover && <label><input type='checkbox' checked={props.settings.vocalReferenceConsent === true} disabled={props.disabled || !chosen}
                onChange={event => props.onSettings({ vocalReferenceConsent: event.currentTarget.checked })} />{t('consent')}</label>}
            {problem && <p className='nmx-music-note is-warn' role='status'>{t(problem)}</p>}
        </>}
    </div>;
}

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function musicReferenceText(locale: Parameters<typeof uncheckedMusicReferenceText>[0], key: Parameters<typeof uncheckedMusicReferenceText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedMusicReferenceText>>): string {
    return totalCopy(locale, key, language => uncheckedMusicReferenceText(language, key, ...rest));
}
