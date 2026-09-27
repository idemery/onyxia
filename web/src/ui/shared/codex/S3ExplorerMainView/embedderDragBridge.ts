import { stringifyS3Uri, type S3Uri } from "core/tools/S3Uri";

/**
 * Telling the page that embeds the explorer where a drag of S3 objects ended.
 *
 * WHY THIS EXISTS. When the explorer runs inside an iframe, a drag of its rows
 * cannot be dropped on the embedding page. Chromium refuses any drop from a
 * cross-origin frame into its parent, even between two subdomains of one site.
 * The parent receives no `dragover` and no `drop`, and the drag ends here with
 * `dropEffect === "none"`. That was measured in Chromium 154 (a same-origin
 * frame's drop IS delivered; same-site and cross-site frames are both refused).
 * So the payload `setS3ObjectsDragData` publishes never reaches the embedder,
 * whatever the embedder does.
 *
 * What does survive is `dragend` on the source. It still reports where the
 * pointer was released, in this frame's viewport coordinates, which may be
 * outside the frame. So the explorer posts the dragged URIs and that point to
 * the parent, and the parent decides what lies under it.
 *
 * Only a drag that NOTHING took is reported. A drop onto a prefix row inside
 * the explorer, onto another application, or onto the parent in a browser
 * that allows it, all end with a real `dropEffect`. Reporting those too would
 * act on one gesture twice.
 */
export const EMBEDDER_DRAG_END_MESSAGE = "onyxia:s3-objects-drag-end";

export type EmbedderDragEndMessage = {
    type: typeof EMBEDDER_DRAG_END_MESSAGE;
    s3Uris: string[];
    /** Release point, in THIS frame's viewport coordinates. */
    clientX: number;
    clientY: number;
};

/**
 * The origin of the page embedding this one, or `undefined` when there is
 * none or it cannot be known. The message is posted to exactly that origin,
 * never to `*`: the payload names objects in the store.
 *
 * `ancestorOrigins` is Chromium and WebKit. `document.referrer` is the fallback
 * for Firefox, and it carries the parent's origin under the default referrer
 * policy.
 */
export function getEmbedderOrigin(win: Window = window): string | undefined {
    if (win.parent === win) {
        return undefined;
    }

    const fromAncestors = win.location.ancestorOrigins?.[0];

    if (fromAncestors !== undefined && fromAncestors !== "null") {
        return fromAncestors;
    }

    try {
        return win.document.referrer === ""
            ? undefined
            : new URL(win.document.referrer).origin;
    } catch {
        return undefined;
    }
}

export function getEmbedderDragEndMessage(params: {
    s3Uris: S3Uri[];
    event: Pick<DragEvent, "clientX" | "clientY" | "dataTransfer">;
}): EmbedderDragEndMessage | undefined {
    const { s3Uris, event } = params;

    if (s3Uris.length === 0) {
        return undefined;
    }

    // Something took it: the explorer itself, another app, or the embedder.
    if ((event.dataTransfer?.dropEffect ?? "none") !== "none") {
        return undefined;
    }

    // Some browsers report 0,0 for a drag cancelled by Escape. That is not a
    // place the pointer was released, and acting on it would copy the objects
    // to whatever sits in the parent's corner.
    if (event.clientX === 0 && event.clientY === 0) {
        return undefined;
    }

    return {
        type: EMBEDDER_DRAG_END_MESSAGE,
        s3Uris: s3Uris.map(stringifyS3Uri),
        clientX: event.clientX,
        clientY: event.clientY
    };
}
