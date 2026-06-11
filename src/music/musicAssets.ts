export type MusicAsset = {
  cover: MusicCoverPalette;
  id: string;
  fileName: string;
  mediaUrl: string;
  mimeType: 'audio/wav';
  source: 'bundled' | 'generated';
  title: string;
};

export type MusicCoverPalette = {
  accent: string;
  angle: number;
  primary: string;
  secondary: string;
};

export type GeneratedMusicHistoryItem = {
  createdAt: string;
  durationSeconds: number | null;
  filePath: string;
  id: string;
  modelVersion: string;
  prompt: string;
};

const coverPalettes = [
  ['#ef6f61', '#f8c572', '#314a59'],
  ['#5c7cfa', '#63e6be', '#1f2a44'],
  ['#b197fc', '#ff8787', '#343a40'],
  ['#69db7c', '#ffd43b', '#2b3a2f'],
  ['#4dabf7', '#ffa94d', '#253447'],
  ['#f06595', '#cc5de8', '#34233b'],
] as const;

function hashText(text: string) {
  let hash = 2166136261;

  for (const character of text) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function createCoverPalette(fileName: string): MusicCoverPalette {
  const hash = hashText(fileName.toLowerCase());
  const palette = coverPalettes[hash % coverPalettes.length];

  return {
    accent: palette[2],
    angle: hash % 360,
    primary: palette[0],
    secondary: palette[1],
  };
}

export function createBundledMusicAssets(fileNames: readonly string[]): MusicAsset[] {
  return fileNames
    .filter((fileName) => fileName.toLowerCase().endsWith('.wav'))
    .map((fileName, index) => ({
      cover: createCoverPalette(fileName),
      id: `bundled-wav-${index + 1}`,
      fileName,
      mediaUrl: `/music/${encodeURIComponent(fileName)}`,
      mimeType: 'audio/wav' as const,
      source: 'bundled' as const,
      title: stripExtension(fileName),
    }));
}

export function createGeneratedMusicAsset(
  item: GeneratedMusicHistoryItem,
  toFileUrl: (filePath: string) => string,
): MusicAsset {
  const pathParts = item.filePath.split(/[\\/]/);
  const fileName = pathParts[pathParts.length - 1] || `${item.id}.wav`;
  const title = item.prompt.trim() || stripExtension(fileName);

  return {
    cover: createCoverPalette(`${item.prompt}-${item.createdAt}`),
    fileName,
    id: item.id,
    mediaUrl: toFileUrl(item.filePath),
    mimeType: 'audio/wav',
    source: 'generated',
    title,
  };
}

function stripExtension(fileName: string) {
  return fileName.replace(/\.[^.]+$/, '');
}
