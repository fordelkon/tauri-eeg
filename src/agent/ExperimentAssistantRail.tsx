import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ClickAwayListener from '@mui/material/ClickAwayListener';
import styles from './ExperimentAssistantRail.module.css';

type Props = {
  children: ReactNode;
};

export default function ExperimentAssistantRail({ children }: Props) {
  const [compactOpen, setCompactOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const railRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!compactOpen) return;
    railRef.current?.focus();
    const wide = window.matchMedia('(min-width: 981px)');
    const closeOnResize = () => setCompactOpen(false);
    wide.addEventListener('change', closeOnResize);
    return () => wide.removeEventListener('change', closeOnResize);
  }, [compactOpen]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={styles.railToggle}
        aria-controls="experiment-assistant-rail"
        aria-expanded={compactOpen}
        onClick={() => setCompactOpen((open) => !open)}
      >
        {compactOpen ? (
          <CloseRoundedIcon fontSize="small" />
        ) : (
          <SmartToyOutlinedIcon fontSize="small" />
        )}
        {compactOpen ? '收起助手' : '实验助手'}
      </button>
      <ClickAwayListener
        onClickAway={(event) => {
          if (!triggerRef.current?.contains(event.target as Node)) setCompactOpen(false);
        }}
      >
        <aside
          ref={railRef}
          id="experiment-assistant-rail"
          className={styles.panel}
          data-open={compactOpen}
          tabIndex={-1}
          aria-label="实验助手"
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !event.defaultPrevented && compactOpen) {
              setCompactOpen(false);
              triggerRef.current?.focus();
            }
          }}
          onBlur={(event) => {
            if (
              event.relatedTarget &&
              event.relatedTarget !== triggerRef.current &&
              !event.currentTarget.contains(event.relatedTarget)
            ) {
              setCompactOpen(false);
            }
          }}
        >
          <div className={styles.assistantSlot}>{children}</div>
        </aside>
      </ClickAwayListener>
    </>
  );
}
