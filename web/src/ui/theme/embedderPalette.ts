import type { PaletteBase } from "onyxia-ui";
import type { DeepPartial } from "keycloakify/tools/DeepPartial";
import { env } from "env";
import { knownPaletteName, selectNamedPaletteOverride } from "./namedPalette";

/**
 * Which of the PALETTE_OVERRIDE_NAMED palettes the app wears, as chosen by the page
 * that embeds it.
 *
 * A page with themes of its own wants the framed app in its theme as well as in its
 * light or dark. It names a palette with the `palette` URL parameter, read once at
 * load, and with `palette` in its `onyxia:set-theme` message after (embedderTheme.ts).
 * A name the env does not list is no palette at all: the app keeps PALETTE_OVERRIDE
 * and its light and dark overrides, so a page with a theme the app was never given
 * colours for gets the app's own.
 *
 * The name is kept in sessionStorage, which is the tab's: the sign-in round trip loads
 * the app again without the parameter, and the page's next message may come after the
 * app has painted. It is also set on <html data-palette="…">, for the stylesheets in
 * CUSTOM_HTML_HEAD. An app that is not framed wears no named palette.
 */
export const EMBEDDER_PALETTE_URL_PARAM = "palette";
export const EMBEDDER_PALETTE_SESSION_KEY = "onyxia:embedder-palette";

const listeners = new Set<() => void>();

let paletteName = knownPaletteName(env.PALETTE_OVERRIDE_NAMED, readInitialPaletteName());

paint();

function readInitialPaletteName(): string | null {
    if (window.self === window.top) {
        return null;
    }

    try {
        const url = new URL(window.location.href);
        const name = url.searchParams.get(EMBEDDER_PALETTE_URL_PARAM);

        if (name === null) {
            return sessionStorage.getItem(EMBEDDER_PALETTE_SESSION_KEY);
        }

        sessionStorage.setItem(EMBEDDER_PALETTE_SESSION_KEY, name);
        url.searchParams.delete(EMBEDDER_PALETTE_URL_PARAM);
        window.history.replaceState(window.history.state, "", url.href);

        return name;
    } catch {
        return null;
    }
}

function paint() {
    if (paletteName === undefined) {
        document.documentElement.removeAttribute("data-palette");
    } else {
        document.documentElement.setAttribute("data-palette", paletteName);
    }
}

/** The palette's name, or "" for none: onyxia-ui's `getPaletteKey`. */
export function getEmbedderPaletteName(): string {
    return paletteName ?? "";
}

export function getEmbedderPaletteOverride(params: {
    isDarkModeEnabled: boolean;
}): DeepPartial<PaletteBase> {
    return selectNamedPaletteOverride({
        namedPalettes: env.PALETTE_OVERRIDE_NAMED,
        name: paletteName,
        isDarkModeEnabled: params.isDarkModeEnabled
    });
}

/** Wear the palette the embedding page names; a name not listed means none. */
export function setEmbedderPaletteName(name: string) {
    const next = knownPaletteName(env.PALETTE_OVERRIDE_NAMED, name);

    try {
        sessionStorage.setItem(EMBEDDER_PALETTE_SESSION_KEY, name);
    } catch {
        // Storage blocked: the palette still applies until the app is loaded again.
    }

    if (next === paletteName) {
        return;
    }

    paletteName = next;
    paint();
    listeners.forEach(listener => listener());
}

export function subscribeToEmbedderPalette(listener: () => void): () => void {
    listeners.add(listener);

    return () => {
        listeners.delete(listener);
    };
}
