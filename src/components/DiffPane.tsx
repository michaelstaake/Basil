import { DiffEditor } from '@monaco-editor/react';
import { resolveEditorFontFamily, type EditorFontId } from '../../shared/config';
import type { EditorTab } from '../lib/tabs';

type Props = {
  tab: EditorTab;
  dark: boolean;
  wordWrap: boolean;
  fontSize: number;
  fontFamily: EditorFontId;
};

export function DiffPane({ tab, dark, wordWrap, fontSize, fontFamily }: Props) {
  const language = tab.syntaxHighlight ? tab.language : 'plaintext';

  return (
    <div className="editor-pane">
      <DiffEditor
        height="100%"
        theme={dark ? 'vs-dark' : 'light'}
        language={language}
        original={tab.originalContent}
        modified={tab.content}
        options={{
          readOnly: true,
          renderSideBySide: true,
          fontSize,
          fontFamily: resolveEditorFontFamily(fontFamily),
          minimap: { enabled: false },
          smoothScrolling: true,
          padding: { top: 12 },
          automaticLayout: true,
          wordWrap: wordWrap ? 'on' : 'off',
          scrollBeyondLastLine: false,
          originalEditable: false,
        }}
      />
    </div>
  );
}
