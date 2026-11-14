import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import './ContextMenu.css';

// Shared right-click menu (Step 7B, Part 5A).
// Opens at the pointer, stays inside the window, supports submenus (hover or
// arrow keys), keyboard control (Up, Down, Enter, Left, Right, Escape) and
// closes on outside click, scroll or Escape.

export type ContextMenuItem =
  | { type: 'separator'; id?: string }
  | {
      type?: 'item';
      id: string;
      label: string;
      shortcut?: string;
      icon?: React.ReactNode;
      disabled?: boolean;
      checked?: boolean;
      onSelect?: () => void;
      children?: ContextMenuItem[];
    };

type ContextMenuProps = {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
};

type Level = {
  items: ContextMenuItem[];
  anchor: { x: number; y: number; rect?: DOMRect };
  active: number;
};

function isSelectable(item: ContextMenuItem | undefined): boolean {
  return Boolean(item && item.type !== 'separator' && !item.disabled);
}

// Next selectable row from `from`, wrapping around.
function stepIndex(items: ContextMenuItem[], from: number, direction: 1 | -1): number {
  const count = items.length;

  for (let step = 1; step <= count; step += 1) {
    const index = (((from + direction * step) % count) + count) % count;

    if (isSelectable(items[index])) {
      return index;
    }
  }

  return from;
}

type PanelProps = {
  level: Level;
  depth: number;
  onHover: (depth: number, index: number, element: HTMLElement) => void;
  onActivate: (depth: number, index: number, element: HTMLElement) => void;
};

function Panel({ level, depth, onHover, onActivate }: PanelProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Place the panel and keep it inside the window.
  useLayoutEffect(() => {
    const element = ref.current;

    if (!element) {
      return;
    }

    const { width, height } = element.getBoundingClientRect();
    const rect = level.anchor.rect;
    let left = level.anchor.x;
    let top = level.anchor.y;

    if (rect) {
      left = rect.right - 2;

      if (left + width > window.innerWidth - 4) {
        left = rect.left - width + 2;
      }

      top = rect.top - 4;
    }

    element.style.left = `${Math.max(4, Math.min(left, window.innerWidth - width - 4))}px`;
    element.style.top = `${Math.max(4, Math.min(top, window.innerHeight - height - 4))}px`;
  }, [level.anchor, level.items]);

  return (
    <div
      ref={ref}
      className="cm-panel"
      role="menu"
      data-depth={depth}
      style={{ left: level.anchor.x, top: level.anchor.y }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {level.items.map((item, index) => {
        if (item.type === 'separator') {
          return <div key={`separator-${index}`} className="cm-separator" role="separator" />;
        }

        return (
          <div
            key={item.id}
            role="menuitem"
            aria-disabled={item.disabled ? true : undefined}
            aria-haspopup={item.children ? 'menu' : undefined}
            data-index={index}
            className={
              'cm-item' +
              (index === level.active ? ' is-active' : '') +
              (item.disabled ? ' is-disabled' : '')
            }
            onPointerEnter={(event) => onHover(depth, index, event.currentTarget)}
            onClick={(event) => {
              event.stopPropagation();

              if (!item.disabled) {
                onActivate(depth, index, event.currentTarget);
              }
            }}
          >
            <span className="cm-icon">{item.icon}</span>
            <span className="cm-label">
              {item.checked ? '✓ ' : ''}
              {item.label}
            </span>
            {item.shortcut && <span className="cm-shortcut">{item.shortcut}</span>}
            {item.children && <span className="cm-arrow">›</span>}
          </div>
        );
      })}
    </div>
  );
}

export default function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const [stack, setStack] = useState<Level[]>([
    { items, anchor: { x, y }, active: -1 },
  ]);
  const rootRef = useRef<HTMLDivElement>(null);

  // Keyboard focus lives in the menu while it is open.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;

    rootRef.current?.focus();

    return () => {
      previous?.focus?.();
    };
  }, []);

  // Close on outside click, scroll, resize or when the window loses focus.
  useEffect(() => {
    const insideMenu = (target: EventTarget | null) =>
      Boolean((target as Element | null)?.closest?.('.cm-panel'));

    const onPointerDown = (event: PointerEvent) => {
      if (!insideMenu(event.target)) onClose();
    };

    const onScroll = (event: Event) => {
      if (!insideMenu(event.target)) onClose();
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);

    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  // Marks a row active and opens its submenu (if it has one).
  const openRow = (depth: number, index: number, element: HTMLElement, focusFirst: boolean) => {
    setStack((previous) => {
      const item = previous[depth]?.items[index];
      const kept = previous
        .slice(0, depth + 1)
        .map((level, levelIndex) => (levelIndex === depth ? { ...level, active: index } : level));

      if (item && item.type !== 'separator' && !item.disabled && item.children?.length) {
        const first = focusFirst ? stepIndex(item.children, -1, 1) : -1;

        return [
          ...kept,
          {
            items: item.children,
            anchor: { x: 0, y: 0, rect: element.getBoundingClientRect() },
            active: first,
          },
        ];
      }

      return kept;
    });
  };

  const activateRow = (depth: number, index: number, element: HTMLElement, viaKeyboard: boolean) => {
    const item = stack[depth]?.items[index];

    if (!item || item.type === 'separator' || item.disabled) {
      return;
    }

    if (item.children?.length) {
      openRow(depth, index, element, viaKeyboard);
      return;
    }

    onClose();
    item.onSelect?.();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const depth = stack.length - 1;
    const level = stack[depth];

    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
    };

    const currentElement = (): HTMLElement | null =>
      rootRef.current?.querySelector<HTMLElement>(
        `.cm-panel[data-depth="${depth}"] .cm-item[data-index="${level.active}"]`,
      ) ?? null;

    const setActive = (index: number) =>
      setStack((previous) =>
        previous.map((item, itemIndex) =>
          itemIndex === depth ? { ...item, active: index } : item,
        ),
      );

    if (event.key === 'Escape') {
      handled();
      onClose();
    } else if (event.key === 'ArrowDown') {
      handled();
      setActive(stepIndex(level.items, level.active, 1));
    } else if (event.key === 'ArrowUp') {
      handled();
      setActive(stepIndex(level.items, level.active === -1 ? 0 : level.active, -1));
    } else if (event.key === 'Home') {
      handled();
      setActive(stepIndex(level.items, -1, 1));
    } else if (event.key === 'End') {
      handled();
      setActive(stepIndex(level.items, 0, -1));
    } else if (event.key === 'ArrowRight') {
      const item = level.items[level.active];
      const element = currentElement();

      if (item && item.type !== 'separator' && item.children?.length && element) {
        handled();
        openRow(depth, level.active, element, true);
      }
    } else if (event.key === 'ArrowLeft') {
      if (depth > 0) {
        handled();
        setStack((previous) => previous.slice(0, -1));
      }
    } else if (event.key === 'Enter' || event.key === ' ') {
      handled();
      const element = currentElement();

      if (element) {
        activateRow(depth, level.active, element, true);
      }
    }
  };

  return createPortal(
    <div ref={rootRef} className="cm-root" tabIndex={-1} onKeyDown={handleKeyDown}>
      {stack.map((level, depth) => (
        <Panel
          key={depth}
          level={level}
          depth={depth}
          onHover={(levelDepth, index, element) => openRow(levelDepth, index, element, false)}
          onActivate={(levelDepth, index, element) => activateRow(levelDepth, index, element, false)}
        />
      ))}
    </div>,
    document.body,
  );
}
