import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, List, X } from 'lucide-react';
import type { EditorTab } from '../lib/tabs';
import { isSettingsTab } from '../lib/tabs';
import { BASIL_TAB_MIME } from '../../shared/api';

type Props = {
  tabs: EditorTab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onTabDragStart: (tab: EditorTab) => void;
  onTabDragEnd: (tab: EditorTab) => void;
};

export function TabBar({
  tabs,
  activeId,
  onSelect,
  onClose,
  onTabDragStart,
  onTabDragEnd,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const listWrapRef = useRef<HTMLDivElement>(null);
  const tabbarRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const tabsInnerRef = useRef<HTMLDivElement>(null);

  const updateScrollArrows = useCallback(() => {
    const el = tabsRef.current;
    if (!el) return;
    const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
    setCanScrollLeft(el.scrollLeft > 1);
    setCanScrollRight(el.scrollLeft < maxScroll - 1);
  }, []);

  const applyTabsScroll = useCallback(
    (delta: number) => {
      const el = tabsRef.current;
      if (!el || delta === 0) return false;
      const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
      if (maxScroll <= 0) return false;
      let next = el.scrollLeft + delta;
      if (next <= 1) next = 0;
      else if (next >= maxScroll - 1) next = maxScroll;
      if (next === el.scrollLeft) return false;
      el.scrollLeft = next;
      updateScrollArrows();
      return true;
    },
    [updateScrollArrows],
  );

  const scrollTabs = (direction: -1 | 1) => {
    const el = tabsRef.current;
    if (!el) return;
    const step = Math.max(120, Math.floor(el.clientWidth * 0.6));
    applyTabsScroll(direction * step);
  };

  const scrollTabIntoView = useCallback(
    (id: string) => {
      const container = tabsRef.current;
      const tabEl = tabsInnerRef.current?.querySelector<HTMLElement>(
        `[data-tab-id="${CSS.escape(id)}"]`,
      );
      if (!container || !tabEl) return;

      const maxScroll = Math.max(0, container.scrollWidth - container.clientWidth);
      const cLeft = container.scrollLeft;
      const cRight = cLeft + container.clientWidth;
      const tLeft = tabEl.offsetLeft;
      const tRight = tLeft + tabEl.offsetWidth;

      let next = cLeft;
      if (tLeft < cLeft) next = tLeft;
      else if (tRight > cRight) next = tRight - container.clientWidth;

      if (next <= 1) next = 0;
      else if (next >= maxScroll - 1) next = maxScroll;
      container.scrollLeft = next;
      updateScrollArrows();
    },
    [updateScrollArrows],
  );

  useEffect(() => {
    if (!menuOpen) return;

    const onPointerDown = (e: PointerEvent) => {
      if (listWrapRef.current?.contains(e.target as Node)) return;
      setMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };

    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  useEffect(() => {
    const tabbar = tabbarRef.current;
    if (!tabbar) return;

    const onWheel = (e: WheelEvent) => {
      // Only horizontal-scroll tabs when hovering the tab bar, not the list menu.
      if (e.target instanceof Element && e.target.closest('.tabbar-menu')) {
        return;
      }

      const delta =
        Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (delta === 0) return;
      if (applyTabsScroll(delta)) {
        e.preventDefault();
      }
    };

    tabbar.addEventListener('wheel', onWheel, { passive: false });
    return () => tabbar.removeEventListener('wheel', onWheel);
  }, [applyTabsScroll]);

  useLayoutEffect(() => {
    updateScrollArrows();
    if (activeId) scrollTabIntoView(activeId);
  }, [tabs, activeId, updateScrollArrows, scrollTabIntoView]);

  useEffect(() => {
    const el = tabsRef.current;
    const inner = tabsInnerRef.current;
    if (!el) return;

    const onScroll = () => updateScrollArrows();
    el.addEventListener('scroll', onScroll, { passive: true });

    const ro = new ResizeObserver(() => updateScrollArrows());
    ro.observe(el);
    if (inner) ro.observe(inner);
    window.addEventListener('resize', updateScrollArrows);

    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
      window.removeEventListener('resize', updateScrollArrows);
    };
  }, [tabs, updateScrollArrows]);

  return (
    <div
      ref={tabbarRef}
      className="tabbar"
      role="tablist"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(BASIL_TAB_MIME)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }}
      onDrop={(e) => {
        // Cross-window moves are finalized by the source via endTabDrag.
        if (!e.dataTransfer.types.includes(BASIL_TAB_MIME)) return;
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className="tabbar-list-wrap" ref={listWrapRef}>
        <button
          type="button"
          className={`tabbar-list-btn${menuOpen ? ' active' : ''}`}
          title="Open tabs"
          aria-label="Open tabs"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <List size={14} />
        </button>
        {menuOpen ? (
          <div className="tabbar-menu" role="menu">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="menuitem"
                className={`tabbar-menu-item${tab.id === activeId ? ' active' : ''}`}
                title={tab.path ?? tab.title}
                onClick={() => {
                  onSelect(tab.id);
                  setMenuOpen(false);
                }}
              >
                {tab.dirty ? <span className="tab-dirty" title="Unsaved" /> : <span className="tabbar-menu-spacer" />}
                <span className="tabbar-menu-title">{tab.title}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {canScrollLeft ? (
        <button
          type="button"
          className="tabbar-scroll-btn"
          title="Scroll tabs left"
          aria-label="Scroll tabs left"
          onClick={() => scrollTabs(-1)}
        >
          <ChevronLeft size={14} />
        </button>
      ) : null}
      <div className="tabbar-tabs" ref={tabsRef}>
        <div className="tabbar-tabs-inner" ref={tabsInnerRef}>
          {tabs.map((tab) => {
            const canDrag = !isSettingsTab(tab);
            return (
              <div
                key={tab.id}
                data-tab-id={tab.id}
                className={`tab${tab.id === activeId ? ' active' : ''}${canDrag ? ' tab-draggable' : ''}`}
                role="tab"
                aria-selected={tab.id === activeId}
                draggable={canDrag}
                onClick={() => onSelect(tab.id)}
                onMouseDown={(e) => {
                  if (e.button === 1) {
                    e.preventDefault();
                    onClose(tab.id);
                  }
                }}
                onDragStart={(e) => {
                  if (!canDrag) {
                    e.preventDefault();
                    return;
                  }
                  // Only the custom MIME — avoid text/plain so editors don't insert the title.
                  e.dataTransfer.setData(BASIL_TAB_MIME, tab.id);
                  e.dataTransfer.effectAllowed = 'move';
                  onTabDragStart(tab);
                }}
                onDragEnd={() => {
                  if (!canDrag) return;
                  onTabDragEnd(tab);
                }}
              >
                {tab.dirty ? <span className="tab-dirty" title="Unsaved" /> : null}
                <span className="tab-title" title={tab.path ?? tab.title}>
                  {tab.title}
                </span>
                <button
                  type="button"
                  className="tab-close"
                  title="Close"
                  draggable={false}
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(tab.id);
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
      {canScrollRight ? (
        <button
          type="button"
          className="tabbar-scroll-btn"
          title="Scroll tabs right"
          aria-label="Scroll tabs right"
          onClick={() => scrollTabs(1)}
        >
          <ChevronRight size={14} />
        </button>
      ) : null}
    </div>
  );
}
