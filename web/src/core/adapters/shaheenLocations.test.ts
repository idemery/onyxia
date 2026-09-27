import { describe, expect, it, vi, afterEach } from "vitest";
import type { S3Config } from "core/ports/OnyxiaApi/S3Config";
import {
    fetchShaheenLocations,
    mergeShaheenLocations,
    parseShaheenLocations
} from "./shaheenLocations";

const config = (): S3Config => ({
    defaultValuesOfCreationForm: undefined,
    entries: [
        {
            url: "https://s3.example",
            pathStyleAccess: true,
            region: undefined,
            anonymousProfileName: undefined,
            sts: {
                url: undefined,
                durationSeconds: undefined,
                roles: [],
                oidcParams: {} as never
            },
            bookmarks: [
                {
                    s3UriStr: "s3://iceberg/",
                    title: "Lakehouse",
                    forProfileNames: ["default"],
                    isTemplated: false
                }
            ]
        }
    ]
});

describe("parseShaheenLocations", () => {
    it("keeps well-formed entries and drops the rest", () => {
        expect(
            parseShaheenLocations({
                locations: [
                    { s3Uri: "s3://sharepoint/", bucket: "sharepoint", prefix: "", level: "read" },
                    { s3Uri: "s3://other/", bucket: "sharepoint" },
                    { s3Uri: "s3:///", bucket: "" },
                    "nope"
                ]
            })
        ).toEqual([
            { s3Uri: "s3://sharepoint/", bucket: "sharepoint", prefix: "", level: "read" }
        ]);
        expect(parseShaheenLocations(null)).toEqual([]);
        expect(parseShaheenLocations({ locations: "x" })).toEqual([]);
    });
});

describe("mergeShaheenLocations", () => {
    it("appends after the configured bookmarks without repeating one", () => {
        const merged = mergeShaheenLocations({
            s3Config: config(),
            locations: [
                { s3Uri: "s3://iceberg/", bucket: "iceberg", prefix: "", level: "admin" },
                { s3Uri: "s3://raw/team/a/", bucket: "raw", prefix: "team/a/", level: "read" },
                { s3Uri: "s3://sharepoint/", bucket: "sharepoint", prefix: "", level: "read" }
            ]
        });
        expect(merged.entries[0].bookmarks.map(b => [b.s3UriStr, b.title])).toEqual([
            ["s3://iceberg/", "Lakehouse"],
            ["s3://raw/team/a/", "raw/team/a"],
            ["s3://sharepoint/", "sharepoint"]
        ]);
        // Shown on every profile.
        expect(merged.entries[0].bookmarks[2].forProfileNames).toEqual([]);
    });

    it("leaves the config untouched when there is nothing to add", () => {
        const c = config();
        expect(mergeShaheenLocations({ s3Config: c, locations: [] })).toBe(c);
    });
});

describe("fetchShaheenLocations", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("sends the Maktab cookie and parses the answer", async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                locations: [{ s3Uri: "s3://guide/", bucket: "guide", prefix: "", level: "admin" }]
            })
        });
        vi.stubGlobal("fetch", fetchMock);
        const got = await fetchShaheenLocations({ url: "https://maktab.x/api/v1/portal/lake/locations" });
        expect(got.map(l => l.bucket)).toEqual(["guide"]);
        expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: "include" });
    });

    it("never throws: a refusal or a network error is just no locations", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));
        expect(await fetchShaheenLocations({ url: "https://m/x" })).toEqual([]);
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
        expect(await fetchShaheenLocations({ url: "https://m/x" })).toEqual([]);
    });

    it("does not call anything without a URL", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        expect(await fetchShaheenLocations({ url: "" })).toEqual([]);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
