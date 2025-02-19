import { createTheme, MantineTheme } from '@mantine/core';
declare module '@mantine/core' {
  export interface MantineThemeOther {
    dropzoneHeight: string;
    videoPreviewHeight: string;
    transitionDuration: string;
  }
}

export const theme = createTheme({
  primaryColor: 'blue',
  colors: {
    blue: [
      '#E6F7FF',
      '#BAE7FF',
      '#91D5FF',
      '#69C0FF',
      '#40A9FF',
      '#1890FF',
      '#096DD9',
      '#0050B3',
      '#003A8C',
      '#002766',
    ],
  },
  components: {
    Button: {
      defaultProps: {
        radius: 'md',
      },
    },
    Paper: {
      defaultProps: {
        shadow: 'sm',
        radius: 'md',
      },
    },
    Progress: {
      defaultProps: {
        color: 'blue',
      },
    },
  },
  other: {
    dropzoneHeight: '200px',
    videoPreviewHeight: '400px',
    transitionDuration: '0.3s',
  },
}) as MantineTheme;