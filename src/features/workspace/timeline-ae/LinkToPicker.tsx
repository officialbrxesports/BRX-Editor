import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type { EditorLayerProperties } from '../../project/project.types';

import './LinkToPicker.css';

// "Link To" picker: None, then every layer in strip order with a thumbnail.
// The layer itself is listed as "Self" (= no link). The layer's own
// descendants are hidden, so a link can never create a cycle.

type LinkToPickerProps = {
  layer: EditorLayerProperties;
  layers: EditorLayerProperties[];
  thumbnails: Record<string, string>;
  sourceNames: Record<string, string>;
  disabled?: boolean;
  wouldCreateCycle: (childId: string, parentId: string) => boolean;
  onChange: (parentId: string | null) => void;
};

type PickerOption = {
  key: string;
  parentId: string | null;
  label: string;
  thumbnail?: string;
  initial: string;
  selected: boolean;
};

const POPUP_WIDTH = 230;
const ROW_HEIGHT = 32;
const POPUP_MAX_HEIGHT = 288;

function getLayerLabel(
  layer: EditorLayerProperties,
  sourceNames: Record<string, string>,
): string {
  return layer.name || (layer.sourceId ? sourceNames[layer.sourceId] : '') || layer.type;
}

export default function LinkToPicker({
  layer,
  layers,
  thumbnails,
  sourceNames,
  disabled = false,
  wouldCreateCycle,
  onChange,
}: LinkToPickerProps) {
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const linked = layer.parentId
    ? layers.find((item) => item.id === layer.parentId)
    : undefined;

  const options: PickerOption[] = [
    {
      key: 'none',
      parentId: null,
      label: 'None',
      initial: '–',
      selected: !linked,
    },
  ];

  layers.forEach((item, index) => {
    if (item.id === layer.id) {
      // "Self" means no link.
      options.push({
        key: item.id,
        parentId: null,
        label: 'Self',
        thumbnail: item.sourceId ? thumbnails[item.sourceId] : undefined,
        initial: String(index + 1),
        selected: false,
      });
      return;
    }

    // Hide the layer's own descendants.
    if (wouldCreateCycle(layer.id, item.id)) {
      return;
    }

    options.push({
      key: item.id,
      parentId: item.id,
      label: `${index + 1}. ${getLayerLabel(item, sourceNames)}`,
      thumbnail: item.sourceId ? thumbnails[item.sourceId] : undefined,
      initial: String(index + 1),
      selected: item.id === layer.parentId,
    });
  });

  const isOpen = position !== null;

  const close = () => {
    setPosition(null);
    triggerRef.current?.focus();
  };

  const choose = (option: PickerOption) => {
    onChange(option.parentId);
    setPosition(null);
  };

  const open = () => {
    const trigger = triggerRef.current;

    if (!trigger || disabled) {
      return;
    }

    const rect = trigger.getBoundingClientRect();
    const height = Math.min(POPUP_MAX_HEIGHT, options.length * ROW_HEIGHT + 2);
    const left = Math.max(
      4,
      Math.min(rect.left, window.innerWidth - POPUP_WIDTH - 4),
    );
    const below = rect.bottom + 2;
    const top =
      below + height > window.innerHeight - 4
        ? Math.max(4, rect.top - height - 2)
        : below;

    setActiveIndex(Math.max(0, options.findIndex((option) => option.selected)));
    setPosition({ left, top });
  };

  // Close on outside click or scroll.
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const onPointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target as Node;

      if (
        popupRef.current?.contains(target) ||
        triggerRef.current?.contains(target)
      ) {
        return;
      }

      setPosition(null);
    };

    const onScroll = (event: Event) => {
      if (!popupRef.current?.contains(event.target as Node)) {
        setPosition(null);
      }
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('scroll', onScroll, true);

    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [isOpen]);

  // Keep keyboard focus inside the list while it is open.
  useEffect(() => {
    if (isOpen) {
      popupRef.current?.focus();
    }
  }, [isOpen]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => Math.min(options.length - 1, index + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = options[activeIndex];

      if (option) {
        choose(option);
      }
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="link-picker-trigger"
        aria-label={`Link To for ${layer.name}`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        title="Link To: this layer follows the chosen layer's position, scale and rotation"
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          if (isOpen) {
            setPosition(null);
          } else {
            open();
          }
        }}
      >
        <span className="link-picker-trigger-text">
          {linked ? getLayerLabel(linked, sourceNames) : 'None'}
        </span>
      </button>

      {position &&
        createPortal(
          <div
            ref={popupRef}
            className="link-picker-popup"
            role="listbox"
            tabIndex={-1}
            aria-label="Link To"
            style={{
              left: position.left,
              top: position.top,
              width: POPUP_WIDTH,
              maxHeight: POPUP_MAX_HEIGHT,
            }}
            onKeyDown={handleKeyDown}
            onClick={(event) => event.stopPropagation()}
          >
            {options.map((option, index) => (
              <div
                key={option.key + (option.label === 'Self' ? '-self' : '')}
                role="option"
                aria-selected={option.selected}
                className={
                  'link-picker-row' +
                  (index === activeIndex ? ' is-active' : '') +
                  (option.selected ? ' is-selected' : '')
                }
                onPointerEnter={() => setActiveIndex(index)}
                onClick={() => choose(option)}
              >
                <span
                  className="link-picker-thumb"
                  style={
                    option.thumbnail
                      ? { backgroundImage: `url("${option.thumbnail}")` }
                      : undefined
                  }
                >
                  {option.thumbnail ? '' : option.initial}
                </span>
                <span className="link-picker-label">{option.label}</span>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
