import React, { useState, useRef, useEffect } from 'react';
import { CaretDown } from '@phosphor-icons/react';

interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'onBlur'> {
  onChange?: (event: any) => void;
  // Phần tử nhận focus là <button> chứ không phải <select> nên onBlur gắn vào button.
  onBlur?: React.FocusEventHandler<HTMLButtonElement>;
  className?: string;
}

/** Danh sách từ ngần này mục trở lên mới hiện ô gõ để lọc (danh sách ngắn thì chọn thẳng, đỡ rối). */
const FILTER_MIN_OPTIONS = 7;

/** Chữ thuần của nhãn option (nhãn có thể là mảng như `{tên} ({số})`). */
function textOf(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return textOf(node.props.children);
  return '';
}

/** Bỏ dấu + hạ chữ thường để gõ "chen" vẫn ra "Chén" (cả khi bộ gõ chưa kịp thêm dấu). */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLocaleLowerCase('vi');
}

export function Select({
  children,
  value,
  onChange,
  onBlur,
  className = '',
  disabled,
  id,
  name,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
}: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Chỉ lắng nghe click-outside khi dropdown đang mở để tránh race condition.
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    // Dùng capture=true để bắt trước khi bất kỳ handler nào khác.
    document.addEventListener('mousedown', handleClickOutside, true);
    return () => document.removeEventListener('mousedown', handleClickOutside, true);
  }, [isOpen]);

  // Parse children to get options
  const options: { value: string | number, label: React.ReactNode }[] = [];
  React.Children.forEach(children, child => {
    if (
      React.isValidElement<React.OptionHTMLAttributes<HTMLOptionElement>>(child) &&
      child.type === 'option'
    ) {
      const optionValue = child.props.value
      options.push({
        value:
          typeof optionValue === 'string' || typeof optionValue === 'number'
            ? optionValue
            : optionValue?.join(',') || String(child.props.children ?? ''),
        label: child.props.children
      });
    }
  });

  const selectedOption = options.find(opt => String(opt.value) === String(value)) || options[0];

  const filterable = options.length >= FILTER_MIN_OPTIONS;
  const needle = fold(query.trim());
  // Giữ chỉ số gốc để biết mục nào đang được chọn khi danh sách đã bị lọc.
  const visible = options
    .map((opt) => ({ opt, text: textOf(opt.label) }))
    .filter(({ text }) => !needle || fold(text).includes(needle));

  // Cuộn mục đang tô sáng (bàn phím) vào vùng nhìn thấy.
  useEffect(() => {
    if (!isOpen) return;
    listRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [isOpen, activeIdx, needle]);

  const openList = (seed = '') => {
    if (disabled) return;
    setQuery(seed);
    const idx = options.findIndex((opt) => String(opt.value) === String(value));
    setActiveIdx(seed ? 0 : Math.max(0, idx));
    setIsOpen(true);
  };

  const closeList = (refocus: boolean) => {
    setIsOpen(false);
    setQuery('');
    if (refocus) buttonRef.current?.focus();
  };

  const handleSelect = (val: string | number) => {
    closeList(true);
    if (onChange) {
      onChange({ target: { value: val } } as any);
    }
  };

  const moveActive = (delta: number) => {
    if (visible.length === 0) return;
    setActiveIdx((current) => (Math.min(current, visible.length - 1) + delta + visible.length) % visible.length);
  };

  const handleTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled || isOpen) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openList();
    } else if (filterable && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== ' ') {
      // Gõ chữ ngay trên nút (chưa mở) = mở danh sách và lọc luôn theo chữ đó.
      event.preventDefault();
      openList(event.key);
    }
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveActive(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const picked = visible[Math.min(activeIdx, visible.length - 1)];
      if (picked) handleSelect(picked.opt.value);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation(); // không để Escape đóng luôn hộp thoại chứa combo
      closeList(true);
    }
  };

  // Focus chuyển giữa nút ↔ ô lọc trong cùng combo thì chưa tính là "rời" combo (không báo onBlur, không đóng).
  const leftCombo = (related: EventTarget | null) =>
    !(related instanceof Node && containerRef.current?.contains(related));

  useEffect(() => {
    if (isOpen && filterable) inputRef.current?.focus();
  }, [isOpen, filterable]);

  const containerClass = className.replace(/\b(ds-input|ds-select)\b/g, '').trim();

  return (
    <div className={`ds-custom-select-container ${containerClass}`} ref={containerRef}>
      {/* id/name/aria-* gắn vào button: <label htmlFor> chỉ gắn được với phần tử labelable này. */}
      <button
        ref={buttonRef}
        type="button"
        id={id}
        name={name}
        className={`ds-custom-select-trigger ${disabled ? 'ds-custom-select-trigger--disabled' : ''}`}
        onClick={() => !disabled && (isOpen ? closeList(false) : openList())}
        onKeyDown={handleTriggerKeyDown}
        onBlur={(event) => {
          if (!leftCombo(event.relatedTarget)) return;
          onBlur?.(event);
        }}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
      >
        <span className="ds-custom-select-value">{selectedOption?.label || ''}</span>
        <CaretDown weight="bold" className="ds-custom-select-icon" />
      </button>

      {isOpen && !disabled && (
        <ul
          ref={listRef}
          className="ds-custom-select-dropdown"
          role="listbox"
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
        >
          {filterable ? (
            <li className="ds-custom-select-search" role="presentation">
              <input
                ref={inputRef}
                type="text"
                className="ds-custom-select-search__input"
                value={query}
                placeholder="Gõ để lọc…"
                aria-label="Gõ để lọc danh sách"
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveIdx(0);
                }}
                onKeyDown={handleSearchKeyDown}
                onBlur={(event) => {
                  if (!leftCombo(event.relatedTarget)) return;
                  setIsOpen(false);
                  setQuery('');
                  onBlur?.(event as unknown as React.FocusEvent<HTMLButtonElement>);
                }}
              />
            </li>
          ) : null}
          {visible.length === 0 ? (
            <li className="ds-custom-select-empty" role="presentation">
              Không có kết quả
            </li>
          ) : null}
          {visible.map(({ opt }, idx) => {
            const selected = String(opt.value) === String(value);
            const active = filterable && idx === Math.min(activeIdx, visible.length - 1);
            return (
              <li
                key={`${opt.value}-${idx}`}
                className={`ds-custom-select-option${selected ? ' ds-custom-select-option--selected' : ''}${active ? ' ds-custom-select-option--active' : ''}`}
                role="option"
                aria-selected={selected}
                data-active={active ? 'true' : undefined}
                // onMouseDown đóng dropdown TRƯỚC khi document mousedown-outside handler kịp fire,
                // tránh race condition khiến dropdown không đóng sau khi chọn.
                onMouseDown={(e) => {
                  e.preventDefault(); // ngăn button trigger / ô lọc mất focus
                  handleSelect(opt.value);
                }}
                onMouseMove={() => filterable && setActiveIdx(idx)}
              >
                {opt.label}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
