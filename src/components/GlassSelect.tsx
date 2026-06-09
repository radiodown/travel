import { useEffect, useRef, useState } from 'react';

type Props = {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  ariaLabel?: string;
};

export default function GlassSelect({ value, options, onChange, ariaLabel }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) return;

    const handlePointer = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  // Scroll the selected option into view when the menu opens
  useEffect(() => {
    if (!open || !listRef.current) return;
    const active = listRef.current.querySelector<HTMLElement>('[data-active="true"]');
    active?.scrollIntoView({ block: 'center' });
  }, [open]);

  return (
    <div className="glass-select" ref={rootRef}>
      <button
        type="button"
        className={`glass-select-trigger${open ? ' open' : ''}`}
        onClick={() => setOpen((prev) => !prev)}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{value}</span>
        <span className="glass-select-caret">⌄</span>
      </button>

      {open && (
        <ul className="glass-select-menu" ref={listRef} role="listbox">
          {options.map((option) => {
            const active = option === value;
            return (
              <li
                key={option}
                role="option"
                aria-selected={active}
                data-active={active}
                className={`glass-select-option${active ? ' active' : ''}`}
                onClick={() => {
                  onChange(option);
                  setOpen(false);
                }}
              >
                {option}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
