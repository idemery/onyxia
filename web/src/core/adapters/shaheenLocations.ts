/**
 * Shaheen: the Data Store locations this person can reach, shown as bookmarks.
 *
 * The explorer's home lists only the bookmarks in the `S3` env, and it cannot list
 * buckets for itself: on Ceph RGW, ListBuckets for an STS role session answers with
 * the buckets the session OWNS — none — not the ones its policy lets it read. So a
 * person granted a bucket had no way to see it existed.
 *
 * `LOCATIONS_URL` names an endpoint on the Shaheen portal (Maktab) that answers from
 * the same grants the store's policy is rendered from:
 *
 *     {"locations": [{"s3Uri": "s3://sharepoint/", "bucket": "sharepoint",
 *                     "prefix": "", "level": "read"}, ...]}
 *
 * It is read with the visitor's Maktab session cookie (credentials: "include"), as a
 * simple GET so there is no CORS preflight. Anything going wrong — no URL, not signed
 * in to Maktab, a browser that withholds the cookie in a frame, a slow answer —
 * leaves the configured bookmarks exactly as they were. It never throws.
 */
import type { S3Config } from "core/ports/OnyxiaApi/S3Config";

export type ShaheenLocation = {
    s3Uri: string;
    bucket: string;
    prefix: string;
    level: string;
};

/** Keep only well-formed `s3://bucket/...` entries; a malformed body yields []. */
export function parseShaheenLocations(body: unknown): ShaheenLocation[] {
    if (typeof body !== "object" || body === null) {
        return [];
    }
    const list = (body as { locations?: unknown }).locations;
    if (!Array.isArray(list)) {
        return [];
    }
    const out: ShaheenLocation[] = [];
    for (const item of list) {
        if (typeof item !== "object" || item === null) {
            continue;
        }
        const { s3Uri, bucket, prefix, level } = item as Record<string, unknown>;
        if (
            typeof s3Uri !== "string" ||
            typeof bucket !== "string" ||
            bucket === "" ||
            !s3Uri.startsWith(`s3://${bucket}/`)
        ) {
            continue;
        }
        out.push({
            s3Uri,
            bucket,
            prefix: typeof prefix === "string" ? prefix : "",
            level: typeof level === "string" ? level : ""
        });
    }
    return out;
}

const normalize = (s3Uri: string) => (s3Uri.endsWith("/") ? s3Uri : `${s3Uri}/`);

/**
 * Append each location as a bookmark on every STS entry, after the configured ones
 * and without repeating a path a configured bookmark already names.
 */
export function mergeShaheenLocations(params: {
    s3Config: S3Config;
    locations: ShaheenLocation[];
}): S3Config {
    const { s3Config, locations } = params;
    if (locations.length === 0) {
        return s3Config;
    }
    return {
        ...s3Config,
        entries: s3Config.entries.map(entry => {
            if (entry.sts === undefined) {
                return entry;
            }
            const seen = new Set(entry.bookmarks.map(b => normalize(b.s3UriStr)));
            const added: S3Config.Entry.Bookmark[] = [];
            for (const location of locations) {
                const uri = normalize(location.s3Uri);
                if (seen.has(uri)) {
                    continue;
                }
                seen.add(uri);
                added.push({
                    s3UriStr: uri,
                    title: location.prefix
                        ? `${location.bucket}/${location.prefix.replace(/\/$/, "")}`
                        : location.bucket,
                    forProfileNames: [],
                    isTemplated: false
                });
            }
            return { ...entry, bookmarks: [...entry.bookmarks, ...added] };
        })
    };
}

export async function fetchShaheenLocations(params: {
    url: string;
    timeoutMs?: number;
}): Promise<ShaheenLocation[]> {
    const { url, timeoutMs = 4000 } = params;
    if (url === "") {
        return [];
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            credentials: "include",
            cache: "no-store",
            redirect: "error",
            signal: controller.signal
        });
        if (!response.ok) {
            console.warn(`Shaheen locations: ${url} answered ${response.status}`);
            return [];
        }
        return parseShaheenLocations(await response.json());
    } catch (error) {
        console.warn(`Shaheen locations: ${url} unavailable`, error);
        return [];
    } finally {
        clearTimeout(timer);
    }
}
