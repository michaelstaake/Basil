import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === 'json') return new jsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    return new editorWorker();
  },
};

loader.config({ monaco });

/**
 * Dispose the model behind a closed tab.
 *
 * `@monaco-editor/react` is used with `keepCurrentModel`, so models (and their
 * undo stacks) outlive the component and are keyed by the same value passed as
 * `path`. Without this, every file ever opened stays in memory for the life of
 * the window.
 */
export function disposeModelFor(pathOrId: string): void {
  // @monaco-editor/react resolves models with `monaco.Uri.parse(path)` on the
  // exact string given as its `path` prop, so the same string must be used here.
  monaco.editor.getModel(monaco.Uri.parse(pathOrId))?.dispose();
}

export { monaco };
