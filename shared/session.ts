import type { SessionState } from './api';

export function normalizeSession(raw: unknown): SessionState {
  if (!raw || typeof raw !== 'object') {
    return { openPaths: [] };
  }
  const obj = raw as Record<string, unknown>;
  const openPaths = Array.isArray(obj.openPaths)
    ? obj.openPaths.filter((p): p is string => typeof p === 'string' && p.length > 0)
    : [];
  const activePath =
    typeof obj.activePath === 'string'
      ? obj.activePath
      : obj.activePath === null
        ? null
        : undefined;
  return { openPaths, activePath };
}

/** Snapshot the saveable part of a window's tabs (paths only; content is re-read). */
export function sessionFromTabs(
  tabs: ReadonlyArray<{ id: string; path?: string }>,
  activeId: string | null,
): SessionState {
  const openPaths = tabs
    .map((t) => t.path)
    .filter((p): p is string => typeof p === 'string' && p.length > 0);
  const active = tabs.find((t) => t.id === activeId);
  const activePath = active?.path ?? openPaths[0] ?? null;
  return { openPaths, activePath };
}

/**
 * Union of several windows' sessions, in first-seen order and de-duplicated.
 * `preferredActive` (the focused window's active file) wins if it is still open.
 */
export function mergeSessions(
  sessions: ReadonlyArray<SessionState>,
  preferredActive?: string | null,
): SessionState {
  const openPaths: string[] = [];
  const seen = new Set<string>();
  for (const session of sessions) {
    for (const filePath of session.openPaths) {
      if (seen.has(filePath)) continue;
      seen.add(filePath);
      openPaths.push(filePath);
    }
  }

  let activePath: string | null = null;
  if (preferredActive && seen.has(preferredActive)) {
    activePath = preferredActive;
  } else {
    const fromSessions = sessions
      .map((s) => s.activePath)
      .find((p): p is string => typeof p === 'string' && seen.has(p));
    activePath = fromSessions ?? openPaths[0] ?? null;
  }

  return { openPaths, activePath };
}
