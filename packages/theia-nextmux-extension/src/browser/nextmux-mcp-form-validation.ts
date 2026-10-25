import type { NextMuxDesktopLocale } from './nextmux-locale';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

export type McpFormIssue = 'nameRule' | 'nameExists' | 'urlRule' | 'commandRule' | 'argsRule';
type McpFormText = 'nameLabel' | McpFormIssue;
const keys: readonly McpFormText[] = ['nameLabel', 'nameRule', 'nameExists', 'urlRule', 'commandRule', 'argsRule'];
const copy: Readonly<Record<NextMuxDesktopLocale, readonly string[]>> = {
    'zh-CN': ['服务标识', '使用 1–64 个英文字母、数字、点、下划线或连字符；不支持空格、中文或保留名称。', '此服务标识已存在，请换一个。', '请输入有效的 HTTPS 地址，不含用户名、密码、查询参数或 # 片段。', '请输入可执行命令或路径（最多 2048 个字符），参数请单独填写。', '参数须为字符串 JSON 数组或每行一个参数；最多 64 项，每项最多 2048 字符，配置总长度最多 10000 字符。'],
    'zh-TW': ['服務識別碼', '使用 1–64 個英文字母、數字、點、底線或連字號；不支援空格、中文或保留名稱。', '此服務識別碼已存在，請更換。', '請輸入有效的 HTTPS 位址，不含使用者名稱、密碼、查詢參數或 # 片段。', '請輸入可執行命令或路徑（最多 2048 個字元），參數請另填。', '參數須為字串 JSON 陣列或每行一個；最多 64 項，每項最多 2048 字元，設定總長度最多 10000 字元。'],
    en: ['Service ID', 'Use 1–64 ASCII letters, numbers, dots, underscores or hyphens; no spaces, non-ASCII characters or reserved names.', 'This service ID already exists. Choose another.', 'Enter a valid HTTPS URL without a username, password, query or # fragment.', 'Enter an executable command or path (up to 2048 characters). Put arguments in the separate field.', 'Use a JSON array of strings or one argument per line: up to 64 arguments, 2048 characters each and 10000 characters for the configuration.'],
    ja: ['サービス ID', '半角英数字・ピリオド・アンダースコア・ハイフンを1～64文字使用します。空白、全角文字、予約名は使えません。', 'このサービス ID は既に存在します。別の ID を入力してください。', 'ユーザー名、パスワード、クエリ、# フラグメントを含まない有効な HTTPS URL を入力してください。', '実行コマンドまたはパスを2048文字以内で入力してください。引数は別欄に入力します。', '引数は文字列の JSON 配列または1行に1つ。最大64個、各2048文字、設定全体で10000文字までです。'],
    ko: ['서비스 ID', 'ASCII 영문자, 숫자, 점, 밑줄, 하이픈으로 1–64자를 입력하세요. 공백, 비 ASCII 문자, 예약된 이름은 사용할 수 없습니다.', '이미 존재하는 서비스 ID입니다. 다른 ID를 입력하세요.', '사용자 이름, 비밀번호, 쿼리, # 조각이 없는 유효한 HTTPS URL을 입력하세요.', '실행 명령 또는 경로를 최대 2048자로 입력하세요. 인수는 별도 필드에 입력하세요.', '문자열 JSON 배열 또는 한 줄에 하나씩 입력하세요. 인수 최대 64개, 각각 2048자, 전체 설정 10000자까지 가능합니다.'],
    fr: ['Identifiant du service', 'Utilisez 1 à 64 lettres ASCII, chiffres, points, tirets bas ou tirets ; sans espace, caractère non ASCII ni nom réservé.', 'Cet identifiant existe déjà. Choisissez-en un autre.', 'Saisissez une URL HTTPS valide sans identifiant, mot de passe, requête ni fragment #.', 'Saisissez une commande exécutable ou un chemin (2048 caractères maximum). Indiquez les arguments séparément.', 'Utilisez un tableau JSON de chaînes ou un argument par ligne : 64 arguments maximum, 2048 caractères chacun et 10000 pour la configuration.'],
    de: ['Dienst-ID', '1–64 ASCII-Buchstaben, Ziffern, Punkte, Unterstriche oder Bindestriche verwenden; keine Leerzeichen, Nicht-ASCII-Zeichen oder reservierten Namen.', 'Diese Dienst-ID existiert bereits. Wählen Sie eine andere.', 'Eine gültige HTTPS-URL ohne Benutzername, Passwort, Abfrage oder #-Fragment eingeben.', 'Ausführbaren Befehl oder Pfad eingeben (maximal 2048 Zeichen). Argumente separat angeben.', 'JSON-Array aus Zeichenketten oder ein Argument pro Zeile: maximal 64 Argumente, je 2048 Zeichen und 10000 Zeichen für die Konfiguration.'],
    es: ['ID del servicio', 'Usa de 1 a 64 letras ASCII, números, puntos, guiones bajos o guiones; sin espacios, caracteres no ASCII ni nombres reservados.', 'Este ID ya existe. Elige otro.', 'Introduce una URL HTTPS válida sin usuario, contraseña, consulta ni fragmento #.', 'Introduce un comando ejecutable o una ruta (máximo 2048 caracteres). Escribe los argumentos por separado.', 'Usa un array JSON de cadenas o un argumento por línea: hasta 64 argumentos, 2048 caracteres cada uno y 10000 para la configuración.'],
    'pt-BR': ['ID do serviço', 'Use de 1 a 64 letras ASCII, números, pontos, sublinhados ou hífens; sem espaços, caracteres não ASCII ou nomes reservados.', 'Este ID já existe. Escolha outro.', 'Insira uma URL HTTPS válida sem usuário, senha, consulta ou fragmento #.', 'Insira um comando executável ou caminho (até 2048 caracteres). Informe os argumentos separadamente.', 'Use um array JSON de strings ou um argumento por linha: até 64 argumentos, 2048 caracteres cada e 10000 para a configuração.'],
    ru: ['ID сервиса', 'От 1 до 64 ASCII-букв, цифр, точек, подчёркиваний или дефисов; без пробелов, других символов и зарезервированных имён.', 'Такой ID уже существует. Выберите другой.', 'Введите корректный HTTPS URL без имени пользователя, пароля, параметров запроса и фрагмента #.', 'Введите исполняемую команду или путь (до 2048 символов). Аргументы указываются отдельно.', 'Используйте JSON-массив строк или по одному аргументу в строке: до 64 аргументов, 2048 символов каждый и 10000 символов для настроек.'],
    ar: ['معرّف الخدمة', 'استخدم 1–64 حرف ASCII أو رقماً أو نقطة أو شرطة سفلية أو شرطة؛ بلا مسافات أو أحرف غير ASCII أو أسماء محجوزة.', 'معرّف الخدمة موجود بالفعل. اختر معرّفاً آخر.', 'أدخل عنوان HTTPS صالحاً دون اسم مستخدم أو كلمة مرور أو استعلام أو جزء #.', 'أدخل أمراً قابلاً للتنفيذ أو مساراً (حتى 2048 حرفاً). أدخل المعاملات في الحقل المنفصل.', 'استخدم مصفوفة JSON من النصوص أو معاملاً واحداً لكل سطر: حتى 64 معاملاً، 2048 حرفاً لكل منها و10000 حرف للإعدادات.'],
    hi: ['सेवा ID', '1–64 ASCII अक्षर, अंक, बिंदु, अंडरस्कोर या हाइफ़न इस्तेमाल करें; रिक्त स्थान, गैर-ASCII अक्षर और आरक्षित नाम नहीं।', 'यह सेवा ID पहले से मौजूद है। दूसरी चुनें।', 'यूज़रनेम, पासवर्ड, क्वेरी और # फ़्रैगमेंट के बिना मान्य HTTPS URL दर्ज करें।', 'निष्पादन योग्य कमांड या पथ दर्ज करें (अधिकतम 2048 वर्ण)। आर्ग्युमेंट अलग फ़ील्ड में दें।', 'स्ट्रिंग का JSON ऐरे या प्रति पंक्ति एक आर्ग्युमेंट दें: अधिकतम 64 आर्ग्युमेंट, प्रत्येक 2048 वर्ण और कॉन्फ़िगरेशन कुल 10000 वर्ण।']
};

function uncheckedMcpFormText(locale: NextMuxDesktopLocale, key: McpFormText): string {
    return copy[locale][keys.indexOf(key)];
}

export interface McpAutoRecognizedConfig {
    readonly name?: string;
    readonly local: boolean;
    readonly address: string;
    readonly args: readonly string[];
    readonly env?: Readonly<Record<string, string>>;
    readonly authKind?: 'bearer' | 'x-api-key' | 'api-key';
    readonly authToken?: string;
}

function deriveMcpNameCandidate(raw: string): string | undefined {
    const cleaned = raw
        .replace(/^@[^/]+\//, '')
        .replace(/@[0-9A-Za-z.+~-]+$/, '')
        .replace(/^(?:mcp-server-|server-)/i, '')
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase()
        .slice(0, 64);
    return cleaned && /^[a-zA-Z0-9._-]{1,64}$/.test(cleaned) && !['__proto__', 'constructor', 'prototype'].includes(cleaned)
        ? cleaned : undefined;
}

function tokenizeCliCommand(raw: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let quote: '"' | "'" | undefined;
    for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        if (quote) {
            if (ch === '\\' && quote === '"' && i + 1 < raw.length) {
                current += raw[++i];
            } else if (ch === quote) {
                quote = undefined;
            } else {
                current += ch;
            }
        } else if (ch === '"' || ch === "'") {
            quote = ch;
        } else if (/\s/.test(ch)) {
            if (current.length > 0) {
                tokens.push(current);
                current = '';
            }
        } else if (ch === '\\' && i + 1 < raw.length && /\s/.test(raw[i + 1])) {
            current += raw[++i];
        } else {
            current += ch;
        }
    }
    if (current.length > 0) tokens.push(current);
    return tokens;
}

function extractHeaderAuth(headers: Record<string, unknown>): { authKind?: 'bearer' | 'x-api-key' | 'api-key'; authToken?: string } {
    for (const [k, v] of Object.entries(headers)) {
        if (typeof v !== 'string' || !v.trim()) continue;
        const lower = k.toLowerCase();
        const val = v.trim();
        if (lower === 'authorization') {
            const token = val.replace(/^bearer\s+/i, '').trim();
            return { authKind: 'bearer', ...(token && !/\{[^}]+\}|^<[^>]+>$|^YOUR_/i.test(token) ? { authToken: token } : {}) };
        }
        if (lower === 'x-api-key') {
            return { authKind: 'x-api-key', ...(!/\{[^}]+\}|^<[^>]+>$|^YOUR_/i.test(val) ? { authToken: val } : {}) };
        }
        if (lower === 'api-key' || lower === 'apikey') {
            return { authKind: 'api-key', ...(!/\{[^}]+\}|^<[^>]+>$|^YOUR_/i.test(val) ? { authToken: val } : {}) };
        }
    }
    return {};
}

/**
 * Automatically recognizes MCP configurations from pasted JSON (Claude Desktop / Cursor / VS Code / Smithery),
 * CLI commands (npx / uvx / docker / node / python), or remote HTTPS URLs.
 */
export function parseMcpAutoRecognizedInput(raw: string): McpAutoRecognizedConfig | undefined {
    const trimmed = raw.trim().replace(/^```(?:json|bash|sh|zsh|shell)?\s*/i, '').replace(/\s*```$/, '').trim();
    if (!trimmed) return undefined;

    // 1. Try JSON or JSON fragment ("server-name": { "command": ... })
    const jsonCandidates = [trimmed];
    if (/^["'][a-zA-Z0-9._-]+["']\s*:\s*\{/.test(trimmed)) {
        jsonCandidates.push(`{${trimmed.replace(/,\s*$/, '')}}`);
    }
    for (const candidate of jsonCandidates) {
        if (!candidate.startsWith('{')) continue;
        try {
            const parsed = JSON.parse(candidate) as Record<string, unknown>;
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
            let serverName: string | undefined;
            let spec: Record<string, unknown> | undefined;
            const container = (parsed.mcpServers && typeof parsed.mcpServers === 'object' && !Array.isArray(parsed.mcpServers))
                ? parsed.mcpServers as Record<string, unknown>
                : (parsed.servers && typeof parsed.servers === 'object' && !Array.isArray(parsed.servers))
                    ? parsed.servers as Record<string, unknown>
                    : undefined;
            if (container) {
                const firstEntry = Object.entries(container).find(([, v]) => v && typeof v === 'object' && !Array.isArray(v));
                if (firstEntry) {
                    serverName = deriveMcpNameCandidate(firstEntry[0]);
                    spec = firstEntry[1] as Record<string, unknown>;
                }
            } else if (typeof parsed.command === 'string' || typeof parsed.serverUrl === 'string' || typeof parsed.url === 'string') {
                if (typeof parsed.name === 'string') serverName = deriveMcpNameCandidate(parsed.name);
                spec = parsed;
            } else {
                const firstEntry = Object.entries(parsed).find(([, v]) => v && typeof v === 'object' && !Array.isArray(v)
                    && ('command' in (v as Record<string, unknown>) || 'serverUrl' in (v as Record<string, unknown>) || 'url' in (v as Record<string, unknown>)));
                if (firstEntry) {
                    serverName = deriveMcpNameCandidate(firstEntry[0]);
                    spec = firstEntry[1] as Record<string, unknown>;
                }
            }
            if (!spec) continue;
            const remoteUrl = typeof spec.serverUrl === 'string' ? spec.serverUrl.trim() : typeof spec.url === 'string' ? spec.url.trim() : undefined;
            if (remoteUrl) {
                const parsedUrl = parseMcpAutoRecognizedInput(remoteUrl);
                const headersAuth = spec.headers && typeof spec.headers === 'object' && !Array.isArray(spec.headers)
                    ? extractHeaderAuth(spec.headers as Record<string, unknown>) : {};
                const cleanAddress = parsedUrl ? parsedUrl.address : remoteUrl;
                const inferredName = serverName || parsedUrl?.name;
                return {
                    ...(inferredName ? { name: inferredName } : {}),
                    local: false,
                    address: cleanAddress,
                    args: [],
                    ...(headersAuth.authKind || parsedUrl?.authKind ? { authKind: headersAuth.authKind || parsedUrl?.authKind } : {}),
                    ...(headersAuth.authToken || parsedUrl?.authToken ? { authToken: headersAuth.authToken || parsedUrl?.authToken } : {})
                };
            }
            if (typeof spec.command === 'string' && spec.command.trim()) {
                let cmd = spec.command.trim();
                let args = Array.isArray(spec.args) ? spec.args.filter((a): a is string => typeof a === 'string') : [];
                const env: Record<string, string> = {};
                if (spec.env && typeof spec.env === 'object' && !Array.isArray(spec.env)) {
                    for (const [k, v] of Object.entries(spec.env as Record<string, unknown>)) {
                        if (/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(k) && typeof v === 'string') env[k] = v;
                    }
                }
                if (args.length === 0 && /\s/.test(cmd)) {
                    const cliParsed = parseMcpAutoRecognizedInput(cmd);
                    if (cliParsed && cliParsed.local) {
                        cmd = cliParsed.address;
                        args = [...cliParsed.args];
                        if (cliParsed.env) Object.assign(env, cliParsed.env);
                    }
                }
                if (cmd === 'npx' && !args.includes('-y') && !args.includes('--yes')) {
                    args = ['-y', ...args];
                }
                const pkgToken = args.find(a => !a.startsWith('-'));
                const inferredName = serverName || (pkgToken ? deriveMcpNameCandidate(pkgToken) : deriveMcpNameCandidate(cmd));
                return {
                    ...(inferredName ? { name: inferredName } : {}),
                    local: true,
                    address: cmd,
                    args,
                    ...(Object.keys(env).length ? { env } : {})
                };
            }
        } catch { /* Not valid JSON; continue to URL or CLI parsing. */ }
    }

    // 2. Try Remote HTTPS URL
    if (/^https?:\/\//i.test(trimmed) && !/\s/.test(trimmed)) {
        try {
            const url = new URL(trimmed);
            if (url.protocol === 'https:') {
                let authKind: 'bearer' | 'x-api-key' | 'api-key' | undefined;
                let authToken: string | undefined;
                if (url.password || url.username) {
                    authKind = 'bearer';
                    authToken = decodeURIComponent(url.password || url.username);
                } else {
                    for (const [k, v] of url.searchParams.entries()) {
                        if (/^(?:api[_-]?key|x[_-]?api[_-]?key|token|access[_-]?token|key)$/i.test(k) && v.trim()) {
                            authKind = /api[_-]?key/i.test(k) ? 'x-api-key' : 'bearer';
                            authToken = v.trim();
                            break;
                        }
                    }
                }
                const cleanUrl = `${url.origin}${url.pathname}`;
                const hostPart = url.hostname.replace(/^(?:mcp|api|www)\./i, '').split('.')[0];
                const pathPart = url.pathname.split('/').filter(p => p && p !== 'mcp' && p !== 'sse' && p !== 'v1').pop();
                const inferredName = deriveMcpNameCandidate(pathPart ? `${hostPart}-${pathPart}` : hostPart);
                return {
                    ...(inferredName ? { name: inferredName } : {}),
                    local: false,
                    address: cleanUrl,
                    args: [],
                    ...(authKind ? { authKind } : {}),
                    ...(authToken ? { authToken } : {})
                };
            }
        } catch { /* Ignore invalid URL */ }
    }

    // 3. Try CLI command string (e.g. "env KEY=VAL npx -y @pkg/mcp", "npx @pkg/mcp", "uvx markitdown-mcp")
    const tokens = tokenizeCliCommand(trimmed.replace(/^(?:\$|#|>\s*)+/, '').trim());
    if (tokens.length >= 2) {
        let idx = 0;
        const env: Record<string, string> = {};
        if (tokens[idx] === 'env') idx++;
        while (idx < tokens.length && /^[A-Za-z_][A-Za-z0-9_]{0,127}=/.test(tokens[idx])) {
            const eq = tokens[idx].indexOf('=');
            env[tokens[idx].slice(0, eq)] = tokens[idx].slice(eq + 1);
            idx++;
        }
        if (idx < tokens.length) {
            let command = tokens[idx];
            let args = tokens.slice(idx + 1);
            if (command === 'uv' && args[0] === 'tool' && args[1] === 'run' && args.length >= 3) {
                command = 'uvx';
                args = args.slice(2);
            }
            if (command === 'npx' && !args.includes('-y') && !args.includes('--yes')) {
                args = ['-y', ...args];
            }
            const pkgToken = args.find(a => !a.startsWith('-'));
            const inferredName = pkgToken ? deriveMcpNameCandidate(pkgToken) : deriveMcpNameCandidate(command);
            return {
                ...(inferredName ? { name: inferredName } : {}),
                local: true,
                address: command,
                args,
                ...(Object.keys(env).length ? { env } : {})
            };
        }
    }
    return undefined;
}

/** Match the existing registry IDs and configuration limits, not a display-name heuristic.
 * OpenCode's McpAddCommand validates fields before writing configuration; the
 * constraints here remain NextMux's established registry/credential contract. */
export function validateMcpServerForm(input: { name: string; local: boolean; address: string; args: string[] | undefined; env?: Readonly<Record<string, string>> },
    existingNames: readonly string[], editing?: string): Partial<Record<'name' | 'address' | 'args', McpFormIssue>> {
    const issues: Partial<Record<'name' | 'address' | 'args', McpFormIssue>> = {};
    const name = input.name.trim(), address = input.address.trim();
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(name) || ['__proto__', 'constructor', 'prototype'].includes(name)) issues.name = 'nameRule';
    else if (name !== editing && existingNames.includes(name)) issues.name = 'nameExists';
    if (input.local) {
        if (!address || address.length > 2048 || /[\0\r\n]/.test(address)) issues.address = 'commandRule';
        const envEntries = input.env ? Object.entries(input.env) : [];
        const invalidEnv = envEntries.length > 64 || envEntries.some(([k, v]) => !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(k) || typeof v !== 'string' || v.length > 4096 || v.includes('\0'));
        const runnerBase = address.split(/[\\/]/).pop()?.replace(/\.(?:cmd|exe|bat)$/i, '').toLowerCase() || '';
        const isPackageRunner = ['npx', 'uvx', 'bunx', 'pnpx'].includes(runnerBase);
        const hasPackageArg = Array.isArray(input.args) && input.args.some(arg => typeof arg === 'string' && arg.trim().length > 0 && !arg.trim().startsWith('-'));
        if (invalidEnv || !input.args || input.args.length > 64 || input.args.some(arg => typeof arg !== 'string' || arg.length > 2048)
            || (isPackageRunner && !hasPackageArg)
            || (!editing && JSON.stringify({ command: address, args: input.args, ...(envEntries.length ? { env: input.env } : {}) }).length > 10_000)) issues.args = 'argsRule';
    } else {
        try {
            const url = new URL(address);
            if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) issues.address = 'urlRule';
        } catch { issues.address = 'urlRule'; }
    }
    return issues;
}

/** Only fixed public error codes become user-facing text. Raw server errors may contain secrets. */
export function mcpKnownFormError(error: unknown): McpFormIssue | undefined {
    const message = error instanceof Error ? error.message : undefined;
    if (message === 'MCP_NAME_INVALID') return 'nameRule';
    if (message === 'MCP_NAME_EXISTS') return 'nameExists';
    if (message === 'MCP_URL_INVALID') return 'urlRule';
    if (message === 'MCP_COMMAND_INVALID') return 'commandRule';
    return undefined;
}

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function mcpFormText(locale: Parameters<typeof uncheckedMcpFormText>[0], key: Parameters<typeof uncheckedMcpFormText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedMcpFormText>>): string {
    return totalCopy(locale, key, language => uncheckedMcpFormText(language, key, ...rest));
}
