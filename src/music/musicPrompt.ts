const noVocalsConstraint = 'no vocals';

export function buildMusicPrompt(
  instruments: readonly string[],
  customInstrument: string,
  styles: readonly string[],
  customStyle: string,
  detailTemplates: readonly string[],
  details: string,
) {
  const selectedInstruments = instruments
    .map((instrument) => (instrument === 'custom' ? customInstrument.trim() : instrument))
    .filter((instrument) => instrument.length > 0);
  const selectedStyles = styles
    .map((style) => (style === 'custom' ? customStyle.trim() : style))
    .filter((style) => style.length > 0);
  const selectedDetails = detailTemplates
    .map((detail) => detail.trim())
    .filter((detail) => detail.length > 0);
  const parts = [
    ...selectedInstruments,
    ...selectedStyles,
    ...selectedDetails,
    details.trim(),
    noVocalsConstraint,
  ]
    .filter((part) => part.length > 0);

  return Array.from(new Set(parts)).join(', ');
}
