export const widgetThemes = ['hot-pink', 'blue', 'dark-green', 'light', 'rgb-neon'] as const;

export type WidgetTheme = (typeof widgetThemes)[number];
export type WidgetColorMode = 'light' | 'dark';

export interface WidgetAppearance {
  ink: string;
  paper: string;
  surface: string;
  muted: string;
  line: string;
  accent: string;
  accentStrong: string;
  accentInk: string;
  dark: string;
  hover: string;
  fieldLine: string;
  send: string;
  sendInk: string;
  panelLine: string;
  panelInset: string;
}

interface ThemeAppearance {
  accent: string;
  accentStrong: string;
  accentStrongDark: string;
  lightHeader: string;
  dark: Omit<WidgetAppearance, 'accent' | 'accentStrong'>;
}

const lightMode = {
  ink: '#1b211e',
  paper: '#f7f6f1',
  surface: '#ffffff',
  muted: '#687069',
  line: '#d9ddd7',
  accentInk: '#101713',
  hover: '#f0f2ef',
  fieldLine: '#cbd1cb',
  panelLine: 'rgb(27 33 30 / 13%)',
  panelInset: 'rgb(255 255 255 / 70%)',
} as const;

const themes: Readonly<Record<WidgetTheme, ThemeAppearance>> = {
  'hot-pink': {
    accent: '#ff75ad',
    accentStrong: '#c72d70',
    accentStrongDark: '#ff9bc4',
    lightHeader: '#202723',
    dark: {
      ink: '#fff1f7',
      paper: '#24131c',
      surface: '#351c28',
      muted: '#d8a9bc',
      line: '#694156',
      accentInk: '#2a0717',
      dark: '#4b1731',
      hover: '#472536',
      fieldLine: '#87536d',
      send: '#9c275c',
      sendInk: '#ffffff',
      panelLine: '#9b607c',
      panelInset: 'transparent',
    },
  },
  blue: {
    accent: '#a9d8ff',
    accentStrong: '#236ebd',
    accentStrongDark: '#8bc5ff',
    lightHeader: '#102b47',
    dark: {
      ink: '#eef7ff',
      paper: '#0b1724',
      surface: '#12263a',
      muted: '#abc6df',
      line: '#2a4b68',
      accentInk: '#071522',
      dark: '#0b3154',
      hover: '#1b3349',
      fieldLine: '#416b8b',
      send: '#245b8f',
      sendInk: '#ffffff',
      panelLine: '#5683a5',
      panelInset: 'transparent',
    },
  },
  'dark-green': {
    accent: '#74d887',
    accentStrong: '#217938',
    accentStrongDark: '#74d887',
    lightHeader: '#071a11',
    dark: {
      ink: '#effaf2',
      paper: '#07130d',
      surface: '#10231a',
      muted: '#a9cbb5',
      line: '#294d38',
      accentInk: '#071a11',
      dark: '#0a301c',
      hover: '#193627',
      fieldLine: '#3f6d50',
      send: '#1f6b35',
      sendInk: '#ffffff',
      panelLine: '#548463',
      panelInset: 'transparent',
    },
  },
  light: {
    accent: '#e2e2df',
    accentStrong: '#626865',
    accentStrongDark: '#c9cecb',
    lightHeader: '#2d302f',
    dark: {
      ink: '#f5f7f6',
      paper: '#161817',
      surface: '#222625',
      muted: '#bcc5c1',
      line: '#434c47',
      accentInk: '#171917',
      dark: '#303734',
      hover: '#303633',
      fieldLine: '#5b6761',
      send: '#4b5550',
      sendInk: '#ffffff',
      panelLine: '#727f78',
      panelInset: 'transparent',
    },
  },
  'rgb-neon': {
    accent: '#ff4fa3',
    accentStrong: '#08758f',
    accentStrongDark: '#68d7f3',
    lightHeader: '#0b0b17',
    dark: {
      ink: '#f7f4ff',
      paper: '#0a0914',
      surface: '#171527',
      muted: '#c3bee5',
      line: '#403b66',
      accentInk: '#160711',
      dark: '#211345',
      hover: '#27233d',
      fieldLine: '#5a5487',
      send: '#98205e',
      sendInk: '#ffffff',
      panelLine: '#746ca3',
      panelInset: 'transparent',
    },
  },
};

export function resolveWidgetAppearance(
  theme: WidgetTheme,
  colorMode: WidgetColorMode,
): WidgetAppearance {
  const selected = themes[theme];
  if (colorMode === 'dark') {
    return {
      ...selected.dark,
      accent: selected.accent,
      accentStrong: selected.accentStrongDark,
    };
  }
  return {
    ...lightMode,
    accent: selected.accent,
    accentStrong: selected.accentStrong,
    dark: selected.lightHeader,
    send: selected.accent,
    sendInk: lightMode.accentInk,
  };
}
