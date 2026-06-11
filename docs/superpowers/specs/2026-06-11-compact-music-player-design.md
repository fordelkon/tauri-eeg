# Compact Music Player Design

## Goal

Refine the Music regulation page into a compact, focused music generation workspace with a layered prompt builder above a small horizontal player.

## Layout

- Keep the page header and status banner behavior.
- Place Prompt Builder above the player, not to the right.
- Keep the right side of the workspace visually reserved for future content.
- Limit the main music controls to a narrow column so the player does not stretch across the page.

## Prompt Builder

- Use a vertical, layered form.
- Layer 1 is Instrument. It uses a select box with common choices plus Custom.
- Layer 2 is Style. It uses a select box with common choices plus Custom.
- Layer 3 is Details. It is optional free text for niche instruments, mood, tempo, or constraints.
- When Custom is selected for Instrument or Style, show a compact text input for that custom value.
- Build the generated prompt from the selected instrument, selected style, optional details, and the fixed no-vocals constraint.

## Music Player

- Replace the current large player with a compact horizontal player inspired by the provided reference image.
- The player should include a small square cover, track title/source, compact progress bar, previous/play/next controls, and a history button.
- Use stable dimensions around a small horizontal card rather than a tall visual card.
- Remove the always-visible queue/history panel.

## History

- Integrate history into the Music Player as an icon button.
- Clicking the button opens a modal/popover with generated track history.
- Selecting a track from the modal changes playback to that track.
- The modal can be dismissed with a close button, backdrop click, or Escape key.

## Verification

- Existing music asset tests should continue to pass.
- TypeScript should compile.
- The UI must remain responsive on mobile by stacking the prompt, player, and reserved workspace vertically.
