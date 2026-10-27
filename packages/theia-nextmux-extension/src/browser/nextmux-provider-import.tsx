import * as React from '@theia/core/shared/react';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import type { ProviderImportRequest } from '../common/nextmux-provider-import';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

/**
 * A relay's "Apply to NextMux" link opens the ＋ Compatible API form with its values filled in.
 * This banner sits above that form and says where the values came from; nothing is saved until
 * the user presses Save or Test and save.
 */

const text = {
    en: { title: 'Imported from {source}', filled: 'The name, API address, API key and model are filled in. Check them, then choose Test and save to add this API to your own APIs.', trust: 'Only import configurations from providers you trust. The key is kept in this computer’s system keychain.', busy: 'A connection is still being saved. When it finishes, click Apply to NextMux on the website again.', converted: 'The link was made for {app}; its address was converted to the OpenAI-compatible path. Change it if the provider uses another one.', notes: 'Notes' },
    'zh-CN': { title: '已从 {source} 导入', filled: '名称、API 地址、API Key 和模型已自动填好。核对无误后点“测试并保存”，这个 API 就会出现在自有 API 里。', trust: '只导入你信任的服务商提供的配置。Key 只保存在本机系统钥匙串。', busy: '当前还有连接正在保存。完成后请在网站上再点一次“应用到 NextMux”。', converted: '这个链接原本是给 {app} 用的，地址已转换成 OpenAI 兼容路径；如果服务商用的是别的路径，请修改。', notes: '备注' },
    'zh-TW': { title: '已從 {source} 匯入', filled: '名稱、API 位址、API Key 和模型已自動填好。核對無誤後點「測試並儲存」，這個 API 就會出現在自有 API 裡。', trust: '只匯入你信任的服務商提供的設定。Key 只儲存在本機系統鑰匙圈。', busy: '目前還有連線正在儲存。完成後請在網站上再點一次「套用到 NextMux」。', converted: '這個連結原本是給 {app} 用的，位址已轉換成 OpenAI 相容路徑；如果服務商用的是其他路徑，請修改。', notes: '備註' },
    ja: { title: '{source} からインポートしました', filled: '名前、API アドレス、API キー、モデルを入力済みです。内容を確認して「テストして保存」を押すと、自分の API に追加されます。', trust: '信頼できる提供元の設定だけをインポートしてください。キーはこのコンピューターのシステムキーチェーンにのみ保存されます。', busy: '別の接続を保存中です。完了したら、サイトの「NextMux に適用」をもう一度押してください。', converted: 'このリンクは {app} 向けのため、アドレスを OpenAI 互換のパスに変換しました。提供元が別のパスを使う場合は変更してください。', notes: 'メモ' },
    ko: { title: '{source}에서 가져옴', filled: '이름, API 주소, API 키, 모델이 채워졌습니다. 확인한 뒤 ‘테스트 후 저장’을 누르면 내 API에 추가됩니다.', trust: '신뢰할 수 있는 제공자의 설정만 가져오세요. 키는 이 컴퓨터의 시스템 키체인에만 저장됩니다.', busy: '다른 연결을 저장하는 중입니다. 끝나면 사이트에서 ‘NextMux에 적용’을 다시 누르세요.', converted: '이 링크는 {app}용이라 주소를 OpenAI 호환 경로로 바꿨습니다. 제공자가 다른 경로를 쓰면 수정하세요.', notes: '메모' },
    es: { title: 'Importado de {source}', filled: 'El nombre, la dirección de la API, la clave y el modelo ya están rellenados. Revísalos y pulsa Probar y guardar para añadir esta API a tus API propias.', trust: 'Importa solo configuraciones de proveedores de confianza. La clave se guarda solo en el llavero del sistema de este equipo.', busy: 'Todavía se está guardando otra conexión. Cuando termine, vuelve a pulsar Aplicar a NextMux en la web.', converted: 'El enlace era para {app}; la dirección se convirtió a la ruta compatible con OpenAI. Cámbiala si el proveedor usa otra.', notes: 'Notas' },
    fr: { title: 'Importé depuis {source}', filled: 'Le nom, l’adresse de l’API, la clé et le modèle sont remplis. Vérifiez-les, puis choisissez Tester et enregistrer pour ajouter cette API à vos API.', trust: 'N’importez que des configurations de fournisseurs de confiance. La clé est conservée uniquement dans le trousseau système de cet ordinateur.', busy: 'Une autre connexion est en cours d’enregistrement. Une fois terminé, cliquez à nouveau sur Appliquer à NextMux sur le site.', converted: 'Le lien était prévu pour {app} ; l’adresse a été convertie vers le chemin compatible OpenAI. Modifiez-la si le fournisseur en utilise un autre.', notes: 'Notes' },
    de: { title: 'Von {source} importiert', filled: 'Name, API-Adresse, API-Schlüssel und Modell sind ausgefüllt. Prüfen Sie sie und wählen Sie Testen und speichern, um diese API zu Ihren eigenen APIs hinzuzufügen.', trust: 'Importieren Sie nur Konfigurationen vertrauenswürdiger Anbieter. Der Schlüssel wird nur im Systemschlüsselbund dieses Computers gespeichert.', busy: 'Eine andere Verbindung wird noch gespeichert. Klicken Sie danach auf der Website erneut auf Auf NextMux anwenden.', converted: 'Der Link war für {app} gedacht; die Adresse wurde in den OpenAI-kompatiblen Pfad umgewandelt. Ändern Sie sie, falls der Anbieter einen anderen nutzt.', notes: 'Notizen' },
    'pt-BR': { title: 'Importado de {source}', filled: 'Nome, endereço da API, chave e modelo já foram preenchidos. Confira e escolha Testar e salvar para adicionar esta API às suas APIs.', trust: 'Importe apenas configurações de provedores confiáveis. A chave fica somente no chaveiro do sistema deste computador.', busy: 'Outra conexão ainda está sendo salva. Quando terminar, clique de novo em Aplicar ao NextMux no site.', converted: 'O link era para {app}; o endereço foi convertido para o caminho compatível com OpenAI. Altere se o provedor usar outro.', notes: 'Notas' },
    ru: { title: 'Импортировано из {source}', filled: 'Название, адрес API, ключ и модель уже заполнены. Проверьте их и нажмите «Проверить и сохранить», чтобы добавить этот API в ваши API.', trust: 'Импортируйте настройки только от доверенных провайдеров. Ключ хранится только в системной связке ключей этого компьютера.', busy: 'Другое подключение ещё сохраняется. Когда оно завершится, снова нажмите «Применить в NextMux» на сайте.', converted: 'Ссылка была для {app}; адрес преобразован в OpenAI-совместимый путь. Измените его, если провайдер использует другой.', notes: 'Заметки' },
    ar: { title: 'تم الاستيراد من {source}', filled: 'تمت تعبئة الاسم وعنوان الواجهة والمفتاح والنموذج. راجعها ثم اختر «اختبار وحفظ» لإضافة هذه الواجهة إلى واجهاتك الخاصة.', trust: 'استورد الإعدادات من مزوّدين تثق بهم فقط. يُحفظ المفتاح في سلسلة مفاتيح النظام على هذا الجهاز فقط.', busy: 'لا يزال اتصال آخر قيد الحفظ. عند انتهائه، انقر «تطبيق على NextMux» في الموقع مرة أخرى.', converted: 'الرابط مُعدّ لـ {app}؛ حُوِّل العنوان إلى المسار المتوافق مع OpenAI. غيّره إن كان المزوّد يستخدم مسارًا آخر.', notes: 'ملاحظات' },
    hi: { title: '{source} से इम्पोर्ट किया गया', filled: 'नाम, API पता, कुंजी और मॉडल भर दिए गए हैं। जाँचें, फिर "टेस्ट करके सेव करें" चुनें ताकि यह API आपकी अपनी API में जुड़ जाए।', trust: 'सिर्फ़ भरोसेमंद प्रदाताओं के कॉन्फ़िगरेशन इम्पोर्ट करें। कुंजी सिर्फ़ इस कंप्यूटर के सिस्टम कीचेन में रहती है।', busy: 'एक और कनेक्शन अभी सेव हो रहा है। पूरा होने पर वेबसाइट पर "NextMux पर लागू करें" फिर से क्लिक करें।', converted: 'यह लिंक {app} के लिए था; पता OpenAI-संगत पथ में बदला गया है। प्रदाता दूसरा पथ इस्तेमाल करे तो बदलें।', notes: 'नोट्स' }
} as const satisfies Record<NextMuxDesktopLocale, Record<string, string>>;

type Key = keyof typeof text.en;
function uncheckedProviderImportText(locale: NextMuxDesktopLocale, key: Key, values: Record<string, string> = {}): string {
    return Object.entries(values).reduce<string>((out, [name, value]) => out.replaceAll(`{${name}}`, value), (text[locale] || text.en)[key]);
}

const APP_NAMES: Readonly<Record<string, string>> = { claude: 'Claude Code', 'claude-desktop': 'Claude Desktop', codex: 'Codex', gemini: 'Gemini CLI', opencode: 'OpenCode', openclaw: 'OpenClaw' };

/** Where the key and every request will go: the host of the link's first API address. */
function providerImportHost(request: ProviderImportRequest): string {
    try { return request.endpoints[0] ? new URL(request.endpoints[0]).host : ''; } catch { return ''; }
}

/** The site or relay name the link came from, for "Imported from …". */
export function providerImportSource(request: ProviderImportRequest): string {
    const endpointHost = providerImportHost(request);
    // With a remark, `name` is the user's own label, not the source; a nameless link's `name` is just the host.
    const explicitName = (request.sourceName ?? (request.remark || request.name === endpointHost ? '' : request.name))?.trim();
    if (explicitName && explicitName !== 'API') return explicitName;
    try { return new URL(request.homepage || request.endpoints[0] || '').host || explicitName || request.name?.trim() || 'API'; } catch { return explicitName || request.name?.trim() || 'API'; }
}

export function ProviderImportBanner(props: { readonly locale: NextMuxDesktopLocale; readonly request: ProviderImportRequest }): React.ReactElement {
    const t = (key: Key, values?: Record<string, string>) => providerImportText(props.locale, key, values);
    const request = props.request;
    const converted = ['claude', 'claude-desktop', 'gemini'].includes(request.app);
    const source = providerImportSource(request);
    // A link names itself; the host beside that name is where the key will actually be sent.
    const host = providerImportHost(request);
    return <div className='nmx-import-source' role='note' data-import-source='relay-link'>
        <strong>
            <i className='codicon codicon-link-external' aria-hidden='true'></i>
            <span data-nmx-literal>{t('title', { source })}</span>
            {host && host !== source && <code className='nmx-import-host' data-nmx-literal title={host}><bdi dir='ltr'>{host}</bdi></code>}
        </strong>
        <p>{t('filled')}</p>
        {converted && <p>{t('converted', { app: APP_NAMES[request.app] || request.app })}</p>}
        {request.notes && <p data-nmx-literal><b>{t('notes')}</b> {request.notes}</p>}
        <p className='is-trust'><i className='codicon codicon-shield' aria-hidden='true'></i><span>{t('trust')}</span></p>
    </div>;
}

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function providerImportText(locale: Parameters<typeof uncheckedProviderImportText>[0], key: Parameters<typeof uncheckedProviderImportText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedProviderImportText>>): string {
    return totalCopy(locale, key, language => uncheckedProviderImportText(language, key, ...rest));
}
