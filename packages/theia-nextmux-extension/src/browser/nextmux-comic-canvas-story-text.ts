import type { NextMuxDesktopLocale } from './nextmux-locale';

type StoryTextKey = 'planning' | 'progress' | 'contextBudget' | 'unknownCharacter' | 'savedContinue' | 'savedReady' | 'incomplete' | 'sourceChanged';
const copy: Record<NextMuxDesktopLocale, Record<StoryTextKey, string>> = {
    'zh-CN': {
        planning: '正在拆分故事…', progress: '故事拆镜 {current} / {total}；已保存 {count} 个镜头',
        contextBudget: '人物与前镜上下文超出所选模型预算，请使用更大上下文的文本模型。', unknownCharacter: '未识别的人物：{name}',
        savedContinue: '已保存 {count} 个镜头；再次点击拆镜可继续', savedReady: '已保存 {count} 个镜头，可直接修改提示词、选择模型并生成',
        incomplete: '拆镜未完成；已保存的镜头会保留。', sourceChanged: '故事已修改或删除，原计划未写入；请按当前内容重新拆镜。'
    },
    'zh-TW': {
        planning: '正在拆分故事…', progress: '故事分鏡 {current} / {total}；已儲存 {count} 個鏡頭',
        contextBudget: '人物與前一鏡頭的上下文超出所選模型預算，請使用支援更長上下文的文字模型。', unknownCharacter: '無法識別的人物：{name}',
        savedContinue: '已儲存 {count} 個鏡頭；再次點擊分鏡即可繼續', savedReady: '已儲存 {count} 個鏡頭，可直接修改提示詞、選擇模型並生成',
        incomplete: '分鏡尚未完成；已儲存的鏡頭會保留。', sourceChanged: '故事已修改或刪除，原計畫未寫入；請依目前內容重新分鏡。'
    },
    en: {
        planning: 'Planning shots…', progress: 'Planning {current} / {total}; {count} shots saved',
        contextBudget: 'Character and previous-shot context exceeds this text model’s budget. Choose a model with more context.', unknownCharacter: 'Unknown character: {name}',
        savedContinue: '{count} shots saved; run planning again to continue', savedReady: '{count} shots saved; edit prompts and choose models to generate',
        incomplete: 'Planning did not complete; saved shots are retained.', sourceChanged: 'The story changed or was removed; the old plan was not applied. Plan the current text again.'
    },
    ja: {
        planning: 'ストーリーをショットに分割中…', progress: 'ショット作成 {current} / {total}；{count} ショット保存済み',
        contextBudget: '登場人物と前のショットの情報が選択したモデルの上限を超えています。より長いコンテキストに対応したテキストモデルを選んでください。', unknownCharacter: '不明な登場人物：{name}',
        savedContinue: '{count} ショットを保存しました。再度ショット作成を実行すると続行できます', savedReady: '{count} ショットを保存しました。プロンプトを編集し、モデルを選んで生成できます',
        incomplete: 'ショット作成は完了しませんでした。保存済みのショットは保持されます。', sourceChanged: 'ストーリーが変更または削除されたため、元の計画は適用されませんでした。現在の内容で再度実行してください。'
    },
    ko: {
        planning: '스토리를 장면으로 나누는 중…', progress: '장면 구성 {current} / {total}; {count}개 저장됨',
        contextBudget: '등장인물과 이전 장면 정보가 선택한 모델의 한도를 초과합니다. 더 긴 문맥을 지원하는 텍스트 모델을 선택하세요.', unknownCharacter: '알 수 없는 등장인물: {name}',
        savedContinue: '장면 {count}개 저장됨. 장면 구성을 다시 실행하면 계속할 수 있습니다', savedReady: '장면 {count}개 저장됨. 프롬프트를 수정하고 모델을 선택해 생성할 수 있습니다',
        incomplete: '장면 구성을 완료하지 못했습니다. 저장된 장면은 유지됩니다.', sourceChanged: '스토리가 변경되거나 삭제되어 이전 계획을 적용하지 않았습니다. 현재 내용으로 다시 구성하세요.'
    },
    es: {
        planning: 'Planificando planos…', progress: 'Planificación {current} / {total}; {count} planos guardados',
        contextBudget: 'El contexto de los personajes y del plano anterior supera el límite del modelo. Elige un modelo de texto con más contexto.', unknownCharacter: 'Personaje desconocido: {name}',
        savedContinue: '{count} planos guardados; vuelve a planificar para continuar', savedReady: '{count} planos guardados; edita las instrucciones y elige modelos para generar',
        incomplete: 'La planificación no se completó; se conservan los planos guardados.', sourceChanged: 'La historia se modificó o eliminó; no se aplicó el plan anterior. Vuelve a planificar con el texto actual.'
    },
    fr: {
        planning: 'Découpage du récit en cours…', progress: 'Découpage {current} / {total} ; {count} plans enregistrés',
        contextBudget: 'Le contexte des personnages et du plan précédent dépasse la limite du modèle. Choisissez un modèle de texte acceptant plus de contexte.', unknownCharacter: 'Personnage inconnu : {name}',
        savedContinue: '{count} plans enregistrés ; relancez le découpage pour continuer', savedReady: '{count} plans enregistrés ; modifiez les instructions et choisissez les modèles pour générer',
        incomplete: 'Le découpage est inachevé ; les plans enregistrés sont conservés.', sourceChanged: 'Le récit a été modifié ou supprimé ; l’ancien plan n’a pas été appliqué. Relancez le découpage du texte actuel.'
    },
    de: {
        planning: 'Szenen werden geplant…', progress: 'Planung {current} / {total}; {count} Einstellungen gespeichert',
        contextBudget: 'Die Figuren und die vorherige Einstellung überschreiten das Kontextlimit des Modells. Wählen Sie ein Textmodell mit größerem Kontext.', unknownCharacter: 'Unbekannte Figur: {name}',
        savedContinue: '{count} Einstellungen gespeichert; starten Sie die Planung erneut, um fortzufahren', savedReady: '{count} Einstellungen gespeichert; bearbeiten Sie Prompts und wählen Sie Modelle zur Generierung',
        incomplete: 'Die Planung wurde nicht abgeschlossen; gespeicherte Einstellungen bleiben erhalten.', sourceChanged: 'Die Geschichte wurde geändert oder entfernt. Der alte Plan wurde nicht angewendet. Planen Sie den aktuellen Text erneut.'
    },
    'pt-BR': {
        planning: 'Planejando tomadas…', progress: 'Planejamento {current} / {total}; {count} tomadas salvas',
        contextBudget: 'O contexto dos personagens e da tomada anterior excede o limite do modelo. Escolha um modelo de texto com mais contexto.', unknownCharacter: 'Personagem desconhecido: {name}',
        savedContinue: '{count} tomadas salvas; execute o planejamento novamente para continuar', savedReady: '{count} tomadas salvas; edite as instruções e escolha os modelos para gerar',
        incomplete: 'O planejamento não foi concluído; as tomadas salvas foram mantidas.', sourceChanged: 'A história foi alterada ou removida; o plano anterior não foi aplicado. Planeje novamente com o texto atual.'
    },
    ru: {
        planning: 'Создание раскадровки…', progress: 'Раскадровка {current} / {total}; сохранено кадров: {count}',
        contextBudget: 'Сведения о персонажах и предыдущем кадре превышают лимит контекста модели. Выберите текстовую модель с большим контекстом.', unknownCharacter: 'Неизвестный персонаж: {name}',
        savedContinue: 'Сохранено кадров: {count}; запустите раскадровку ещё раз, чтобы продолжить', savedReady: 'Сохранено кадров: {count}; измените запросы и выберите модели для генерации',
        incomplete: 'Раскадровка не завершена; сохранённые кадры остаются.', sourceChanged: 'История изменена или удалена; прежний план не применён. Создайте раскадровку текущего текста заново.'
    },
    ar: {
        planning: 'جارٍ تقسيم القصة إلى لقطات…', progress: 'تخطيط اللقطات {current} / {total}؛ تم حفظ {count} لقطة',
        contextBudget: 'تجاوز سياق الشخصيات واللقطة السابقة حد النموذج المحدد. اختر نموذجًا نصيًا يدعم سياقًا أطول.', unknownCharacter: 'شخصية غير معروفة: {name}',
        savedContinue: 'تم حفظ {count} لقطة؛ أعد تشغيل التخطيط للمتابعة', savedReady: 'تم حفظ {count} لقطة؛ يمكنك تعديل الأوصاف واختيار النماذج للتوليد',
        incomplete: 'لم يكتمل التخطيط؛ تم الاحتفاظ باللقطات المحفوظة.', sourceChanged: 'تم تغيير القصة أو حذفها، ولم تُطبّق الخطة السابقة. أعد التخطيط باستخدام النص الحالي.'
    },
    hi: {
        planning: 'कहानी को शॉट में बाँटा जा रहा है…', progress: 'शॉट योजना {current} / {total}; {count} शॉट सहेजे गए',
        contextBudget: 'पात्रों और पिछले शॉट का संदर्भ चुने गए मॉडल की सीमा से अधिक है। अधिक संदर्भ वाला टेक्स्ट मॉडल चुनें।', unknownCharacter: 'अज्ञात पात्र: {name}',
        savedContinue: '{count} शॉट सहेजे गए; जारी रखने के लिए योजना फिर चलाएँ', savedReady: '{count} शॉट सहेजे गए; प्रॉम्प्ट बदलें और वीडियो बनाने के लिए मॉडल चुनें',
        incomplete: 'शॉट योजना पूरी नहीं हुई; सहेजे गए शॉट सुरक्षित हैं।', sourceChanged: 'कहानी बदल दी गई या हटा दी गई है; पुरानी योजना लागू नहीं की गई। वर्तमान पाठ की योजना फिर बनाएँ।'
    }
};

export function canvasStoryText(locale: NextMuxDesktopLocale, key: StoryTextKey, values: Readonly<Record<string, string | number>> = {}): string {
    return ((copy[locale] || copy.en)[key] ?? copy.en[key] ?? String(key)).replace(/\{(\w+)\}/g, (placeholder, name: string) => values[name] === undefined ? placeholder : String(values[name]));
}
