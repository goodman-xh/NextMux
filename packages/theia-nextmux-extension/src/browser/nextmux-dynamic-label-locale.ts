import type { NextMuxDesktopLocale } from './nextmux-locale';
import { totalCopy } from './nextmux-copy-fallback';

/**
 * Sentences built from counts and names (audit A19-01). The surface translator only knows fixed Chinese strings, so
 * these are rendered in the chosen language before they reach the page; system fallbacks inside `data-nmx-literal`
 * (user file names) are localized here too.
 */
type Key = 'attachments' | 'tasksPending' | 'tasksActive' | 'items' | 'missingAppearance' | 'localProvider' | 'localModel' | 'importedProvider'
    | 'musicCount' | 'effectCount' | 'dialogueKept' | 'follows' | 'followsNext' | 'firstShotNext' | 'episode' | 'episodeTitled'
    | 'dialogueMissingVoice' | 'unifiedBalance' | 'referencePrice' | 'topupOffset' | 'paidAt' | 'spent';

const copy: Record<NextMuxDesktopLocale, Record<Key, string>> = {
    'zh-CN': {
        attachments: '{count} 个附件', tasksPending: '{count} 个任务待处理', tasksActive: '{count} 个任务进行中', items: '{count} 条', missingAppearance: '{count} 个角色缺外观',
        localProvider: '本地', localModel: '本地处理', importedProvider: '本机导入', musicCount: '{count} 条音乐', effectCount: '{count} 条音效',
        dialogueKept: '{count} 段对白已保留；当前简洁面板不覆盖多段时间码。', follows: '承接：{title}', followsNext: '承接：{title} · 下一镜：{next}', firstShotNext: '场景首镜 · 下一镜：{next}',
        episode: '第 {number} 集', episodeTitled: '第 {number} 集 · {title}', dialogueMissingVoice: '{count} 个对白镜头还没有声音', unifiedBalance: '统一余额结算',
        referencePrice: '参考价格 {model}', topupOffset: '充值 {amount} · 尾差 +{offset}', paidAt: '支付 {time}', spent: '消费 {amount}'
    },
    'zh-TW': {
        attachments: '{count} 個附件', tasksPending: '{count} 個任務待處理', tasksActive: '{count} 個任務進行中', items: '{count} 條', missingAppearance: '{count} 個角色缺少外觀',
        localProvider: '本機', localModel: '本機處理', importedProvider: '本機匯入', musicCount: '{count} 條音樂', effectCount: '{count} 條音效',
        dialogueKept: '已保留 {count} 段對白；目前的簡潔面板不涵蓋多段時間碼。', follows: '承接：{title}', followsNext: '承接：{title} · 下一鏡：{next}', firstShotNext: '場景首鏡 · 下一鏡：{next}',
        episode: '第 {number} 集', episodeTitled: '第 {number} 集 · {title}', dialogueMissingVoice: '{count} 個對白鏡頭還沒有聲音', unifiedBalance: '統一餘額結算',
        referencePrice: '參考價格 {model}', topupOffset: '儲值 {amount} · 尾差 +{offset}', paidAt: '付款 {time}', spent: '消費 {amount}'
    },
    en: {
        attachments: '{count} attachment(s)', tasksPending: '{count} task(s) need attention', tasksActive: '{count} task(s) running', items: '{count} item(s)', missingAppearance: '{count} character(s) missing a look',
        localProvider: 'Local', localModel: 'Processed locally', importedProvider: 'Imported from this computer', musicCount: '{count} music clip(s)', effectCount: '{count} sound effect(s)',
        dialogueKept: '{count} dialogue lines are kept; this compact panel does not edit multi-line timing.', follows: 'Follows: {title}', followsNext: 'Follows: {title} · Next: {next}', firstShotNext: 'First shot of the scene · Next: {next}',
        episode: 'Episode {number}', episodeTitled: 'Episode {number} · {title}', dialogueMissingVoice: '{count} dialogue shot(s) still have no voice', unifiedBalance: 'Paid from your balance',
        referencePrice: 'Reference price {model}', topupOffset: 'Top-up {amount} · offset +{offset}', paidAt: 'Paid {time}', spent: 'Spent {amount}'
    },
    ja: {
        attachments: '添付 {count} 件', tasksPending: '対応が必要なタスク {count} 件', tasksActive: '実行中のタスク {count} 件', items: '{count} 件', missingAppearance: '外見未設定のキャラクター {count} 人',
        localProvider: 'ローカル', localModel: 'ローカル処理', importedProvider: 'このコンピューターから取り込み', musicCount: '音楽 {count} 件', effectCount: '効果音 {count} 件',
        dialogueKept: 'セリフ {count} 件を保持しています。この簡易パネルでは複数のタイムコードを編集できません。', follows: '前のショット：{title}', followsNext: '前のショット：{title} · 次のショット：{next}', firstShotNext: 'シーン最初のショット · 次のショット：{next}',
        episode: '第 {number} 話', episodeTitled: '第 {number} 話 · {title}', dialogueMissingVoice: '音声のないセリフショットが {count} 件あります', unifiedBalance: '残高から精算',
        referencePrice: '参考価格 {model}', topupOffset: 'チャージ {amount} · 端数 +{offset}', paidAt: '支払い {time}', spent: '利用 {amount}'
    },
    ko: {
        attachments: '첨부 {count}개', tasksPending: '처리할 작업 {count}개', tasksActive: '진행 중인 작업 {count}개', items: '{count}개', missingAppearance: '외형이 없는 캐릭터 {count}명',
        localProvider: '로컬', localModel: '로컬 처리', importedProvider: '이 컴퓨터에서 가져옴', musicCount: '음악 {count}개', effectCount: '효과음 {count}개',
        dialogueKept: '대사 {count}개가 유지됩니다. 이 간단한 패널에서는 여러 타임코드를 편집할 수 없습니다.', follows: '이전 샷: {title}', followsNext: '이전 샷: {title} · 다음 샷: {next}', firstShotNext: '장면 첫 샷 · 다음 샷: {next}',
        episode: '{number}화', episodeTitled: '{number}화 · {title}', dialogueMissingVoice: '음성이 없는 대사 샷 {count}개', unifiedBalance: '잔액에서 정산',
        referencePrice: '참고 가격 {model}', topupOffset: '충전 {amount} · 끝전 +{offset}', paidAt: '결제 {time}', spent: '사용 {amount}'
    },
    es: {
        attachments: '{count} adjunto(s)', tasksPending: '{count} tarea(s) requieren atención', tasksActive: '{count} tarea(s) en curso', items: '{count} elemento(s)', missingAppearance: '{count} personaje(s) sin aspecto',
        localProvider: 'Local', localModel: 'Procesado localmente', importedProvider: 'Importado de este equipo', musicCount: '{count} pista(s) de música', effectCount: '{count} efecto(s) de sonido',
        dialogueKept: 'Se conservan {count} diálogos; este panel compacto no edita varios tiempos.', follows: 'Sigue a: {title}', followsNext: 'Sigue a: {title} · Siguiente: {next}', firstShotNext: 'Primer plano de la escena · Siguiente: {next}',
        episode: 'Episodio {number}', episodeTitled: 'Episodio {number} · {title}', dialogueMissingVoice: '{count} plano(s) con diálogo aún sin voz', unifiedBalance: 'Se paga con tu saldo',
        referencePrice: 'Precio de referencia {model}', topupOffset: 'Recarga {amount} · ajuste +{offset}', paidAt: 'Pagado {time}', spent: 'Gastado {amount}'
    },
    fr: {
        attachments: '{count} pièce(s) jointe(s)', tasksPending: '{count} tâche(s) à traiter', tasksActive: '{count} tâche(s) en cours', items: '{count} élément(s)', missingAppearance: '{count} personnage(s) sans apparence',
        localProvider: 'Local', localModel: 'Traitement local', importedProvider: 'Importé depuis cet ordinateur', musicCount: '{count} musique(s)', effectCount: '{count} effet(s) sonore(s)',
        dialogueKept: '{count} répliques sont conservées ; ce panneau compact ne modifie pas plusieurs minutages.', follows: 'Suit : {title}', followsNext: 'Suit : {title} · Suivant : {next}', firstShotNext: 'Premier plan de la scène · Suivant : {next}',
        episode: 'Épisode {number}', episodeTitled: 'Épisode {number} · {title}', dialogueMissingVoice: '{count} plan(s) dialogué(s) sans voix', unifiedBalance: 'Payé avec votre solde',
        referencePrice: 'Prix de référence {model}', topupOffset: 'Recharge {amount} · écart +{offset}', paidAt: 'Payé {time}', spent: 'Dépensé {amount}'
    },
    de: {
        attachments: '{count} Anhang/Anhänge', tasksPending: '{count} Aufgabe(n) brauchen Aufmerksamkeit', tasksActive: '{count} Aufgabe(n) laufen', items: '{count} Einträge', missingAppearance: '{count} Figur(en) ohne Aussehen',
        localProvider: 'Lokal', localModel: 'Lokal verarbeitet', importedProvider: 'Von diesem Computer importiert', musicCount: '{count} Musikstück(e)', effectCount: '{count} Soundeffekt(e)',
        dialogueKept: '{count} Dialogzeilen bleiben erhalten; dieses kompakte Feld bearbeitet keine mehrfachen Timecodes.', follows: 'Folgt auf: {title}', followsNext: 'Folgt auf: {title} · Nächste: {next}', firstShotNext: 'Erste Einstellung der Szene · Nächste: {next}',
        episode: 'Folge {number}', episodeTitled: 'Folge {number} · {title}', dialogueMissingVoice: '{count} Dialogeinstellung(en) noch ohne Stimme', unifiedBalance: 'Über dein Guthaben abgerechnet',
        referencePrice: 'Referenzpreis {model}', topupOffset: 'Aufladung {amount} · Ausgleich +{offset}', paidAt: 'Bezahlt {time}', spent: 'Verbraucht {amount}'
    },
    'pt-BR': {
        attachments: '{count} anexo(s)', tasksPending: '{count} tarefa(s) precisam de atenção', tasksActive: '{count} tarefa(s) em andamento', items: '{count} item(ns)', missingAppearance: '{count} personagem(ns) sem aparência',
        localProvider: 'Local', localModel: 'Processado localmente', importedProvider: 'Importado deste computador', musicCount: '{count} música(s)', effectCount: '{count} efeito(s) sonoro(s)',
        dialogueKept: '{count} falas foram mantidas; este painel compacto não edita vários tempos.', follows: 'Segue: {title}', followsNext: 'Segue: {title} · Próximo: {next}', firstShotNext: 'Primeiro plano da cena · Próximo: {next}',
        episode: 'Episódio {number}', episodeTitled: 'Episódio {number} · {title}', dialogueMissingVoice: '{count} plano(s) com fala ainda sem voz', unifiedBalance: 'Pago com seu saldo',
        referencePrice: 'Preço de referência {model}', topupOffset: 'Recarga {amount} · ajuste +{offset}', paidAt: 'Pago {time}', spent: 'Gasto {amount}'
    },
    ru: {
        attachments: 'Вложений: {count}', tasksPending: 'Задач требуют внимания: {count}', tasksActive: 'Задач выполняется: {count}', items: 'Элементов: {count}', missingAppearance: 'Персонажей без внешности: {count}',
        localProvider: 'Локально', localModel: 'Локальная обработка', importedProvider: 'Импорт с этого компьютера', musicCount: 'Музыка: {count}', effectCount: 'Звуковые эффекты: {count}',
        dialogueKept: 'Реплик сохранено: {count}; эта компактная панель не редактирует несколько таймкодов.', follows: 'После: {title}', followsNext: 'После: {title} · Далее: {next}', firstShotNext: 'Первый кадр сцены · Далее: {next}',
        episode: 'Серия {number}', episodeTitled: 'Серия {number} · {title}', dialogueMissingVoice: 'Кадров с репликами без голоса: {count}', unifiedBalance: 'Оплата с баланса',
        referencePrice: 'Справочная цена {model}', topupOffset: 'Пополнение {amount} · поправка +{offset}', paidAt: 'Оплачено {time}', spent: 'Списано {amount}'
    },
    ar: {
        attachments: 'المرفقات: {count}', tasksPending: 'مهام تحتاج إلى متابعة: {count}', tasksActive: 'مهام قيد التنفيذ: {count}', items: 'العناصر: {count}', missingAppearance: 'شخصيات بلا مظهر: {count}',
        localProvider: 'محلي', localModel: 'معالجة محلية', importedProvider: 'مستورد من هذا الكمبيوتر', musicCount: 'مقاطع موسيقى: {count}', effectCount: 'مؤثرات صوتية: {count}',
        dialogueKept: 'حُفظت {count} جمل حوار؛ هذه اللوحة المختصرة لا تعدّل التوقيتات المتعددة.', follows: 'بعد: {title}', followsNext: 'بعد: {title} · التالي: {next}', firstShotNext: 'أول لقطة في المشهد · التالي: {next}',
        episode: 'الحلقة {number}', episodeTitled: 'الحلقة {number} · {title}', dialogueMissingVoice: 'لقطات حوار بلا صوت: {count}', unifiedBalance: 'يُدفع من رصيدك',
        referencePrice: 'السعر المرجعي {model}', topupOffset: 'شحن {amount} · فرق +{offset}', paidAt: 'دُفع {time}', spent: 'أُنفق {amount}'
    },
    hi: {
        attachments: '{count} अटैचमेंट', tasksPending: '{count} काम पर ध्यान देना है', tasksActive: '{count} काम चल रहे हैं', items: '{count} आइटम', missingAppearance: '{count} किरदारों का रूप तय नहीं',
        localProvider: 'लोकल', localModel: 'लोकल प्रोसेसिंग', importedProvider: 'इस कंप्यूटर से इम्पोर्ट', musicCount: '{count} संगीत', effectCount: '{count} साउंड इफ़ेक्ट',
        dialogueKept: '{count} संवाद रखे गए हैं; यह छोटा पैनल कई टाइमकोड नहीं बदलता।', follows: 'पिछला: {title}', followsNext: 'पिछला: {title} · अगला: {next}', firstShotNext: 'दृश्य का पहला शॉट · अगला: {next}',
        episode: 'एपिसोड {number}', episodeTitled: 'एपिसोड {number} · {title}', dialogueMissingVoice: '{count} संवाद शॉट में अभी आवाज़ नहीं', unifiedBalance: 'आपके बैलेंस से भुगतान',
        referencePrice: 'संदर्भ कीमत {model}', topupOffset: 'रिचार्ज {amount} · अंतर +{offset}', paidAt: 'भुगतान {time}', spent: 'ख़र्च {amount}'
    }
};

export function dynamicLabel(locale: NextMuxDesktopLocale, key: Key, values: Record<string, string | number> = {}): string {
    return totalCopy(locale, key, language => copy[language][key]).replace(/\{(\w+)\}/g, (whole, name: string) => name in values ? String(values[name]) : whole);
}
