import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import type { ReactNode } from 'react';

// Theme mirrors the hand-rolled tokens in src/styles/tokens.css so MUI
// surfaces (dialogs, pickers, buttons) match the warm-ink design language.
//
// R3 consistency pass: the primary palette is the calm INK (#172026), not the
// saturated brand red — the approved effect-evaluation dialect fills controls
// with ink and reserves coral/red for decorative art and semantic tints. The
// coral marketing art on Login / Home / NotFound is painted by CSS-module
// background-image gradients, which render on top of any palette
// background-color, so the brand shells survive this change untouched. The
// button/alert recipes below are the same values the effect page already
// scopes via .workspace, hoisted so every page that does NOT override still
// lands on the dialect.
const theme = createTheme({
  palette: {
    primary: { main: '#172026', contrastText: '#ffffff' },
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
          '&:focus-visible': {
            boxShadow: '0 0 0 3px rgba(23, 32, 38, 0.16)',
            outline: '2px solid rgba(23, 32, 38, 0.55)',
            outlineOffset: 1,
          },
        },
        contained: {
          // Longhand on purpose: the `background` shorthand would reset
          // background-image and erase the coral gradient art on the Login /
          // NotFound marketing buttons (CSS-module background-image paints
          // over any palette background-color).
          backgroundColor: '#172026',
          boxShadow: '0 6px 16px rgba(23, 32, 38, 0.24)',
          color: '#fff',
          '&:hover': {
            backgroundColor: '#24333d',
            boxShadow: '0 6px 16px rgba(23, 32, 38, 0.24)',
          },
          '&:active': {
            boxShadow: '0 2px 6px rgba(23, 32, 38, 0.18)',
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
        // which now resolves to the ink primary for the default color.
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          fontSize: 13.5,
          fontWeight: 650,
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
      styleOverrides: {
        paper: {
          borderRadius: 14,
          boxShadow: '0 24px 64px rgba(12, 18, 22, 0.28)',
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
