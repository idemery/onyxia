import { getEmbedderOrigin } from "ui/shared/codex/S3ExplorerMainView/embedderDragBridge";

/**
 * Letting the page that embeds the app choose its colour scheme.
 *
 * Framed by a page that has its own light/dark switch, the app would otherwise keep
 * its own scheme: whatever it last persisted, or the system's. The two disagree the
 * moment the person flips the page's switch, and the app's own switch sits in a
 * footer a framed app may not even show.
 *
 * The contract mirrors the `theme` URL parameter onyxia-ui already reads at load:
 *
 *     page → app   { type: "onyxia:set-theme", theme: "dark" | "light", palette?: string }
 *     app → page   { type: "onyxia:theme-ready" }
 *
 * `palette` names one of PALETTE_OVERRIDE_NAMED, for a page with themes of its own
 * (embedderPalette.ts). A message without it leaves the palette as it is.
 *
 * The app sends `ready` once it is listening, and the page answers it with its
 * current scheme. Without that, a scheme posted when the frame loads is lost: `load`
 * fires before the app has mounted, so nothing is listening yet.
 *
 * Only the direct parent is heard, and only from the origin the app was framed by.
 * Whoever frames the app has already passed the CSP's frame-ancestors, and a colour
 * scheme is all a message can change.
 */
export const EMBEDDER_SET_THEME_MESSAGE = "onyxia:set-theme";
export const EMBEDDER_THEME_READY_MESSAGE = "onyxia:theme-ready";

/** `true` for dark, `false` for light, `undefined` for anything else. */
export function parseEmbedderSetThemeMessage(data: unknown): boolean | undefined {
    if (typeof data !== "object" || data === null) {
        return undefined;
    }

    const { type, theme } = data as Record<string, unknown>;

    if (type !== EMBEDDER_SET_THEME_MESSAGE) {
        return undefined;
    }

    switch (theme) {
        case "dark":
            return true;
        case "light":
            return false;
        default:
            return undefined;
    }
}

/** The palette a valid `set-theme` message names, `undefined` when it names none. */
export function parseEmbedderPaletteName(data: unknown): string | undefined {
    if (parseEmbedderSetThemeMessage(data) === undefined) {
        return undefined;
    }

    const { palette } = data as Record<string, unknown>;

    return typeof palette === "string" ? palette : undefined;
}

/**
 * Listen for the embedder's scheme and palette, and tell it the app is ready for them.
 * Does nothing, and returns a no-op, when the app is not framed.
 */
export function listenToEmbedderTheme(params: {
    onIsDarkModeEnabled: (isDarkModeEnabled: boolean) => void;
    onPaletteName?: (paletteName: string) => void;
    win?: Window;
}): () => void {
    const { onIsDarkModeEnabled, onPaletteName, win = window } = params;

    const embedderOrigin = getEmbedderOrigin(win);

    if (embedderOrigin === undefined) {
        return () => {};
    }

    const onMessage = (event: MessageEvent) => {
        if (event.source !== win.parent || event.origin !== embedderOrigin) {
            return;
        }

        const isDarkModeEnabled = parseEmbedderSetThemeMessage(event.data);

        if (isDarkModeEnabled === undefined) {
            return;
        }

        // The palette first: when both change, the app is drawn once, in both.
        const paletteName = parseEmbedderPaletteName(event.data);

        if (paletteName !== undefined) {
            onPaletteName?.(paletteName);
        }

        onIsDarkModeEnabled(isDarkModeEnabled);
    };

    win.addEventListener("message", onMessage);

    win.parent.postMessage({ type: EMBEDDER_THEME_READY_MESSAGE }, embedderOrigin);

    return () => win.removeEventListener("message", onMessage);
}
