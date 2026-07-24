import { useEffect, useRef, useState } from 'react';
import Editor, { useMonaco } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { KeyCode } from 'monaco-editor';
import { resolveEditorFontFamily, type EditorFontId } from '../../shared/config';
import type { EditorTab } from '../lib/tabs';
import {
  lineEndingFromEol,
  type EditorStatus,
} from './StatusBar';

type Props = {
  tab: EditorTab | null;
  dark: boolean;
  wordWrap: boolean;
  indentGuides: boolean;
  highlightCurrentLine: boolean;
  stickyScroll: boolean;
  fontSize: number;
  fontFamily: EditorFontId;
  trackStatus?: boolean;
  onChange: (content: string) => void;
  onEditorMount: (ed: editor.IStandaloneCodeEditor | null) => void;
  onStatusChange?: (status: EditorStatus) => void;
};

export function EditorPane({
  tab,
  dark,
  wordWrap,
  indentGuides,
  highlightCurrentLine,
  stickyScroll,
  fontSize,
  fontFamily,
  trackStatus = false,
  onChange,
  onEditorMount,
  onStatusChange,
}: Props) {
  const monaco = useMonaco();
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const overwriteRef = useRef(false);
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;
  const [mountedEditor, setMountedEditor] = useState<editor.IStandaloneCodeEditor | null>(
    null,
  );

  const language = tab
    ? tab.syntaxHighlight
      ? tab.language
      : 'plaintext'
    : 'plaintext';

  const onEditorMountRef = useRef(onEditorMount);
  onEditorMountRef.current = onEditorMount;

  // Hand the editor back on unmount so callers stop issuing commands (undo,
  // find, …) against an instance Monaco has already disposed — which happens
  // whenever the diff view or the Settings tab replaces this pane.
  useEffect(() => {
    return () => {
      editorRef.current = null;
      onEditorMountRef.current(null);
    };
  }, []);

  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (!monaco || !model) return;
    monaco.editor.setModelLanguage(model, language);
  }, [monaco, language]);

  useEffect(() => {
    const ed = mountedEditor;
    if (!ed || !trackStatus) return;

    const publish = () => {
      const model = ed.getModel();
      const pos = ed.getPosition();
      if (!model || !pos) return;
      onStatusChangeRef.current?.({
        line: pos.lineNumber,
        column: pos.column,
        eol: lineEndingFromEol(model.getEOL()),
        overwrite: overwriteRef.current,
      });
    };

    publish();

    const disposables = [
      ed.onDidChangeCursorPosition(publish),
      ed.onDidChangeModel(publish),
      ed.onDidChangeModelContent(publish),
      ed.onKeyDown((e) => {
        if (e.keyCode === KeyCode.Insert) {
          overwriteRef.current = !overwriteRef.current;
          ed.updateOptions({
            cursorStyle: overwriteRef.current ? 'block' : 'line',
          });
          publish();
          return;
        }

        if (!overwriteRef.current) return;
        if (e.ctrlKey || e.altKey) return;
        const ch = e.browserEvent.key;
        if (ch.length !== 1) return;

        const model = ed.getModel();
        const pos = ed.getPosition();
        if (!model || !pos) return;
        // At end of line, fall through to normal insert.
        if (pos.column >= model.getLineMaxColumn(pos.lineNumber)) return;

        e.preventDefault();
        e.stopPropagation();
        ed.executeEdits('basil-overtype', [
          {
            range: {
              startLineNumber: pos.lineNumber,
              startColumn: pos.column,
              endLineNumber: pos.lineNumber,
              endColumn: pos.column + 1,
            },
            text: ch,
          },
        ]);
        ed.setPosition({ lineNumber: pos.lineNumber, column: pos.column + 1 });
      }),
    ];

    return () => {
      for (const d of disposables) d.dispose();
      overwriteRef.current = false;
      ed.updateOptions({ cursorStyle: 'line' });
    };
  }, [mountedEditor, trackStatus, tab?.id]);

  // The tab's content can be replaced from outside the editor (the file was
  // reopened after changing on disk). `defaultValue` only applies when a model is
  // first created, so the editor would otherwise keep showing stale text.
  //
  // Keyed on `revision`, which only changes for external replacements — keying on
  // `content` would race with fast typing and revert characters, because content
  // also flows *out* of the editor via onChange.
  const revision = tab?.revision ?? 0;
  useEffect(() => {
    const ed = mountedEditor;
    const model = ed?.getModel();
    if (!ed || !model || !tab) return;
    if (tab.content === model.getValue()) return;
    const position = ed.getPosition();
    // pushEditOperations keeps the change undoable instead of wiping history.
    model.pushEditOperations(
      [],
      [{ range: model.getFullModelRange(), text: tab.content }],
      () => null,
    );
    if (position) ed.setPosition(position);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mountedEditor, tab?.id, revision]);

  if (!tab) {
    return <div className="empty-editor">Open a file or create a new one to start writing.</div>;
  }

  return (
    <div className="editor-pane">
      <Editor
        height="100%"
        theme={dark ? 'vs-dark' : 'light'}
        language={language}
        path={tab.path ?? tab.id}
        defaultValue={tab.content}
        keepCurrentModel
        onChange={(value) => onChange(value ?? '')}
        onMount={(ed) => {
          editorRef.current = ed;
          overwriteRef.current = false;
          ed.updateOptions({ cursorStyle: 'line' });
          setMountedEditor(ed);
          onEditorMount(ed);
        }}
        options={{
          fontSize,
          fontFamily: resolveEditorFontFamily(fontFamily),
          minimap: { enabled: false },
          smoothScrolling: true,
          cursorBlinking: 'smooth',
          padding: { top: 12 },
          automaticLayout: true,
          wordWrap: wordWrap ? 'on' : 'off',
          guides: { indentation: indentGuides },
          renderLineHighlight: highlightCurrentLine ? 'line' : 'none',
          stickyScroll: { enabled: stickyScroll },
          scrollBeyondLastLine: false,
          dropIntoEditor: { enabled: false },
        }}
      />
    </div>
  );
}
