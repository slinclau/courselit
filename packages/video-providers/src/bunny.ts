import { createHash, createHmac, timingSafeEqual } from "crypto";
import type {
    Playback,
    ProviderConfig,
    ProviderVideo,
    StreamingVideoStatus,
    VideoProviderConnector,
} from "@courselit/common-models";

const API_BASE = "https://video.bunnycdn.com";
const TUS_ENDPOINT = `${API_BASE}/tusupload`;
const UPLOAD_TTL_SECONDS = 6 * 60 * 60;
const ITEMS_PER_PAGE = 100;

export const BUNNY_SECRET_FIELDS = [
    "apiKey",
    "readOnlyApiKey",
    "tokenSecurityKey",
];
export const BUNNY_SETTING_FIELDS = ["libraryId", "cdnHostname"];

interface BunnyVideo {
    guid: string;
    title?: string;
    status?: number;
    length?: number;
    thumbnailFileName?: string;
    collectionId?: string;
    dateUploaded?: string;
}

interface BunnyList<T> {
    totalItems?: number;
    items?: T[] | null;
}

export function mapBunnyStatus(code: number | undefined): StreamingVideoStatus {
    switch (code) {
        case 0:
            return "uploading";
        case 4:
            return "ready";
        case 5:
        case 6:
            return "error";
        default:
            // 1 uploaded, 2 processing, 3 transcoding, 7 / 8 JIT stages
            return "processing";
    }
}

function sha256Hex(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

function hmacHex(secret: string, value: string): string {
    return createHmac("sha256", secret).update(value).digest("hex");
}

export function createBunnyConnector(
    config: ProviderConfig,
): VideoProviderConnector {
    const { libraryId, cdnHostname } = config.settings;
    const { apiKey, readOnlyApiKey, tokenSecurityKey } = config.secrets;
    for (const [name, value] of Object.entries({
        libraryId,
        cdnHostname,
        apiKey,
        readOnlyApiKey,
        tokenSecurityKey,
    })) {
        if (!value) {
            throw new Error(`Bunny configuration is missing "${name}"`);
        }
    }
    const lib = encodeURIComponent(libraryId);

    async function request(
        path: string,
        init: { method?: string; body?: unknown } = {},
        allowNotFound = false,
    ): Promise<any | null> {
        const headers: Record<string, string> = {
            AccessKey: apiKey,
            Accept: "application/json",
        };
        if (init.body !== undefined) {
            headers["Content-Type"] = "application/json";
        }
        const response = await fetch(`${API_BASE}${path}`, {
            method: init.method || "GET",
            headers,
            body:
                init.body !== undefined ? JSON.stringify(init.body) : undefined,
        });
        if (allowNotFound && response.status === 404) {
            return null;
        }
        if (!response.ok) {
            throw new Error(
                `Bunny API request failed with status ${response.status}`,
            );
        }
        return response.json();
    }

    /**
     * Bunny directory token: one token covers every file under
     * `/{guid}/` (playlist, segments, thumbnail).
     */
    function signDirectory(providerVideoId: string, ttlSeconds: number) {
        const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
        const signaturePath = `/${providerVideoId}/`;
        const token =
            "HS256-" +
            createHmac("sha256", tokenSecurityKey)
                .update(signaturePath + expires)
                .digest("base64url");
        return {
            prefix: `https://${cdnHostname}/bcdn_token=${token}&expires=${expires}&token_path=${encodeURIComponent(signaturePath)}`,
            expires,
        };
    }

    function toProviderVideo(v: BunnyVideo): ProviderVideo {
        const video: ProviderVideo = {
            providerVideoId: v.guid,
            title: v.title ?? "",
            status: mapBunnyStatus(v.status),
        };
        if (typeof v.length === "number") {
            video.durationSeconds = v.length;
        }
        if (v.thumbnailFileName) {
            video.thumbnailUrl = `https://${cdnHostname}/${v.guid}/${v.thumbnailFileName}`;
        }
        if (v.collectionId) {
            video.groupId = v.collectionId;
        }
        if (v.dateUploaded) {
            video.createdAt = new Date(v.dateUploaded);
        }
        return video;
    }

    return {
        async testConnection() {
            try {
                const data: BunnyList<BunnyVideo> = await request(
                    `/library/${lib}/videos?page=1&itemsPerPage=10&orderBy=date`,
                );
                return { ok: true, videoCount: data.totalItems ?? 0 };
            } catch (err: any) {
                return {
                    ok: false,
                    error: err?.message || "Could not reach Bunny",
                };
            }
        },

        async ensureGroup(key, title) {
            const name = `${title} (${key})`;
            const found: BunnyList<{ guid: string; name: string }> =
                await request(
                    `/library/${lib}/collections?search=${encodeURIComponent(name)}&itemsPerPage=100`,
                );
            const existing = (found.items || []).find((c) => c.name === name);
            if (existing) {
                return existing.guid;
            }
            const created = await request(`/library/${lib}/collections`, {
                method: "POST",
                body: { name },
            });
            return created.guid;
        },

        async createUpload({ title, groupId, filetype }) {
            const body: { title: string; collectionId?: string } = { title };
            if (groupId) {
                body.collectionId = groupId;
            }
            const created = await request(`/library/${lib}/videos`, {
                method: "POST",
                body,
            });
            const guid: string = created.guid;
            const expire = Math.floor(Date.now() / 1000) + UPLOAD_TTL_SECONDS;
            const metadata: Record<string, string> = { filetype, title };
            if (groupId) {
                metadata.collection = groupId;
            }
            return {
                providerVideoId: guid,
                upload: {
                    protocol: "tus",
                    endpoint: TUS_ENDPOINT,
                    headers: {
                        AuthorizationSignature: sha256Hex(
                            libraryId + apiKey + expire + guid,
                        ),
                        AuthorizationExpire: String(expire),
                        VideoId: guid,
                        LibraryId: libraryId,
                    },
                    metadata,
                    expiresAt: new Date(expire * 1000),
                },
            };
        },

        async getVideo(providerVideoId) {
            const v: BunnyVideo | null = await request(
                `/library/${lib}/videos/${encodeURIComponent(providerVideoId)}`,
                {},
                true,
            );
            return v ? toProviderVideo(v) : null;
        },

        async listVideos({ page }) {
            const data: BunnyList<BunnyVideo> = await request(
                `/library/${lib}/videos?page=${page}&itemsPerPage=${ITEMS_PER_PAGE}&orderBy=date`,
            );
            const items = (data.items || []).map(toProviderVideo);
            return {
                items,
                hasMore: page * ITEMS_PER_PAGE < (data.totalItems ?? 0),
            };
        },

        verifyWebhook(rawBody, headers) {
            if (
                headers.get("X-BunnyStream-Signature-Version") !== "v1" ||
                headers.get("X-BunnyStream-Signature-Algorithm") !==
                    "hmac-sha256"
            ) {
                return null;
            }
            const provided = headers.get("X-BunnyStream-Signature");
            if (!provided) {
                return null;
            }
            const expected = Buffer.from(
                hmacHex(readOnlyApiKey, rawBody),
                "hex",
            );
            const actual = Buffer.from(provided.trim().toLowerCase(), "hex");
            // timingSafeEqual throws on unequal lengths, so check first.
            if (
                actual.length !== expected.length ||
                !timingSafeEqual(actual, expected)
            ) {
                return null;
            }
            let payload: any;
            try {
                payload = JSON.parse(rawBody);
            } catch {
                return null;
            }
            if (
                !payload ||
                String(payload.VideoLibraryId) !== libraryId ||
                typeof payload.VideoGuid !== "string" ||
                !payload.VideoGuid
            ) {
                return null;
            }
            return { providerVideoId: payload.VideoGuid };
        },

        getPlayback(providerVideoId, ttlSeconds): Playback {
            const { prefix, expires } = signDirectory(
                providerVideoId,
                ttlSeconds,
            );
            return {
                kind: "hls",
                url: `${prefix}/${providerVideoId}/playlist.m3u8`,
                expiresAt: new Date(expires * 1000),
            };
        },

        getThumbnailUrl(providerVideoId, thumbnailUrl, ttlSeconds) {
            let path: string;
            try {
                path = new URL(thumbnailUrl).pathname;
            } catch {
                return thumbnailUrl;
            }
            if (!path.startsWith(`/${providerVideoId}/`)) {
                return thumbnailUrl;
            }
            const { prefix } = signDirectory(providerVideoId, ttlSeconds);
            return `${prefix}${path}`;
        },
    };
}
