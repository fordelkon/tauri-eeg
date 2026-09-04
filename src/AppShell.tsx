import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import type { ReactNode } from 'react';

// Theme mirrors the hand-rolled tokens in src/styles/tokens.css so MUI
// surfaces (dialogs, pickers, buttons) match the warm-ink design language.
const theme = createTheme({
  palette: {
    primary: { main: '#df0203' },
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
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 14,
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
