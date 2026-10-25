export const CANVAS_ROUTE_LOCALES = ['zh-CN','en','zh-TW','ja','ko','es','fr','de','pt-BR','ru','ar','hi'] as const;
const text = {
    source: ['API 来源','API source','API 來源','API ソース','API 소스','Origen de API','Source API','API-Quelle','Origem da API','Источник API','مصدر API','API स्रोत'],
    relay: ['中转 API','Relay API','中轉 API','中継 API','중계 API','API intermediaria','API relais','Relay-API','API intermediária','Промежуточный API','API وسيط','रिले API'],
    own: ['自有 API','Own API','自有 API','自分の API','자체 API','API propia','API personnelle','Eigene API','API própria','Собственный API','API خاص','अपना API'],
    merchant: ['中转商','Relay provider','中轉商','中継プロバイダー','중계 제공업체','Proveedor intermediario','Fournisseur relais','Relay-Anbieter','Provedor intermediário','Провайдер-посредник','مزود وسيط','रिले प्रदाता'],
    connection: ['自有 API 连接','Own API connection','自有 API 連線','自分の API 接続','자체 API 연결','Conexión de API propia','Connexion API personnelle','Eigene API-Verbindung','Conexão de API própria','Подключение API','اتصال API الخاص','अपने API का कनेक्शन'],
    choose: ['选择连接','Choose a connection','選擇連線','接続を選択','연결 선택','Elegir conexión','Choisir une connexion','Verbindung wählen','Escolher conexão','Выберите подключение','اختر اتصالاً','कनेक्शन चुनें'],
    none: ['暂无此来源的模型连接','No model connection for this source','此來源暫無模型連線','このソースのモデル接続はありません','이 소스에 모델 연결이 없습니다','No hay conexiones para este origen','Aucune connexion pour cette source','Keine Modellverbindung für diese Quelle','Sem conexão de modelo nesta origem','Нет подключения для этого источника','لا يوجد اتصال نماذج لهذا المصدر','इस स्रोत के लिए कोई मॉडल कनेक्शन नहीं'],
    unavailable: ['当前连接不可用','Current connection unavailable','目前連線不可用','現在の接続は利用できません','현재 연결을 사용할 수 없습니다','Conexión actual no disponible','Connexion actuelle indisponible','Aktuelle Verbindung nicht verfügbar','Conexão atual indisponível','Текущее подключение недоступно','الاتصال الحالي غير متاح','वर्तमान कनेक्शन उपलब्ध नहीं']
} as const;
export function canvasRouteText(locale: string, key: keyof typeof text): string {
    const index = CANVAS_ROUTE_LOCALES.indexOf(locale as typeof CANVAS_ROUTE_LOCALES[number]);
    return text[key]?.[index < 0 ? locale.startsWith('zh') ? 0 : 1 : index] ?? String(key);
}
