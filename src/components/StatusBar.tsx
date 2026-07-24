import { useEffect, useRef, useState } from 'react';
import {
  ENCODINGS,
  encodingLabel,
  type EncodingId,
} from '../../shared/encoding';
import type { LineEnding } from '../../shared/text';

export type { LineEnding };
export { countLines, detectLineEnding, lineEndingFromEol } from '../../shared/text';

export type EditorStatus = {
  line: number;
  column: number;
  eol: LineEnding;
  overwrite: boolean;
};

type Props = {
  length: number;
  lines: number;
  line: number;
  column: number;
  eol: LineEnding;
  encoding: EncodingId;
  overwrite: boolean;
  onEolChange?: (eol: LineEnding) => void;
  onEncodingChange?: (encoding: EncodingId) => void;
};

const EOL_OPTIONS: { id: LineEnding; label: string }[] = [
  { id: 'CRLF', label: 'CRLF (Windows)' },
  { id: 'LF', label: 'LF (Unix)' },
  { id: 'CR', label: 'CR (classic Mac)' },
];

/** Small popup list anchored to a status bar item. */
function StatusMenu<T extends string>({
  label,
  title,
  value,
  options,
  onSelect,
}: {
  label: string;
  title: string;
  value: T;
  options: { id: T; label: string }[];
  onSelect: (id: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (wrapRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="statusbar-menu-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`statusbar-item statusbar-button${open ? ' active' : ''}`}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </button>
      {open ? (
        <div className="statusbar-menu" role="menu">
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              role="menuitemradio"
              aria-checked={option.id === value}
              className={`statusbar-menu-item${option.id === value ? ' active' : ''}`}
              onClick={() => {
                setOpen(false);
                if (option.id !== value) onSelect(option.id);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function StatusBar({
  length,
  lines,
  line,
  column,
  eol,
  encoding,
  overwrite,
  onEolChange,
  onEncodingChange,
}: Props) {
  return (
    <footer className="statusbar" aria-label="File status">
      <span className="statusbar-item" title="Character count">
        Length: {length.toLocaleString()}
      </span>
      <span className="statusbar-item" title="Line count">
        Lines: {lines.toLocaleString()}
      </span>
      <span className="statusbar-item" title="Cursor position">
        Ln {line}, Col {column}
      </span>
      <span className="statusbar-spacer" />
      {onEolChange ? (
        <StatusMenu
          label={eol}
          title="Line ending — click to change"
          value={eol}
          options={EOL_OPTIONS}
          onSelect={onEolChange}
        />
      ) : (
        <span className="statusbar-item" title="Line ending">
          {eol}
        </span>
      )}
      {onEncodingChange ? (
        <StatusMenu
          label={encodingLabel(encoding)}
          title="Character encoding — click to change"
          value={encoding}
          options={ENCODINGS}
          onSelect={onEncodingChange}
        />
      ) : (
        <span className="statusbar-item" title="Character encoding">
          {encodingLabel(encoding)}
        </span>
      )}
      <span className="statusbar-item" title="Insert or overwrite mode">
        {overwrite ? 'OVR' : 'INS'}
      </span>
    </footer>
  );
}
