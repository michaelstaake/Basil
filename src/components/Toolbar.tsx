import {
  FilePlus,
  FolderOpen,
  Save,
  SaveAll,
  Undo2,
  Redo2,
  Search,
  Replace,
  WrapText,
  IndentIncrease,
  Code2,
  GitCompare,
  PanelRight,
  type LucideIcon,
} from 'lucide-react';
import type { ToolbarActionId } from '../../shared/config';

const LABELS: Record<ToolbarActionId, { icon: LucideIcon; title: string; group?: string }> = {
  new: { icon: FilePlus, title: 'New file (Ctrl+N)' },
  open: { icon: FolderOpen, title: 'Open files (Ctrl+O)' },
  save: { icon: Save, title: 'Save (Ctrl+S)' },
  saveAs: { icon: SaveAll, title: 'Save as (Ctrl+Shift+S)' },
  undo: { icon: Undo2, title: 'Undo (Ctrl+Z)', group: 'edit' },
  redo: { icon: Redo2, title: 'Redo (Ctrl+Y)', group: 'edit' },
  find: { icon: Search, title: 'Find (Ctrl+F)', group: 'edit' },
  replace: { icon: Replace, title: 'Find and replace (Ctrl+H)', group: 'edit' },
  wordWrap: { icon: WrapText, title: 'Toggle word wrap', group: 'view' },
  indentGuides: { icon: IndentIncrease, title: 'Toggle indent guides', group: 'view' },
  toggleSyntax: { icon: Code2, title: 'Toggle syntax highlighting', group: 'view' },
  diff: { icon: GitCompare, title: 'Show changes since opened', group: 'view' },
  toggleAi: { icon: PanelRight, title: 'Toggle AI sidebar', group: 'view' },
};

type Props = {
  actions: ToolbarActionId[];
  aiSidebarVisible: boolean;
  wordWrap: boolean;
  indentGuides: boolean;
  syntaxHighlight: boolean;
  diffOpen: boolean;
  canDiff: boolean;
  /** False when no code editor is mounted (diff view or Settings tab). */
  canEdit: boolean;
  onAction: (id: ToolbarActionId) => void;
  onOpenSettings: () => void;
};

export function Toolbar({
  actions,
  aiSidebarVisible,
  wordWrap,
  indentGuides,
  syntaxHighlight,
  diffOpen,
  canDiff,
  canEdit,
  onAction,
  onOpenSettings,
}: Props) {
  let lastGroup: string | undefined;
  const mainActions = actions.filter((id) => id !== 'toggleAi');
  const showAi = actions.includes('toggleAi');

  const activeFor: Partial<Record<ToolbarActionId, boolean>> = {
    wordWrap,
    indentGuides,
    toggleSyntax: syntaxHighlight,
    diff: diffOpen,
  };

  // Editor commands are routed to the Monaco instance, which does not exist
  // while the diff view or Settings tab is showing.
  const disabledFor: Partial<Record<ToolbarActionId, boolean>> = {
    diff: !canDiff && !diffOpen,
    undo: !canEdit,
    redo: !canEdit,
    find: !canEdit,
    replace: !canEdit,
  };

  return (
    <header className="toolbar">
      <button
        type="button"
        className="toolbar-brand"
        title="Basil"
        aria-haspopup="menu"
        onContextMenu={(e) => {
          e.preventDefault();
        }}
        onClick={() => {
          if (window.basil?.showBrandMenu) {
            void window.basil.showBrandMenu();
          } else {
            onOpenSettings();
          }
        }}
      >
        <img src="./basil-mark.svg" alt="" />
        <span>Basil</span>
      </button>
      <div className="toolbar-actions">
        {mainActions.map((id) => {
          const meta = LABELS[id];
          if (!meta) return null;
          const Icon = meta.icon;
          const showSep = meta.group && lastGroup && meta.group !== lastGroup;
          lastGroup = meta.group ?? 'file';
          const active = activeFor[id];
          const disabled = disabledFor[id] ?? false;
          return (
            <span key={id} style={{ display: 'contents' }}>
              {showSep ? <span className="toolbar-sep" /> : null}
              <button
                type="button"
                className={`toolbar-btn${active ? ' active' : ''}`}
                title={
                  id === 'diff' && disabled
                    ? 'No changes since opened'
                    : meta.title
                }
                disabled={disabled}
                onClick={() => onAction(id)}
              >
                <Icon size={16} strokeWidth={2} />
              </button>
            </span>
          );
        })}
        {showAi ? (
          <>
            <span className="toolbar-spacer" />
            <button
              type="button"
              className={`toolbar-btn${aiSidebarVisible ? ' active' : ''}`}
              title={LABELS.toggleAi.title}
              onClick={() => onAction('toggleAi')}
            >
              <PanelRight size={16} strokeWidth={2} />
            </button>
          </>
        ) : null}
      </div>
    </header>
  );
}
