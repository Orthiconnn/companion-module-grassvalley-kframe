// Kayenne M/E engine indexes, in the order the action dropdowns list them.
export const ME_INDEXES: Record<string, number> = { PGM: 3, ME1: 0, ME2: 1, ME3: 2, ME4: 4 }

// Button colours per M/E: bright for the A bus or active state, dark otherwise,
// and a text colour that reads on both.
export const ME_COLORS: Record<string, { bright: number; dark: number; text: number }> = {
	ME1: { bright: 0x2e9d55, dark: 0x1d6538, text: 0xffffff },
	ME2: { bright: 0xffd21f, dark: 0xb08c00, text: 0x000000 },
	ME3: { bright: 0xff7a18, dark: 0xa84b00, text: 0x000000 },
	ME4: { bright: 0x9b59b6, dark: 0x633974, text: 0xffffff },
	PGM: { bright: 0xd93636, dark: 0x8d2020, text: 0xffffff },
}
export const OTHER_COLORS = { bright: 0x444444, dark: 0x222222, text: 0xffffff }
