import * as React from '@theia/core/shared/react';
import {
    Virtuoso,
    VirtuosoGrid,
    type Components,
    type GridComponents,
    type GridItemProps,
    type GridListProps,
    type ItemProps,
    type ListProps,
    type ListRange,
    type ScrollerProps,
    type VirtuosoGridHandle,
    type VirtuosoHandle
} from 'react-virtuoso';

export const DEFAULT_VIRTUAL_LIST_THRESHOLD = 30;
const DEFAULT_OVERSCAN = 200;
const EMPTY_COMPONENTS: Readonly<Record<string, never>> = {};

export type VirtualListContainerProps = ListProps & { readonly className?: string };
export type VirtualListItemContainerProps<T> = ItemProps<T> & { readonly className?: string };
export type VirtualScrollerContainerProps = ScrollerProps & React.HTMLAttributes<HTMLDivElement>;

export interface VirtualListProps<T, Context = unknown> {
    readonly items: readonly T[];
    readonly renderItem: (item: T, index: number) => React.ReactNode;
    readonly itemKey?: (item: T, index: number) => React.Key;
    readonly threshold?: number;
    readonly id?: string;
    readonly className?: string;
    readonly listClassName?: string;
    readonly itemClassName?: string;
    readonly style?: React.CSSProperties;
    readonly listStyle?: React.CSSProperties;
    readonly role?: React.AriaRole;
    readonly 'aria-label'?: string;
    readonly context?: Context;
    readonly overscan?: number | { readonly main: number; readonly reverse: number };
    readonly increaseViewportBy?: number | { readonly top: number; readonly bottom: number };
    readonly defaultItemHeight?: number;
    readonly fixedItemHeight?: number;
    readonly initialItemCount?: number;
    readonly customScrollParent?: HTMLElement | null;
    readonly useWindowScroll?: boolean;
    readonly endReached?: (index: number) => void;
    readonly startReached?: (index: number) => void;
    readonly rangeChanged?: (range: ListRange) => void;
    readonly onScroll?: React.UIEventHandler<HTMLElement>;
    readonly scrollerRef?: (ref: HTMLElement | null) => void;
    readonly virtuosoRef?: React.Ref<VirtuosoHandle>;
    readonly header?: React.ReactNode;
    readonly footer?: React.ReactNode;
    readonly empty?: React.ReactNode;
    readonly components?: {
        readonly List?: React.ComponentType<VirtualListContainerProps>;
        readonly Item?: React.ComponentType<VirtualListItemContainerProps<T>>;
        readonly Scroller?: React.ComponentType<VirtualScrollerContainerProps>;
        readonly Header?: React.ComponentType;
        readonly Footer?: React.ComponentType;
        readonly EmptyPlaceholder?: React.ComponentType;
    };
}

export interface VirtualGridProps<T, Context = unknown> {
    readonly items: readonly T[];
    readonly renderItem: (item: T, index: number) => React.ReactNode;
    readonly itemKey?: (item: T, index: number) => React.Key;
    readonly threshold?: number;
    readonly id?: string;
    readonly className?: string;
    readonly listClassName?: string;
    readonly itemClassName?: string;
    readonly style?: React.CSSProperties;
    readonly listStyle?: React.CSSProperties;
    readonly role?: React.AriaRole;
    readonly 'aria-label'?: string;
    readonly context?: Context;
    readonly overscan?: number | { readonly main: number; readonly reverse: number };
    readonly increaseViewportBy?: number | { readonly top: number; readonly bottom: number };
    readonly initialItemCount?: number;
    readonly customScrollParent?: HTMLElement | null;
    readonly useWindowScroll?: boolean;
    readonly endReached?: (index: number) => void;
    readonly startReached?: (index: number) => void;
    readonly rangeChanged?: (range: ListRange) => void;
    readonly onScroll?: React.UIEventHandler<HTMLElement>;
    readonly scrollerRef?: (ref: HTMLElement | null) => void;
    readonly virtuosoRef?: React.Ref<VirtuosoGridHandle>;
    readonly header?: React.ReactNode;
    readonly footer?: React.ReactNode;
    readonly empty?: React.ReactNode;
    readonly components?: {
        readonly List?: React.ComponentType<GridListProps>;
        readonly Item?: React.ComponentType<GridItemProps>;
        readonly Scroller?: React.ComponentType<VirtualScrollerContainerProps>;
        readonly Header?: React.ComponentType;
        readonly Footer?: React.ComponentType;
    };
}

/**
 * Virtualized vertical list backed by `react-virtuoso` when `items.length > threshold`.
 * Below the threshold, renders plain children without virtual scroller scaffolding so small
 * lists and JSDOM/unit tests keep direct DOM layout and zero content-visibility tricks.
 */
export function VirtualList<T, Context = unknown>(props: VirtualListProps<T, Context>): React.ReactElement {
    const {
        items,
        renderItem,
        itemKey,
        threshold = DEFAULT_VIRTUAL_LIST_THRESHOLD,
        id,
        className,
        listClassName,
        itemClassName,
        style,
        listStyle,
        role,
        'aria-label': ariaLabel,
        context,
        overscan,
        increaseViewportBy,
        defaultItemHeight,
        fixedItemHeight,
        initialItemCount,
        customScrollParent,
        useWindowScroll,
        endReached,
        startReached,
        rangeChanged,
        onScroll,
        scrollerRef,
        virtuosoRef,
        header,
        footer,
        empty,
        components
    } = props;

    const virtuosoComponents = React.useMemo<Components<T, Context>>(() => {
        const CustomList = components?.List;
        const CustomItem = components?.Item;
        const CustomScroller = components?.Scroller;
        const CustomHeader = components?.Header;
        const CustomFooter = components?.Footer;
        const CustomEmpty = components?.EmptyPlaceholder;
        const needsList = Boolean(CustomList || listClassName || listStyle);
        const needsItem = Boolean(CustomItem || itemClassName);
        if (!needsList && !needsItem && !CustomScroller && !CustomHeader && !CustomFooter && !CustomEmpty && header === undefined && footer === undefined && empty === undefined) {
            return EMPTY_COMPONENTS as Components<T, Context>;
        }
        const next: Components<T, Context> = {};
        if (CustomScroller) next.Scroller = CustomScroller as Components<T, Context>['Scroller'];
        if (needsList) {
            next.List = React.forwardRef<HTMLDivElement, VirtualListContainerProps>(function VirtualListContainer(listProps, ref) {
                const mergedClass = [listProps.className, listClassName].filter(Boolean).join(' ') || undefined;
                const mergedStyle = listStyle ? { ...listProps.style, ...listStyle } : listProps.style;
                if (CustomList) {
                    return <CustomList {...listProps} ref={ref} className={mergedClass} style={mergedStyle} />;
                }
                return <div {...listProps} ref={ref} className={mergedClass} style={mergedStyle} />;
            }) as Components<T, Context>['List'];
        }
        if (needsItem) {
            next.Item = function VirtualListItem(itemProps: VirtualListItemContainerProps<T>) {
                const mergedClass = [itemProps.className, itemClassName].filter(Boolean).join(' ') || undefined;
                if (CustomItem) {
                    return <CustomItem {...itemProps} className={mergedClass} />;
                }
                return <div {...itemProps} className={mergedClass} />;
            } as Components<T, Context>['Item'];
        }
        if (CustomHeader) next.Header = CustomHeader as Components<T, Context>['Header'];
        else if (header !== undefined) next.Header = () => <>{header}</>;
        if (CustomFooter) next.Footer = CustomFooter as Components<T, Context>['Footer'];
        else if (footer !== undefined) next.Footer = () => <>{footer}</>;
        if (CustomEmpty) next.EmptyPlaceholder = CustomEmpty as Components<T, Context>['EmptyPlaceholder'];
        else if (empty !== undefined) next.EmptyPlaceholder = () => <>{empty}</>;
        return next;
    }, [components?.List, components?.Item, components?.Scroller, components?.Header, components?.Footer, components?.EmptyPlaceholder, listClassName, listStyle, itemClassName, header, footer, empty]);

    if (items.length <= threshold) {
        const CustomScroller = components?.Scroller;
        const CustomList = components?.List;
        const CustomItem = components?.Item;
        const body = items.length === 0
            ? (components?.EmptyPlaceholder ? <components.EmptyPlaceholder /> : empty ?? null)
            : items.map((item, index) => {
                const key = itemKey ? itemKey(item, index) : index;
                const content = renderItem(item, index);
                if (CustomItem) {
                    return <CustomItem key={key} item={item} data-index={index} data-item-index={index} data-known-size={0} className={itemClassName}>{content}</CustomItem>;
                }
                if (itemClassName) {
                    return <div key={key} className={itemClassName}>{content}</div>;
                }
                return <React.Fragment key={key}>{content}</React.Fragment>;
            });

        const wrappedBody = items.length > 0 && (CustomList || listClassName || listStyle)
            ? (CustomList
                ? <CustomList className={listClassName} style={listStyle} data-testid='virtuoso-item-list'>{body}</CustomList>
                : <div className={listClassName} style={listStyle}>{body}</div>)
            : body;

        const headerNode = components?.Header ? <components.Header /> : header;
        const footerNode = components?.Footer ? <components.Footer /> : footer;

        if (CustomScroller) {
            return <CustomScroller id={id} className={className} style={style} role={role} aria-label={ariaLabel} onScroll={onScroll} ref={scrollerRef}>
                {headerNode}
                {wrappedBody}
                {footerNode}
            </CustomScroller>;
        }
        return <div id={id} className={className} style={style} role={role} aria-label={ariaLabel} onScroll={onScroll} ref={scrollerRef}>
            {headerNode}
            {wrappedBody}
            {footerNode}
        </div>;
    }

    // Do not pass explicit `undefined` for Virtuoso stream-backed props (`components`, `computeItemKey`, `scrollerRef`, etc.),
    // because react-virtuoso overwrites internal defaults when those prop keys exist with value `undefined`.
    const optionalProps: Record<string, unknown> = {};
    if (id !== undefined) optionalProps.id = id;
    if (className !== undefined) optionalProps.className = className;
    if (style !== undefined) optionalProps.style = style;
    if (role !== undefined) optionalProps.role = role;
    if (ariaLabel !== undefined) optionalProps['aria-label'] = ariaLabel;
    if (context !== undefined) optionalProps.context = context;
    if (itemKey) optionalProps.computeItemKey = (index: number, item: T) => itemKey(item, index);
    if (overscan !== undefined) optionalProps.overscan = overscan;
    else if (increaseViewportBy === undefined) optionalProps.overscan = DEFAULT_OVERSCAN;
    if (increaseViewportBy !== undefined) optionalProps.increaseViewportBy = increaseViewportBy;
    if (defaultItemHeight !== undefined) optionalProps.defaultItemHeight = defaultItemHeight;
    if (fixedItemHeight !== undefined) optionalProps.fixedItemHeight = fixedItemHeight;
    if (initialItemCount !== undefined) optionalProps.initialItemCount = initialItemCount;
    if (customScrollParent) optionalProps.customScrollParent = customScrollParent;
    if (useWindowScroll !== undefined) optionalProps.useWindowScroll = useWindowScroll;
    if (endReached !== undefined) optionalProps.endReached = endReached;
    if (startReached !== undefined) optionalProps.startReached = startReached;
    if (rangeChanged !== undefined) optionalProps.rangeChanged = rangeChanged;
    if (onScroll !== undefined) optionalProps.onScroll = onScroll;
    if (scrollerRef) {
        optionalProps.scrollerRef = (ref: HTMLElement | Window | null) => scrollerRef(ref instanceof HTMLElement ? ref : null);
    }

    return <Virtuoso<T, Context>
        ref={virtuosoRef}
        data={items}
        itemContent={(index, item) => renderItem(item, index)}
        components={virtuosoComponents}
        {...optionalProps}
    />;
}

/**
 * Virtualized grid backed by `VirtuosoGrid` when `items.length > threshold`.
 * Below the threshold, renders plain grid children so small grids keep natural layout and fast test rendering.
 */
export function VirtualGrid<T, Context = unknown>(props: VirtualGridProps<T, Context>): React.ReactElement {
    const {
        items,
        renderItem,
        itemKey,
        threshold = DEFAULT_VIRTUAL_LIST_THRESHOLD,
        id,
        className,
        listClassName,
        itemClassName,
        style,
        listStyle,
        role,
        'aria-label': ariaLabel,
        context,
        overscan,
        increaseViewportBy,
        initialItemCount,
        customScrollParent,
        useWindowScroll,
        endReached,
        startReached,
        rangeChanged,
        onScroll,
        scrollerRef,
        virtuosoRef,
        header,
        footer,
        empty,
        components
    } = props;

    const gridComponents = React.useMemo<GridComponents<Context>>(() => {
        const CustomList = components?.List;
        const CustomItem = components?.Item;
        const CustomScroller = components?.Scroller;
        const CustomHeader = components?.Header;
        const CustomFooter = components?.Footer;
        if (!CustomList && !CustomItem && !CustomScroller && !CustomHeader && !CustomFooter && !listStyle && header === undefined && footer === undefined) {
            return EMPTY_COMPONENTS as GridComponents<Context>;
        }
        const next: GridComponents<Context> = {};
        if (CustomScroller) next.Scroller = CustomScroller as GridComponents<Context>['Scroller'];
        if (CustomList || listStyle) {
            next.List = React.forwardRef<HTMLDivElement, GridListProps>(function VirtualGridList(listProps, ref) {
                const mergedStyle = listStyle ? { ...listProps.style, ...listStyle } : listProps.style;
                if (CustomList) return <CustomList {...listProps} ref={ref} style={mergedStyle} />;
                return <div {...listProps} ref={ref} style={mergedStyle} />;
            }) as GridComponents<Context>['List'];
        }
        if (CustomItem) next.Item = CustomItem as GridComponents<Context>['Item'];
        if (CustomHeader) next.Header = CustomHeader as GridComponents<Context>['Header'];
        else if (header !== undefined) next.Header = () => <>{header}</>;
        if (CustomFooter) next.Footer = CustomFooter as GridComponents<Context>['Footer'];
        else if (footer !== undefined) next.Footer = () => <>{footer}</>;
        return next;
    }, [components?.List, components?.Item, components?.Scroller, components?.Header, components?.Footer, listStyle, header, footer]);

    if (items.length <= threshold) {
        const CustomScroller = components?.Scroller;
        const CustomList = components?.List;
        const CustomItem = components?.Item;
        const headerNode = components?.Header ? <components.Header /> : header;
        const footerNode = components?.Footer ? <components.Footer /> : footer;
        const renderedItems = items.map((item, index) => {
            const key = itemKey ? itemKey(item, index) : index;
            const child = renderItem(item, index);
            if (CustomItem) return <CustomItem key={key} data-index={index} className={itemClassName || ''}>{child}</CustomItem>;
            if (itemClassName) return <div key={key} className={itemClassName}>{child}</div>;
            return <React.Fragment key={key}>{child}</React.Fragment>;
        });
        const content = items.length === 0
            ? (empty ?? null)
            : (CustomList
                ? <CustomList className={listClassName} style={listStyle} data-testid='virtuoso-item-list'>{renderedItems}</CustomList>
                : <div className={listClassName} style={listStyle}>{renderedItems}</div>);

        if (CustomScroller) {
            return <CustomScroller id={id} className={className} style={style} role={role} aria-label={ariaLabel} onScroll={onScroll} ref={scrollerRef}>
                {headerNode}
                {content}
                {footerNode}
            </CustomScroller>;
        }
        return <div id={id} className={className} style={style} role={role} aria-label={ariaLabel} onScroll={onScroll} ref={scrollerRef}>
            {headerNode}
            {content}
            {footerNode}
        </div>;
    }

    if (items.length === 0 && empty !== undefined) {
        return <div id={id} className={className} style={style} role={role} aria-label={ariaLabel} onScroll={onScroll} ref={scrollerRef}>
            {header}
            {empty}
            {footer}
        </div>;
    }

    const optionalProps: Record<string, unknown> = {};
    if (id !== undefined) optionalProps.id = id;
    if (className !== undefined) optionalProps.className = className;
    if (listClassName !== undefined) optionalProps.listClassName = listClassName;
    if (itemClassName !== undefined) optionalProps.itemClassName = itemClassName;
    if (style !== undefined) optionalProps.style = style;
    if (role !== undefined) optionalProps.role = role;
    if (ariaLabel !== undefined) optionalProps['aria-label'] = ariaLabel;
    if (context !== undefined) optionalProps.context = context;
    if (itemKey) optionalProps.computeItemKey = (index: number, item: T) => itemKey(item, index);
    if (overscan !== undefined) optionalProps.overscan = overscan;
    else if (increaseViewportBy === undefined) optionalProps.overscan = DEFAULT_OVERSCAN;
    if (increaseViewportBy !== undefined) optionalProps.increaseViewportBy = increaseViewportBy;
    if (initialItemCount !== undefined) optionalProps.initialItemCount = initialItemCount;
    if (customScrollParent) optionalProps.customScrollParent = customScrollParent;
    if (useWindowScroll !== undefined) optionalProps.useWindowScroll = useWindowScroll;
    if (endReached !== undefined) optionalProps.endReached = endReached;
    if (startReached !== undefined) optionalProps.startReached = startReached;
    if (rangeChanged !== undefined) optionalProps.rangeChanged = rangeChanged;
    if (onScroll !== undefined) optionalProps.onScroll = onScroll;
    if (scrollerRef !== undefined) optionalProps.scrollerRef = scrollerRef;

    return <VirtuosoGrid<T, Context>
        ref={virtuosoRef}
        data={items}
        itemContent={(index, item) => renderItem(item, index)}
        components={gridComponents}
        {...optionalProps}
    />;
}
