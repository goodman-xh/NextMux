import type { NextMuxDesktopLocale } from './nextmux-locale';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

const copy: Record<NextMuxDesktopLocale, readonly [string, string, string, string]> = {
    'zh-CN': ['本机模型', '回环地址', '无需密钥，仅直连本机服务，不经过平台或系统代理。服务自身是否调用云模型由 Ollama 配置决定。', '测试会运行已安装的模型，消耗本机资源；NextMux 不扣平台余额，也不会自动下载模型。'],
    'zh-TW': ['本機模型', '回環位址', '無需金鑰，僅直連本機服務，不經平台或系統代理。服務是否呼叫雲端模型由 Ollama 設定決定。', '測試會執行已安裝的模型並使用本機資源；NextMux 不扣平台餘額，也不自動下載模型。'],
    en: ['Local models', 'Loopback address', 'No key needed. Connects directly to this device, bypassing the platform and system proxy. Ollama controls whether it uses cloud models.', 'Testing runs an installed model and uses local resources. NextMux does not charge platform credit or download models automatically.'],
    ja: ['ローカルモデル', 'ループバックアドレス', 'キー不要。プラットフォームやシステムプロキシを経由せず、この端末に直接接続します。クラウドモデルの利用は Ollama の設定によります。', 'テストはインストール済みモデルを実行し、端末のリソースを使用します。NextMux は残高を消費せず、モデルを自動ダウンロードしません。'],
    ko: ['로컬 모델', '루프백 주소', '키 없이 플랫폼과 시스템 프록시를 우회하여 이 기기에 직접 연결합니다. 클라우드 모델 사용 여부는 Ollama 설정에 따릅니다.', '테스트는 설치된 모델과 로컬 자원을 사용합니다. NextMux 잔액은 차감되지 않으며 모델을 자동 다운로드하지 않습니다.'],
    es: ['Modelos locales', 'Dirección de bucle local', 'Sin clave. Conexión directa a este dispositivo, sin la plataforma ni el proxy del sistema. Ollama controla el uso de modelos en la nube.', 'La prueba usa un modelo instalado y recursos locales. NextMux no cobra saldo ni descarga modelos automáticamente.'],
    fr: ['Modèles locaux', 'Adresse de bouclage', 'Sans clé. Connexion directe à cet appareil, sans plateforme ni proxy système. Ollama décide de l’usage des modèles cloud.', 'Le test utilise un modèle installé et les ressources locales. NextMux ne débite pas le solde et ne télécharge pas automatiquement de modèles.'],
    de: ['Lokale Modelle', 'Loopback-Adresse', 'Kein Schlüssel nötig. Direkte Verbindung zu diesem Gerät, ohne Plattform oder Systemproxy. Ob Cloud-Modelle verwendet werden, bestimmt Ollama.', 'Der Test nutzt ein installiertes Modell und lokale Ressourcen. NextMux belastet kein Guthaben und lädt keine Modelle automatisch herunter.'],
    'pt-BR': ['Modelos locais', 'Endereço de loopback', 'Sem chave. Conexão direta a este dispositivo, sem plataforma ou proxy do sistema. O uso de modelos na nuvem depende do Ollama.', 'O teste usa um modelo instalado e recursos locais. O NextMux não cobra saldo nem baixa modelos automaticamente.'],
    ru: ['Локальные модели', 'Адрес loopback', 'Ключ не нужен. Прямое подключение к устройству без платформы и системного прокси. Использование облачных моделей зависит от Ollama.', 'Тест использует установленную модель и ресурсы устройства. NextMux не списывает баланс и не загружает модели автоматически.'],
    ar: ['نماذج محلية', 'عنوان الاسترجاع المحلي', 'لا حاجة لمفتاح. اتصال مباشر بهذا الجهاز دون المنصة أو وكيل النظام. يتحكم Ollama في استخدام النماذج السحابية.', 'يستخدم الاختبار نموذجاً مثبتاً وموارد الجهاز. لا يخصم NextMux من الرصيد ولا ينزّل نماذج تلقائياً.'],
    hi: ['स्थानीय मॉडल', 'लूपबैक पता', 'कुंजी की आवश्यकता नहीं। प्लेटफ़ॉर्म और सिस्टम प्रॉक्सी के बिना इस डिवाइस से सीधा कनेक्शन। क्लाउड मॉडल का उपयोग Ollama की सेटिंग पर निर्भर है।', 'परीक्षण स्थापित मॉडल और स्थानीय संसाधनों का उपयोग करता है। NextMux बैलेंस नहीं काटता और मॉडल अपने आप डाउनलोड नहीं करता।']
};

function uncheckedLocalModelText(locale: NextMuxDesktopLocale, key: 'title' | 'address' | 'note' | 'test'): string {
    return copy[locale][({ title: 0, address: 1, note: 2, test: 3 } as const)[key]];
}

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function localModelText(locale: Parameters<typeof uncheckedLocalModelText>[0], key: Parameters<typeof uncheckedLocalModelText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedLocalModelText>>): string {
    return totalCopy(locale, key, language => uncheckedLocalModelText(language, key, ...rest));
}
