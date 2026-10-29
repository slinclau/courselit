import { createHash, createHmac } from "crypto";
import {
    applyProviderVideo,
    getConnector,
    SECRET_FIELDS,
    SETTING_FIELDS,
} from "../index";
import type { ProviderConfig } from "@courselit/common-models";

const config: ProviderConfig = {
    type: "bunny",
    settings: { libraryId: "lib", cdnHostname: "vz-test.b-cdn.net" },
    secrets: {
        apiKey: "key",
        readOnlyApiKey: "ro-key",
        tokenSecurityKey: "token-key",
    },
};

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });

let fetchMock: jest.Mock;
beforeEach(() => {
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
});

describe("bunny status mapping", () => {
    const table: [number, string][] = [
        [0, "uploading"],
        [1, "processing"],
        [2, "processing"],
        [3, "processing"],
        [4, "ready"],
        [5, "error"],
        [6, "error"],
        [7, "processing"],
        [8, "processing"],
    ];
    test.each(table)("status %i -> %s", async (code, expected) => {
        fetchMock.mockResolvedValueOnce(
            json({ guid: "g", title: "t", status: code }),
        );
        const video = await getConnector(config).getVideo("g");
        expect(video!.status).toBe(expected);
    });
});

describe("bunny getVideo / listVideos", () => {
    test("maps fields and sends AccessKey", async () => {
        fetchMock.mockResolvedValueOnce(
            json({
                guid: "g",
                title: "T",
                status: 4,
                length: 42,
                thumbnailFileName: "thumbnail.jpg",
                collectionId: "c1",
                dateUploaded: "2026-01-02T03:04:05Z",
            }),
        );
        const v = await getConnector(config).getVideo("g");
        expect(v).toEqual({
            providerVideoId: "g",
            title: "T",
            status: "ready",
            durationSeconds: 42,
            thumbnailUrl: "https://vz-test.b-cdn.net/g/thumbnail.jpg",
            groupId: "c1",
            createdAt: new Date("2026-01-02T03:04:05Z"),
        });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("https://video.bunnycdn.com/library/lib/videos/g");
        expect(init.headers.AccessKey).toBe("key");
    });

    test("returns null on 404", async () => {
        fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
        expect(await getConnector(config).getVideo("g")).toBeNull();
    });

    test("throws on other errors without leaking the key", async () => {
        fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
        const err = await getConnector(config)
            .getVideo("g")
            .catch((e) => e);
        expect(err).toBeInstanceOf(Error);
        expect(err.message).toContain("500");
        expect(err.message).not.toContain("key");
    });

    test("listVideos paginates", async () => {
        fetchMock.mockResolvedValueOnce(
            json({
                totalItems: 150,
                currentPage: 1,
                itemsPerPage: 100,
                items: [{ guid: "a", title: "A", status: 4 }],
            }),
        );
        const r = await getConnector(config).listVideos({ page: 1 });
        expect(r.hasMore).toBe(true);
        expect(r.items).toHaveLength(1);
        expect(fetchMock.mock.calls[0][0]).toBe(
            "https://video.bunnycdn.com/library/lib/videos?page=1&itemsPerPage=100&orderBy=date",
        );
    });
});

describe("bunny createUpload", () => {
    test("creates the video then signs the TUS headers", async () => {
        fetchMock.mockResolvedValueOnce(json({ guid: "guid" }));
        const { providerVideoId, upload } = await getConnector(
            config,
        ).createUpload({
            title: "My video",
            groupId: "col-1",
            filetype: "video/mp4",
        });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("https://video.bunnycdn.com/library/lib/videos");
        expect(init.method).toBe("POST");
        expect(JSON.parse(init.body)).toEqual({
            title: "My video",
            collectionId: "col-1",
        });
        expect(providerVideoId).toBe("guid");
        expect(upload.protocol).toBe("tus");
        expect(upload.endpoint).toBe("https://video.bunnycdn.com/tusupload");
        const expire = upload.headers.AuthorizationExpire;
        expect(upload.headers.AuthorizationSignature).toBe(
            createHash("sha256")
                .update("lib" + "key" + expire + "guid")
                .digest("hex"),
        );
        expect(upload.headers.VideoId).toBe("guid");
        expect(upload.headers.LibraryId).toBe("lib");
        expect(upload.metadata).toEqual({
            filetype: "video/mp4",
            title: "My video",
            collection: "col-1",
        });
        expect(Number(expire) * 1000).toBe(upload.expiresAt.getTime());
        const hours = (upload.expiresAt.getTime() - Date.now()) / 3600000;
        expect(hours).toBeGreaterThan(5.9);
        expect(hours).toBeLessThanOrEqual(6);
    });

    test("never exposes the api key", async () => {
        fetchMock.mockResolvedValueOnce(json({ guid: "guid" }));
        const r = await getConnector(config).createUpload({
            title: "t",
            filetype: "video/mp4",
        });
        expect(JSON.stringify(r)).not.toContain('"key"');
        expect(JSON.stringify(r)).not.toContain("ro-key");
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
            title: "t",
        });
    });
});

describe("bunny ensureGroup", () => {
    test("reuses an existing collection", async () => {
        fetchMock.mockResolvedValueOnce(
            json({
                items: [
                    { guid: "other", name: "Other (k)" },
                    { guid: "c9", name: "Course (k)" },
                ],
            }),
        );
        expect(await getConnector(config).ensureGroup("k", "Course")).toBe(
            "c9",
        );
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test("creates when missing", async () => {
        fetchMock
            .mockResolvedValueOnce(json({ items: [] }))
            .mockResolvedValueOnce(json({ guid: "new", name: "Course (k)" }));
        expect(await getConnector(config).ensureGroup("k", "Course")).toBe(
            "new",
        );
        const [url, init] = fetchMock.mock.calls[1];
        expect(url).toBe("https://video.bunnycdn.com/library/lib/collections");
        expect(JSON.parse(init.body)).toEqual({ name: "Course (k)" });
    });
});

describe("bunny verifyWebhook", () => {
    const body = JSON.stringify({
        VideoLibraryId: "lib",
        VideoGuid: "guid",
        Status: 3,
    });
    const sign = (b: string, secret = "ro-key") =>
        createHmac("sha256", secret).update(b).digest("hex");
    const hdrs = (over: Record<string, string | null> = {}) => {
        const base: Record<string, string> = {
            "X-BunnyStream-Signature-Version": "v1",
            "X-BunnyStream-Signature-Algorithm": "hmac-sha256",
            "X-BunnyStream-Signature": sign(body),
        };
        const h = new Headers();
        for (const [k, v] of Object.entries({ ...base, ...over })) {
            if (v !== null) h.set(k, v);
        }
        return h;
    };
    const c = getConnector(config);

    test("accepts a valid signature", () => {
        expect(c.verifyWebhook(body, hdrs())).toEqual({
            providerVideoId: "guid",
        });
    });
    test("rejects a tampered body", () => {
        expect(
            c.verifyWebhook(body.replace("guid", "evil"), hdrs()),
        ).toBeNull();
    });
    test("rejects a wrong library id", () => {
        const b = body.replace('"lib"', '"other"');
        expect(
            c.verifyWebhook(b, hdrs({ "X-BunnyStream-Signature": sign(b) })),
        ).toBeNull();
    });
    test("accepts a numeric library id", () => {
        const b = body.replace('"lib"', "5");
        const cfg = getConnector({
            ...config,
            settings: { ...config.settings, libraryId: "5" },
        });
        expect(
            cfg.verifyWebhook(b, hdrs({ "X-BunnyStream-Signature": sign(b) })),
        ).toEqual({ providerVideoId: "guid" });
    });
    test("rejects a missing signature header", () => {
        expect(
            c.verifyWebhook(body, hdrs({ "X-BunnyStream-Signature": null })),
        ).toBeNull();
    });
    test("rejects a wrong-length / non-hex signature without throwing", () => {
        expect(
            c.verifyWebhook(body, hdrs({ "X-BunnyStream-Signature": "abcd" })),
        ).toBeNull();
        expect(
            c.verifyWebhook(body, hdrs({ "X-BunnyStream-Signature": "zz" })),
        ).toBeNull();
    });
    test("rejects wrong version or algorithm", () => {
        expect(
            c.verifyWebhook(
                body,
                hdrs({ "X-BunnyStream-Signature-Version": "v2" }),
            ),
        ).toBeNull();
        expect(
            c.verifyWebhook(
                body,
                hdrs({ "X-BunnyStream-Signature-Algorithm": "hmac-sha1" }),
            ),
        ).toBeNull();
    });
    test("rejects a signature made with another key", () => {
        expect(
            c.verifyWebhook(
                body,
                hdrs({ "X-BunnyStream-Signature": sign(body, "other") }),
            ),
        ).toBeNull();
    });
    test("rejects a non-JSON body", () => {
        const b = "not json";
        expect(
            c.verifyWebhook(b, hdrs({ "X-BunnyStream-Signature": sign(b) })),
        ).toBeNull();
    });
});

describe("bunny getPlayback", () => {
    test("builds a token-signed HLS url", () => {
        const p = getConnector(config).getPlayback("guid", 3600);
        const m = p.url.match(
            /^https:\/\/vz-test\.b-cdn\.net\/bcdn_token=(.+)&expires=(\d+)&token_path=%2Fguid%2F\/guid\/playlist\.m3u8$/,
        );
        expect(m).not.toBeNull();
        const [, token, expires] = m!;
        const expected =
            "HS256-" +
            createHmac("sha256", "token-key")
                .update("/guid/" + expires)
                .digest("base64url");
        expect(token).toBe(expected);
        expect(Number(expires) * 1000).toBe(p.expiresAt.getTime());
        expect(p.kind).toBe("hls");
    });
});

describe("bunny getThumbnailUrl", () => {
    test("signs the thumbnail with the same directory token as playback", () => {
        const before = Math.floor(Date.now() / 1000);
        const url = getConnector(config).getThumbnailUrl(
            "guid",
            "https://vz-test.b-cdn.net/guid/thumbnail.jpg",
            3600,
        );
        const m = url.match(
            /^https:\/\/vz-test\.b-cdn\.net\/bcdn_token=(.+)&expires=(\d+)&token_path=%2Fguid%2F\/guid\/thumbnail\.jpg$/,
        );
        expect(m).not.toBeNull();
        const [, token, expires] = m!;
        const expected =
            "HS256-" +
            createHmac("sha256", "token-key")
                .update("/guid/" + expires)
                .digest("base64url");
        expect(token).toBe(expected);
        expect(Number(expires)).toBeGreaterThanOrEqual(before + 3600);
    });

    test("leaves a url outside the video directory untouched", () => {
        const url = "https://elsewhere.example/other/thumb.jpg";
        expect(getConnector(config).getThumbnailUrl("guid", url, 3600)).toBe(
            url,
        );
    });
});

describe("bunny testConnection", () => {
    test("ok with video count", async () => {
        fetchMock.mockResolvedValueOnce(json({ totalItems: 7, items: [] }));
        expect(await getConnector(config).testConnection()).toEqual({
            ok: true,
            videoCount: 7,
        });
    });
    test("not ok on 401", async () => {
        fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
        const r = await getConnector(config).testConnection();
        expect(r.ok).toBe(false);
        expect(JSON.stringify(r)).not.toContain("key");
    });
    test("not ok on network failure", async () => {
        fetchMock.mockRejectedValueOnce(new Error("boom"));
        expect((await getConnector(config).testConnection()).ok).toBe(false);
    });
});

describe("registry", () => {
    test("field lists", () => {
        expect(SECRET_FIELDS.bunny).toEqual([
            "apiKey",
            "readOnlyApiKey",
            "tokenSecurityKey",
        ]);
        expect(SETTING_FIELDS.bunny).toEqual(["libraryId", "cdnHostname"]);
    });
    test("getConnector rejects unknown types", () => {
        expect(() => getConnector({ ...config, type: "x" as any })).toThrow();
    });
    test("getConnector rejects missing fields", () => {
        expect(() =>
            getConnector({ ...config, secrets: { apiKey: "k" } }),
        ).toThrow();
    });
});

describe("applyProviderVideo", () => {
    const now = new Date("2026-05-01T00:00:00Z");
    test("ready sets readyAt once", () => {
        const r = applyProviderVideo(
            { status: "processing" },
            {
                providerVideoId: "g",
                title: "t",
                status: "ready",
                durationSeconds: 9,
                thumbnailUrl: "u",
            },
            now,
        );
        expect(r).toEqual({
            status: "ready",
            durationSeconds: 9,
            thumbnailUrl: "u",
            lastCheckedAt: now,
            readyAt: now,
        });
        const again = applyProviderVideo(
            { status: "ready", readyAt: new Date(1) },
            { providerVideoId: "g", title: "t", status: "ready" },
            now,
        );
        expect(again.readyAt).toBeUndefined();
    });
    test("processing is not regressed to uploading", () => {
        const r = applyProviderVideo(
            { status: "processing" },
            { providerVideoId: "g", title: "t", status: "uploading" },
            now,
        );
        expect(r).toEqual({ lastCheckedAt: now });
    });
    test("null -> error", () => {
        expect(applyProviderVideo({ status: "processing" }, null, now)).toEqual(
            {
                status: "error",
                errorMessage: "Video not found at provider",
                lastCheckedAt: now,
            },
        );
    });
    test("provider error status", () => {
        const r = applyProviderVideo(
            { status: "processing" },
            { providerVideoId: "g", title: "t", status: "error" },
            now,
        );
        expect(r.status).toBe("error");
        expect(r.errorMessage).toBeTruthy();
    });
});
