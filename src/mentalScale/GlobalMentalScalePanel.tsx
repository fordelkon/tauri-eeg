import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import AssessmentOutlinedIcon from '@mui/icons-material/AssessmentOutlined';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ClickAwayListener from '@mui/material/ClickAwayListener';
import { getMentalScaleStatusSnapshot, subscribeMentalScaleStatus } from './mentalScaleStatus';
import styles from './GlobalMentalScalePanel.module.css';

type Props = {
  children?: ReactNode;
};

export default function GlobalMentalScalePanel({ children }: Props) {
  const [compactOpen, setCompactOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const railRef = useRef<HTMLElement>(null);
  const [showDetails, setShowDetails] = useState(false);
  const status = useSyncExternalStore(
    subscribeMentalScaleStatus,
    getMentalScaleStatusSnapshot,
    getMentalScaleStatusSnapshot,
  );

  useEffect(() => {
    if (!compactOpen) return;
    railRef.current?.focus();
    const wide = window.matchMedia('(min-width: 981px)');
    const closeOnResize = () => setCompactOpen(false);
    wide.addEventListener('change', closeOnResize);
    return () => wide.removeEventListener('change', closeOnResize);
  }, [compactOpen]);

  const updatedLabel = status.updatedAt
    ? new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(status.updatedAt))
    : '基线';

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
          aria-label="实验助手与全局心理量表状态"
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
          <div className={styles.header}>
            <h2 className={styles.headline}>
              <AssessmentOutlinedIcon fontSize="small" aria-hidden="true" />
              量表记录
            </h2>
            {status.updatedAt ? (
              <button
                type="button"
                className={styles.detailsButton}
                aria-expanded={showDetails}
                aria-label={showDetails ? '收起量表记录' : '查看量表记录'}
                onClick={() => setShowDetails((open) => !open)}
              >
                {updatedLabel}
                <ExpandMoreRoundedIcon fontSize="small" aria-hidden="true" />
              </button>
            ) : (
              <p className={styles.summary}>暂无本次记录</p>
            )}
          </div>
          {showDetails && status.updatedAt && (
            <dl className={styles.checkValues}>
              {status.dimensions
                .filter((d) => d.key === 'anxiety' || d.key === 'mood')
                .map((d) => (
                  <div key={d.key}>
                    <dt>{d.key === 'anxiety' ? '紧绷' : '不愉快'}</dt>
                    <dd>{Math.round((d.value * 3) / 100)} / 3</dd>
                  </div>
                ))}
            </dl>
          )}
          {children ? <div className={styles.assistantSlot}>{children}</div> : null}
        </aside>
      </ClickAwayListener>
    </>
  );
}
