import { TextReplacementContribution } from '@theia/core/lib/browser/preload/text-replacement-contribution';

const replacements: Record<string, Record<string, string>> = {
    'zh-cn': {
        File: '文件', Edit: '编辑', Selection: '选择', View: '视图', Go: '转到', Run: '运行', Terminal: '终端', Help: '帮助', About: '关于 NextMux',
        'New Text File': '新建文本文件', 'New File...': '新建文件…', 'New Folder...': '新建文件夹…', 'New Window': '新建窗口',
        'Open File': '打开文件', 'Open Folder': '打开文件夹', 'Open File...': '打开文件…', 'Open Folder...': '打开文件夹…', 'Open Workspace from File...': '从文件打开工作区…', 'Open Recent Workspace...': '打开最近的工作区…',
        'Add Folder to Workspace...': '将文件夹添加到工作区…', 'Save Workspace As...': '工作区另存为…', Save: '保存', 'Save All': '全部保存', 'Save As...': '另存为…',
        'Auto Save': '自动保存', Preferences: '首选项', 'Close Editor': '关闭编辑器', 'Close Workspace': '关闭工作区', 'Close Window': '关闭窗口',
        Undo: '撤销', Redo: '重做', Cut: '剪切', Copy: '复制', Paste: '粘贴', Find: '查找', Replace: '替换', 'Find in Files': '在文件中查找', 'Replace in Files': '在文件中替换',
        'Command Palette...': '命令面板…', 'Open View...': '打开视图…', Appearance: '外观', 'Editor Layout': '编辑器布局', 'AI Chat': 'AI 对话',
        'Call Hierarchy': '调用层次结构', Debug: '调试', 'Debug Console': '调试控制台', Explorer: '资源管理器', Extensions: '扩展', History: '历史记录', Outline: '大纲', Output: '输出',
        Plugins: '插件', Problems: '问题', Search: '搜索', 'Source Control': '源代码管理', 'Type Hierarchy': '类型层次结构', 'View: Toggle Word Wrap': '切换自动换行',
        'Toggle Minimap': '切换小地图', 'Toggle Breadcrumbs': '切换面包屑导航', 'Toggle Render Whitespace': '切换空白字符显示', 'Toggle Sticky Scroll': '切换粘性滚动',
        'Reload Window': '重新加载窗口', 'Toggle Developer Tools': '切换开发者工具'
    },
    'zh-tw': { File: '檔案', Edit: '編輯', Selection: '選取', View: '檢視', Go: '前往', Run: '執行', Terminal: '終端機', Help: '說明', About: '關於 NextMux' },
    ja: { File: 'ファイル', Edit: '編集', Selection: '選択', View: '表示', Go: '移動', Run: '実行', Terminal: 'ターミナル', Help: 'ヘルプ', About: 'NextMux について' },
    ko: { File: '파일', Edit: '편집', Selection: '선택', View: '보기', Go: '이동', Run: '실행', Terminal: '터미널', Help: '도움말', About: 'NextMux 정보' },
    es: { File: 'Archivo', Edit: 'Editar', Selection: 'Selección', View: 'Ver', Go: 'Ir', Run: 'Ejecutar', Terminal: 'Terminal', Help: 'Ayuda', About: 'Acerca de NextMux' },
    fr: { File: 'Fichier', Edit: 'Édition', Selection: 'Sélection', View: 'Affichage', Go: 'Aller', Run: 'Exécuter', Terminal: 'Terminal', Help: 'Aide', About: 'À propos de NextMux' },
    de: { File: 'Datei', Edit: 'Bearbeiten', Selection: 'Auswahl', View: 'Ansicht', Go: 'Gehe zu', Run: 'Ausführen', Terminal: 'Terminal', Help: 'Hilfe', About: 'Über NextMux' },
    'pt-br': { File: 'Arquivo', Edit: 'Editar', Selection: 'Seleção', View: 'Exibir', Go: 'Ir', Run: 'Executar', Terminal: 'Terminal', Help: 'Ajuda', About: 'Sobre o NextMux' },
    ru: { File: 'Файл', Edit: 'Правка', Selection: 'Выделение', View: 'Вид', Go: 'Переход', Run: 'Запуск', Terminal: 'Терминал', Help: 'Справка', About: 'О NextMux' },
    ar: { File: 'ملف', Edit: 'تحرير', Selection: 'تحديد', View: 'عرض', Go: 'انتقال', Run: 'تشغيل', Terminal: 'الطرفية', Help: 'مساعدة', About: 'حول NextMux' },
    hi: { File: 'फ़ाइल', Edit: 'संपादन', Selection: 'चयन', View: 'दृश्य', Go: 'जाएँ', Run: 'चलाएँ', Terminal: 'टर्मिनल', Help: 'सहायता', About: 'NextMux के बारे में' }
};

export class NextMuxTextReplacementContribution implements TextReplacementContribution {
    getReplacement(locale: string): Record<string, string> {
        return replacements[locale.toLowerCase()] || { About: 'About NextMux' };
    }
}
