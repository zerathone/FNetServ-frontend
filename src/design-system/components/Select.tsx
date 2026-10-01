import React, { useState, useRef, useEffect } from 'react';
import { CaretDown } from '@phosphor-icons/react';

interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'onBlur'> {
  onChange?: (event: any) => void;
  // Phần tử nhận focus là <button> chứ không phải <select> nên onBlur gắn vào button.
  onBlur?: React.FocusEventHandler<HTMLButtonElement>;
  className?: string;
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
  const containerRef = useRef<HTMLDivElement>(null);

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

  const handleSelect = (val: string | number) => {
    setIsOpen(false);
    if (onChange) {
      onChange({ target: { value: val } } as any);
    }
  };

  const containerClass = className.replace(/\b(ds-input|ds-select)\b/g, '').trim();

  return (
    <div className={`ds-custom-select-container ${containerClass}`} ref={containerRef}>
      {/* id/name/aria-* gắn vào button: <label htmlFor> chỉ gắn được với phần tử labelable này. */}
      <button
        type="button"
        id={id}
        name={name}
        className={`ds-custom-select-trigger ${disabled ? 'ds-custom-select-trigger--disabled' : ''}`}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        onBlur={onBlur}
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
          className="ds-custom-select-dropdown"
          role="listbox"
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
        >
          {options.map((opt, idx) => (
            <li
              key={idx}
              className={`ds-custom-select-option ${String(opt.value) === String(value) ? 'ds-custom-select-option--selected' : ''}`}
              role="option"
              aria-selected={String(opt.value) === String(value)}
              // onMouseDown đóng dropdown TRƯỚC khi document mousedown-outside handler kịp fire,
              // tránh race condition khiến dropdown không đóng sau khi chọn.
              onMouseDown={(e) => {
                e.preventDefault(); // ngăn button trigger mất focus
                handleSelect(opt.value);
              }}
            >
              {opt.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
