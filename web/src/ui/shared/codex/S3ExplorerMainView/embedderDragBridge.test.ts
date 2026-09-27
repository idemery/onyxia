import { describe, it, expect } from "vitest";
import { parseS3Uri } from "core/tools/S3Uri";
import {
    EMBEDDER_DRAG_END_MESSAGE,
    getEmbedderDragEndMessage,
    getEmbedderOrigin
} from "./embedderDragBridge";

const s3Uris = [parseS3Uri({ value: "s3://scratch/admin/a.csv", delimiter: "/" })];

function end(dropEffect: DataTransfer["dropEffect"], clientX = 650, clientY = 94) {
    return { clientX, clientY, dataTransfer: { dropEffect } as DataTransfer };
}

describe("getEmbedderDragEndMessage", () => {
    it("reports a drag nothing took, with the release point", () => {
        expect(getEmbedderDragEndMessage({ s3Uris, event: end("none") })).toEqual({
            type: EMBEDDER_DRAG_END_MESSAGE,
            s3Uris: ["s3://scratch/admin/a.csv"],
            clientX: 650,
            clientY: 94
        });
    });

    it("stays silent when something took the drop, so one gesture never acts twice", () => {
        expect(getEmbedderDragEndMessage({ s3Uris, event: end("copy") })).toBeUndefined();
    });

    it("stays silent for a cancelled drag reported at 0,0", () => {
        expect(getEmbedderDragEndMessage({ s3Uris, event: end("none", 0, 0) })).toBeUndefined();
    });

    it("stays silent when no rows were dragged", () => {
        expect(getEmbedderDragEndMessage({ s3Uris: [], event: end("none") })).toBeUndefined();
    });
});

describe("getEmbedderOrigin", () => {
    const framed = (loc: Partial<Location>, referrer = "") =>
        ({
            parent: {},
            location: loc,
            document: { referrer }
        }) as unknown as Window;

    it("is undefined when not framed", () => {
        const win = { location: {}, document: { referrer: "" } } as unknown as Window;
        (win as unknown as { parent: Window }).parent = win;
        expect(getEmbedderOrigin(win)).toBeUndefined();
    });

    it("prefers ancestorOrigins", () => {
        const loc = { ancestorOrigins: ["https://maktab.example"] } as unknown as Location;
        expect(getEmbedderOrigin(framed(loc, "https://other.example/x"))).toBe(
            "https://maktab.example"
        );
    });

    it("falls back to the referrer's origin", () => {
        expect(getEmbedderOrigin(framed({}, "https://maktab.example/os?x=1"))).toBe(
            "https://maktab.example"
        );
    });

    it("is undefined when neither is known, rather than posting to '*'", () => {
        expect(getEmbedderOrigin(framed({}))).toBeUndefined();
    });
});
