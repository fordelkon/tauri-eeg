import CssBaseline from '@mui/material/CssBaseline';
import Grow from '@mui/material/Grow';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import type { ComponentProps, ReactNode } from 'react';

/**
 * Dialog/Popover motion rides the calm dialect curve (--ease-out) instead
 * of MUI's default 225ms standard curve, so portal dialogs land the same
 * way the hand-rolled 220ms dialogs do. Exit is slightly quicker than
 * enter — the response snaps, the dismissal leaves sooner.
 */
const CalmGrow = (props: ComponentProps<typeof Grow>) => (
  <Grow
    {...props}
    easing={{
      enter: 'cubic-bezier(0.16, 1, 0.3, 1)',
      exit: 'cubic-bezier(0.7, 0, 0.84, 0)',
    }}
  />
);

// Theme mirrors the hand-rolled tokens in src/styles/tokens.css so MUI
// surfaces (dialogs, pickers, buttons) match the warm-ink design language.
//
// Calm-dialect pass: the primary palette is muted TERRACOTTA (#c46757) — the calm
// primary action hue; ink stays text-only and coral/red stay decorative art
// and semantic tints. Shadows follow the calm depth rule: soft, diffuse and
// tinted with the fill's own hue (sage controls get sage shadows), never
// heavy near-black drops. The coral marketing art on Login / Home / NotFound
// is painted by CSS-module background-image gradients, which render on top of
// any palette background-color, so the brand shells survive this change
// untouched. The button/alert recipes below are the same values the effect
// page already scopes via .workspace, hoisted so every page that does NOT
// override still lands on the dialect.
const theme = createTheme({
  palette: {
    primary: { main: '#c46757', contrastText: '#ffffff' },
    secondary: { main: '#fb7f6e' },
    success: { main: '#1c6a47' },
    warning: { main: '#8a560e' },
    error: { main: '#b3261e' },
    info: { main: '#245f9d' },
    // Keep the shell's warm paper + ink: the themed CssBaseline injected at
    // runtime would otherwise paint MUI's neutral gray defaults over the
    // body values declared in src/styles/global.css.
    background: { default: '#f5f0eb' },
    text: { primary: '#2c2218' },
  },
  typography: {
    fontFamily: 'Inter, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  },
  shape: {
    borderRadius: 8,
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          // Button labels never wrap to two lines: rows wrap the whole
          // control instead (the dialect's nowrap rule for buttons/pills).
          whiteSpace: 'nowrap',
          // Dialect motion tokens (main.tsx loads tokens.css globally, so the
          // var()s resolve here) replace MUI's 250ms standard-curve default;
          // transform is listed so the pressed recipe below animates.
          transition:
            'background-color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out)',
          '&:active': {
            // The dialect's pressed recipe, inherited by every MUI button.
            transform: 'scale(0.98)',
          },
          '&:focus-visible': {
            boxShadow: '0 0 0 3px rgba(196, 103, 87, 0.16)',
            outline: '2px solid rgba(196, 103, 87, 0.55)',
            outlineOffset: 1,
          },
        },
        contained: {
          // Longhand on purpose: the `background` shorthand would reset
          // background-image and erase the coral gradient art on the Login /
          // NotFound marketing buttons (CSS-module background-image paints
          // over any palette background-color).
          backgroundColor: '#c46757',
          boxShadow: 'var(--shadow-control)',
          color: '#fff',
          '&:hover': {
            backgroundColor: '#ad5343',
            boxShadow: 'var(--shadow-control)',
          },
          '&:active': {
            boxShadow: 'var(--shadow-control-active)',
          },
          '&.Mui-disabled': {
            backgroundColor: 'rgba(23, 32, 38, 0.14)',
            boxShadow: 'none',
            color: 'rgba(23, 32, 38, 0.44)',
          },
        },
        outlined: {
          borderColor: 'rgba(23, 32, 38, 0.26)',
          boxShadow: 'none',
          color: 'rgba(23, 32, 38, 0.82)',
          '&:hover': {
            backgroundColor: 'rgba(23, 32, 38, 0.05)',
            borderColor: 'rgba(23, 32, 38, 0.46)',
            boxShadow: 'none',
          },
          '&.Mui-disabled': {
            borderColor: 'rgba(23, 32, 38, 0.14)',
            color: 'rgba(23, 32, 38, 0.4)',
          },
        },
        // No `text` override: text-variant buttons carry color semantics
        // (color="error" destructive actions) through --variant-textColor,
        // which now resolves to the sage primary for the default color.
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: {
          // Banners share the 8px control step (same as the hand-rolled
          // error/success/environment banners on the regulation pages).
          borderRadius: 8,
          fontSize: 13,
          // Banner body at the secondary step (500); <strong> verdict leads
          // inside the message carry the primary 600. Weight scale is
          // 400/500/600 app-wide.
          fontWeight: 500,
          lineHeight: 1.55,
          padding: '10px 14px',
          // MUI v9 composes variant+color as two classes (MuiAlert-standard +
          // MuiAlert-colorInfo), so the calm banner tints hang off the root.
          '&.MuiAlert-standard.MuiAlert-colorInfo': {
            backgroundColor: 'rgba(45, 113, 184, 0.08)',
            borderColor: 'rgba(45, 113, 184, 0.2)',
            color: '#245f9d',
            '& .MuiAlert-icon': {
              color: '#245f9d',
            },
          },
          '&.MuiAlert-standard.MuiAlert-colorWarning': {
            backgroundColor: 'rgba(217, 119, 6, 0.09)',
            borderColor: 'rgba(217, 119, 6, 0.24)',
            color: '#8a5a10',
            '& .MuiAlert-icon': {
              color: '#a4690f',
            },
          },
          '&.MuiAlert-standard.MuiAlert-colorError': {
            backgroundColor: 'rgba(196, 58, 48, 0.1)',
            borderColor: 'rgba(196, 58, 48, 0.22)',
            color: '#8d2d25',
            '& .MuiAlert-icon': {
              color: '#8d2d25',
            },
          },
          '&.MuiAlert-standard.MuiAlert-colorSuccess': {
            backgroundColor: 'rgba(34, 125, 84, 0.1)',
            borderColor: 'rgba(34, 125, 84, 0.22)',
            color: '#1c6a47',
            '& .MuiAlert-icon': {
              color: '#1c6a47',
            },
          },
        },
        message: {
          padding: '2px 0',
        },
      },
    },
    MuiDialog: {
      defaultProps: {
        // MUI v9: TransitionComponent was migrated to slots.transition;
        // easing/timeout ride slotProps.transition.
        slots: { transition: CalmGrow },
        slotProps: {
          transition: {
            timeout: { enter: 220, exit: 180 },
          },
        },
      },
      styleOverrides: {
        paper: {
          borderRadius: 14,
          // Calm depth: warm-tinted and softer than the old cool-ink drop.
          boxShadow: '0 24px 56px rgba(44, 34, 24, 0.16)',
        },
      },
    },
    MuiPopover: {
      defaultProps: {
        slots: { transition: CalmGrow },
        slotProps: {
          transition: {
            timeout: { enter: 220, exit: 180 },
          },
        },
      },
    },
  },
});

type AppShellProps = {
  children: ReactNode;
};

// Lives below the React.lazy boundary in App.tsx: the entry chunk stays
// MUI-free and the first paint comes from main.tsx + src/styles/global.css.
export default function AppShell({ children }: AppShellProps) {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  );
}
