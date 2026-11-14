// Keyboard shortcut names, shown in menus and button hints (Step 7B).
// Keeping them in one place keeps every hint the same.

export const SHORTCUT = {
  cut: 'Ctrl+X',
  copy: 'Ctrl+C',
  paste: 'Ctrl+V',
  duplicate: 'Ctrl+D',
  remove: 'Delete',
  split: 'S',
  group: 'Ctrl+G',
  ungroup: 'Ctrl+Shift+G',
  selectAll: 'Ctrl+A',
  playPause: 'Space',
  bookmark: 'M',
} as const;

/** True while the user is typing, so shortcuts must stay out of the way. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;

  return Boolean(
    element &&
      (element.tagName === 'INPUT' ||
        element.tagName === 'TEXTAREA' ||
        element.tagName === 'SELECT' ||
        element.isContentEditable),
  );
}
