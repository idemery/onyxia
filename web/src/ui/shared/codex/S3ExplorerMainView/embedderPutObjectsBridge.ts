import { stringifyS3Uri, type S3Uri } from "core/tools/S3Uri";
import type { S3Client } from "core/ports/S3Client";
import type { PutObjectOutcome } from "core/usecases/s3ExplorerUiController";
import { getEmbedderOrigin } from "./embedderDragBridge";

/**
 * Letting the page that embeds the explorer hand it files to upload.
 *
 * WHY THIS EXISTS. A page that frames the explorer cross-origin cannot drop
 * anything into it: a drag that starts in the page and ends over the frame
 * reaches neither document, the same wall embedderDragBridge.ts describes from
 * the other side. So the page takes the drop itself, over the frame, and passes
 * the files in along with the point where they were let go.
 *
 * The explorer then does exactly what it does with files dropped from the
 * operating system: `onPutObjects`, with the visitor's own credentials. The
 * embedding page's own access to the store plays no part, so what the store
 * allows is what the visitor is allowed.
 *
 *     page → app   { type: "onyxia:put-objects", requestId, files: File[],
 *                    clientX, clientY }
 *     app → page   { type: "onyxia:put-objects-result", requestId, ok,
 *                    destination?, fileNames, error?, started? }
 *     app → page   { type: "onyxia:put-objects-ready" }
 *
 * WHERE THEY LAND. The point is in this frame's viewport. Over a folder row the
 * files go into that folder, anywhere else into the folder the explorer lists,
 * as a person dropping onto a file manager expects. The destination is part of
 * the answer, so the page can say where the files went.
 *
 * THE ANSWER IS WHAT HAPPENED, not what was attempted: `ok` only when every file
 * landed, `fileNames` the ones that did, and `error` why the others did not (a
 * store refusal, a cancelled upload, an existing object the visitor chose to
 * keep). When no folder is listed, or the listed one cannot take uploads, the
 * answer says so and nothing is uploaded anywhere.
 *
 * The app sends `ready` once it is listening, from the root, so a request is
 * answered whatever the app is showing. An embedder that never hears it is
 * talking to a build without this bridge. Only the direct parent is heard, only
 * from the origin that framed the app, and every answer goes to that origin
 * alone: an answer names objects in the store.
 */
export const EMBEDDER_PUT_OBJECTS_MESSAGE = "onyxia:put-objects";
export const EMBEDDER_PUT_OBJECTS_READY_MESSAGE = "onyxia:put-objects-ready";
export const EMBEDDER_PUT_OBJECTS_RESULT_MESSAGE = "onyxia:put-objects-result";

export type EmbedderPutObjectsRequest = {
    requestId: string;
    files: File[];
    /** Where the files were let go, in THIS frame's viewport coordinates. */
    clientX: number;
    clientY: number;
};

/** What the explorer answers to one request. */
export type EmbedderPutObjectsAnswer = {
    /** Every file landed. With `started`, every file was handed to the upload. */
    ok: boolean;
    /** The upload was started and its outcome could not be observed. */
    started?: true;
    /** The `s3://` URI of the prefix the files went, or were to go, into. */
    destination?: string;
    /** The files that landed there. */
    fileNames: string[];
    /** Why the others did not, for a person to read. */
    error?: string;
};

export type EmbedderPutObjectsResultMessage = EmbedderPutObjectsAnswer & {
    type: typeof EMBEDDER_PUT_OBJECTS_RESULT_MESSAGE;
    requestId: string;
};

export type EmbedderPutObjectsHandler = (
    request: EmbedderPutObjectsRequest
) => Promise<EmbedderPutObjectsAnswer>;

export const NO_FOLDER_IS_LISTED_ERROR =
    "No folder is open in the explorer. Open the folder the files should go into, then drop them on it.";

/**
 * A request from the embedder, or `undefined` for any other message. A request
 * that cannot be carried out is refused whole, with the reason, rather than
 * partly carried out: a person who dropped five files should not have to work
 * out which four of them arrived.
 */
export function parseEmbedderPutObjectsMessage(
    data: unknown
):
    | { isValid: true; request: EmbedderPutObjectsRequest }
    | { isValid: false; requestId: string; error: string }
    | undefined {
    if (typeof data !== "object" || data === null) {
        return undefined;
    }

    const { type, requestId, files, clientX, clientY } = data as Record<string, unknown>;

    if (type !== EMBEDDER_PUT_OBJECTS_MESSAGE) {
        return undefined;
    }

    // Without an id there is nobody to answer, so there is nothing to do.
    if (typeof requestId !== "string" || requestId === "") {
        return undefined;
    }

    const refuse = (error: string) => ({ isValid: false as const, requestId, error });

    if (!Array.isArray(files) || files.length === 0) {
        return refuse("No files were sent.");
    }

    if (!files.every((file): file is File => file instanceof File)) {
        return refuse(
            "Only files can be uploaded, and one of the items sent is not a file."
        );
    }

    const fileNames = files.map(file => file.name);

    // A name is the last segment of the key. One with a delimiter in it would
    // land in a folder nobody dropped it on.
    if (fileNames.some(fileName => fileName === "" || fileName.includes("/"))) {
        return refuse("A file name must not be empty or contain '/'.");
    }

    const duplicateFileName = fileNames.find(
        (fileName, index) => fileNames.indexOf(fileName) !== index
    );

    if (duplicateFileName !== undefined) {
        return refuse(
            `More than one of the files is named ${duplicateFileName}, and they would overwrite each other. Drop them one at a time.`
        );
    }

    if (
        typeof clientX !== "number" ||
        typeof clientY !== "number" ||
        !Number.isFinite(clientX) ||
        !Number.isFinite(clientY)
    ) {
        return refuse("The point where the files were dropped is missing.");
    }

    return { isValid: true, request: { requestId, files, clientX, clientY } };
}

/**
 * The attribute a listing row carries its item's URI in. The list is
 * virtualized, so a row's position says nothing about which item it shows; the
 * attribute does.
 */
export const ROW_S3_URI_ATTRIBUTE = "data-s3-uri";

/** The URI of the listing row an element is part of, if it is part of one. */
export function getS3UriOfRowAt(
    element: Pick<Element, "closest"> | null
): string | undefined {
    return (
        element
            ?.closest(`[${ROW_S3_URI_ATTRIBUTE}]`)
            ?.getAttribute(ROW_S3_URI_ATTRIBUTE) ?? undefined
    );
}

/**
 * Where files dropped at a point go, or why they cannot.
 *
 * `itemUnderPoint` is the item of the row under the drop point, if any. Into a
 * prefix row's folder when it is one, else into the listed prefix: an object
 * row, a header or the empty space below the rows all mean "here". The upload is
 * relative to the listed prefix (that is what `onPutObjects` takes), hence the
 * relative segments.
 *
 * Refused wherever the explorer refuses its own upload to the listed prefix
 * (`isUploadToListedPrefixDisabled`, the reason named where it can be), and
 * while it is still listing: the upload is based on the prefix being opened,
 * which is not yet the one on screen, so the rows under the point belong to a
 * folder the files would not go into.
 */
export function getEmbedderPutObjectsTarget(params: {
    listedPrefix: { s3Uri: S3Uri } & (
        | { isErrored: true; error: S3Client.ListObjectsReturn.Error }
        | { isErrored: false }
    );
    isListing: boolean;
    isUploadToListedPrefixDisabled: boolean;
    itemUnderPoint: { type: "prefix segment" | "object"; s3Uri: S3Uri } | undefined;
}):
    | { isRefused: true; answer: EmbedderPutObjectsAnswer }
    | {
          isRefused: false;
          destinationS3Uri: S3Uri.TerminatedByDelimiter;
          relativePathSegments: string[];
      } {
    const { listedPrefix, isListing, isUploadToListedPrefixDisabled, itemUnderPoint } =
        params;

    const listedPrefixS3Uri = listedPrefix.s3Uri;

    if (!listedPrefixS3Uri.isDelimiterTerminated) {
        return {
            isRefused: true,
            answer: {
                ok: false,
                fileNames: [],
                error: "The explorer is showing a file, not a folder. Open a folder, then drop the files on it."
            }
        };
    }

    const destination = stringifyS3Uri(listedPrefixS3Uri);

    const refuse = (error: string) => ({
        isRefused: true as const,
        answer: { ok: false, destination, fileNames: [], error }
    });

    if (listedPrefix.isErrored) {
        return refuse(
            `${destination} could not be listed (${getListErrorDescription(listedPrefix.error)}), so nothing was uploaded to it.`
        );
    }

    if (isListing) {
        return refuse(
            "The explorer is still opening a folder. Drop the files again once it is open."
        );
    }

    if (isUploadToListedPrefixDisabled) {
        return refuse(`The explorer cannot upload to ${destination}.`);
    }

    if (
        itemUnderPoint !== undefined &&
        itemUnderPoint.type === "prefix segment" &&
        itemUnderPoint.s3Uri.isDelimiterTerminated
    ) {
        const relativePathSegments = getRelativeKeySegments({
            prefixS3Uri: listedPrefixS3Uri,
            s3Uri: itemUnderPoint.s3Uri
        });

        if (relativePathSegments !== undefined && relativePathSegments.length !== 0) {
            return {
                isRefused: false,
                destinationS3Uri: itemUnderPoint.s3Uri,
                relativePathSegments
            };
        }
    }

    return {
        isRefused: false,
        destinationS3Uri: listedPrefixS3Uri,
        relativePathSegments: []
    };
}

/**
 * The answer, from what `onPutObjects` reported for each file. `outcomes` is
 * `undefined` when it reported nothing to wait on, and then the only honest
 * answer is that the upload was started.
 */
export function getEmbedderPutObjectsAnswer(params: {
    destinationS3Uri: S3Uri.TerminatedByDelimiter;
    fileNames: string[];
    outcomes: PutObjectOutcome[] | undefined;
}): EmbedderPutObjectsAnswer {
    const { destinationS3Uri, fileNames, outcomes } = params;

    const destination = stringifyS3Uri(destinationS3Uri);

    if (outcomes === undefined) {
        return { ok: true, started: true, destination, fileNames };
    }

    const landedFileNames: string[] = [];
    const reasons: { fileName: string; reason: string }[] = [];

    for (const fileName of fileNames) {
        const outcome = outcomes.find(
            ({ s3Uri }) => s3Uri.keySegments.at(-1) === fileName
        );

        const reason = (() => {
            switch (outcome?.status) {
                case "uploaded":
                    return undefined;
                case "failed":
                    return outcome.errorMessage;
                case "canceled":
                    return "The upload was cancelled.";
                case "not overwritten":
                    return "A file with this name is already there, and it was kept.";
                case undefined:
                    return "Nothing was reported for it.";
            }
        })();

        if (reason === undefined) {
            landedFileNames.push(fileName);
            continue;
        }

        reasons.push({ fileName, reason });
    }

    if (reasons.length === 0) {
        return { ok: true, destination, fileNames: landedFileNames };
    }

    return {
        ok: false,
        destination,
        fileNames: landedFileNames,
        // The page names the file itself when there was only one.
        error:
            fileNames.length === 1
                ? reasons[0].reason
                : reasons
                      .map(({ fileName, reason }) => `${fileName}: ${reason}`)
                      .join("; ")
    };
}

const handlers: EmbedderPutObjectsHandler[] = [];

/**
 * Make `handler` the one that answers requests, for as long as the explorer
 * that owns it is on screen. Returns the function that takes it back. With none
 * registered, a request is answered with `NO_FOLDER_IS_LISTED_ERROR`.
 */
export function registerEmbedderPutObjectsHandler(
    handler: EmbedderPutObjectsHandler
): () => void {
    handlers.push(handler);

    return () => {
        const index = handlers.lastIndexOf(handler);

        if (index !== -1) {
            handlers.splice(index, 1);
        }
    };
}

export function getEmbedderPutObjectsHandler(): EmbedderPutObjectsHandler | undefined {
    return handlers.at(-1);
}

/**
 * Answer the embedder's requests, and tell it the app takes them. Does nothing,
 * and returns a no-op, when the app is not framed.
 */
export function listenToEmbedderPutObjects(
    params: {
        getHandler?: () => EmbedderPutObjectsHandler | undefined;
        win?: Window;
    } = {}
): () => void {
    const { getHandler = getEmbedderPutObjectsHandler, win = window } = params;

    const embedderOrigin = getEmbedderOrigin(win);

    if (embedderOrigin === undefined) {
        return () => {};
    }

    const postAnswer = (requestId: string, answer: EmbedderPutObjectsAnswer) => {
        const message: EmbedderPutObjectsResultMessage = {
            type: EMBEDDER_PUT_OBJECTS_RESULT_MESSAGE,
            requestId,
            ...answer
        };

        win.parent.postMessage(message, embedderOrigin);
    };

    const onMessage = (event: MessageEvent) => {
        if (event.source !== win.parent || event.origin !== embedderOrigin) {
            return;
        }

        const parsed = parseEmbedderPutObjectsMessage(event.data);

        if (parsed === undefined) {
            return;
        }

        if (!parsed.isValid) {
            postAnswer(parsed.requestId, {
                ok: false,
                fileNames: [],
                error: parsed.error
            });
            return;
        }

        const { request } = parsed;

        const handler = getHandler();

        if (handler === undefined) {
            postAnswer(request.requestId, {
                ok: false,
                fileNames: [],
                error: NO_FOLDER_IS_LISTED_ERROR
            });
            return;
        }

        handler(request).then(
            answer => postAnswer(request.requestId, answer),
            error =>
                postAnswer(request.requestId, {
                    ok: false,
                    fileNames: [],
                    error: error instanceof Error ? error.message : String(error)
                })
        );
    };

    win.addEventListener("message", onMessage);

    win.parent.postMessage({ type: EMBEDDER_PUT_OBJECTS_READY_MESSAGE }, embedderOrigin);

    return () => win.removeEventListener("message", onMessage);
}

function getRelativeKeySegments(params: {
    prefixS3Uri: S3Uri.TerminatedByDelimiter;
    s3Uri: S3Uri;
}): string[] | undefined {
    const { prefixS3Uri, s3Uri } = params;

    if (
        s3Uri.bucket !== prefixS3Uri.bucket ||
        s3Uri.delimiter !== prefixS3Uri.delimiter ||
        s3Uri.keySegments.length < prefixS3Uri.keySegments.length ||
        prefixS3Uri.keySegments.some((segment, i) => s3Uri.keySegments[i] !== segment)
    ) {
        return undefined;
    }

    return s3Uri.keySegments.slice(prefixS3Uri.keySegments.length);
}

function getListErrorDescription(error: S3Client.ListObjectsReturn.Error): string {
    return error.isKnownError ? error.errorCase : error.errorMessage;
}
