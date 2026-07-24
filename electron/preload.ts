import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { AiConfig, Preferences, ThemeEffective } from '../shared/config';
import type {
  AppCommand,
  BasilApi,
  ChatPayload,
  ConfirmOptions,
  OpenFilesResult,
  SaveFileResult,
  SessionState,
  TransferableTab,
} from '../shared/api';

const basilApi: BasilApi = {
  getPreferences: () => ipcRenderer.invoke('prefs:get'),
  setPreferences: (prefs: Preferences) => ipcRenderer.invoke('prefs:set', prefs),

  getAiConfig: () => ipcRenderer.invoke('ai:getConfig'),
  setAiConfig: (config: AiConfig) => ipcRenderer.invoke('ai:setConfig', config),
  checkAi: () => ipcRenderer.invoke('ai:check'),

  getTheme: () => ipcRenderer.invoke('theme:getEffective'),
  onThemeUpdated: (cb: (theme: ThemeEffective) => void) => {
    const listener = (_event: unknown, theme: ThemeEffective) => cb(theme);
    ipcRenderer.on('theme:updated', listener);
    return () => ipcRenderer.removeListener('theme:updated', listener);
  },

  onAppCommand: (cb: (command: AppCommand) => void) => {
    const listener = (_event: unknown, command: AppCommand) => cb(command);
    ipcRenderer.on('app:command', listener);
    return () => ipcRenderer.removeListener('app:command', listener);
  },

  onCloseRequest: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on('app:close-request', listener);
    return () => ipcRenderer.removeListener('app:close-request', listener);
  },
  ackCloseRequest: () => ipcRenderer.invoke('app:ack-close'),
  respondCloseRequest: (allow: boolean) =>
    ipcRenderer.invoke('app:respond-close', allow),

  getSession: () => ipcRenderer.invoke('session:get'),
  setSession: (session: SessionState) => ipcRenderer.invoke('session:set', session),

  getStartupFiles: (): Promise<OpenFilesResult> =>
    ipcRenderer.invoke('files:getStartup'),
  onOpenFiles: (cb: (result: OpenFilesResult) => void) => {
    const listener = (_event: unknown, result: OpenFilesResult) => cb(result);
    ipcRenderer.on('files:open', listener);
    return () => ipcRenderer.removeListener('files:open', listener);
  },

  getWindowId: () => ipcRenderer.invoke('window:getId'),
  getBootstrap: () => ipcRenderer.invoke('window:getBootstrap'),
  beginTabDrag: (tab: TransferableTab) =>
    ipcRenderer.invoke('tabs:begin-drag', tab),
  endTabDrag: (tab: TransferableTab) =>
    ipcRenderer.invoke('tabs:end-drag', tab),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  newWindow: () => ipcRenderer.invoke('window:new'),
  onReceiveTab: (cb: (tab: TransferableTab) => void) => {
    const listener = (_event: unknown, tab: TransferableTab) => cb(tab);
    ipcRenderer.on('tabs:receive', listener);
    return () => ipcRenderer.removeListener('tabs:receive', listener);
  },

  showBrandMenu: () => ipcRenderer.invoke('menu:brand'),
  confirm: (options: ConfirmOptions): Promise<number> =>
    ipcRenderer.invoke('dialog:confirm', options),
  setWindowTitle: (title: string) => ipcRenderer.invoke('window:setTitle', title),

  openFiles: (): Promise<OpenFilesResult> => ipcRenderer.invoke('dialog:openFiles'),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  openPaths: (paths: string[]): Promise<OpenFilesResult> =>
    ipcRenderer.invoke('files:openPaths', paths),
  saveFile: (payload: {
    path?: string;
    content: string;
    defaultName?: string;
  }): Promise<SaveFileResult> => ipcRenderer.invoke('dialog:saveFile', payload),

  basename: (filePath: string) => ipcRenderer.invoke('path:basename', filePath),

  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),

  chat: (payload: ChatPayload, onChunk: (chunk: string) => void) => {
    const listener = (_event: unknown, chunk: string) => onChunk(chunk);
    ipcRenderer.on('ai:chat-chunk', listener);
    return ipcRenderer
      .invoke('ai:chat', payload)
      .finally(() => ipcRenderer.removeListener('ai:chat-chunk', listener));
  },
  stopChat: () => ipcRenderer.invoke('ai:chat-abort'),
};

contextBridge.exposeInMainWorld('basil', basilApi);

/** Used by the fullscreen tab-drag overlay for synchronous cursor feedback. */
contextBridge.exposeInMainWorld('basilTabDrag', {
  getDropEffect: (): 'move' | 'none' =>
    ipcRenderer.sendSync('tabs:drag-drop-effect') as 'move' | 'none',
});
