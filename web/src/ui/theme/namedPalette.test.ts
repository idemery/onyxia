import { describe, it, expect } from "vitest";
import { knownPaletteName, selectNamedPaletteOverride } from "./namedPalette";

describe("named palettes", () => {
    const namedPalettes = {
        teal: {
            light: { focus: { main: "#157A74" } },
            dark: { focus: { main: "#4FE3D9" } }
        },
        nightOnly: { dark: { focus: { main: "#8DA2EC" } } }
    };

    it("knows only the names the env lists", () => {
        expect(knownPaletteName(namedPalettes, "teal")).toBe("teal");
        expect(knownPaletteName(namedPalettes, "coral")).toBeUndefined();
        // Not a key the object inherits, nor anything but a string.
        expect(knownPaletteName(namedPalettes, "toString")).toBeUndefined();
        expect(knownPaletteName(namedPalettes, 1)).toBeUndefined();
    });

    it("adds the named palette's override for the mode", () => {
        expect(
            selectNamedPaletteOverride({
                namedPalettes,
                name: "teal",
                isDarkModeEnabled: false
            })
        ).toEqual({ focus: { main: "#157A74" } });
        expect(
            selectNamedPaletteOverride({
                namedPalettes,
                name: "teal",
                isDarkModeEnabled: true
            })
        ).toEqual({ focus: { main: "#4FE3D9" } });
    });

    it("adds nothing for no palette, an unknown one, or a mode it leaves out", () => {
        for (const name of [undefined, "coral"]) {
            expect(
                selectNamedPaletteOverride({
                    namedPalettes,
                    name,
                    isDarkModeEnabled: true
                })
            ).toEqual({});
        }
        expect(
            selectNamedPaletteOverride({
                namedPalettes,
                name: "nightOnly",
                isDarkModeEnabled: false
            })
        ).toEqual({});
    });
});
