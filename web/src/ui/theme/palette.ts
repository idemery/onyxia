import { defaultPalette } from "onyxia-ui";
import { env } from "env";
import { mergeDeep } from "ui/tools/mergeDeep";
import { getEmbedderPaletteOverride } from "./embedderPalette";

export function getPalette(params: { isDarkModeEnabled: boolean }) {
    const { isDarkModeEnabled } = params;

    return mergeDeep(
        {
            ...defaultPalette,
            limeGreen: {
                main: "#BAFF29",
                light: "#E2FFA6"
            }
        },
        mergeDeep(
            mergeDeep(
                env.PALETTE_OVERRIDE,
                isDarkModeEnabled ? env.PALETTE_OVERRIDE_DARK : env.PALETTE_OVERRIDE_LIGHT
            ),
            // The palette an embedding page names, if any, over both.
            getEmbedderPaletteOverride({ isDarkModeEnabled })
        )
    );
}
