import type { PaletteBase } from "onyxia-ui";
import type { DeepPartial } from "keycloakify/tools/DeepPartial";
import type { NamedPaletteOverride } from "env";

/** `name` when PALETTE_OVERRIDE_NAMED lists it, otherwise `undefined`. */
export function knownPaletteName(
    namedPalettes: Record<string, NamedPaletteOverride>,
    name: unknown
): string | undefined {
    return typeof name === "string" &&
        Object.prototype.hasOwnProperty.call(namedPalettes, name)
        ? name
        : undefined;
}

/** The override a named palette adds in one mode: nothing for no palette. */
export function selectNamedPaletteOverride(params: {
    namedPalettes: Record<string, NamedPaletteOverride>;
    name: string | undefined;
    isDarkModeEnabled: boolean;
}): DeepPartial<PaletteBase> {
    const { namedPalettes, name, isDarkModeEnabled } = params;

    const known = knownPaletteName(namedPalettes, name);

    if (known === undefined) {
        return {};
    }

    return namedPalettes[known][isDarkModeEnabled ? "dark" : "light"] ?? {};
}
