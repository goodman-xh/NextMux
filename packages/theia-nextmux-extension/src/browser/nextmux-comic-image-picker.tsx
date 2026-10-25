import * as React from '@theia/core/shared/react';

export interface ComicImageChoice {
    readonly id: string;
    readonly url: string;
    /** What the picture is to the user: its file name, or the shot/scene it was made for. */
    readonly title: string;
}

/** Pick one picture of the project by looking at it, with a first "automatic / none" choice (set plate, singer photo). */
export function ComicImagePicker(props: {
    readonly label: string; readonly hint?: string; readonly emptyLabel: string;
    readonly value?: string; readonly images: readonly ComicImageChoice[];
    readonly disabled?: boolean; readonly onChange: (id: string | undefined) => void;
    /** A section title above already names the picker: keep the name for assistive technology only. */
    readonly labelHidden?: boolean;
}): React.ReactElement {
    const selected = props.images.find(image => image.id === props.value);
    const choose = (id: string | undefined): void => { if (!props.disabled && id !== props.value) props.onChange(id); };
    return <div className='nmx-image-picker'>
        <span className='nmx-image-picker-label'>{!props.labelHidden && props.label}{selected && <small data-nmx-literal title={selected.title}>{selected.title}</small>}</span>
        <div className='nmx-image-picker-strip' role='radiogroup' aria-label={props.label}>
            <button type='button' role='radio' aria-checked={!selected} className='nmx-image-picker-empty' disabled={props.disabled} onClick={() => choose(undefined)}>{props.emptyLabel}</button>
            {props.images.map(image => <button type='button' role='radio' key={image.id} aria-checked={image.id === props.value} title={image.title}
                aria-label={image.title} disabled={props.disabled} onClick={() => choose(image.id)}><img src={image.url} alt='' loading='lazy' draggable={false} /></button>)}
        </div>
        {props.hint && <small className='nmx-image-picker-hint'>{props.hint}</small>}
    </div>;
}
