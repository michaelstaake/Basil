/// <reference types="vite/client" />

import type { BasilApi } from '../shared/api';

declare global {
  interface Window {
    basil: BasilApi;
  }

  var MonacoEnvironment: {
    getWorker: (workerId: string, label: string) => Worker;
  };
}

export {};
