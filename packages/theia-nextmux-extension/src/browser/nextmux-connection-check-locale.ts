import type { NextMuxDesktopLocale } from './nextmux-locale';
import { totalCopy } from './nextmux-copy-fallback';

/**
 * What a connection test really established, per kind of API (audit A03-04): a chat model checks the connection and
 * tool calls; a generation API may check its key or status. If no check ran, say so without
 * inferring whether an arbitrary provider offers a free check.
 */
type Key = 'toolsPassed' | 'toolsFailed' | 'mediaReachable' | 'notChecked';

const copy: Record<NextMuxDesktopLocale, Record<Key, string>> = {
    'zh-CN': { toolsPassed: '“{label}”连接与工具调用已通过。', toolsFailed: '“{label}”可连接，但工具调用检测未通过。', mediaReachable: '“{label}”连接正常。', notChecked: '“{label}”已保存，本次未验证连接。生成请求可能产生费用。' },
    'zh-TW': { toolsPassed: '「{label}」連線與工具呼叫已通過。', toolsFailed: '「{label}」可連線，但工具呼叫檢測未通過。', mediaReachable: '「{label}」連線正常。', notChecked: '「{label}」已儲存，本次未驗證連線。生成請求可能產生費用。' },
    en: { toolsPassed: '“{label}” connected and passed the tool-call check.', toolsFailed: '“{label}” connected, but the tool-call check failed.', mediaReachable: '“{label}” connected.', notChecked: '“{label}” saved. The connection was not verified this time. Generation requests may incur charges.' },
    ja: { toolsPassed: '「{label}」は接続とツール呼び出しの確認に合格しました。', toolsFailed: '「{label}」は接続できますが、ツール呼び出しの確認に失敗しました。', mediaReachable: '「{label}」は正常に接続しました。', notChecked: '「{label}」を保存しました。今回は接続を検証していません。生成リクエストには料金が発生する場合があります。' },
    ko: { toolsPassed: '“{label}” 연결 및 도구 호출 확인을 통과했습니다.', toolsFailed: '“{label}”에 연결되지만 도구 호출 확인에 실패했습니다.', mediaReachable: '“{label}” 연결이 정상입니다.', notChecked: '“{label}”을(를) 저장했습니다. 이번에는 연결을 확인하지 않았습니다. 생성 요청에는 요금이 발생할 수 있습니다.' },
    es: { toolsPassed: '«{label}» conectó y superó la prueba de llamadas a herramientas.', toolsFailed: '«{label}» conectó, pero falló la prueba de llamadas a herramientas.', mediaReachable: '«{label}» conectó correctamente.', notChecked: '«{label}» guardado. Esta vez no se verificó la conexión. Las solicitudes de generación pueden generar cargos.' },
    fr: { toolsPassed: '« {label} » est connecté et a réussi le test d’appel d’outils.', toolsFailed: '« {label} » est connecté, mais le test d’appel d’outils a échoué.', mediaReachable: '« {label} » est bien connecté.', notChecked: '« {label} » enregistré. La connexion n’a pas été vérifiée cette fois. Les requêtes de génération peuvent entraîner des frais.' },
    de: { toolsPassed: '„{label}“ ist verbunden und hat den Tool-Aufruf-Test bestanden.', toolsFailed: '„{label}“ ist verbunden, der Tool-Aufruf-Test ist aber fehlgeschlagen.', mediaReachable: '„{label}“ ist verbunden.', notChecked: '„{label}“ gespeichert. Die Verbindung wurde diesmal nicht überprüft. Generierungsanfragen können Kosten verursachen.' },
    'pt-BR': { toolsPassed: '“{label}” conectou e passou no teste de chamadas de ferramentas.', toolsFailed: '“{label}” conectou, mas o teste de chamadas de ferramentas falhou.', mediaReachable: '“{label}” conectou normalmente.', notChecked: '“{label}” salvo. A conexão não foi verificada desta vez. Solicitações de geração podem gerar cobranças.' },
    ru: { toolsPassed: '«{label}» подключено и прошло проверку вызова инструментов.', toolsFailed: '«{label}» подключено, но проверка вызова инструментов не пройдена.', mediaReachable: '«{label}» подключено.', notChecked: '«{label}» сохранено. В этот раз подключение не проверялось. Запросы на генерацию могут быть платными.' },
    ar: { toolsPassed: 'اتصل «{label}» واجتاز فحص استدعاء الأدوات.', toolsFailed: 'اتصل «{label}» لكنه لم يجتز فحص استدعاء الأدوات.', mediaReachable: 'اتصل «{label}» بنجاح.', notChecked: 'حُفظ «{label}». لم يتم التحقق من الاتصال هذه المرة. قد تترتب رسوم على طلبات التوليد.' },
    hi: { toolsPassed: '“{label}” जुड़ गया और टूल-कॉल जाँच पास की।', toolsFailed: '“{label}” जुड़ गया, पर टूल-कॉल जाँच विफल रही।', mediaReachable: '“{label}” ठीक से जुड़ गया।', notChecked: '“{label}” सहेजा गया। इस बार कनेक्शन सत्यापित नहीं किया गया। जनरेशन अनुरोधों पर शुल्क लग सकता है।' }
};

export function connectionCheckText(locale: NextMuxDesktopLocale, key: Key, label: string): string {
    return totalCopy(locale, key, language => copy[language][key]).replace('{label}', label);
}
