import { reviewedMediaSurfaceText } from './nextmux-media-surface-reviewed';
import { mediaAuditText } from './nextmux-media-audit-locale';
import generatedCatalog from './nextmux-surface-translations.json';
import directorySurfaceCatalog from './nextmux-directory-surface-translations.json';
import reviewedAdditionsCatalog from './nextmux-surface-reviewed-additions.json';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { codingSurfaceText } from './nextmux-coding-surface-locale';
import { shellSurfaceText } from './nextmux-shell-surface-locale';
import { modelsSettingsSurfaceText } from './nextmux-models-settings-surface-locale';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

type SurfaceCatalog = Readonly<Record<string, string>>;

const generated = generatedCatalog as Readonly<Partial<Record<NextMuxDesktopLocale, SurfaceCatalog>>>;
const directorySurface = directorySurfaceCatalog as Readonly<Partial<Record<NextMuxDesktopLocale, SurfaceCatalog>>>;
const reviewedAdditions = reviewedAdditionsCatalog as Readonly<Partial<Record<NextMuxDesktopLocale, SurfaceCatalog>>>;

// Reviewed top-up labels. Simplified Chinese intentionally uses “残忍充值”
// (product decision 2026-09-24); every other locale keeps its ordinary
// “top up now” wording. Keep this override close to the lookup boundary so a
// refreshed generated catalog cannot replace the reviewed labels.
const correctedSurfaceLabels: Readonly<Partial<Record<NextMuxDesktopLocale, SurfaceCatalog>>> = {
    'zh-CN': { '立即充值': '残忍充值' },
    'zh-TW': { '立即充值': '立即儲值' },
    en: { '立即充值': 'Top up now' },
    ja: { '立即充值': 'チャージする' },
    ko: { '立即充值': '충전하기' },
    es: { '立即充值': 'Recargar saldo' },
    fr: { '立即充值': 'Ajouter des fonds' },
    de: { '立即充值': 'Guthaben aufladen' },
    'pt-BR': { '立即充值': 'Adicionar saldo' },
    ru: { '立即充值': 'Пополнить баланс' },
    ar: { '立即充值': 'إضافة رصيد' },
    hi: { '立即充值': 'राशि जोड़ें' }
};

const manual: Readonly<Record<NextMuxDesktopLocale, SurfaceCatalog>> = {
    'zh-CN': {
        "目标文件已在其他位置修改，请打开文件查看。": "目标文件已在其他位置修改，请打开文件查看。",
        "目标文件无法保存": "目标文件无法保存",
        "请保留目标文件的元数据，并在“提示词”段落中填写目标。": "请保留目标文件的元数据，并在“提示词”段落中填写目标。",
        "目标文件路径无效。": "目标文件路径无效。",
        "目标文件目录已改变，请重新打开。": "目标文件目录已改变，请重新打开。",
        "目标文件不是普通文件。": "目标文件不是普通文件。",
        "目标文件过大或不是普通文件。": "目标文件过大或不是普通文件。",
        "目标文件已在其他位置修改，请重新打开后再保存。": "目标文件已在其他位置修改，请重新打开后再保存。",
        "目标文件内容无效。": "目标文件内容无效。",
        "请保留目标文件的所属对话和目标编号。": "请保留目标文件的所属对话和目标编号。",
        "目标文件已创建，请重新打开。": "目标文件已创建，请重新打开。",
        "电脑操作未完成": "电脑操作未完成",
        "操作结果待确认": "操作结果待确认",
        "电脑控制在此环境中不可用。": "电脑控制在此环境中不可用。",
        "电脑操作已取消。": "电脑操作已取消。",
        "电脑控制尚未获得系统权限，请完成系统授权后重试。": "电脑控制尚未获得系统权限，请完成系统授权后重试。",
        "本机电脑控制组件不可用。": "本机电脑控制组件不可用。",
        "浏览器操作已取消。": "浏览器操作已取消。",
        "停止请求尚未确认": "停止请求尚未确认",
        "操作应用": "操作应用",
        "编辑计划": "编辑计划",
        "保存计划": "保存计划",
        "选择其他文件夹": "选择其他文件夹",
        "中转商 / 自有 API": "中转商 / 自有 API",
        "计划中转商": "计划中转商",
        "计划模型": "计划模型",
        "计划思考深度": "计划思考深度",
        "计划上下文": "计划上下文",
        "计划权限": "计划权限",
        "按本机时间执行；休眠后补跑一次。结果保存在所选项目的计划对话中。": "按本机时间执行；休眠后补跑一次。结果保存在所选项目的计划对话中。",
        "请选择中转商与模型。": "请选择中转商与模型。",
        "计划更新失败": "计划更新失败",
        "模型列表加载失败，请重新选择中转商。": "模型列表加载失败，请重新选择中转商。",
        "计划正在运行，请结束后再修改设置。": "计划正在运行，请结束后再修改设置。",
        "计划已发生变化，请刷新后重试。": "计划已发生变化，请刷新后重试。",
        "计划已删除，请刷新后重试。": "计划已删除，请刷新后重试。",
        "请填写计划名称和任务说明。": "请填写计划名称和任务说明。",
        "请检查计划时间与权限设置。": "请检查计划时间与权限设置。",
        "此计划已经执行，请选择新的运行时间。": "此计划已经执行，请选择新的运行时间。",
        "已保存模型": "已保存模型",
        "先选择项目文件夹": "先选择项目文件夹",
        '新建计划': '新建计划',
        '创建计划': '创建计划',
        '按本机时间执行；休眠期间的任务将在恢复后补跑一次，可随时暂停或删除。': '按本机时间执行；休眠期间的任务将在恢复后补跑一次，可随时暂停或删除。',
        '请先在对话中选择模型，再创建计划。': '请先在对话中选择模型，再创建计划。',
        '计划读取失败': '计划读取失败',
        '计划读取失败，请重新打开应用；已保存的计划未被覆盖。': '计划读取失败，请重新打开应用；已保存的计划未被覆盖。',
        '计划保存失败，请重试；任务不会自动发送。': '计划保存失败，请重试；任务不会自动发送。',
        '上次运行已中断，请查看对话恢复。': '上次运行已中断，请查看对话恢复。',
        '该次计划已启动或中断，请查看运行记录；不会重复发送。': '该次计划已启动或中断，请查看运行记录；不会重复发送。',
        '计划暂未执行，将自动重试。': '计划暂未执行，将自动重试。',
        '模型线路不可用，请更换': '模型线路不可用，请更换',
        '任务已中断，请查看运行记录。': '任务已中断，请查看运行记录。',
        '任务已取消，可在对话中恢复。': '任务已取消，可在对话中恢复。',
        '任务已执行结束，但检查未通过。': '任务已执行结束，但检查未通过。',
        '任务已暂停，请在对话中继续。': '任务已暂停，请在对话中继续。',
        '应用正在关闭，计划未重新发送；请查看运行记录。': '应用正在关闭，计划未重新发送；请查看运行记录。',
        '项目文件夹不存在或无法访问，请重新选择。': '项目文件夹不存在或无法访问，请重新选择。',
        '所选路径不是项目文件夹，请重新选择。': '所选路径不是项目文件夹，请重新选择。',
        'Unified model routing': '统一模型路由',
        'Credential inventory': '凭据库存',
        'Built-in': '内置',
        'scenes': '场景',
        'shots': '镜头',
        'Local project file': '本地工程文件',
        'FFmpeg ready': 'FFmpeg 已就绪',
        'FFmpeg unavailable': 'FFmpeg 不可用',
        '对话已结束': '对话已结束',
        'Clear': '清除',
        'Save': '保存',
        'Test': '检测',
        'Checking…': '检测中…',
        '添加到消息': '添加到消息',
        '对话附件': '对话附件',
        '粘贴和拖入的文件本机副本': '粘贴和拖入的文件本机副本',
        '立即充值': '残忍充值'
    },
    'zh-TW': {
        '新建漫剧工程': '新增漫劇工程',
        '新建漫剧': '新增漫劇',
        '横屏 16:9 · 1920×1080': '橫向 16:9 · 1920×1080',
        '竖屏 9:16 · 1080×1920': '直向 9:16 · 1080×1920',
        '方形 1:1 · 1080×1080': '正方形 1:1 · 1080×1080',
        '经典 4:3 · 1440×1080': '經典 4:3 · 1440×1080',
        '空工程': '空白工程',
        "目标文件已在其他位置修改，请打开文件查看。": "目標檔案已在其他位置修改，請開啟檔案查看。",
        "目标文件无法保存": "無法儲存目標檔案",
        "请保留目标文件的元数据，并在“提示词”段落中填写目标。": "請保留目標檔案的中繼資料，並在「提示詞」段落中填寫目標。",
        "目标文件路径无效。": "目標檔案路徑無效。",
        "目标文件目录已改变，请重新打开。": "目標檔案的目錄已變更，請重新開啟。",
        "目标文件不是普通文件。": "目標檔案不是一般檔案。",
        "目标文件过大或不是普通文件。": "目標檔案過大或不是一般檔案。",
        "目标文件已在其他位置修改，请重新打开后再保存。": "目標檔案已在其他位置修改，請重新開啟後再儲存。",
        "目标文件内容无效。": "目標檔案內容無效。",
        "请保留目标文件的所属对话和目标编号。": "請保留目標檔案所屬的對話與目標編號。",
        "目标文件已创建，请重新打开。": "目標檔案已建立，請重新開啟。",
        "电脑操作未完成": "電腦操作未完成",
        "操作结果待确认": "操作結果待確認",
        "电脑控制在此环境中不可用。": "此環境無法使用電腦控制。",
        "电脑操作已取消。": "電腦操作已取消。",
        "电脑控制尚未获得系统权限，请完成系统授权后重试。": "電腦控制尚未取得系統權限，請完成系統授權後重試。",
        "本机电脑控制组件不可用。": "本機電腦控制元件無法使用。",
        "浏览器操作已取消。": "瀏覽器操作已取消。",
        "停止请求尚未确认": "停止請求尚未確認",
        "操作应用": "操作應用程式",
        "编辑计划": "編輯排程",
        "保存计划": "儲存排程",
        "选择其他文件夹": "選擇其他資料夾",
        "中转商 / 自有 API": "中轉商 / 自有 API",
        "计划中转商": "排程中轉商",
        "计划模型": "排程模型",
        "计划思考深度": "排程思考深度",
        "计划上下文": "排程上下文",
        "计划权限": "排程權限",
        "按本机时间执行；休眠后补跑一次。结果保存在所选项目的计划对话中。": "依本機時間執行；休眠後補跑一次。結果儲存在所選專案的排程對話中。",
        "请选择中转商与模型。": "請選擇中轉商與模型。",
        "计划更新失败": "排程更新失敗",
        "模型列表加载失败，请重新选择中转商。": "模型清單載入失敗，請重新選擇中轉商。",
        "计划正在运行，请结束后再修改设置。": "排程正在執行，請結束後再修改設定。",
        "计划已发生变化，请刷新后重试。": "排程已變更，請重新整理後重試。",
        "计划已删除，请刷新后重试。": "排程已刪除，請重新整理後重試。",
        "请填写计划名称和任务说明。": "請填寫排程名稱與任務說明。",
        "请检查计划时间与权限设置。": "請檢查排程時間與權限設定。",
        "此计划已经执行，请选择新的运行时间。": "此排程已執行，請選擇新的執行時間。",
        "已保存模型": "已儲存模型",
        "先选择项目文件夹": "請先選擇專案資料夾",
        '新建计划': '新增排程',
        '创建计划': '建立排程',
        '按本机时间执行；休眠期间的任务将在恢复后补跑一次，可随时暂停或删除。': '依本機時間執行；休眠期間錯過的任務會在喚醒後補跑一次，可隨時暫停或刪除。',
        '请先在对话中选择模型，再创建计划。': '請先在對話中選擇模型，再建立排程。',
        '计划读取失败': '無法讀取排程',
        '计划读取失败，请重新打开应用；已保存的计划未被覆盖。': '無法讀取排程，請重新開啟應用程式；已儲存的排程未被覆寫。',
        '计划保存失败，请重试；任务不会自动发送。': '排程儲存失敗，請重試；任務不會自動送出。',
        '上次运行已中断，请查看对话恢复。': '上次執行已中斷，請開啟對話以繼續。',
        '该次计划已启动或中断，请查看运行记录；不会重复发送。': '此次排程已啟動或中斷，請查看執行記錄；不會重複送出。',
        '计划暂未执行，将自动重试。': '排程尚未執行，將自動重試。',
        '模型线路不可用，请更换': '模型線路無法使用，請更換',
        '任务已中断，请查看运行记录。': '任務已中斷，請查看執行記錄。',
        '任务已取消，可在对话中恢复。': '任務已取消，可在對話中繼續。',
        '任务已执行结束，但检查未通过。': '任務已執行完畢，但檢查未通過。',
        '任务已暂停，请在对话中继续。': '任務已暫停，請在對話中繼續。',
        '应用正在关闭，计划未重新发送；请查看运行记录。': '應用程式正在關閉，排程未重新送出；請查看執行記錄。',
        '项目文件夹不存在或无法访问，请重新选择。': '專案資料夾不存在或無法存取，請重新選擇。',
        '所选路径不是项目文件夹，请重新选择。': '所選路徑不是專案資料夾，請重新選擇。',
        'Unified model routing': '統一模型路由',
        'Credential inventory': '憑證庫存',
        'Built-in': '內建',
        'scenes': '場景',
        'shots': '鏡頭',
        'Local project file': '本機工程檔案',
        'FFmpeg ready': 'FFmpeg 已就緒',
        'FFmpeg unavailable': 'FFmpeg 不可用',
        'Clear': '清除',
        'Save': '儲存',
        'Test': '檢測',
        'Checking…': '檢測中…',
        '添加到消息': '加入訊息',
        '对话附件': '對話附件',
        '粘贴和拖入的文件本机副本': '貼上與拖入檔案的本機副本',
        '立即充值': '立即儲值',
        '系统中没有可用于此文件的应用。': '系統中沒有可用於此檔案的應用程式。',
        '终端名称': '終端機名稱',
        '请在 Windows“隐私和安全性 → 麦克风”中开启“麦克风访问”和“允许桌面应用访问麦克风”，然后重新请求权限。桌面应用不会显示单独的 NextMux 开关。': '請在 Windows「隱私權與安全性 → 麥克風」中開啟「麥克風存取權」和「允許桌面應用程式存取麥克風」，然後重新請求權限。桌面應用程式不會顯示單獨的 NextMux 開關。',
        '请在 macOS“隐私与安全性 → 麦克风”中允许 NextMux，然后重新启动应用。': '請在 macOS「隱私權與安全性 → 麥克風」中允許 NextMux，然後重新啟動應用程式。',
        '请在 macOS“隐私与安全性 → 麦克风”中允许 NextMux，然后重新请求权限。': '請在 macOS「隱私權與安全性 → 麥克風」中允許 NextMux，然後重新請求權限。',
        '请在系统隐私设置中允许桌面应用访问麦克风，然后重新请求权限。': '請在系統隱私權設定中允許桌面應用程式存取麥克風，然後重新請求權限。',
        '无法检查麦克风，请稍后重试。': '無法檢查麥克風，請稍後再試。',
        '消息 ID 已复制': '訊息 ID 已複製',
        '复制消息 ID': '複製訊息 ID',
        '消息定位引用已复制': '訊息定位參照已複製',
        '复制定位引用': '複製定位參照',
        '模型生成的图片': '模型產生的圖片',
        '模型生成的音频': '模型產生的音訊',
        '媒体文件暂不可用': '媒體檔案暫時無法使用',
        '正在读取媒体…': '正在讀取媒體…',
        '将完全访问设为新对话默认值？': '要將完整存取設為新對話的預設值嗎？',
        '此档位可启动本机进程，并可能修改当前工作区外的系统状态。确认后只影响新建对话，已有对话的权限不会改变。': '此層級可啟動本機處理程序，並可能修改目前工作區外的系統狀態。確認後只會影響新建對話，已有對話的權限不會改變。',
        '此档位可启动本机进程，并可能修改当前工作区外的系统状态。确认后，本对话后续任务将保持完全访问，直到主动切换权限。': '此層級可啟動本機處理程序，並可能修改目前工作區外的系統狀態。確認後，本對話後續任務將保持完整存取，直到主動切換權限。',
        '这里设置新对话的默认权限；已有对话保持各自当前权限不变。': '這裡設定新對話的預設權限；已有對話各自維持目前權限不變。'
    },
    en: {
        '新建漫剧工程': 'New comic project',
        '新建漫剧': 'New comic',
        '空工程': 'Empty project',
        "目标文件已在其他位置修改，请打开文件查看。": "The goal file was changed elsewhere. Open the file to review it.",
        "目标文件无法保存": "Unable to save the goal file",
        "请保留目标文件的元数据，并在“提示词”段落中填写目标。": "Keep the goal file metadata and enter your goal in the prompt section.",
        "目标文件路径无效。": "The goal file path is invalid.",
        "目标文件目录已改变，请重新打开。": "The goal file directory has changed. Reopen the file.",
        "目标文件不是普通文件。": "The goal file is not a regular file.",
        "目标文件过大或不是普通文件。": "The goal file is too large or is not a regular file.",
        "目标文件已在其他位置修改，请重新打开后再保存。": "The goal file was changed elsewhere. Reopen it before saving.",
        "目标文件内容无效。": "The goal file content is invalid.",
        "请保留目标文件的所属对话和目标编号。": "Keep the conversation ID and goal ID in the goal file.",
        "目标文件已创建，请重新打开。": "The goal file has already been created. Reopen it.",
        "电脑操作未完成": "Computer action incomplete",
        "操作结果待确认": "Action result awaiting confirmation",
        "电脑控制在此环境中不可用。": "Computer control is unavailable in this environment.",
        "电脑操作已取消。": "Computer action cancelled.",
        "电脑控制尚未获得系统权限，请完成系统授权后重试。": "Computer control requires system permission. Grant access in system settings and try again.",
        "本机电脑控制组件不可用。": "The local computer control component is unavailable.",
        "浏览器操作已取消。": "Browser action cancelled.",
        "停止请求尚未确认": "Stop request not yet confirmed",
        "操作应用": "Operate app",
        "编辑计划": "Edit schedule",
        "保存计划": "Save schedule",
        "选择其他文件夹": "Choose another folder",
        "中转商 / 自有 API": "Provider / Own API",
        "计划中转商": "Schedule provider",
        "计划模型": "Schedule model",
        "计划思考深度": "Schedule reasoning effort",
        "计划上下文": "Schedule context window",
        "计划权限": "Schedule permissions",
        "按本机时间执行；休眠后补跑一次。结果保存在所选项目的计划对话中。": "Runs in local time and catches up once after sleep. Results appear in a scheduled conversation in the selected project.",
        "请选择中转商与模型。": "Select a provider and model.",
        "计划更新失败": "Schedule update failed",
        "模型列表加载失败，请重新选择中转商。": "Could not load models. Select the provider again.",
        "计划正在运行，请结束后再修改设置。": "This schedule is running. Wait for it to finish before editing settings.",
        "计划已发生变化，请刷新后重试。": "This schedule has changed. Refresh and try again.",
        "计划已删除，请刷新后重试。": "This schedule was deleted. Refresh and try again.",
        "请填写计划名称和任务说明。": "Enter a schedule name and task description.",
        "请检查计划时间与权限设置。": "Check the schedule time and permissions.",
        "此计划已经执行，请选择新的运行时间。": "This schedule has already run. Choose a new run time.",
        "已保存模型": "Saved model",
        "先选择项目文件夹": "Select a project folder first",
        '新建计划': 'New schedule',
        '创建计划': 'Create schedule',
        '按本机时间执行；休眠期间的任务将在恢复后补跑一次，可随时暂停或删除。': 'Runs in local time. Tasks missed during sleep run once after wake. Pause or delete at any time.',
        '请先在对话中选择模型，再创建计划。': 'Choose a model in the conversation before creating a schedule.',
        '计划读取失败': 'Could not load schedules',
        '计划读取失败，请重新打开应用；已保存的计划未被覆盖。': 'Could not load schedules. Reopen the app; saved schedules have not been overwritten.',
        '计划保存失败，请重试；任务不会自动发送。': 'Could not save the schedule. Try again; the task will not be sent automatically.',
        '上次运行已中断，请查看对话恢复。': 'The last run was interrupted. Open the conversation to resume.',
        '该次计划已启动或中断，请查看运行记录；不会重复发送。': 'This scheduled run has already started or was interrupted. Check its history; it will not be sent again.',
        '计划暂未执行，将自动重试。': 'The schedule has not run yet and will retry automatically.',
        '模型线路不可用，请更换': 'Model route unavailable. Choose another route.',
        '任务已中断，请查看运行记录。': 'Task interrupted. Check its run history.',
        '任务已取消，可在对话中恢复。': 'Task cancelled. Resume it in the conversation.',
        '任务已执行结束，但检查未通过。': 'Task finished, but checks did not pass.',
        '任务已暂停，请在对话中继续。': 'Task paused. Continue in the conversation.',
        '应用正在关闭，计划未重新发送；请查看运行记录。': 'The app is closing. The scheduled task was not sent again; check its run history.',
        '项目文件夹不存在或无法访问，请重新选择。': 'The project folder is missing or inaccessible. Choose it again.',
        '所选路径不是项目文件夹，请重新选择。': 'The selected path is not a project folder. Choose another folder.',
        'Unified model routing': 'Unified model routing',
        'Credential inventory': 'Credential inventory',
        'Built-in': 'Built-in',
        'scenes': 'scenes',
        'shots': 'shots',
        'Local project file': 'Local project file',
        'FFmpeg ready': 'FFmpeg ready',
        'FFmpeg unavailable': 'FFmpeg unavailable',
        '对话已结束': 'Conversation ended',
        'Clear': 'Clear',
        'Save': 'Save',
        'Test': 'Test',
        'Checking…': 'Checking…',
        '添加到消息': 'Add to message',
        '对话附件': 'Conversation attachments',
        '粘贴和拖入的文件本机副本': 'Local copies of pasted and dropped files'
    },
    ja: {
        "目标文件已在其他位置修改，请打开文件查看。": "目標ファイルが別の場所で変更されました。ファイルを開いて確認してください。",
        "目标文件无法保存": "目標ファイルを保存できません",
        "请保留目标文件的元数据，并在“提示词”段落中填写目标。": "目標ファイルのメタデータを保持し、プロンプト欄に目標を入力してください。",
        "目标文件路径无效。": "目標ファイルのパスが無効です。",
        "目标文件目录已改变，请重新打开。": "目標ファイルのディレクトリが変更されました。ファイルを開き直してください。",
        "目标文件不是普通文件。": "目標ファイルは通常のファイルではありません。",
        "目标文件过大或不是普通文件。": "目標ファイルが大きすぎるか、通常のファイルではありません。",
        "目标文件已在其他位置修改，请重新打开后再保存。": "目標ファイルが別の場所で変更されました。開き直してから保存してください。",
        "目标文件内容无效。": "目標ファイルの内容が無効です。",
        "请保留目标文件的所属对话和目标编号。": "目標ファイルの会話 ID と目標 ID を保持してください。",
        "目标文件已创建，请重新打开。": "目標ファイルはすでに作成されています。開き直してください。",
        "电脑操作未完成": "コンピューター操作が完了していません",
        "操作结果待确认": "操作結果の確認が必要です",
        "电脑控制在此环境中不可用。": "この環境ではコンピューター操作を利用できません。",
        "电脑操作已取消。": "コンピューター操作をキャンセルしました。",
        "电脑控制尚未获得系统权限，请完成系统授权后重试。": "コンピューター操作にはシステム権限が必要です。システム設定で許可してから再試行してください。",
        "本机电脑控制组件不可用。": "ローカルのコンピューター操作コンポーネントを利用できません。",
        "浏览器操作已取消。": "ブラウザー操作をキャンセルしました。",
        "停止请求尚未确认": "停止要求はまだ確認されていません",
        "操作应用": "アプリを操作",
        "编辑计划": "スケジュールを編集",
        "保存计划": "スケジュールを保存",
        "选择其他文件夹": "別のフォルダーを選択",
        "中转商 / 自有 API": "プロバイダー / 独自 API",
        "计划中转商": "スケジュールのプロバイダー",
        "计划模型": "スケジュールのモデル",
        "计划思考深度": "スケジュールの推論深度",
        "计划上下文": "スケジュールのコンテキスト",
        "计划权限": "スケジュールの権限",
        "按本机时间执行；休眠后补跑一次。结果保存在所选项目的计划对话中。": "ローカル時刻で実行し、スリープ後は一度だけ補完実行します。結果は選択したプロジェクトのスケジュール用会話に保存します。",
        "请选择中转商与模型。": "プロバイダーとモデルを選択してください。",
        "计划更新失败": "スケジュールの更新に失敗しました",
        "模型列表加载失败，请重新选择中转商。": "モデルを読み込めませんでした。プロバイダーを選び直してください。",
        "计划正在运行，请结束后再修改设置。": "実行中です。完了してから設定を変更してください。",
        "计划已发生变化，请刷新后重试。": "スケジュールが変更されました。更新して再試行してください。",
        "计划已删除，请刷新后重试。": "スケジュールは削除されました。更新して再試行してください。",
        "请填写计划名称和任务说明。": "スケジュール名とタスクの説明を入力してください。",
        "请检查计划时间与权限设置。": "実行時刻と権限を確認してください。",
        "此计划已经执行，请选择新的运行时间。": "実行済みです。新しい実行時刻を選択してください。",
        "已保存模型": "保存済みモデル",
        "先选择项目文件夹": "先にプロジェクトフォルダーを選択してください",
        '新建计划': '新しいスケジュール',
        '创建计划': 'スケジュールを作成',
        '按本机时间执行；休眠期间的任务将在恢复后补跑一次，可随时暂停或删除。': 'ローカル時刻で実行します。スリープ中に逃したタスクは復帰後に一度実行します。いつでも一時停止・削除できます。',
        '请先在对话中选择模型，再创建计划。': 'スケジュールを作成する前に、会話でモデルを選択してください。',
        '计划读取失败': 'スケジュールを読み込めません',
        '计划读取失败，请重新打开应用；已保存的计划未被覆盖。': 'スケジュールを読み込めません。アプリを開き直してください。保存済みのスケジュールは上書きされていません。',
        '计划保存失败，请重试；任务不会自动发送。': 'スケジュールを保存できません。再試行してください。タスクは自動送信されません。',
        '上次运行已中断，请查看对话恢复。': '前回の実行は中断されました。会話を開いて再開してください。',
        '该次计划已启动或中断，请查看运行记录；不会重复发送。': '今回のスケジュールは開始済みか中断されています。実行履歴を確認してください。再送信はしません。',
        '计划暂未执行，将自动重试。': 'スケジュールはまだ実行されていません。自動で再試行します。',
        '模型线路不可用，请更换': 'モデルの接続先を利用できません。別の接続先を選んでください。',
        '任务已中断，请查看运行记录。': 'タスクが中断されました。実行履歴を確認してください。',
        '任务已取消，可在对话中恢复。': 'タスクがキャンセルされました。会話から再開できます。',
        '任务已执行结束，但检查未通过。': 'タスクの実行は終了しましたが、チェックに合格しませんでした。',
        '任务已暂停，请在对话中继续。': 'タスクは一時停止中です。会話で続行してください。',
        '应用正在关闭，计划未重新发送；请查看运行记录。': 'アプリを終了しています。スケジュールのタスクは再送信していません。実行履歴を確認してください。',
        '项目文件夹不存在或无法访问，请重新选择。': 'プロジェクトフォルダーが存在しないか、アクセスできません。選択し直してください。',
        '所选路径不是项目文件夹，请重新选择。': '選択したパスはプロジェクトフォルダーではありません。選択し直してください。',
        'Unified model routing': '統合モデルルーティング',
        'Credential inventory': '認証情報インベントリ',
        'Built-in': '組み込み',
        'scenes': 'シーン',
        'shots': 'ショット',
        'Local project file': 'ローカルプロジェクトファイル',
        'FFmpeg ready': 'FFmpeg 準備完了',
        'FFmpeg unavailable': 'FFmpeg 利用不可',
        '对话已结束': '会話は終了しました',
        'Clear': 'クリア',
        'Save': '保存',
        'Test': 'テスト',
        'Checking…': '確認中…',
        '添加到消息': 'メッセージに追加',
        '对话附件': '会話の添付ファイル',
        '粘贴和拖入的文件本机副本': '貼り付けまたはドロップしたファイルのローカルコピー'
    },
    ko: {
        "目标文件已在其他位置修改，请打开文件查看。": "목표 파일이 다른 곳에서 변경되었습니다. 파일을 열어 확인하세요.",
        "目标文件无法保存": "목표 파일을 저장할 수 없습니다",
        "请保留目标文件的元数据，并在“提示词”段落中填写目标。": "목표 파일의 메타데이터를 유지하고 프롬프트 섹션에 목표를 입력하세요.",
        "目标文件路径无效。": "목표 파일 경로가 올바르지 않습니다.",
        "目标文件目录已改变，请重新打开。": "목표 파일 디렉터리가 변경되었습니다. 파일을 다시 여세요.",
        "目标文件不是普通文件。": "목표 파일이 일반 파일이 아닙니다.",
        "目标文件过大或不是普通文件。": "목표 파일이 너무 크거나 일반 파일이 아닙니다.",
        "目标文件已在其他位置修改，请重新打开后再保存。": "목표 파일이 다른 곳에서 변경되었습니다. 다시 연 후 저장하세요.",
        "目标文件内容无效。": "목표 파일 내용이 올바르지 않습니다.",
        "请保留目标文件的所属对话和目标编号。": "목표 파일의 대화 ID와 목표 ID를 유지하세요.",
        "目标文件已创建，请重新打开。": "목표 파일이 이미 생성되었습니다. 다시 여세요.",
        "电脑操作未完成": "컴퓨터 작업 미완료",
        "操作结果待确认": "작업 결과 확인 필요",
        "电脑控制在此环境中不可用。": "이 환경에서는 컴퓨터 제어를 사용할 수 없습니다.",
        "电脑操作已取消。": "컴퓨터 작업이 취소되었습니다.",
        "电脑控制尚未获得系统权限，请完成系统授权后重试。": "컴퓨터 제어에 시스템 권한이 필요합니다. 시스템 설정에서 권한을 허용한 후 다시 시도하세요.",
        "本机电脑控制组件不可用。": "로컬 컴퓨터 제어 구성 요소를 사용할 수 없습니다.",
        "浏览器操作已取消。": "브라우저 작업이 취소되었습니다.",
        "停止请求尚未确认": "중지 요청이 아직 확인되지 않았습니다",
        "操作应用": "앱 조작",
        "编辑计划": "예약 편집",
        "保存计划": "예약 저장",
        "选择其他文件夹": "다른 폴더 선택",
        "中转商 / 自有 API": "공급자 / 자체 API",
        "计划中转商": "예약 공급자",
        "计划模型": "예약 모델",
        "计划思考深度": "예약 추론 수준",
        "计划上下文": "예약 컨텍스트",
        "计划权限": "예약 권한",
        "按本机时间执行；休眠后补跑一次。结果保存在所选项目的计划对话中。": "현지 시간으로 실행하며 절전 후 한 번 보충 실행합니다. 결과는 선택한 프로젝트의 예약 대화에 저장됩니다.",
        "请选择中转商与模型。": "공급자와 모델을 선택하세요.",
        "计划更新失败": "예약 업데이트 실패",
        "模型列表加载失败，请重新选择中转商。": "모델을 불러오지 못했습니다. 공급자를 다시 선택하세요.",
        "计划正在运行，请结束后再修改设置。": "예약이 실행 중입니다. 완료 후 설정을 변경하세요.",
        "计划已发生变化，请刷新后重试。": "예약이 변경되었습니다. 새로고침 후 다시 시도하세요.",
        "计划已删除，请刷新后重试。": "예약이 삭제되었습니다. 새로고침 후 다시 시도하세요.",
        "请填写计划名称和任务说明。": "예약 이름과 작업 설명을 입력하세요.",
        "请检查计划时间与权限设置。": "예약 시간과 권한을 확인하세요.",
        "此计划已经执行，请选择新的运行时间。": "이미 실행된 예약입니다. 새 실행 시간을 선택하세요.",
        "已保存模型": "저장된 모델",
        "先选择项目文件夹": "먼저 프로젝트 폴더를 선택하세요",
        '新建计划': '새 예약',
        '创建计划': '예약 만들기',
        '按本机时间执行；休眠期间的任务将在恢复后补跑一次，可随时暂停或删除。': '기기의 현지 시간에 실행됩니다. 절전 중 놓친 작업은 절전 해제 후 한 번 실행됩니다. 언제든 일시 중지하거나 삭제할 수 있습니다.',
        '请先在对话中选择模型，再创建计划。': '예약을 만들기 전에 대화에서 모델을 선택하세요.',
        '计划读取失败': '예약을 불러올 수 없음',
        '计划读取失败，请重新打开应用；已保存的计划未被覆盖。': '예약을 불러올 수 없습니다. 앱을 다시 여세요. 저장된 예약은 덮어쓰지 않았습니다.',
        '计划保存失败，请重试；任务不会自动发送。': '예약을 저장할 수 없습니다. 다시 시도하세요. 작업은 자동으로 전송되지 않습니다.',
        '上次运行已中断，请查看对话恢复。': '지난 실행이 중단되었습니다. 대화를 열어 재개하세요.',
        '该次计划已启动或中断，请查看运行记录；不会重复发送。': '이번 예약 작업은 이미 시작되었거나 중단되었습니다. 실행 기록을 확인하세요. 다시 전송하지 않습니다.',
        '计划暂未执行，将自动重试。': '예약이 아직 실행되지 않았습니다. 자동으로 다시 시도합니다.',
        '模型线路不可用，请更换': '모델 경로를 사용할 수 없습니다. 다른 경로를 선택하세요.',
        '任务已中断，请查看运行记录。': '작업이 중단되었습니다. 실행 기록을 확인하세요.',
        '任务已取消，可在对话中恢复。': '작업이 취소되었습니다. 대화에서 재개할 수 있습니다.',
        '任务已执行结束，但检查未通过。': '작업 실행은 끝났지만 검사를 통과하지 못했습니다.',
        '任务已暂停，请在对话中继续。': '작업이 일시 중지되었습니다. 대화에서 계속하세요.',
        '应用正在关闭，计划未重新发送；请查看运行记录。': '앱을 종료하는 중입니다. 예약 작업을 다시 전송하지 않았습니다. 실행 기록을 확인하세요.',
        '项目文件夹不存在或无法访问，请重新选择。': '프로젝트 폴더가 없거나 접근할 수 없습니다. 다시 선택하세요.',
        '所选路径不是项目文件夹，请重新选择。': '선택한 경로가 프로젝트 폴더가 아닙니다. 다시 선택하세요.',
        'Unified model routing': '통합 모델 라우팅',
        'Credential inventory': '자격 증명 인벤토리',
        'Built-in': '내장',
        'scenes': '장면',
        'shots': '샷',
        'Local project file': '로컬 프로젝트 파일',
        'FFmpeg ready': 'FFmpeg 준비됨',
        'FFmpeg unavailable': 'FFmpeg 사용 불가',
        '对话已结束': '대화가 종료되었습니다',
        'Clear': '지우기',
        'Save': '저장',
        'Test': '테스트',
        'Checking…': '확인 중…',
        '添加到消息': '메시지에 추가',
        '对话附件': '대화 첨부 파일',
        '粘贴和拖入的文件本机副本': '붙여넣거나 끌어다 놓은 파일의 로컬 사본'
    },
    es: {
        "目标文件已在其他位置修改，请打开文件查看。": "El archivo de objetivo se modificó en otro lugar. Ábrelo para revisarlo.",
        "目标文件无法保存": "No se puede guardar el archivo de objetivo",
        "请保留目标文件的元数据，并在“提示词”段落中填写目标。": "Conserva los metadatos del archivo de objetivo e introduce tu objetivo en la sección de instrucciones.",
        "目标文件路径无效。": "La ruta del archivo de objetivo no es válida.",
        "目标文件目录已改变，请重新打开。": "El directorio del archivo de objetivo ha cambiado. Vuelve a abrir el archivo.",
        "目标文件不是普通文件。": "El archivo de objetivo no es un archivo normal.",
        "目标文件过大或不是普通文件。": "El archivo de objetivo es demasiado grande o no es un archivo normal.",
        "目标文件已在其他位置修改，请重新打开后再保存。": "El archivo de objetivo se modificó en otro lugar. Vuelve a abrirlo antes de guardar.",
        "目标文件内容无效。": "El contenido del archivo de objetivo no es válido.",
        "请保留目标文件的所属对话和目标编号。": "Conserva el ID de conversación y el ID de objetivo en el archivo de objetivo.",
        "目标文件已创建，请重新打开。": "El archivo de objetivo ya se ha creado. Vuelve a abrirlo.",
        "电脑操作未完成": "Acción del equipo incompleta",
        "操作结果待确认": "Resultado de la acción pendiente de confirmar",
        "电脑控制在此环境中不可用。": "El control del equipo no está disponible en este entorno.",
        "电脑操作已取消。": "Acción del equipo cancelada.",
        "电脑控制尚未获得系统权限，请完成系统授权后重试。": "El control del equipo requiere permisos del sistema. Concede acceso en los ajustes del sistema y vuelve a intentarlo.",
        "本机电脑控制组件不可用。": "El componente local de control del equipo no está disponible.",
        "浏览器操作已取消。": "Acción del navegador cancelada.",
        "停止请求尚未确认": "Solicitud de detención aún no confirmada",
        "操作应用": "Controlar aplicación",
        "编辑计划": "Editar programación",
        "保存计划": "Guardar programación",
        "选择其他文件夹": "Elegir otra carpeta",
        "中转商 / 自有 API": "Proveedor / API propia",
        "计划中转商": "Proveedor de la programación",
        "计划模型": "Modelo de la programación",
        "计划思考深度": "Razonamiento de la programación",
        "计划上下文": "Contexto de la programación",
        "计划权限": "Permisos de la programación",
        "按本机时间执行；休眠后补跑一次。结果保存在所选项目的计划对话中。": "Se ejecuta en hora local y recupera una ejecución tras la suspensión. Los resultados se guardan en una conversación programada del proyecto elegido.",
        "请选择中转商与模型。": "Selecciona un proveedor y un modelo.",
        "计划更新失败": "No se pudo actualizar la programación",
        "模型列表加载失败，请重新选择中转商。": "No se pudieron cargar los modelos. Vuelve a seleccionar el proveedor.",
        "计划正在运行，请结束后再修改设置。": "La programación se está ejecutando. Espera a que termine antes de cambiar los ajustes.",
        "计划已发生变化，请刷新后重试。": "La programación ha cambiado. Actualiza e inténtalo de nuevo.",
        "计划已删除，请刷新后重试。": "La programación se ha eliminado. Actualiza e inténtalo de nuevo.",
        "请填写计划名称和任务说明。": "Introduce un nombre y una descripción de la tarea.",
        "请检查计划时间与权限设置。": "Comprueba la hora y los permisos de la programación.",
        "此计划已经执行，请选择新的运行时间。": "La programación ya se ejecutó. Elige una nueva hora.",
        "已保存模型": "Modelo guardado",
        "先选择项目文件夹": "Selecciona primero una carpeta de proyecto",
        '新建计划': 'Nueva programación',
        '创建计划': 'Crear programación',
        '按本机时间执行；休眠期间的任务将在恢复后补跑一次，可随时暂停或删除。': 'Se ejecuta en la hora local. Las tareas omitidas durante la suspensión se ejecutan una vez al reanudar. Puedes pausar o eliminar la programación cuando quieras.',
        '请先在对话中选择模型，再创建计划。': 'Elige un modelo en la conversación antes de crear una programación.',
        '计划读取失败': 'No se pudieron cargar las programaciones',
        '计划读取失败，请重新打开应用；已保存的计划未被覆盖。': 'No se pudieron cargar las programaciones. Vuelve a abrir la aplicación; las guardadas no se han sobrescrito.',
        '计划保存失败，请重试；任务不会自动发送。': 'No se pudo guardar la programación. Inténtalo de nuevo; la tarea no se enviará automáticamente.',
        '上次运行已中断，请查看对话恢复。': 'La última ejecución se interrumpió. Abre la conversación para reanudarla.',
        '该次计划已启动或中断，请查看运行记录；不会重复发送。': 'Esta ejecución programada ya se inició o se interrumpió. Revisa su historial; no se volverá a enviar.',
        '计划暂未执行，将自动重试。': 'La programación aún no se ha ejecutado. Se reintentará automáticamente.',
        '模型线路不可用，请更换': 'La ruta del modelo no está disponible. Elige otra.',
        '任务已中断，请查看运行记录。': 'La tarea se interrumpió. Revisa su historial de ejecución.',
        '任务已取消，可在对话中恢复。': 'La tarea se canceló. Puedes reanudarla en la conversación.',
        '任务已执行结束，但检查未通过。': 'La tarea terminó, pero no superó las comprobaciones.',
        '任务已暂停，请在对话中继续。': 'La tarea está en pausa. Continúa en la conversación.',
        '应用正在关闭，计划未重新发送；请查看运行记录。': 'La aplicación se está cerrando. La tarea programada no se ha reenviado; revisa su historial de ejecución.',
        '项目文件夹不存在或无法访问，请重新选择。': 'La carpeta del proyecto no existe o no es accesible. Vuelve a seleccionarla.',
        '所选路径不是项目文件夹，请重新选择。': 'La ruta seleccionada no es una carpeta de proyecto. Elige otra carpeta.',
        'Unified model routing': 'Enrutamiento unificado de modelos',
        'Credential inventory': 'Inventario de credenciales',
        'Built-in': 'Integrado',
        'scenes': 'escenas',
        'shots': 'planos',
        'Local project file': 'Archivo de proyecto local',
        'FFmpeg ready': 'FFmpeg listo',
        'FFmpeg unavailable': 'FFmpeg no disponible',
        '对话已结束': 'Conversación finalizada',
        'Clear': 'Limpiar',
        'Save': 'Guardar',
        'Test': 'Probar',
        'Checking…': 'Comprobando…',
        '添加到消息': 'Añadir al mensaje',
        '对话附件': 'Archivos adjuntos de la conversación',
        '粘贴和拖入的文件本机副本': 'Copias locales de archivos pegados y arrastrados'
    },
    fr: {
        "目标文件已在其他位置修改，请打开文件查看。": "Le fichier d’objectif a été modifié ailleurs. Ouvrez-le pour le vérifier.",
        "目标文件无法保存": "Impossible d’enregistrer le fichier d’objectif",
        "请保留目标文件的元数据，并在“提示词”段落中填写目标。": "Conservez les métadonnées du fichier d’objectif et saisissez votre objectif dans la section des instructions.",
        "目标文件路径无效。": "Le chemin du fichier d’objectif n’est pas valide.",
        "目标文件目录已改变，请重新打开。": "Le répertoire du fichier d’objectif a changé. Rouvrez le fichier.",
        "目标文件不是普通文件。": "Le fichier d’objectif n’est pas un fichier ordinaire.",
        "目标文件过大或不是普通文件。": "Le fichier d’objectif est trop volumineux ou n’est pas un fichier ordinaire.",
        "目标文件已在其他位置修改，请重新打开后再保存。": "Le fichier d’objectif a été modifié ailleurs. Rouvrez-le avant de l’enregistrer.",
        "目标文件内容无效。": "Le contenu du fichier d’objectif n’est pas valide.",
        "请保留目标文件的所属对话和目标编号。": "Conservez l’identifiant de conversation et l’identifiant d’objectif dans le fichier d’objectif.",
        "目标文件已创建，请重新打开。": "Le fichier d’objectif a déjà été créé. Rouvrez-le.",
        "电脑操作未完成": "Action sur l’ordinateur inachevée",
        "操作结果待确认": "Résultat de l’action à confirmer",
        "电脑控制在此环境中不可用。": "Le contrôle de l’ordinateur n’est pas disponible dans cet environnement.",
        "电脑操作已取消。": "Action sur l’ordinateur annulée.",
        "电脑控制尚未获得系统权限，请完成系统授权后重试。": "Le contrôle de l’ordinateur nécessite une autorisation système. Autorisez l’accès dans les réglages système, puis réessayez.",
        "本机电脑控制组件不可用。": "Le composant local de contrôle de l’ordinateur est indisponible.",
        "浏览器操作已取消。": "Action du navigateur annulée.",
        "停止请求尚未确认": "Demande d’arrêt pas encore confirmée",
        "操作应用": "Contrôler une application",
        "编辑计划": "Modifier la planification",
        "保存计划": "Enregistrer la planification",
        "选择其他文件夹": "Choisir un autre dossier",
        "中转商 / 自有 API": "Fournisseur / API personnelle",
        "计划中转商": "Fournisseur de la planification",
        "计划模型": "Modèle de la planification",
        "计划思考深度": "Raisonnement de la planification",
        "计划上下文": "Contexte de la planification",
        "计划权限": "Autorisations de la planification",
        "按本机时间执行；休眠后补跑一次。结果保存在所选项目的计划对话中。": "Exécution en heure locale, avec un rattrapage après la veille. Les résultats sont enregistrés dans une conversation planifiée du projet choisi.",
        "请选择中转商与模型。": "Sélectionnez un fournisseur et un modèle.",
        "计划更新失败": "Échec de la mise à jour de la planification",
        "模型列表加载失败，请重新选择中转商。": "Impossible de charger les modèles. Sélectionnez à nouveau le fournisseur.",
        "计划正在运行，请结束后再修改设置。": "La planification est en cours. Attendez la fin avant de modifier les paramètres.",
        "计划已发生变化，请刷新后重试。": "La planification a changé. Actualisez puis réessayez.",
        "计划已删除，请刷新后重试。": "La planification a été supprimée. Actualisez puis réessayez.",
        "请填写计划名称和任务说明。": "Saisissez un nom et une description de la tâche.",
        "请检查计划时间与权限设置。": "Vérifiez l’heure et les autorisations de la planification.",
        "此计划已经执行，请选择新的运行时间。": "Cette planification a déjà été exécutée. Choisissez une nouvelle heure.",
        "已保存模型": "Modèle enregistré",
        "先选择项目文件夹": "Sélectionnez d’abord un dossier de projet",
        '新建计划': 'Nouvelle planification',
        '创建计划': 'Créer une planification',
        '按本机时间执行；休眠期间的任务将在恢复后补跑一次，可随时暂停或删除。': 'Exécution à l’heure locale. Les tâches manquées pendant la veille sont exécutées une fois au réveil. Vous pouvez suspendre ou supprimer la planification à tout moment.',
        '请先在对话中选择模型，再创建计划。': 'Choisissez un modèle dans la conversation avant de créer une planification.',
        '计划读取失败': 'Impossible de charger les planifications',
        '计划读取失败，请重新打开应用；已保存的计划未被覆盖。': 'Impossible de charger les planifications. Rouvrez l’application ; les planifications enregistrées n’ont pas été écrasées.',
        '计划保存失败，请重试；任务不会自动发送。': 'Impossible d’enregistrer la planification. Réessayez ; la tâche ne sera pas envoyée automatiquement.',
        '上次运行已中断，请查看对话恢复。': 'La dernière exécution a été interrompue. Ouvrez la conversation pour la reprendre.',
        '该次计划已启动或中断，请查看运行记录；不会重复发送。': 'Cette exécution planifiée a déjà démarré ou a été interrompue. Consultez son historique ; elle ne sera pas renvoyée.',
        '计划暂未执行，将自动重试。': 'La planification n’a pas encore été exécutée. Une nouvelle tentative sera automatique.',
        '模型线路不可用，请更换': 'La route du modèle est indisponible. Choisissez-en une autre.',
        '任务已中断，请查看运行记录。': 'La tâche a été interrompue. Consultez son historique d’exécution.',
        '任务已取消，可在对话中恢复。': 'La tâche a été annulée. Vous pouvez la reprendre dans la conversation.',
        '任务已执行结束，但检查未通过。': 'La tâche est terminée, mais les vérifications ont échoué.',
        '任务已暂停，请在对话中继续。': 'La tâche est en pause. Continuez dans la conversation.',
        '应用正在关闭，计划未重新发送；请查看运行记录。': 'L’application se ferme. La tâche planifiée n’a pas été renvoyée ; consultez son historique d’exécution.',
        '项目文件夹不存在或无法访问，请重新选择。': 'Le dossier du projet est introuvable ou inaccessible. Sélectionnez-le à nouveau.',
        '所选路径不是项目文件夹，请重新选择。': 'Le chemin sélectionné n’est pas un dossier de projet. Choisissez un autre dossier.',
        'Unified model routing': 'Routage unifié des modèles',
        'Credential inventory': 'Stock d’identifiants',
        'Built-in': 'Intégré',
        'scenes': 'scènes',
        'shots': 'plans',
        'Local project file': 'Fichier de projet local',
        'FFmpeg ready': 'FFmpeg prêt',
        'FFmpeg unavailable': 'FFmpeg indisponible',
        '对话已结束': 'Conversation terminée',
        'Clear': 'Effacer',
        'Save': 'Enregistrer',
        'Test': 'Tester',
        'Checking…': 'Vérification…',
        '添加到消息': 'Ajouter au message',
        '对话附件': 'Pièces jointes de la conversation',
        '粘贴和拖入的文件本机副本': 'Copies locales des fichiers collés et déposés'
    },
    de: {
        "目标文件已在其他位置修改，请打开文件查看。": "Die Zieldatei wurde an anderer Stelle geändert. Öffnen Sie die Datei zur Überprüfung.",
        "目标文件无法保存": "Zieldatei kann nicht gespeichert werden",
        "请保留目标文件的元数据，并在“提示词”段落中填写目标。": "Behalten Sie die Metadaten der Zieldatei bei und geben Sie Ihr Ziel im Prompt-Abschnitt ein.",
        "目标文件路径无效。": "Der Pfad der Zieldatei ist ungültig.",
        "目标文件目录已改变，请重新打开。": "Das Verzeichnis der Zieldatei wurde geändert. Öffnen Sie die Datei erneut.",
        "目标文件不是普通文件。": "Die Zieldatei ist keine reguläre Datei.",
        "目标文件过大或不是普通文件。": "Die Zieldatei ist zu groß oder keine reguläre Datei.",
        "目标文件已在其他位置修改，请重新打开后再保存。": "Die Zieldatei wurde an anderer Stelle geändert. Öffnen Sie sie vor dem Speichern erneut.",
        "目标文件内容无效。": "Der Inhalt der Zieldatei ist ungültig.",
        "请保留目标文件的所属对话和目标编号。": "Behalten Sie die Konversations-ID und die Ziel-ID in der Zieldatei bei.",
        "目标文件已创建，请重新打开。": "Die Zieldatei wurde bereits erstellt. Öffnen Sie sie erneut.",
        "电脑操作未完成": "Computeraktion nicht abgeschlossen",
        "操作结果待确认": "Aktionsergebnis muss bestätigt werden",
        "电脑控制在此环境中不可用。": "Die Computersteuerung ist in dieser Umgebung nicht verfügbar.",
        "电脑操作已取消。": "Computeraktion abgebrochen.",
        "电脑控制尚未获得系统权限，请完成系统授权后重试。": "Die Computersteuerung erfordert eine Systemberechtigung. Erteilen Sie den Zugriff in den Systemeinstellungen und versuchen Sie es erneut.",
        "本机电脑控制组件不可用。": "Die lokale Komponente zur Computersteuerung ist nicht verfügbar.",
        "浏览器操作已取消。": "Browseraktion abgebrochen.",
        "停止请求尚未确认": "Stoppanforderung noch nicht bestätigt",
        "操作应用": "App steuern",
        "编辑计划": "Zeitplan bearbeiten",
        "保存计划": "Zeitplan speichern",
        "选择其他文件夹": "Anderen Ordner wählen",
        "中转商 / 自有 API": "Anbieter / Eigene API",
        "计划中转商": "Anbieter des Zeitplans",
        "计划模型": "Modell des Zeitplans",
        "计划思考深度": "Denktiefe des Zeitplans",
        "计划上下文": "Kontext des Zeitplans",
        "计划权限": "Berechtigungen des Zeitplans",
        "按本机时间执行；休眠后补跑一次。结果保存在所选项目的计划对话中。": "Ausführung nach Ortszeit; nach dem Ruhezustand wird einmal nachgeholt. Ergebnisse erscheinen in einem geplanten Gespräch im gewählten Projekt.",
        "请选择中转商与模型。": "Wählen Sie einen Anbieter und ein Modell.",
        "计划更新失败": "Zeitplan konnte nicht aktualisiert werden",
        "模型列表加载失败，请重新选择中转商。": "Modelle konnten nicht geladen werden. Wählen Sie den Anbieter erneut.",
        "计划正在运行，请结束后再修改设置。": "Der Zeitplan wird ausgeführt. Ändern Sie die Einstellungen erst nach Abschluss.",
        "计划已发生变化，请刷新后重试。": "Der Zeitplan wurde geändert. Aktualisieren Sie und versuchen Sie es erneut.",
        "计划已删除，请刷新后重试。": "Der Zeitplan wurde gelöscht. Aktualisieren Sie und versuchen Sie es erneut.",
        "请填写计划名称和任务说明。": "Geben Sie einen Namen und eine Aufgabenbeschreibung ein.",
        "请检查计划时间与权限设置。": "Prüfen Sie Zeit und Berechtigungen des Zeitplans.",
        "此计划已经执行，请选择新的运行时间。": "Dieser Zeitplan wurde bereits ausgeführt. Wählen Sie eine neue Uhrzeit.",
        "已保存模型": "Gespeichertes Modell",
        "先选择项目文件夹": "Wählen Sie zuerst einen Projektordner",
        '新建计划': 'Neuer Zeitplan',
        '创建计划': 'Zeitplan erstellen',
        '按本机时间执行；休眠期间的任务将在恢复后补跑一次，可随时暂停或删除。': 'Ausführung nach Ortszeit. Im Ruhezustand verpasste Aufgaben werden nach dem Aufwachen einmal nachgeholt. Sie können den Zeitplan jederzeit pausieren oder löschen.',
        '请先在对话中选择模型，再创建计划。': 'Wählen Sie zuerst ein Modell in der Unterhaltung, bevor Sie einen Zeitplan erstellen.',
        '计划读取失败': 'Zeitpläne konnten nicht geladen werden',
        '计划读取失败，请重新打开应用；已保存的计划未被覆盖。': 'Zeitpläne konnten nicht geladen werden. Öffnen Sie die App erneut; gespeicherte Zeitpläne wurden nicht überschrieben.',
        '计划保存失败，请重试；任务不会自动发送。': 'Der Zeitplan konnte nicht gespeichert werden. Versuchen Sie es erneut; die Aufgabe wird nicht automatisch gesendet.',
        '上次运行已中断，请查看对话恢复。': 'Die letzte Ausführung wurde unterbrochen. Öffnen Sie die Unterhaltung, um sie fortzusetzen.',
        '该次计划已启动或中断，请查看运行记录；不会重复发送。': 'Diese geplante Ausführung wurde bereits gestartet oder unterbrochen. Prüfen Sie den Verlauf; sie wird nicht erneut gesendet.',
        '计划暂未执行，将自动重试。': 'Der Zeitplan wurde noch nicht ausgeführt. Ein neuer Versuch erfolgt automatisch.',
        '模型线路不可用，请更换': 'Die Modellroute ist nicht verfügbar. Wählen Sie eine andere.',
        '任务已中断，请查看运行记录。': 'Die Aufgabe wurde unterbrochen. Prüfen Sie den Ausführungsverlauf.',
        '任务已取消，可在对话中恢复。': 'Die Aufgabe wurde abgebrochen. Sie können sie in der Unterhaltung fortsetzen.',
        '任务已执行结束，但检查未通过。': 'Die Aufgabe wurde beendet, aber die Prüfungen waren nicht erfolgreich.',
        '任务已暂停，请在对话中继续。': 'Die Aufgabe ist pausiert. Setzen Sie sie in der Unterhaltung fort.',
        '应用正在关闭，计划未重新发送；请查看运行记录。': 'Die App wird geschlossen. Die geplante Aufgabe wurde nicht erneut gesendet; prüfen Sie den Ausführungsverlauf.',
        '项目文件夹不存在或无法访问，请重新选择。': 'Der Projektordner fehlt oder ist nicht zugänglich. Wählen Sie ihn erneut aus.',
        '所选路径不是项目文件夹，请重新选择。': 'Der gewählte Pfad ist kein Projektordner. Wählen Sie einen anderen Ordner.',
        'Unified model routing': 'Einheitliches Modellrouting',
        'Credential inventory': 'Anmeldedatenbestand',
        'Built-in': 'Integriert',
        'scenes': 'Szenen',
        'shots': 'Aufnahmen',
        'Local project file': 'Lokale Projektdatei',
        'FFmpeg ready': 'FFmpeg bereit',
        'FFmpeg unavailable': 'FFmpeg nicht verfügbar',
        '对话已结束': 'Unterhaltung beendet',
        'Clear': 'Leeren',
        'Save': 'Speichern',
        'Test': 'Testen',
        'Checking…': 'Wird geprüft…',
        '添加到消息': 'Zur Nachricht hinzufügen',
        '对话附件': 'Unterhaltungsanhänge',
        '粘贴和拖入的文件本机副本': 'Lokale Kopien eingefügter und abgelegter Dateien'
    },
    'pt-BR': {
        "目标文件已在其他位置修改，请打开文件查看。": "O arquivo de objetivo foi alterado em outro lugar. Abra o arquivo para revisá-lo.",
        "目标文件无法保存": "Não foi possível salvar o arquivo de objetivo",
        "请保留目标文件的元数据，并在“提示词”段落中填写目标。": "Mantenha os metadados do arquivo de objetivo e insira seu objetivo na seção de instruções.",
        "目标文件路径无效。": "O caminho do arquivo de objetivo é inválido.",
        "目标文件目录已改变，请重新打开。": "O diretório do arquivo de objetivo mudou. Reabra o arquivo.",
        "目标文件不是普通文件。": "O arquivo de objetivo não é um arquivo regular.",
        "目标文件过大或不是普通文件。": "O arquivo de objetivo é muito grande ou não é um arquivo regular.",
        "目标文件已在其他位置修改，请重新打开后再保存。": "O arquivo de objetivo foi alterado em outro lugar. Reabra-o antes de salvar.",
        "目标文件内容无效。": "O conteúdo do arquivo de objetivo é inválido.",
        "请保留目标文件的所属对话和目标编号。": "Mantenha o ID da conversa e o ID do objetivo no arquivo de objetivo.",
        "目标文件已创建，请重新打开。": "O arquivo de objetivo já foi criado. Reabra-o.",
        "电脑操作未完成": "Ação no computador incompleta",
        "操作结果待确认": "Resultado da ação aguardando confirmação",
        "电脑控制在此环境中不可用。": "O controle do computador não está disponível neste ambiente.",
        "电脑操作已取消。": "Ação no computador cancelada.",
        "电脑控制尚未获得系统权限，请完成系统授权后重试。": "O controle do computador requer permissão do sistema. Conceda acesso nas configurações do sistema e tente novamente.",
        "本机电脑控制组件不可用。": "O componente local de controle do computador não está disponível.",
        "浏览器操作已取消。": "Ação do navegador cancelada.",
        "停止请求尚未确认": "Solicitação de parada ainda não confirmada",
        "操作应用": "Controlar aplicativo",
        "编辑计划": "Editar agendamento",
        "保存计划": "Salvar agendamento",
        "选择其他文件夹": "Escolher outra pasta",
        "中转商 / 自有 API": "Provedor / API própria",
        "计划中转商": "Provedor do agendamento",
        "计划模型": "Modelo do agendamento",
        "计划思考深度": "Raciocínio do agendamento",
        "计划上下文": "Contexto do agendamento",
        "计划权限": "Permissões do agendamento",
        "按本机时间执行；休眠后补跑一次。结果保存在所选项目的计划对话中。": "Executa no horário local e recupera uma execução após a suspensão. Os resultados são salvos em uma conversa agendada do projeto escolhido.",
        "请选择中转商与模型。": "Selecione um provedor e um modelo.",
        "计划更新失败": "Falha ao atualizar o agendamento",
        "模型列表加载失败，请重新选择中转商。": "Não foi possível carregar os modelos. Selecione o provedor novamente.",
        "计划正在运行，请结束后再修改设置。": "O agendamento está em execução. Aguarde o término para alterar as configurações.",
        "计划已发生变化，请刷新后重试。": "O agendamento mudou. Atualize e tente novamente.",
        "计划已删除，请刷新后重试。": "O agendamento foi excluído. Atualize e tente novamente.",
        "请填写计划名称和任务说明。": "Digite um nome e a descrição da tarefa.",
        "请检查计划时间与权限设置。": "Verifique o horário e as permissões do agendamento.",
        "此计划已经执行，请选择新的运行时间。": "Este agendamento já foi executado. Escolha um novo horário.",
        "已保存模型": "Modelo salvo",
        "先选择项目文件夹": "Selecione primeiro uma pasta de projeto",
        '新建计划': 'Novo agendamento',
        '创建计划': 'Criar agendamento',
        '按本机时间执行；休眠期间的任务将在恢复后补跑一次，可随时暂停或删除。': 'Executa no horário local. Tarefas perdidas durante a suspensão são executadas uma vez ao retomar. Você pode pausar ou excluir o agendamento a qualquer momento.',
        '请先在对话中选择模型，再创建计划。': 'Escolha um modelo na conversa antes de criar um agendamento.',
        '计划读取失败': 'Não foi possível carregar os agendamentos',
        '计划读取失败，请重新打开应用；已保存的计划未被覆盖。': 'Não foi possível carregar os agendamentos. Reabra o aplicativo; os agendamentos salvos não foram sobrescritos.',
        '计划保存失败，请重试；任务不会自动发送。': 'Não foi possível salvar o agendamento. Tente novamente; a tarefa não será enviada automaticamente.',
        '上次运行已中断，请查看对话恢复。': 'A última execução foi interrompida. Abra a conversa para retomá-la.',
        '该次计划已启动或中断，请查看运行记录；不会重复发送。': 'Esta execução agendada já foi iniciada ou interrompida. Confira o histórico; ela não será enviada novamente.',
        '计划暂未执行，将自动重试。': 'O agendamento ainda não foi executado. Uma nova tentativa será feita automaticamente.',
        '模型线路不可用，请更换': 'A rota do modelo está indisponível. Escolha outra.',
        '任务已中断，请查看运行记录。': 'A tarefa foi interrompida. Confira o histórico de execução.',
        '任务已取消，可在对话中恢复。': 'A tarefa foi cancelada. Você pode retomá-la na conversa.',
        '任务已执行结束，但检查未通过。': 'A tarefa terminou, mas não passou nas verificações.',
        '任务已暂停，请在对话中继续。': 'A tarefa está pausada. Continue na conversa.',
        '应用正在关闭，计划未重新发送；请查看运行记录。': 'O aplicativo está fechando. A tarefa agendada não foi reenviada; confira o histórico de execução.',
        '项目文件夹不存在或无法访问，请重新选择。': 'A pasta do projeto não existe ou está inacessível. Selecione-a novamente.',
        '所选路径不是项目文件夹，请重新选择。': 'O caminho selecionado não é uma pasta de projeto. Escolha outra pasta.',
        'Unified model routing': 'Roteamento unificado de modelos',
        'Credential inventory': 'Inventário de credenciais',
        'Built-in': 'Integrado',
        'scenes': 'cenas',
        'shots': 'tomadas',
        'Local project file': 'Arquivo de projeto local',
        'FFmpeg ready': 'FFmpeg pronto',
        'FFmpeg unavailable': 'FFmpeg indisponível',
        '对话已结束': 'Conversa encerrada',
        'Clear': 'Limpar',
        'Save': 'Salvar',
        'Test': 'Testar',
        'Checking…': 'Verificando…',
        '添加到消息': 'Adicionar à mensagem',
        '对话附件': 'Anexos da conversa',
        '粘贴和拖入的文件本机副本': 'Cópias locais de arquivos colados e arrastados'
    },
    ru: {
        "目标文件已在其他位置修改，请打开文件查看。": "Файл цели изменён в другом месте. Откройте файл для проверки.",
        "目标文件无法保存": "Не удалось сохранить файл цели",
        "请保留目标文件的元数据，并在“提示词”段落中填写目标。": "Сохраните метаданные файла цели и введите цель в разделе запроса.",
        "目标文件路径无效。": "Недопустимый путь к файлу цели.",
        "目标文件目录已改变，请重新打开。": "Каталог файла цели изменился. Откройте файл заново.",
        "目标文件不是普通文件。": "Файл цели не является обычным файлом.",
        "目标文件过大或不是普通文件。": "Файл цели слишком большой или не является обычным файлом.",
        "目标文件已在其他位置修改，请重新打开后再保存。": "Файл цели изменён в другом месте. Откройте его заново перед сохранением.",
        "目标文件内容无效。": "Недопустимое содержимое файла цели.",
        "请保留目标文件的所属对话和目标编号。": "Сохраните идентификаторы диалога и цели в файле цели.",
        "目标文件已创建，请重新打开。": "Файл цели уже создан. Откройте его заново.",
        "电脑操作未完成": "Действие на компьютере не завершено",
        "操作结果待确认": "Результат действия требует подтверждения",
        "电脑控制在此环境中不可用。": "Управление компьютером недоступно в этой среде.",
        "电脑操作已取消。": "Действие на компьютере отменено.",
        "电脑控制尚未获得系统权限，请完成系统授权后重试。": "Для управления компьютером требуется системное разрешение. Предоставьте доступ в настройках системы и повторите попытку.",
        "本机电脑控制组件不可用。": "Локальный компонент управления компьютером недоступен.",
        "浏览器操作已取消。": "Действие в браузере отменено.",
        "停止请求尚未确认": "Запрос остановки ещё не подтверждён",
        "操作应用": "Управлять приложением",
        "编辑计划": "Изменить расписание",
        "保存计划": "Сохранить расписание",
        "选择其他文件夹": "Выбрать другую папку",
        "中转商 / 自有 API": "Провайдер / Свой API",
        "计划中转商": "Провайдер расписания",
        "计划模型": "Модель расписания",
        "计划思考深度": "Глубина рассуждения расписания",
        "计划上下文": "Контекст расписания",
        "计划权限": "Разрешения расписания",
        "按本机时间执行；休眠后补跑一次。结果保存在所选项目的计划对话中。": "Запуск по местному времени; после сна пропущенное задание выполняется один раз. Результаты сохраняются в чате расписания выбранного проекта.",
        "请选择中转商与模型。": "Выберите провайдера и модель.",
        "计划更新失败": "Не удалось обновить расписание",
        "模型列表加载失败，请重新选择中转商。": "Не удалось загрузить модели. Выберите провайдера повторно.",
        "计划正在运行，请结束后再修改设置。": "Задание выполняется. Измените настройки после завершения.",
        "计划已发生变化，请刷新后重试。": "Расписание изменено. Обновите и повторите попытку.",
        "计划已删除，请刷新后重试。": "Расписание удалено. Обновите и повторите попытку.",
        "请填写计划名称和任务说明。": "Укажите название и описание задания.",
        "请检查计划时间与权限设置。": "Проверьте время и разрешения расписания.",
        "此计划已经执行，请选择新的运行时间。": "Задание уже выполнялось. Выберите новое время запуска.",
        "已保存模型": "Сохранённая модель",
        "先选择项目文件夹": "Сначала выберите папку проекта",
        '新建计划': 'Новое расписание',
        '创建计划': 'Создать расписание',
        '按本机时间执行；休眠期间的任务将在恢复后补跑一次，可随时暂停或删除。': 'Запуск по местному времени. Пропущенные во время сна задачи выполнятся один раз после пробуждения. Расписание можно приостановить или удалить в любой момент.',
        '请先在对话中选择模型，再创建计划。': 'Выберите модель в диалоге, прежде чем создавать расписание.',
        '计划读取失败': 'Не удалось загрузить расписания',
        '计划读取失败，请重新打开应用；已保存的计划未被覆盖。': 'Не удалось загрузить расписания. Откройте приложение заново; сохранённые расписания не перезаписаны.',
        '计划保存失败，请重试；任务不会自动发送。': 'Не удалось сохранить расписание. Повторите попытку; задача не будет отправлена автоматически.',
        '上次运行已中断，请查看对话恢复。': 'Последний запуск был прерван. Откройте диалог, чтобы продолжить.',
        '该次计划已启动或中断，请查看运行记录；不会重复发送。': 'Этот запуск по расписанию уже начался или был прерван. Проверьте историю; повторной отправки не будет.',
        '计划暂未执行，将自动重试。': 'Расписание ещё не выполнено. Попытка повторится автоматически.',
        '模型线路不可用，请更换': 'Маршрут модели недоступен. Выберите другой.',
        '任务已中断，请查看运行记录。': 'Задача прервана. Проверьте историю запусков.',
        '任务已取消，可在对话中恢复。': 'Задача отменена. Её можно возобновить в диалоге.',
        '任务已执行结束，但检查未通过。': 'Задача завершилась, но проверки не пройдены.',
        '任务已暂停，请在对话中继续。': 'Задача приостановлена. Продолжите в диалоге.',
        '应用正在关闭，计划未重新发送；请查看运行记录。': 'Приложение закрывается. Задача по расписанию не отправлена повторно; проверьте историю запусков.',
        '项目文件夹不存在或无法访问，请重新选择。': 'Папка проекта не существует или недоступна. Выберите её заново.',
        '所选路径不是项目文件夹，请重新选择。': 'Выбранный путь не является папкой проекта. Выберите другую папку.',
        'Unified model routing': 'Единая маршрутизация моделей',
        'Credential inventory': 'Хранилище учётных данных',
        'Built-in': 'Встроено',
        'scenes': 'сцены',
        'shots': 'кадры',
        'Local project file': 'Локальный файл проекта',
        'FFmpeg ready': 'FFmpeg готов',
        'FFmpeg unavailable': 'FFmpeg недоступен',
        '对话已结束': 'Диалог завершён',
        'Clear': 'Очистить',
        'Save': 'Сохранить',
        'Test': 'Проверить',
        'Checking…': 'Проверка…',
        '添加到消息': 'Добавить в сообщение',
        '对话附件': 'Вложения беседы',
        '粘贴和拖入的文件本机副本': 'Локальные копии вставленных и перетащенных файлов'
    },
    ar: {
        "目标文件已在其他位置修改，请打开文件查看。": "تم تعديل ملف الهدف في مكان آخر. افتح الملف لمراجعته.",
        "目标文件无法保存": "تعذّر حفظ ملف الهدف",
        "请保留目标文件的元数据，并在“提示词”段落中填写目标。": "احتفظ بالبيانات الوصفية لملف الهدف وأدخل هدفك في قسم التعليمات.",
        "目标文件路径无效。": "مسار ملف الهدف غير صالح.",
        "目标文件目录已改变，请重新打开。": "تغيّر مجلد ملف الهدف. أعد فتح الملف.",
        "目标文件不是普通文件。": "ملف الهدف ليس ملفًا عاديًا.",
        "目标文件过大或不是普通文件。": "ملف الهدف كبير جدًا أو ليس ملفًا عاديًا.",
        "目标文件已在其他位置修改，请重新打开后再保存。": "تم تعديل ملف الهدف في مكان آخر. أعد فتحه قبل الحفظ.",
        "目标文件内容无效。": "محتوى ملف الهدف غير صالح.",
        "请保留目标文件的所属对话和目标编号。": "احتفظ بمعرّف المحادثة ومعرّف الهدف في ملف الهدف.",
        "目标文件已创建，请重新打开。": "تم إنشاء ملف الهدف بالفعل. أعد فتحه.",
        "电脑操作未完成": "لم يكتمل إجراء الكمبيوتر",
        "操作结果待确认": "نتيجة الإجراء بانتظار التأكيد",
        "电脑控制在此环境中不可用。": "التحكم في الكمبيوتر غير متاح في هذه البيئة.",
        "电脑操作已取消。": "تم إلغاء إجراء الكمبيوتر.",
        "电脑控制尚未获得系统权限，请完成系统授权后重试。": "يتطلب التحكم في الكمبيوتر إذنًا من النظام. امنح الوصول في إعدادات النظام ثم أعد المحاولة.",
        "本机电脑控制组件不可用。": "مكوّن التحكم المحلي في الكمبيوتر غير متاح.",
        "浏览器操作已取消。": "تم إلغاء إجراء المتصفح.",
        "停止请求尚未确认": "لم يتم تأكيد طلب الإيقاف بعد",
        "操作应用": "التحكم في التطبيق",
        "编辑计划": "تعديل الجدولة",
        "保存计划": "حفظ الجدولة",
        "选择其他文件夹": "اختيار مجلد آخر",
        "中转商 / 自有 API": "المزوّد / واجهة API خاصة",
        "计划中转商": "مزوّد الجدولة",
        "计划模型": "نموذج الجدولة",
        "计划思考深度": "عمق التفكير للجدولة",
        "计划上下文": "سياق الجدولة",
        "计划权限": "أذونات الجدولة",
        "按本机时间执行；休眠后补跑一次。结果保存在所选项目的计划对话中。": "تعمل بالتوقيت المحلي، وتُنفّذ المهمة الفائتة مرة واحدة بعد السكون. تُحفظ النتائج في محادثة مجدولة ضمن المشروع المختار.",
        "请选择中转商与模型。": "اختر مزوّدًا ونموذجًا.",
        "计划更新失败": "تعذّر تحديث الجدولة",
        "模型列表加载失败，请重新选择中转商。": "تعذّر تحميل النماذج. اختر المزوّد مجددًا.",
        "计划正在运行，请结束后再修改设置。": "الجدولة قيد التنفيذ. انتظر انتهائها قبل تعديل الإعدادات.",
        "计划已发生变化，请刷新后重试。": "تغيّرت الجدولة. حدّث الصفحة وحاول مجددًا.",
        "计划已删除，请刷新后重试。": "حُذفت الجدولة. حدّث الصفحة وحاول مجددًا.",
        "请填写计划名称和任务说明。": "أدخل اسم الجدولة ووصف المهمة.",
        "请检查计划时间与权限设置。": "تحقق من وقت الجدولة والأذونات.",
        "此计划已经执行，请选择新的运行时间。": "نُفّذت هذه الجدولة بالفعل. اختر وقتًا جديدًا.",
        "已保存模型": "النموذج المحفوظ",
        "先选择项目文件夹": "اختر مجلد المشروع أولًا",
        '新建计划': 'جدولة جديدة',
        '创建计划': 'إنشاء جدولة',
        '按本机时间执行；休眠期间的任务将在恢复后补跑一次，可随时暂停或删除。': 'تُنفّذ المهام حسب التوقيت المحلي. تُشغَّل المهام الفائتة أثناء السكون مرة واحدة بعد الاستيقاظ. يمكنك إيقاف الجدولة مؤقتًا أو حذفها في أي وقت.',
        '请先在对话中选择模型，再创建计划。': 'اختر نموذجًا في المحادثة قبل إنشاء جدولة.',
        '计划读取失败': 'تعذّر تحميل الجداول',
        '计划读取失败，请重新打开应用；已保存的计划未被覆盖。': 'تعذّر تحميل الجداول. أعد فتح التطبيق؛ لم يتم استبدال الجداول المحفوظة.',
        '计划保存失败，请重试；任务不会自动发送。': 'تعذّر حفظ الجدولة. حاول مجددًا؛ لن تُرسَل المهمة تلقائيًا.',
        '上次运行已中断，请查看对话恢复。': 'توقف التشغيل الأخير. افتح المحادثة لاستئنافه.',
        '该次计划已启动或中断，请查看运行记录；不会重复发送。': 'بدأ هذا التشغيل المجدول بالفعل أو توقف. راجع سجلّه؛ لن يُرسَل مجددًا.',
        '计划暂未执行，将自动重试。': 'لم تُنفّذ الجدولة بعد. ستُعاد المحاولة تلقائيًا.',
        '模型线路不可用，请更换': 'مسار النموذج غير متاح. اختر مسارًا آخر.',
        '任务已中断，请查看运行记录。': 'توقفت المهمة. راجع سجل التشغيل.',
        '任务已取消，可在对话中恢复。': 'أُلغيت المهمة. يمكنك استئنافها في المحادثة.',
        '任务已执行结束，但检查未通过。': 'انتهت المهمة، لكنها لم تجتز الفحوصات.',
        '任务已暂停，请在对话中继续。': 'المهمة متوقفة مؤقتًا. تابع في المحادثة.',
        '应用正在关闭，计划未重新发送；请查看运行记录。': 'التطبيق قيد الإغلاق. لم تُرسَل المهمة المجدولة مجددًا؛ راجع سجل التشغيل.',
        '项目文件夹不存在或无法访问，请重新选择。': 'مجلد المشروع غير موجود أو يتعذّر الوصول إليه. اختره مجددًا.',
        '所选路径不是项目文件夹，请重新选择。': 'المسار المحدد ليس مجلد مشروع. اختر مجلدًا آخر.',
        'Unified model routing': 'توجيه موحّد للنماذج',
        'Credential inventory': 'مخزون بيانات الاعتماد',
        'Built-in': 'مدمج',
        'scenes': 'مشاهد',
        'shots': 'لقطات',
        'Local project file': 'ملف مشروع محلي',
        'FFmpeg ready': 'FFmpeg جاهز',
        'FFmpeg unavailable': 'FFmpeg غير متاح',
        '对话已结束': 'انتهت المحادثة',
        'Clear': 'مسح',
        'Save': 'حفظ',
        'Test': 'اختبار',
        'Checking…': 'جارٍ الفحص…',
        '添加到消息': 'إضافة إلى الرسالة',
        '对话附件': 'مرفقات المحادثة',
        '粘贴和拖入的文件本机副本': 'نسخ محلية من الملفات الملصقة والمسحوبة'
    },
    hi: {
        "目标文件已在其他位置修改，请打开文件查看。": "लक्ष्य फ़ाइल कहीं और बदली गई है। समीक्षा करने के लिए फ़ाइल खोलें।",
        "目标文件无法保存": "लक्ष्य फ़ाइल सहेजी नहीं जा सकी",
        "请保留目标文件的元数据，并在“提示词”段落中填写目标。": "लक्ष्य फ़ाइल का मेटाडेटा बनाए रखें और प्रॉम्प्ट अनुभाग में अपना लक्ष्य दर्ज करें।",
        "目标文件路径无效。": "लक्ष्य फ़ाइल का पथ अमान्य है।",
        "目标文件目录已改变，请重新打开。": "लक्ष्य फ़ाइल की डायरेक्टरी बदल गई है। फ़ाइल फिर से खोलें।",
        "目标文件不是普通文件。": "लक्ष्य फ़ाइल एक सामान्य फ़ाइल नहीं है।",
        "目标文件过大或不是普通文件。": "लक्ष्य फ़ाइल बहुत बड़ी है या सामान्य फ़ाइल नहीं है।",
        "目标文件已在其他位置修改，请重新打开后再保存。": "लक्ष्य फ़ाइल कहीं और बदली गई है। सहेजने से पहले इसे फिर से खोलें।",
        "目标文件内容无效。": "लक्ष्य फ़ाइल की सामग्री अमान्य है।",
        "请保留目标文件的所属对话和目标编号。": "लक्ष्य फ़ाइल में बातचीत की आईडी और लक्ष्य की आईडी बनाए रखें।",
        "目标文件已创建，请重新打开。": "लक्ष्य फ़ाइल पहले ही बनाई जा चुकी है। इसे फिर से खोलें।",
        "电脑操作未完成": "कंप्यूटर कार्रवाई अधूरी है",
        "操作结果待确认": "कार्रवाई के परिणाम की पुष्टि बाकी है",
        "电脑控制在此环境中不可用。": "इस परिवेश में कंप्यूटर नियंत्रण उपलब्ध नहीं है।",
        "电脑操作已取消。": "कंप्यूटर कार्रवाई रद्द कर दी गई।",
        "电脑控制尚未获得系统权限，请完成系统授权后重试。": "कंप्यूटर नियंत्रण के लिए सिस्टम की अनुमति चाहिए। सिस्टम सेटिंग में अनुमति दें और फिर से कोशिश करें।",
        "本机电脑控制组件不可用。": "स्थानीय कंप्यूटर नियंत्रण घटक उपलब्ध नहीं है।",
        "浏览器操作已取消。": "ब्राउज़र कार्रवाई रद्द कर दी गई।",
        "停止请求尚未确认": "रोकने के अनुरोध की अभी पुष्टि नहीं हुई है",
        "操作应用": "ऐप नियंत्रित करें",
        "编辑计划": "शेड्यूल संपादित करें",
        "保存计划": "शेड्यूल सहेजें",
        "选择其他文件夹": "दूसरा फ़ोल्डर चुनें",
        "中转商 / 自有 API": "प्रदाता / अपनी API",
        "计划中转商": "शेड्यूल प्रदाता",
        "计划模型": "शेड्यूल मॉडल",
        "计划思考深度": "शेड्यूल का तर्क स्तर",
        "计划上下文": "शेड्यूल का संदर्भ",
        "计划权限": "शेड्यूल की अनुमतियाँ",
        "按本机时间执行；休眠后补跑一次。结果保存在所选项目的计划对话中。": "स्थानीय समय पर चलता है; स्लीप के बाद छूटा कार्य एक बार चलता है। परिणाम चुने गए प्रोजेक्ट की शेड्यूल वाली बातचीत में सहेजे जाते हैं।",
        "请选择中转商与模型。": "प्रदाता और मॉडल चुनें।",
        "计划更新失败": "शेड्यूल अपडेट नहीं हुआ",
        "模型列表加载失败，请重新选择中转商。": "मॉडल लोड नहीं हुए। प्रदाता फिर चुनें।",
        "计划正在运行，请结束后再修改设置。": "शेड्यूल चल रहा है। सेटिंग बदलने से पहले इसके पूरा होने की प्रतीक्षा करें।",
        "计划已发生变化，请刷新后重试。": "शेड्यूल बदल गया है। रीफ़्रेश करके फिर कोशिश करें।",
        "计划已删除，请刷新后重试。": "शेड्यूल हटाया गया है। रीफ़्रेश करके फिर कोशिश करें।",
        "请填写计划名称和任务说明。": "शेड्यूल का नाम और कार्य का विवरण दर्ज करें।",
        "请检查计划时间与权限设置。": "शेड्यूल का समय और अनुमतियाँ जाँचें।",
        "此计划已经执行，请选择新的运行时间。": "यह शेड्यूल पहले चल चुका है। नया समय चुनें।",
        "已保存模型": "सहेजा गया मॉडल",
        "先选择项目文件夹": "पहले प्रोजेक्ट फ़ोल्डर चुनें",
        '新建计划': 'नया शेड्यूल',
        '创建计划': 'शेड्यूल बनाएँ',
        '按本机时间执行；休眠期间的任务将在恢复后补跑一次，可随时暂停或删除。': 'स्थानीय समय के अनुसार चलेगा। स्लीप के दौरान छूटे कार्य जागने के बाद एक बार चलेंगे। आप कभी भी शेड्यूल रोक या हटा सकते हैं।',
        '请先在对话中选择模型，再创建计划。': 'शेड्यूल बनाने से पहले बातचीत में मॉडल चुनें।',
        '计划读取失败': 'शेड्यूल लोड नहीं हो सके',
        '计划读取失败，请重新打开应用；已保存的计划未被覆盖。': 'शेड्यूल लोड नहीं हो सके। ऐप फिर से खोलें; सहेजे गए शेड्यूल बदले नहीं गए हैं।',
        '计划保存失败，请重试；任务不会自动发送。': 'शेड्यूल सहेजा नहीं जा सका। फिर कोशिश करें; कार्य अपने आप नहीं भेजा जाएगा।',
        '上次运行已中断，请查看对话恢复。': 'पिछला रन बाधित हुआ था। फिर शुरू करने के लिए बातचीत खोलें।',
        '该次计划已启动或中断，请查看运行记录；不会重复发送。': 'यह निर्धारित रन पहले ही शुरू हो चुका है या बाधित हुआ है। उसका इतिहास देखें; इसे दोबारा नहीं भेजा जाएगा।',
        '计划暂未执行，将自动重试。': 'शेड्यूल अभी नहीं चला है। अपने आप फिर कोशिश होगी।',
        '模型线路不可用，请更换': 'मॉडल रूट उपलब्ध नहीं है। दूसरा रूट चुनें।',
        '任务已中断，请查看运行记录。': 'कार्य बाधित हुआ। रन का इतिहास देखें।',
        '任务已取消，可在对话中恢复。': 'कार्य रद्द हुआ। इसे बातचीत में फिर शुरू कर सकते हैं।',
        '任务已执行结束，但检查未通过。': 'कार्य पूरा हुआ, लेकिन जाँचें सफल नहीं हुईं।',
        '任务已暂停，请在对话中继续。': 'कार्य रुका हुआ है। बातचीत में जारी रखें।',
        '应用正在关闭，计划未重新发送；请查看运行记录。': 'ऐप बंद हो रहा है। निर्धारित कार्य दोबारा नहीं भेजा गया; रन का इतिहास देखें।',
        '项目文件夹不存在或无法访问，请重新选择。': 'प्रोजेक्ट फ़ोल्डर मौजूद नहीं है या खुल नहीं सकता। उसे फिर से चुनें।',
        '所选路径不是项目文件夹，请重新选择。': 'चुना गया पथ प्रोजेक्ट फ़ोल्डर नहीं है। दूसरा फ़ोल्डर चुनें।',
        'Unified model routing': 'एकीकृत मॉडल रूटिंग',
        'Credential inventory': 'क्रेडेंशियल सूची',
        'Built-in': 'अंतर्निहित',
        'scenes': 'दृश्य',
        'shots': 'शॉट',
        'Local project file': 'स्थानीय प्रोजेक्ट फ़ाइल',
        'FFmpeg ready': 'FFmpeg तैयार',
        'FFmpeg unavailable': 'FFmpeg उपलब्ध नहीं',
        '对话已结束': 'बातचीत समाप्त हुई',
        'Clear': 'साफ़ करें',
        'Save': 'सहेजें',
        'Test': 'जाँचें',
        'Checking…': 'जाँच जारी…',
        '添加到消息': 'संदेश में जोड़ें',
        '对话附件': 'वार्तालाप संलग्नक',
        '粘贴和拖入的文件本机副本': 'चिपकाई और खींचकर छोड़ी गई फ़ाइलों की स्थानीय प्रतियाँ'
    }
};

type DynamicSurfaceTemplate = 'turn' | 'close' | 'fileDiff' | 'route' | 'officialConnection' | 'remove' | 'newConversation' | 'expandRemainingConversations' | 'collapseConversations' | 'activityCount';

const dynamicTemplates: Readonly<Record<NextMuxDesktopLocale, Readonly<Record<DynamicSurfaceTemplate, string>>>> = {
    'zh-CN': {
        turn: '跳到第 {index} 轮：{title}', close: '关闭 {name}', fileDiff: '文件差异：{path}', route: '{provider} 线路',
        officialConnection: '{provider} 官方连接', remove: '移除 {name}', newConversation: '在 {project} 中新建对话',
        expandRemainingConversations: '展开剩余 {count} 条对话', collapseConversations: '收起对话', activityCount: '{count} 项活动'
    },
    'zh-TW': {
        turn: '前往第 {index} 輪：{title}', close: '關閉 {name}', fileDiff: '檔案差異：{path}', route: '{provider} 線路',
        officialConnection: '{provider} 官方連線', remove: '移除 {name}', newConversation: '在 {project} 中新增對話',
        expandRemainingConversations: '展開剩餘 {count} 個對話', collapseConversations: '收起對話', activityCount: '{count} 項活動'
    },
    en: {
        turn: 'Go to turn {index}: {title}', close: 'Close {name}', fileDiff: 'File diff: {path}', route: '{provider} route',
        officialConnection: '{provider} official connection', remove: 'Remove {name}', newConversation: 'Start a new conversation in {project}',
        expandRemainingConversations: 'Show {count} more conversations', collapseConversations: 'Collapse conversations', activityCount: '{count} activities'
    },
    ja: {
        turn: '第{index}ターンへ移動：{title}', close: '{name} を閉じる', fileDiff: 'ファイル差分：{path}', route: '{provider} ルート',
        officialConnection: '{provider} 公式接続', remove: '{name} を削除', newConversation: '{project} で新しい会話を開始',
        expandRemainingConversations: '残り {count} 件の会話を表示', collapseConversations: '会話を折りたたむ', activityCount: '{count} 件のアクティビティ'
    },
    ko: {
        turn: '{index}번째 턴으로 이동: {title}', close: '{name} 닫기', fileDiff: '파일 차이: {path}', route: '{provider} 경로',
        officialConnection: '{provider} 공식 연결', remove: '{name} 제거', newConversation: '{project}에서 새 대화 시작',
        expandRemainingConversations: '나머지 {count}개 대화 표시', collapseConversations: '대화 접기', activityCount: '활동 {count}개'
    },
    es: {
        turn: 'Ir al turno {index}: {title}', close: 'Cerrar {name}', fileDiff: 'Diferencias del archivo: {path}', route: 'Ruta de {provider}',
        officialConnection: 'Conexión oficial de {provider}', remove: 'Eliminar {name}', newConversation: 'Iniciar una conversación nueva en {project}',
        expandRemainingConversations: 'Mostrar {count} conversaciones más', collapseConversations: 'Contraer conversaciones', activityCount: '{count} actividades'
    },
    fr: {
        turn: 'Aller au tour {index} : {title}', close: 'Fermer {name}', fileDiff: 'Différences du fichier : {path}', route: 'Route {provider}',
        officialConnection: 'Connexion officielle {provider}', remove: 'Supprimer {name}', newConversation: 'Démarrer une nouvelle conversation dans {project}',
        expandRemainingConversations: 'Afficher {count} conversations de plus', collapseConversations: 'Réduire les conversations', activityCount: '{count} activités'
    },
    de: {
        turn: 'Zu Runde {index} wechseln: {title}', close: '{name} schließen', fileDiff: 'Dateiunterschied: {path}', route: '{provider}-Route',
        officialConnection: 'Offizielle {provider}-Verbindung', remove: '{name} entfernen', newConversation: 'Neue Unterhaltung in {project} starten',
        expandRemainingConversations: '{count} weitere Unterhaltungen anzeigen', collapseConversations: 'Unterhaltungen einklappen', activityCount: '{count} Aktivitäten'
    },
    'pt-BR': {
        turn: 'Ir para a interação {index}: {title}', close: 'Fechar {name}', fileDiff: 'Diferenças do arquivo: {path}', route: 'Rota: {provider}',
        officialConnection: 'Conexão oficial: {provider}', remove: 'Remover {name}', newConversation: 'Iniciar nova conversa em {project}',
        expandRemainingConversations: 'Mostrar mais {count} conversas', collapseConversations: 'Recolher conversas', activityCount: '{count} atividades'
    },
    ru: {
        turn: 'Перейти к сообщению {index}: {title}', close: 'Закрыть {name}', fileDiff: 'Различия файла: {path}', route: 'Маршрут {provider}',
        officialConnection: 'Официальное подключение {provider}', remove: 'Удалить {name}', newConversation: 'Начать новый диалог в {project}',
        expandRemainingConversations: 'Показать ещё {count} диалогов', collapseConversations: 'Свернуть диалоги', activityCount: '{count} действий'
    },
    ar: {
        turn: 'الانتقال إلى الجولة {index}: {title}', close: 'إغلاق {name}', fileDiff: 'فروق الملف: {path}', route: 'مسار {provider}',
        officialConnection: 'اتصال {provider} الرسمي', remove: 'إزالة {name}', newConversation: 'بدء محادثة جديدة في {project}',
        expandRemainingConversations: 'عرض {count} محادثات إضافية', collapseConversations: 'طي المحادثات', activityCount: '{count} نشاطًا'
    },
    hi: {
        turn: 'चरण {index} पर जाएँ: {title}', close: '{name} बंद करें', fileDiff: 'फ़ाइल अंतर: {path}', route: '{provider} रूट',
        officialConnection: '{provider} आधिकारिक कनेक्शन', remove: '{name} हटाएँ', newConversation: '{project} में नई बातचीत शुरू करें',
        expandRemainingConversations: 'और {count} बातचीत दिखाएँ', collapseConversations: 'बातचीत समेटें', activityCount: '{count} गतिविधियाँ'
    }
};

export type OfficialModelSurfaceKey =
    | 'savedConnectionCount'
    | 'modelCount'
    | 'dynamicModelCount'
    | 'defaultModel'
    | 'defaultModelHint'
    | 'discoverySuccess'
    | 'expandAllProviders'
    | 'collapseProviders';

const officialModelSurfaceTemplates: Readonly<Record<NextMuxDesktopLocale, Readonly<Record<OfficialModelSurfaceKey, string>>>> = {
    'zh-CN': {
        savedConnectionCount: '{count} 个', modelCount: '{count} 个模型', dynamicModelCount: '{count} 个动态模型', defaultModel: '默认模型', defaultModelHint: '测试连接用 · 保存后全部模型可用',
        discoverySuccess: '已从该 API 读取 {count} 个模型；未返回的模型会显示为不可选。',
        expandAllProviders: '展开全部 {count} 家提供商', collapseProviders: '收起提供商'
    },
    'zh-TW': {
        savedConnectionCount: '{count} 個', modelCount: '{count} 個模型', dynamicModelCount: '{count} 個動態模型', defaultModel: '預設模型', defaultModelHint: '測試連線用 · 儲存後全部模型可用',
        discoverySuccess: '已從此 API 讀取 {count} 個模型；未回傳的模型會維持不可選。',
        expandAllProviders: '展開全部 {count} 家供應商', collapseProviders: '收合供應商'
    },
    en: {
        savedConnectionCount: '{count} connections', modelCount: '{count} models', dynamicModelCount: '{count} discovered models', defaultModel: 'Default model', defaultModelHint: 'Tests the connection · every model is usable after saving',
        discoverySuccess: 'Read {count} models from this API. Models not returned remain unavailable.',
        expandAllProviders: 'Show all {count} providers', collapseProviders: 'Collapse providers'
    },
    ja: {
        savedConnectionCount: '{count} 件', modelCount: '{count} モデル', dynamicModelCount: '検出済み {count} モデル', defaultModel: '既定のモデル', defaultModelHint: '接続テスト用 · 保存後はすべてのモデルを利用可能',
        discoverySuccess: 'この API から {count} モデルを取得しました。返されなかったモデルは選択できません。',
        expandAllProviders: '{count} 件のプロバイダーをすべて表示', collapseProviders: 'プロバイダーを折りたたむ'
    },
    ko: {
        savedConnectionCount: '{count}개', modelCount: '{count}개 모델', dynamicModelCount: '검색된 모델 {count}개', defaultModel: '기본 모델', defaultModelHint: '연결 테스트용 · 저장 후 모든 모델 사용 가능',
        discoverySuccess: '이 API에서 모델 {count}개를 읽었습니다. 반환되지 않은 모델은 선택할 수 없습니다.',
        expandAllProviders: '제공업체 {count}개 모두 보기', collapseProviders: '제공업체 접기'
    },
    es: {
        savedConnectionCount: '{count} conexiones', modelCount: '{count} modelos', dynamicModelCount: '{count} modelos detectados', defaultModel: 'Modelo predeterminado', defaultModelHint: 'Sirve para probar la conexión · todos los modelos se pueden usar al guardar',
        discoverySuccess: 'Se leyeron {count} modelos de esta API. Los modelos no devueltos seguirán sin estar disponibles.',
        expandAllProviders: 'Mostrar los {count} proveedores', collapseProviders: 'Contraer proveedores'
    },
    fr: {
        savedConnectionCount: '{count} connexions', modelCount: '{count} modèles', dynamicModelCount: '{count} modèles détectés', defaultModel: 'Modèle par défaut', defaultModelHint: 'Sert à tester la connexion · tous les modèles sont utilisables après l’enregistrement',
        discoverySuccess: '{count} modèles ont été lus depuis cette API. Les modèles non renvoyés restent indisponibles.',
        expandAllProviders: 'Afficher les {count} fournisseurs', collapseProviders: 'Réduire les fournisseurs'
    },
    de: {
        savedConnectionCount: '{count} Verbindungen', modelCount: '{count} Modelle', dynamicModelCount: '{count} erkannte Modelle', defaultModel: 'Standardmodell', defaultModelHint: 'Zum Testen der Verbindung · nach dem Speichern sind alle Modelle nutzbar',
        discoverySuccess: '{count} Modelle wurden von dieser API gelesen. Nicht zurückgegebene Modelle bleiben nicht verfügbar.',
        expandAllProviders: 'Alle {count} Anbieter anzeigen', collapseProviders: 'Anbieter einklappen'
    },
    'pt-BR': {
        savedConnectionCount: '{count} conexões', modelCount: '{count} modelos', dynamicModelCount: '{count} modelos detectados', defaultModel: 'Modelo padrão', defaultModelHint: 'Serve para testar a conexão · todos os modelos ficam disponíveis após salvar',
        discoverySuccess: '{count} modelos foram lidos desta API. Os modelos não retornados permanecem indisponíveis.',
        expandAllProviders: 'Mostrar todos os {count} provedores', collapseProviders: 'Recolher provedores'
    },
    ru: {
        savedConnectionCount: '{count} подключений', modelCount: '{count} моделей', dynamicModelCount: '{count} обнаруженных моделей', defaultModel: 'Модель по умолчанию', defaultModelHint: 'Для проверки подключения · после сохранения доступны все модели',
        discoverySuccess: 'Из этого API получено моделей: {count}. Не возвращённые модели остаются недоступными.',
        expandAllProviders: 'Показать всех поставщиков: {count}', collapseProviders: 'Свернуть поставщиков'
    },
    ar: {
        savedConnectionCount: '{count} اتصالات', modelCount: '{count} نماذج', dynamicModelCount: '{count} نماذج مكتشفة', defaultModel: 'النموذج الافتراضي', defaultModelHint: 'لاختبار الاتصال · كل النماذج متاحة بعد الحفظ',
        discoverySuccess: 'تمت قراءة {count} نماذج من واجهة API هذه. تظل النماذج غير المُعادة غير متاحة.',
        expandAllProviders: 'عرض جميع موفري الخدمة وعددهم {count}', collapseProviders: 'طي موفري الخدمة'
    },
    hi: {
        savedConnectionCount: '{count} कनेक्शन', modelCount: '{count} मॉडल', dynamicModelCount: '{count} खोजे गए मॉडल', defaultModel: 'डिफ़ॉल्ट मॉडल', defaultModelHint: 'कनेक्शन जाँचने के लिए · सेव करने के बाद सभी मॉडल उपलब्ध',
        discoverySuccess: 'इस API से {count} मॉडल पढ़े गए। जो मॉडल वापस नहीं मिले वे अनुपलब्ध रहेंगे।',
        expandAllProviders: 'सभी {count} प्रदाता दिखाएँ', collapseProviders: 'प्रदाताओं को समेटें'
    }
};

const generatedSources = Object.keys(generated.en || {}).sort((left, right) => right.length - left.length);
const manualSources = Object.keys(manual.en).sort((left, right) => right.length - left.length);
const localizationCache = new Map<NextMuxDesktopLocale, Map<string, string>>();
const MAX_LOCALIZATION_CACHE_ENTRIES = 4_096;

function cacheLocalizedSurface(cache: Map<string, string>, value: string, localized: string): string {
    if (cache.size >= MAX_LOCALIZATION_CACHE_ENTRIES) cache.delete(cache.keys().next().value as string);
    cache.set(value, localized);
    return localized;
}

function replaceAll(value: string, source: string, target: string): string {
    return value.includes(source) ? value.split(source).join(target) : value;
}

function preserveBoundaryWhitespace(source: string, target: string): string {
    const leading = source.match(/^\s+/)?.[0] || '';
    const trailing = source.match(/\s+$/)?.[0] || '';
    return `${leading}${target.trim()}${trailing}`;
}

function renderDynamicTemplate(template: string, values: Readonly<Record<string, string>>): string {
    return template.replace(/\{([a-z]+)\}/gi, (_match, key: string) => values[key] || '');
}

function uncheckedOfficialModelSurfaceText(
    locale: NextMuxDesktopLocale,
    key: OfficialModelSurfaceKey,
    values: Readonly<{ readonly count: string }>
): string {
    return renderDynamicTemplate(officialModelSurfaceTemplates[locale][key], values);
}

function localizeDynamicSurface(locale: NextMuxDesktopLocale, value: string): string | undefined {
    const source = value.trim();
    const staging = /^有\s*(\d+)\s*个暂存缓存目录，可校验的文件已计入用量，可重试清理。$/u.exec(source);
    if (staging) {
        if (locale === 'zh-CN') return source;
        const template = directorySurface[locale]?.['有 {count} 个暂存缓存目录，可校验的文件已计入用量，可重试清理。'];
        if (template) return renderDynamicTemplate(template, { count: staging[1] });
    }
    const unavailable = /^另有\s*(\d+)\s*个缓存目录无法安全读取，当前用量不完整，附件清理已暂停。$/u.exec(source);
    if (unavailable) {
        if (locale === 'zh-CN') return source;
        const template = directorySurface[locale]?.['另有 {count} 个缓存目录无法安全读取，当前用量不完整，附件清理已暂停。'];
        if (template) return renderDynamicTemplate(template, { count: unavailable[1] });
    }
    const templates = dynamicTemplates[locale];
    let match = /^跳到第\s*(\d+)\s*轮：(.*)$/s.exec(source);
    if (match) return renderDynamicTemplate(templates.turn, { index: match[1], title: match[2] });
    match = /^文件差异\s+(.+)$/s.exec(source);
    if (match) return renderDynamicTemplate(templates.fileDiff, { path: match[1] });
    match = /^在\s+(.+)\s+中新建对话$/s.exec(source);
    if (match) return renderDynamicTemplate(templates.newConversation, { project: match[1] });
    match = /^(.+)\s+官方连接$/s.exec(source);
    if (match) return renderDynamicTemplate(templates.officialConnection, { provider: match[1] });
    match = /^(.+)\s+线路$/s.exec(source);
    if (match) return renderDynamicTemplate(templates.route, { provider: match[1] });
    match = /^关闭\s+(.+)$/s.exec(source);
    if (match) return renderDynamicTemplate(templates.close, { name: match[1] });
    match = /^移除\s+(.+)$/s.exec(source);
    if (match) return renderDynamicTemplate(templates.remove, { name: match[1] });
    match = /^展开剩余\s*(\d+)\s*条对话$/s.exec(source);
    if (match) return renderDynamicTemplate(templates.expandRemainingConversations, { count: match[1] });
    match = /^(\d+)\s*项活动$/s.exec(source);
    if (match) return renderDynamicTemplate(templates.activityCount, { count: match[1] });
    if (source === '收起对话') return templates.collapseConversations;
    return undefined;
}

export function localizeDesktopSurface(locale: NextMuxDesktopLocale, value: string): string {
    const reviewedMedia = reviewedMediaSurfaceText(locale, value);
    if (reviewedMedia !== undefined) return reviewedMedia;
    if (value === 'ElevenLabs 音频') return mediaAuditText(locale, 'elevenLabsAudio');
    let localeCache = localizationCache.get(locale);
    if (!localeCache) {
        localeCache = new Map<string, string>();
        localizationCache.set(locale, localeCache);
    }
    const cached = localeCache.get(value);
    if (cached !== undefined) return cached;
    const corrected = correctedSurfaceLabels[locale]?.[value];
    if (corrected) return cacheLocalizedSurface(localeCache, value, corrected);
    const coding = codingSurfaceText(locale, value);
    if (coding) return cacheLocalizedSurface(localeCache, value, coding);
    const shell = shellSurfaceText(locale, value);
    if (shell) return cacheLocalizedSurface(localeCache, value, shell);
    const modelsSettings = modelsSettingsSurfaceText(locale, value);
    if (modelsSettings) return cacheLocalizedSurface(localeCache, value, modelsSettings);
    const reviewedExact = reviewedAdditions[locale]?.[value.trim()];
    if (reviewedExact) {
        return cacheLocalizedSurface(localeCache, value, preserveBoundaryWhitespace(value, reviewedExact));
    }
    const manualExact = manual[locale][value];
    if (manualExact) {
        return cacheLocalizedSurface(localeCache, value, manualExact);
    }
    const directoryExact = directorySurface[locale]?.[value];
    if (directoryExact) {
        return cacheLocalizedSurface(localeCache, value, preserveBoundaryWhitespace(value, directoryExact));
    }
    const localeCatalog = generated[locale];
    const generatedExact = localeCatalog?.[value];
    if (generatedExact) {
        const rendered = preserveBoundaryWhitespace(value, generatedExact);
        return cacheLocalizedSurface(localeCache, value, rendered);
    }
    // Chinese templates and catalogue substitutions cannot match these
    // values. Keep the small English-to-locale table for composite labels.
    if (!/[\u3400-\u9fff]/u.test(value)) {
        let localized = value;
        if (locale !== 'en') {
            for (const source of manualSources) {
                const target = manual[locale][source];
                if (target && localized.includes(source)) localized = replaceAll(localized, source, target);
            }
        }
        return cacheLocalizedSurface(localeCache, value, localized);
    }
    const dynamic = localizeDynamicSurface(locale, value);
    if (dynamic) {
        const rendered = preserveBoundaryWhitespace(value, dynamic);
        return cacheLocalizedSurface(localeCache, value, rendered);
    }
    let localized = value.replace(/(\d+)\s*场景\s*·\s*(\d+)\s*镜头/g, `$1 ${manual[locale].scenes} · $2 ${manual[locale].shots}`);
    // The generated catalogue is entirely keyed by Chinese source strings.
    // File paths, model ids and other dynamic values are common during every
    // workbench render; avoid walking the complete catalogue for values that
    // cannot contain a generated source.
    if (localeCatalog && /[\u3400-\u9fff]/u.test(localized)) {
        for (const source of generatedSources) {
            if (!localized.includes(source)) continue;
            localized = replaceAll(localized, source, preserveBoundaryWhitespace(source, localeCatalog[source] || source));
        }
    }
    for (const source of manualSources) {
        const target = manual[locale][source];
        if (target && localized.includes(source)) localized = replaceAll(localized, source, target);
    }
    // Fragment substitution is only trustworthy when it covers the whole text.
    // A partly covered sentence ("Currently系统无法…") reads as broken UI in
    // scripts without Han characters, so keep the complete source sentence.
    if (!HAN_SCRIPT_LOCALES.has(locale) && localized !== value && /[\u3400-\u9fff]/u.test(localized)) {
        return cacheLocalizedSurface(localeCache, value, value);
    }
    return cacheLocalizedSurface(localeCache, value, localized);
}

const HAN_SCRIPT_LOCALES: ReadonlySet<NextMuxDesktopLocale> = new Set<NextMuxDesktopLocale>(['zh-CN', 'zh-TW', 'ja']);

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function officialModelSurfaceText(locale: Parameters<typeof uncheckedOfficialModelSurfaceText>[0], key: Parameters<typeof uncheckedOfficialModelSurfaceText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedOfficialModelSurfaceText>>): string {
    return totalCopy(locale, key, language => uncheckedOfficialModelSurfaceText(language, key, ...rest));
}
