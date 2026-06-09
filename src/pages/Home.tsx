import { Box, Typography } from '@mui/material';

export default function Home() {
  return (
    <Box
      sx={{
        backgroundColor: 'background.paper', // {colors.canvas} 
        minHeight: '100vh',
        p: { xs: 4, md: 10 }, // standard Section spacing (80px) represented via responsive values
      }}
    >
      <Typography variant="h3" sx={{ mb: 2 }}>
        Application Dashboard
      </Typography>
      <Typography variant="body1">
        Welcome to your application. This page adheres to the Apple-inspired design principles.
      </Typography>
    </Box>
  );
}
