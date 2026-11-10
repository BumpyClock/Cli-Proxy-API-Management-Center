import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { IconChevronDown } from './icons';
import { resolveDropdownStyle } from './dropdownPosition';
import {
  borderWidth,
  fontSize,
  fontWeight,
  iconSize,
  opacity,
  px,
  shadow,
  size,
  space,
} from '@/design-system';

interface AutocompleteInputProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  options: string[] | { value: string; label?: string }[];
  placeholder?: string;
  disabled?: boolean;
  hint?: string;
  error?: string;
  className?: string;
  wrapperClassName?: string;
  wrapperStyle?: React.CSSProperties;
  id?: string;
  /** Ids of helper or validation text that describes the field. */
  ariaDescribedBy?: string;
  rightElement?: ReactNode;
}

export function AutocompleteInput({
  label,
  value,
  onChange,
  options,
  placeholder,
  disabled,
  hint,
  error,
  className = '',
  wrapperClassName = '',
  wrapperStyle,
  id,
  ariaDescribedBy,
  rightElement,
}: AutocompleteInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputWrapRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties | null>(null);
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const listboxId = `${inputId}-listbox`;

  const normalizedOptions = options.map((opt) =>
    typeof opt === 'string'
      ? { value: opt, label: opt }
      : { value: opt.value, label: opt.label || opt.value }
  );

  const filteredOptions = normalizedOptions.filter((opt) => {
    const v = value.toLowerCase();
    return (
      opt.value.toLowerCase().includes(v) || (opt.label && opt.label.toLowerCase().includes(v))
    );
  });

  const showDropdown = isOpen && filteredOptions.length > 0 && !disabled;

  useLayoutEffect(() => {
    if (!showDropdown || !inputWrapRef.current) return;
    const position = () => {
      if (!inputWrapRef.current) return;
      setDropdownStyle(
        resolveDropdownStyle(
          inputWrapRef.current.getBoundingClientRect(),
          window.innerWidth,
          window.innerHeight,
          size['200']
        )
      );
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(inputWrapRef.current);
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && dropdownRef.current?.contains(event.target)) return;
      position();
    };
    window.addEventListener('resize', position);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [showDropdown]);

  useEffect(() => {
    if (!showDropdown || highlightedIndex < 0) return;
    document
      .getElementById(`${listboxId}-${highlightedIndex}`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [showDropdown, highlightedIndex, listboxId]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (containerRef.current?.contains(target) || dropdownRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
    setIsOpen(true);
    setHighlightedIndex(-1);
  };

  const handleSelect = (selectedValue: string) => {
    onChange(selectedValue);
    setIsOpen(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        return;
      }
      setHighlightedIndex((prev) => (prev < filteredOptions.length - 1 ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : 0));
    } else if (e.key === 'Enter') {
      if (isOpen && highlightedIndex >= 0 && highlightedIndex < filteredOptions.length) {
        e.preventDefault();
        handleSelect(filteredOptions[highlightedIndex].value);
      } else if (isOpen) {
        e.preventDefault();
        setIsOpen(false);
      }
    } else if (e.key === 'Escape' && showDropdown) {
      e.preventDefault();
      e.stopPropagation();
      setIsOpen(false);
    } else if (e.key === 'Tab') {
      setIsOpen(false);
    }
  };

  return (
    <div className={`form-group ${wrapperClassName}`} ref={containerRef} style={wrapperStyle}>
      {label && <label htmlFor={inputId}>{label}</label>}
      <div style={{ position: 'relative' }} ref={inputWrapRef}>
        <input
          id={inputId}
          className={`input ${className}`.trim()}
          value={value}
          onChange={handleInputChange}
          onFocus={() => setIsOpen(true)}
          onBlur={(event) => {
            if (
              !containerRef.current?.contains(event.relatedTarget) &&
              !dropdownRef.current?.contains(event.relatedTarget)
            )
              setIsOpen(false);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          aria-describedby={ariaDescribedBy}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showDropdown}
          aria-controls={showDropdown ? listboxId : undefined}
          aria-activedescendant={
            showDropdown && highlightedIndex >= 0 ? `${listboxId}-${highlightedIndex}` : undefined
          }
          autoComplete="off"
          style={{ paddingRight: space['32'] }}
        />
        <div
          style={{
            position: 'absolute',
            right: space['8'],
            top: '50%',
            transform: 'translateY(-50%)',
            display: 'flex',
            alignItems: 'center',
            pointerEvents: disabled ? 'none' : 'auto',
            cursor: 'pointer',
            height: '100%',
          }}
          onClick={() => !disabled && setIsOpen(!isOpen)}
        >
          {rightElement}
          <IconChevronDown
            size={iconSize['16']}
            style={{ opacity: opacity['0-5'], marginLeft: space['4'] }}
          />
        </div>

        {showDropdown &&
          dropdownStyle &&
          typeof document !== 'undefined' &&
          createPortal(
            <div
              ref={dropdownRef}
              id={listboxId}
              role="listbox"
              aria-label={label}
              className="autocomplete-dropdown"
              style={{
                ...dropdownStyle,
                backgroundColor: 'var(--bg-secondary)',
                border: `${px(borderWidth['1'])} solid var(--border-color)`,
                borderRadius: 'var(--radius-md)',
                overflowY: 'auto',
                boxShadow: shadow['autocomplete-menu'],
              }}
            >
              {filteredOptions.map((opt, index) => (
                <div
                  key={`${opt.value}-${index}`}
                  id={`${listboxId}-${index}`}
                  role="option"
                  aria-selected={opt.value === value}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => handleSelect(opt.value)}
                  style={{
                    padding: `${px(space['8'])} ${px(space['12'])}`,
                    cursor: 'pointer',
                    backgroundColor:
                      index === highlightedIndex ? 'var(--bg-tertiary)' : 'transparent',
                    color: 'var(--text-primary)',
                    display: 'flex',
                    flexDirection: 'column',
                    fontSize: fontSize['0-9rem'],
                  }}
                  onMouseEnter={() => setHighlightedIndex(index)}
                >
                  <span style={{ fontWeight: fontWeight['500'] }}>{opt.value}</span>
                  {opt.label && opt.label !== opt.value && (
                    <span style={{ fontSize: fontSize['0-85em'], color: 'var(--text-secondary)' }}>
                      {opt.label}
                    </span>
                  )}
                </div>
              ))}
            </div>,
            document.body
          )}
      </div>
      {hint && <div className="hint">{hint}</div>}
      {error && <div className="error-box">{error}</div>}
    </div>
  );
}
