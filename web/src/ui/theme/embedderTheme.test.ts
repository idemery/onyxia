import { describe, it, expect } from "vitest";
import {
    EMBEDDER_SET_THEME_MESSAGE,
    EMBEDDER_THEME_READY_MESSAGE,
    listenToEmbedderTheme,
    parseEmbedderSetThemeMessage
} from "./embedderTheme";

describe("parseEmbedderSetThemeMessage", () => {
    it("reads the scheme the way the `theme` URL parameter does", () => {
        expect(
            parseEmbedderSetThemeMessage({
                type: EMBEDDER_SET_THEME_MESSAGE,
                theme: "dark"
            })
        ).toBe(true);
        expect(
            parseEmbedderSetThemeMessage({
                type: EMBEDDER_SET_THEME_MESSAGE,
                theme: "light"
            })
        ).toBe(false);
    });

    it("ignores anything else", () => {
        expect(
            parseEmbedderSetThemeMessage({
                type: EMBEDDER_SET_THEME_MESSAGE,
                theme: "blue"
            })
        ).toBeUndefined();
        expect(
            parseEmbedderSetThemeMessage({
                type: "onyxia:s3-objects-drag-end",
                theme: "dark"
            })
        ).toBeUndefined();
        expect(parseEmbedderSetThemeMessage("dark")).toBeUndefined();
        expect(parseEmbedderSetThemeMessage(null)).toBeUndefined();
    });
});

describe("listenToEmbedderTheme", () => {
    const EMBEDDER = "https://maktab.example";

    function framedWindow() {
        const posted: { message: unknown; targetOrigin: string }[] = [];
        const parent = {
            postMessage: (message: unknown, targetOrigin: string) =>
                posted.push({ message, targetOrigin })
        };
        let listener: ((event: MessageEvent) => void) | undefined;
        const win = {
            parent,
            location: { ancestorOrigins: [EMBEDDER] },
            document: { referrer: "" },
            addEventListener: (_: string, l: (event: MessageEvent) => void) =>
                (listener = l),
            removeEventListener: () => (listener = undefined)
        } as unknown as Window;
        const receive = (
            data: unknown,
            from: { source?: unknown; origin?: string } = {}
        ) =>
            listener?.({
                data,
                source: from.source ?? parent,
                origin: from.origin ?? EMBEDDER
            } as MessageEvent);
        return { win, posted, receive, isListening: () => listener !== undefined };
    }

    it("says it is ready, to the embedder's origin only", () => {
        const { win, posted } = framedWindow();
        listenToEmbedderTheme({ win, onIsDarkModeEnabled: () => {} });
        expect(posted).toEqual([
            { message: { type: EMBEDDER_THEME_READY_MESSAGE }, targetOrigin: EMBEDDER }
        ]);
    });

    it("follows the embedder's scheme", () => {
        const { win, receive } = framedWindow();
        const seen: boolean[] = [];
        listenToEmbedderTheme({ win, onIsDarkModeEnabled: v => seen.push(v) });
        receive({ type: EMBEDDER_SET_THEME_MESSAGE, theme: "light" });
        receive({ type: EMBEDDER_SET_THEME_MESSAGE, theme: "dark" });
        expect(seen).toEqual([false, true]);
    });

    it("hears only its parent, from the origin that framed it", () => {
        const { win, receive } = framedWindow();
        const seen: boolean[] = [];
        listenToEmbedderTheme({ win, onIsDarkModeEnabled: v => seen.push(v) });
        receive({ type: EMBEDDER_SET_THEME_MESSAGE, theme: "dark" }, { source: {} });
        receive(
            { type: EMBEDDER_SET_THEME_MESSAGE, theme: "dark" },
            { origin: "https://elsewhere.example" }
        );
        expect(seen).toEqual([]);
    });

    it("stops listening when disposed", () => {
        const { win, isListening } = framedWindow();
        const dispose = listenToEmbedderTheme({ win, onIsDarkModeEnabled: () => {} });
        expect(isListening()).toBe(true);
        dispose();
        expect(isListening()).toBe(false);
    });

    it("does nothing when the app is not framed", () => {
        const posted: unknown[] = [];
        const win = {
            location: {},
            document: { referrer: "" },
            postMessage: (m: unknown) => posted.push(m),
            addEventListener: () => posted.push("listening")
        } as unknown as Window;
        (win as unknown as { parent: Window }).parent = win;
        listenToEmbedderTheme({ win, onIsDarkModeEnabled: () => {} })();
        expect(posted).toEqual([]);
    });
});
