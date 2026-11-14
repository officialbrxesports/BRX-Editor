import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';

type NumberScrubFieldProps = {
  value: number;
  label: string;
  unit?: string;
  rate?: number;
  min?: number;
  max?: number;
  format?: (value: number) => string;
  disabled?: boolean;
  onChange: (value: number) => void;
  onBeginEdit: () => () => void;
};

function parseValue(text: string, initial: number) {
  const value = text.trim().replace(/°|%|px/gi, '');
  const turns = value.match(/^(-?\d+(?:\.\d+)?)x([+-]\d+(?:\.\d+)?)?$/i);
  if (turns) {
    return Number(turns[1]) * 360 + Number(turns[2] ?? 0);
  }
  const operation = value.match(/^([+\-*/])\s*(-?\d+(?:\.\d+)?)$/);
  if (operation) {
    const operand = Number(operation[2]);
    if (operation[1] === '+') return initial + operand;
    if (operation[1] === '-') return initial - operand;
    if (operation[1] === '*') return initial * operand;
    return operand === 0 ? Number.NaN : initial / operand;
  }
  return Number(value);
}

export default function NumberScrubField({
  value,
  label,
  unit,
  rate = 1,
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY,
  format,
  disabled = false,
  onChange,
  onBeginEdit,
}: NumberScrubFieldProps) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const fieldRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const ignoreBlurRef = useRef(false);
  const dragRef = useRef<{
    pointerId: number;
    element: HTMLElement;
    x: number;
    y: number;
    movedX: number;
    movedY: number;
    value: number;
    moved: boolean;
    cancelEdit: (() => void) | null;
  } | null>(null);
  const callbacksRef = useRef({ onChange, onBeginEdit });
  callbacksRef.current = { onChange, onBeginEdit };

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const clampValue = (next: number) => Math.max(min, Math.min(max, next));

  const commitText = () => {
    const next = clampValue(parseValue(text, value));
    if (!Number.isFinite(next) || next === value) {
      setEditing(false);
      return;
    }
    callbacksRef.current.onBeginEdit();
    callbacksRef.current.onChange(next);
    setEditing(false);
  };

  const startDrag = (event: PointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0 || editing || disabled) return;
    event.preventDefault();
    const element = fieldRef.current;
    if (!element) return;
    element.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      element,
      x: event.clientX,
      y: event.clientY,
      movedX: 0,
      movedY: 0,
      value,
      moved: false,
      cancelEdit: null,
    };
    const onMove = (nativeEvent: globalThis.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || nativeEvent.pointerId !== drag.pointerId) return;
      const pointerLocked = document.pointerLockElement === drag.element;
      if (pointerLocked) {
        drag.movedX += nativeEvent.movementX;
        drag.movedY += nativeEvent.movementY;
      } else {
        drag.movedX = nativeEvent.clientX - drag.x;
        drag.movedY = nativeEvent.clientY - drag.y;
      }
      const magnitude = Math.abs(drag.movedX) >= Math.abs(drag.movedY)
        ? drag.movedX
        : -drag.movedY;
      const distance = Math.max(Math.abs(drag.movedX), Math.abs(drag.movedY));
      if (distance < 3) return;
      drag.moved = true;
      if (!drag.cancelEdit) drag.cancelEdit = callbacksRef.current.onBeginEdit();
      const modifier = nativeEvent.shiftKey ? 10 : nativeEvent.ctrlKey || nativeEvent.metaKey ? 0.1 : 1;
      const next = clampValue(drag.value + Math.round(magnitude) * rate * modifier);
      callbacksRef.current.onChange(next);
    };
    const finish = (nativeEvent: globalThis.PointerEvent, cancel: boolean) => {
      const drag = dragRef.current;
      if (!drag || nativeEvent.pointerId !== drag.pointerId) return;
      if (cancel && drag.moved) {
        drag.cancelEdit?.();
      } else if (!drag.moved && !cancel) {
        setText(String(drag.value));
        setEditing(true);
      }
      if (drag.element.hasPointerCapture(drag.pointerId)) {
        drag.element.releasePointerCapture(drag.pointerId);
      }
      if (document.pointerLockElement === drag.element) document.exitPointerLock();
      dragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKeyDown);
    };
    const onUp = (nativeEvent: globalThis.PointerEvent) => finish(nativeEvent, false);
    const onCancel = (nativeEvent: globalThis.PointerEvent) => finish(nativeEvent, true);
    const onKeyDown = (nativeEvent: globalThis.KeyboardEvent) => {
      if (nativeEvent.key === 'Escape' && dragRef.current?.moved) {
        nativeEvent.preventDefault();
        const drag = dragRef.current;
        if (!drag) return;
        drag.cancelEdit?.();
        if (drag.element.hasPointerCapture(drag.pointerId)) {
          drag.element.releasePointerCapture(drag.pointerId);
        }
        dragRef.current = null;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('keydown', onKeyDown);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKeyDown);
    if ('requestPointerLock' in element) {
      const result = element.requestPointerLock();
      if (result instanceof Promise) void result.catch(() => undefined);
    }
  };

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitText();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      ignoreBlurRef.current = true;
      setEditing(false);
    } else if (event.key === 'Tab') {
      event.preventDefault();
      commitText();
      const fields = Array.from(document.querySelectorAll<HTMLElement>('[data-scrub-field]'));
      const index = fields.indexOf(fieldRef.current!);
      fields[index + (event.shiftKey ? -1 : 1)]?.focus();
    }
  };

  return (
    <span
      ref={fieldRef}
      className={`number-scrub-field ${editing ? 'is-editing' : ''} ${disabled ? 'is-disabled' : ''}`}
      data-scrub-field
      tabIndex={editing || disabled ? -1 : 0}
      aria-label={label}
      aria-disabled={disabled}
      onPointerDown={startDrag}
      onDoubleClick={() => {
        if (disabled) return;
        setText(String(value));
        setEditing(true);
      }}
    >
      {editing ? (
        <input
          ref={inputRef}
          aria-label={`Edit ${label}`}
          disabled={disabled}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleEditorKeyDown}
          onBlur={() => {
            if (ignoreBlurRef.current) {
              ignoreBlurRef.current = false;
              return;
            }
            commitText();
          }}
          onDoubleClick={(event) => event.currentTarget.select()}
        />
      ) : (
        <>
          {format ? format(value) : Number(value.toFixed(1))}
          {unit && <span className="number-scrub-unit">{unit}</span>}
        </>
      )}
    </span>
  );
}
