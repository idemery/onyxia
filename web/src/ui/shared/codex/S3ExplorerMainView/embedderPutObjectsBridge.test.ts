import { describe, it, expect } from "vitest";
import { parseS3Uri, type S3Uri } from "core/tools/S3Uri";
import type { PutObjectOutcome } from "core/usecases/s3ExplorerUiController";
import {
    EMBEDDER_PUT_OBJECTS_MESSAGE,
    EMBEDDER_PUT_OBJECTS_READY_MESSAGE,
    EMBEDDER_PUT_OBJECTS_RESULT_MESSAGE,
    NO_FOLDER_IS_LISTED_ERROR,
    getEmbedderPutObjectsAnswer,
    getEmbedderPutObjectsHandler,
    getEmbedderPutObjectsTarget,
    getS3UriOfRowAt,
    listenToEmbedderPutObjects,
    parseEmbedderPutObjectsMessage,
    registerEmbedderPutObjectsHandler,
    type EmbedderPutObjectsHandler
} from "./embedderPutObjectsBridge";

const prefix = (value: string) =>
    parseS3Uri({ value, delimiter: "/" }) as S3Uri.TerminatedByDelimiter;
const object = (value: string) =>
    parseS3Uri({ value, delimiter: "/" }) as S3Uri.NonTerminatedByDelimiter;

const csv = (name: string) => new File(["id,name\n1,a\n"], name, { type: "text/csv" });

function request(over: Record<string, unknown> = {}) {
    return {
        type: EMBEDDER_PUT_OBJECTS_MESSAGE,
        requestId: "r1",
        files: [csv("customers.csv")],
        clientX: 30,
        clientY: 40,
        ...over
    };
}

describe("parseEmbedderPutObjectsMessage", () => {
    it("reads a request: the files and the point they were let go at", () => {
        const files = [csv("customers.csv"), csv("orders.csv")];
        expect(parseEmbedderPutObjectsMessage(request({ files }))).toEqual({
            isValid: true,
            request: { requestId: "r1", files, clientX: 30, clientY: 40 }
        });
    });

    it("ignores any other message, and one it could not answer", () => {
        expect(
            parseEmbedderPutObjectsMessage(request({ type: "onyxia:set-theme" }))
        ).toBeUndefined();
        expect(
            parseEmbedderPutObjectsMessage(
                request({ type: "onyxia:s3-objects-drag-end" })
            )
        ).toBeUndefined();
        expect(parseEmbedderPutObjectsMessage("onyxia:put-objects")).toBeUndefined();
        expect(parseEmbedderPutObjectsMessage(null)).toBeUndefined();
        // No id: nobody to answer.
        expect(
            parseEmbedderPutObjectsMessage(request({ requestId: undefined }))
        ).toBeUndefined();
        expect(
            parseEmbedderPutObjectsMessage(request({ requestId: "" }))
        ).toBeUndefined();
    });

    it("refuses the whole request when any entry is not a file", () => {
        // A Blob has no name, so there is nothing to call the object; a look-alike
        // object has no bytes at all.
        for (const intruder of [
            new Blob(["x"]),
            "customers.csv",
            { name: "customers.csv", size: 3 }
        ]) {
            const parsed = parseEmbedderPutObjectsMessage(
                request({ files: [csv("orders.csv"), intruder] })
            );
            expect(parsed).toMatchObject({ isValid: false, requestId: "r1" });
        }
    });

    it("refuses a request with no files", () => {
        expect(parseEmbedderPutObjectsMessage(request({ files: [] }))).toMatchObject({
            isValid: false,
            requestId: "r1"
        });
        expect(
            parseEmbedderPutObjectsMessage(request({ files: undefined }))
        ).toMatchObject({ isValid: false });
    });

    it("refuses a name that would put the file in a folder nobody dropped it on", () => {
        expect(
            parseEmbedderPutObjectsMessage(request({ files: [csv("raw/customers.csv")] }))
        ).toMatchObject({ isValid: false });
    });

    it("refuses two files of the same name, which would overwrite each other", () => {
        const parsed = parseEmbedderPutObjectsMessage(
            request({ files: [csv("a.csv"), csv("a.csv")] })
        );
        expect(parsed).toMatchObject({ isValid: false });
        expect(parsed?.isValid === false && parsed.error).toContain("a.csv");
    });

    it("refuses a request without a usable drop point", () => {
        expect(
            parseEmbedderPutObjectsMessage(request({ clientX: Number.NaN }))
        ).toMatchObject({ isValid: false });
        expect(parseEmbedderPutObjectsMessage(request({ clientY: "40" }))).toMatchObject({
            isValid: false
        });
    });
});

describe("getS3UriOfRowAt", () => {
    const at = (rowUri: string | undefined) =>
        ({
            closest: (selector: string) =>
                selector === "[data-s3-uri]" && rowUri !== undefined
                    ? {
                          getAttribute: (name: string) =>
                              name === "data-s3-uri" ? rowUri : null
                      }
                    : null
        }) as unknown as Element;

    it("finds the row an element under the point belongs to", () => {
        expect(getS3UriOfRowAt(at("s3://hive/raw/"))).toBe("s3://hive/raw/");
    });

    it("is undefined outside every row, and outside the viewport", () => {
        expect(getS3UriOfRowAt(at(undefined))).toBeUndefined();
        expect(getS3UriOfRowAt(null)).toBeUndefined();
    });
});

describe("getEmbedderPutObjectsTarget", () => {
    const listed = { s3Uri: prefix("s3://hive/"), isErrored: false as const };

    const target = (over: Partial<Parameters<typeof getEmbedderPutObjectsTarget>[0]>) =>
        getEmbedderPutObjectsTarget({
            listedPrefix: listed,
            isListing: false,
            isUploadToListedPrefixDisabled: false,
            itemUnderPoint: undefined,
            ...over
        });

    it("puts files dropped on a folder row INTO that folder", () => {
        expect(
            target({
                itemUnderPoint: {
                    type: "prefix segment",
                    s3Uri: prefix("s3://hive/raw/")
                }
            })
        ).toEqual({
            isRefused: false,
            destinationS3Uri: prefix("s3://hive/raw/"),
            relativePathSegments: ["raw"]
        });
    });

    it("puts files dropped on a file row into the folder being listed", () => {
        expect(
            target({
                itemUnderPoint: { type: "object", s3Uri: object("s3://hive/orders.csv") }
            })
        ).toEqual({
            isRefused: false,
            destinationS3Uri: prefix("s3://hive/"),
            relativePathSegments: []
        });
    });

    it("puts files dropped on empty space into the folder being listed", () => {
        expect(target({})).toEqual({
            isRefused: false,
            destinationS3Uri: prefix("s3://hive/"),
            relativePathSegments: []
        });
    });

    it("never aims at a row that is not in the listed folder", () => {
        expect(
            target({
                itemUnderPoint: {
                    type: "prefix segment",
                    s3Uri: prefix("s3://other/raw/")
                }
            })
        ).toMatchObject({ isRefused: false, destinationS3Uri: prefix("s3://hive/") });
    });

    it("refuses, with the reason, where the explorer's own upload is disabled", () => {
        const answer = target({
            isUploadToListedPrefixDisabled: true,
            itemUnderPoint: { type: "prefix segment", s3Uri: prefix("s3://hive/raw/") }
        });
        expect(answer).toMatchObject({
            isRefused: true,
            answer: { ok: false, destination: "s3://hive/", fileNames: [] }
        });
        expect(answer.isRefused && answer.answer.error).toContain("s3://hive/");
    });

    it("refuses a folder that could not be listed", () => {
        expect(
            target({
                listedPrefix: {
                    s3Uri: prefix("s3://hive/"),
                    isErrored: true,
                    error: {
                        isSuccess: false,
                        isKnownError: true,
                        errorCase: "access denied"
                    }
                }
            })
        ).toMatchObject({
            isRefused: true,
            answer: { ok: false, error: expect.stringContaining("access denied") }
        });
    });

    it("refuses while a folder is still opening, when the rows on screen are the old one's", () => {
        expect(target({ isListing: true })).toMatchObject({ isRefused: true });
    });

    it("refuses when the explorer shows a file rather than a folder", () => {
        expect(
            target({
                listedPrefix: { s3Uri: object("s3://hive/a.csv"), isErrored: false }
            })
        ).toEqual({
            isRefused: true,
            answer: {
                ok: false,
                fileNames: [],
                error: expect.stringContaining("not a folder")
            }
        });
    });
});

describe("getEmbedderPutObjectsAnswer", () => {
    const destinationS3Uri = prefix("s3://hive/raw/");
    const outcome = (fileName: string, rest: Record<string, unknown>) =>
        ({ s3Uri: object(`s3://hive/raw/${fileName}`), ...rest }) as PutObjectOutcome;

    it("reports every file that landed, and where", () => {
        expect(
            getEmbedderPutObjectsAnswer({
                destinationS3Uri,
                fileNames: ["a.csv", "b.csv"],
                outcomes: [
                    outcome("b.csv", { status: "uploaded" }),
                    outcome("a.csv", { status: "uploaded" })
                ]
            })
        ).toEqual({
            ok: true,
            destination: "s3://hive/raw/",
            fileNames: ["a.csv", "b.csv"]
        });
    });

    it("passes the store's refusal on, and claims nothing landed", () => {
        expect(
            getEmbedderPutObjectsAnswer({
                destinationS3Uri,
                fileNames: ["a.csv"],
                outcomes: [
                    outcome("a.csv", { status: "failed", errorMessage: "Access Denied" })
                ]
            })
        ).toEqual({
            ok: false,
            destination: "s3://hive/raw/",
            fileNames: [],
            error: "Access Denied"
        });
    });

    it("names which files did not land when some did", () => {
        const answer = getEmbedderPutObjectsAnswer({
            destinationS3Uri,
            fileNames: ["a.csv", "b.csv", "c.csv"],
            outcomes: [
                outcome("a.csv", { status: "uploaded" }),
                outcome("b.csv", { status: "not overwritten" }),
                outcome("c.csv", { status: "canceled" })
            ]
        });
        expect(answer).toMatchObject({ ok: false, fileNames: ["a.csv"] });
        expect(answer.error).toMatch(/^b\.csv: .*kept.*; c\.csv: .*cancelled/);
    });

    it("does not count a file nothing was reported for", () => {
        expect(
            getEmbedderPutObjectsAnswer({
                destinationS3Uri,
                fileNames: ["a.csv"],
                outcomes: []
            })
        ).toMatchObject({ ok: false, fileNames: [] });
    });

    it("says only that the upload started when there is no outcome to observe", () => {
        expect(
            getEmbedderPutObjectsAnswer({
                destinationS3Uri,
                fileNames: ["a.csv"],
                outcomes: undefined
            })
        ).toEqual({
            ok: true,
            started: true,
            destination: "s3://hive/raw/",
            fileNames: ["a.csv"]
        });
    });
});

describe("registerEmbedderPutObjectsHandler", () => {
    it("answers with the explorer on screen, and with none once it is gone", async () => {
        const first: EmbedderPutObjectsHandler = async () => ({
            ok: true,
            fileNames: []
        });
        const second: EmbedderPutObjectsHandler = async () => ({
            ok: true,
            fileNames: []
        });

        const disposeFirst = registerEmbedderPutObjectsHandler(first);
        const disposeSecond = registerEmbedderPutObjectsHandler(second);
        expect(getEmbedderPutObjectsHandler()).toBe(second);

        disposeSecond();
        expect(getEmbedderPutObjectsHandler()).toBe(first);

        disposeFirst();
        expect(getEmbedderPutObjectsHandler()).toBeUndefined();
    });
});

describe("listenToEmbedderPutObjects", () => {
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
        const answers = () =>
            posted.filter(
                ({ message }) =>
                    (message as { type: string }).type ===
                    EMBEDDER_PUT_OBJECTS_RESULT_MESSAGE
            );
        return {
            win,
            posted,
            receive,
            answers,
            isListening: () => listener !== undefined
        };
    }

    const settle = () => new Promise(resolve => setTimeout(resolve, 0));

    it("says it takes files, to the embedder's origin only", () => {
        const { win, posted } = framedWindow();
        listenToEmbedderPutObjects({ win, getHandler: () => undefined });
        expect(posted).toEqual([
            {
                message: { type: EMBEDDER_PUT_OBJECTS_READY_MESSAGE },
                targetOrigin: EMBEDDER
            }
        ]);
    });

    it("hands a request to the explorer and posts its answer back, to that origin", async () => {
        const { win, receive, answers } = framedWindow();
        const seen: unknown[] = [];
        listenToEmbedderPutObjects({
            win,
            getHandler: () => async request => {
                seen.push(request);
                return {
                    ok: true,
                    destination: "s3://hive/",
                    fileNames: request.files.map(file => file.name)
                };
            }
        });
        const files = [csv("customers.csv")];
        receive(request({ files }));
        await settle();
        expect(seen).toEqual([{ requestId: "r1", files, clientX: 30, clientY: 40 }]);
        expect(answers()).toEqual([
            {
                message: {
                    type: EMBEDDER_PUT_OBJECTS_RESULT_MESSAGE,
                    requestId: "r1",
                    ok: true,
                    destination: "s3://hive/",
                    fileNames: ["customers.csv"]
                },
                targetOrigin: EMBEDDER
            }
        ]);
    });

    it("hears only its parent, from the origin that framed it", async () => {
        const { win, receive, answers } = framedWindow();
        let calls = 0;
        listenToEmbedderPutObjects({
            win,
            getHandler: () => async () => {
                calls++;
                return { ok: true, fileNames: [] };
            }
        });
        receive(request(), { source: {} });
        receive(request(), { origin: "https://elsewhere.example" });
        await settle();
        expect(calls).toBe(0);
        expect(answers()).toEqual([]);
    });

    it("answers a request it refuses, rather than leaving the embedder waiting", async () => {
        const { win, receive, answers } = framedWindow();
        let calls = 0;
        listenToEmbedderPutObjects({
            win,
            getHandler: () => async () => {
                calls++;
                return { ok: true, fileNames: [] };
            }
        });
        receive(request({ files: [csv("a.csv"), "not a file"] }));
        await settle();
        expect(calls).toBe(0);
        expect(answers()).toMatchObject([
            {
                message: { requestId: "r1", ok: false, fileNames: [] },
                targetOrigin: EMBEDDER
            }
        ]);
    });

    it("says so when no folder is open to put the files in", async () => {
        const { win, receive, answers } = framedWindow();
        listenToEmbedderPutObjects({ win, getHandler: () => undefined });
        receive(request());
        await settle();
        expect(answers()).toEqual([
            {
                message: {
                    type: EMBEDDER_PUT_OBJECTS_RESULT_MESSAGE,
                    requestId: "r1",
                    ok: false,
                    fileNames: [],
                    error: NO_FOLDER_IS_LISTED_ERROR
                },
                targetOrigin: EMBEDDER
            }
        ]);
    });

    it("answers a handler that throws with what it threw", async () => {
        const { win, receive, answers } = framedWindow();
        listenToEmbedderPutObjects({
            win,
            getHandler: () => async () => {
                throw new Error("the session expired");
            }
        });
        receive(request());
        await settle();
        expect(answers()).toMatchObject([
            { message: { ok: false, error: "the session expired" } }
        ]);
    });

    it("stops listening when disposed", () => {
        const { win, isListening } = framedWindow();
        const dispose = listenToEmbedderPutObjects({ win, getHandler: () => undefined });
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
        listenToEmbedderPutObjects({ win, getHandler: () => undefined })();
        expect(posted).toEqual([]);
    });
});
