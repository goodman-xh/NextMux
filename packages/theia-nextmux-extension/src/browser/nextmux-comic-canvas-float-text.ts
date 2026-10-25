const locales = ['zh-CN', 'en', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];
const messages = {
    move: ['移动窗口', 'Move window', '移動視窗', 'ウィンドウを移動', '창 이동', 'Mover ventana', 'Déplacer la fenêtre', 'Fenster verschieben', 'Mover janela', 'Переместить окно', 'تحريك النافذة', 'विंडो खिसकाएँ'],
    br: ['调整右下角', 'Resize bottom right', '調整右下角', '右下をリサイズ', '오른쪽 아래 크기 조절', 'Redimensionar abajo a la derecha', 'Redimensionner en bas à droite', 'Unten rechts skalieren', 'Redimensionar canto inferior direito', 'Размер: нижний правый угол', 'تغيير الحجم من أسفل اليمين', 'नीचे दाएँ से आकार बदलें']
} as const;
export function canvasFloatText(locale: string, key: keyof typeof messages): string {
    const index = locales.indexOf(locale);
    return messages[key]?.[index < 0 ? locale.startsWith('zh') ? 0 : 1 : index] ?? key;
}
