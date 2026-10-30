/**
 * @jest-environment node
 */

import mongoose from "mongoose";
import StreamingVideoModel from "../../domain/model/streaming-video";
import VideoProviderModel from "../../domain/model/video-provider";
import { refreshStaleVideos } from "../refresh-stale-videos";

const mockGetVideo = jest.fn();
const mockListVideos = jest.fn();
const mockGetConnector = jest.fn();

jest.mock("@courselit/video-providers", () => ({
    ...jest.requireActual("@courselit/video-providers"),
    getConnector: (...args: any[]) => mockGetConnector(...args),
}));
// The queue jest setup mocks nanoid to a constant; ids must be unique here.
let idCounter = 0;
jest.mock("@courselit/utils", () => ({
    ...jest.requireActual("@courselit/utils"),
    generateUniqueId: () => `vid-${++idCounter}`,
}));
jest.mock("../../logger", () => ({
    logger: { info: jest.fn(), error: jest.fn() },
}));

const NOW = new Date("2026-10-29T12:00:00Z");
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const domain = new mongoose.Types.ObjectId();

async function addProvider(providerId = "p1") {
    return VideoProviderModel.create({
        domain,
        providerId,
        type: "bunny",
        name: "Bunny",
        active: true,
        settings: { libraryId: "1" },
        secrets: { apiKey: "SECRET-KEY" },
    });
}

async function addVideo(overrides: Record<string, any> = {}) {
    const { createdAt, ...rest } = overrides;
    const doc = await StreamingVideoModel.create({
        domain,
        providerId: "p1",
        videoId: "seed-" + Math.random(),
        providerVideoId: "pv-" + Math.random(),
        title: "t",
        createdBy: "u",
        status: "processing",
        ...rest,
    });
    if (createdAt) {
        await StreamingVideoModel.collection.updateOne(
            { _id: doc._id },
            { $set: { createdAt } },
        );
    }
    return doc;
}

describe("refreshStaleVideos", () => {
    beforeEach(async () => {
        await StreamingVideoModel.deleteMany({});
        await VideoProviderModel.deleteMany({});
        mockGetVideo.mockReset();
        mockListVideos.mockReset();
        mockGetConnector.mockReset();
        mockListVideos.mockResolvedValue({ items: [], hasMore: false });
        mockGetConnector.mockReturnValue({
            getVideo: mockGetVideo,
            listVideos: mockListVideos,
        });
    });

    it("moves a stale processing video to ready", async () => {
        await addProvider();
        const v = await addVideo({
            status: "processing",
            lastCheckedAt: new Date(NOW.getTime() - 10 * MIN),
            createdAt: new Date(NOW.getTime() - HOUR),
        });
        mockGetVideo.mockResolvedValue({
            providerVideoId: v.providerVideoId,
            title: "t",
            status: "ready",
            durationSeconds: 42,
        });
        mockListVideos.mockResolvedValue({
            items: [
                {
                    providerVideoId: v.providerVideoId,
                    title: "t",
                    status: "ready",
                },
            ],
            hasMore: false,
        });

        const result = await refreshStaleVideos(NOW);

        const after: any = await StreamingVideoModel.findById(v._id).lean();
        expect(after.status).toBe("ready");
        expect(after.durationSeconds).toBe(42);
        expect(after.readyAt).toEqual(NOW);
        expect(after.lastCheckedAt).toEqual(NOW);
        expect(result).toEqual({
            refreshed: 1,
            failed: 0,
            imported: 0,
            missing: 0,
        });
        expect(mockGetConnector).toHaveBeenCalledWith(
            expect.objectContaining({
                secrets: { apiKey: "SECRET-KEY" },
                settings: { libraryId: "1" },
            }),
        );
    });

    it("refreshes a video that was never checked", async () => {
        await addProvider();
        const v = await addVideo({ status: "uploading" });
        mockGetVideo.mockResolvedValue({
            providerVideoId: v.providerVideoId,
            title: "t",
            status: "processing",
        });
        await refreshStaleVideos(NOW);
        const after: any = await StreamingVideoModel.findById(v._id).lean();
        expect(after.status).toBe("processing");
    });

    it.each(["uploading", "processing"])(
        "marks a 25 h old %s video as error when the provider still says uploading",
        async (stored) => {
            await addProvider();
            const v = await addVideo({
                status: stored,
                lastCheckedAt: new Date(NOW.getTime() - 10 * MIN),
                createdAt: new Date(NOW.getTime() - 25 * HOUR),
            });
            mockGetVideo.mockResolvedValue({
                providerVideoId: v.providerVideoId,
                title: "t",
                status: "uploading",
            });

            await refreshStaleVideos(NOW);

            const after: any = await StreamingVideoModel.findById(v._id).lean();
            expect(after.status).toBe("error");
            expect(after.errorMessage).toBe("Upload did not complete");
        },
    );

    it("keeps a recent uploading video uploading", async () => {
        await addProvider();
        const v = await addVideo({
            status: "uploading",
            lastCheckedAt: new Date(NOW.getTime() - 10 * MIN),
            createdAt: new Date(NOW.getTime() - 2 * HOUR),
        });
        mockGetVideo.mockResolvedValue({
            providerVideoId: v.providerVideoId,
            title: "t",
            status: "uploading",
        });
        await refreshStaleVideos(NOW);
        const after: any = await StreamingVideoModel.findById(v._id).lean();
        expect(after.status).toBe("uploading");
    });

    it("marks a video missing at the provider as error without deleting it", async () => {
        await addProvider();
        const v = await addVideo({ status: "processing" });
        mockGetVideo.mockResolvedValue(null);
        await refreshStaleVideos(NOW);
        const after: any = await StreamingVideoModel.findById(v._id).lean();
        expect(after.status).toBe("error");
        expect(after.errorMessage).toBe("Video not found at provider");
    });

    it("imports unknown provider videos unfiled, idempotently", async () => {
        await addProvider();
        await addVideo({ providerVideoId: "known", status: "ready" });
        mockListVideos.mockResolvedValue({
            items: [
                { providerVideoId: "known", title: "Known", status: "ready" },
                {
                    providerVideoId: "new-1",
                    title: "From provider",
                    status: "ready",
                    durationSeconds: 7,
                },
            ],
            hasMore: false,
        });

        const first = await refreshStaleVideos(NOW);
        const second = await refreshStaleVideos(NOW);

        expect(first.imported).toBe(1);
        expect(second.imported).toBe(0);
        const imported: any = await StreamingVideoModel.findOne({
            providerVideoId: "new-1",
        }).lean();
        expect(imported.courseId).toBeNull();
        expect(imported.title).toBe("From provider");
        expect(imported.status).toBe("ready");
        expect(imported.durationSeconds).toBe(7);
        expect(imported.createdBy).toBe("system");
        expect(imported.videoId).toBeTruthy();
        expect(String(imported.domain)).toBe(String(domain));
        expect(await StreamingVideoModel.countDocuments({})).toBe(2);
    });

    it("does not import a video that is still uploading", async () => {
        await addProvider();
        mockListVideos.mockResolvedValue({
            items: [
                {
                    providerVideoId: "live-upload",
                    title: "Being uploaded",
                    status: "uploading",
                },
                { providerVideoId: "done", title: "Done", status: "ready" },
            ],
            hasMore: false,
        });

        const result = await refreshStaleVideos(NOW);

        expect(result.imported).toBe(1);
        expect(
            await StreamingVideoModel.findOne({
                providerVideoId: "live-upload",
            }).lean(),
        ).toBeNull();
        expect(
            await StreamingVideoModel.findOne({
                providerVideoId: "done",
            }).lean(),
        ).not.toBeNull();
    });

    it("pages through the provider list", async () => {
        await addProvider();
        mockListVideos
            .mockResolvedValueOnce({
                items: [{ providerVideoId: "a", title: "A", status: "ready" }],
                hasMore: true,
            })
            .mockResolvedValueOnce({
                items: [{ providerVideoId: "b", title: "B", status: "ready" }],
                hasMore: false,
            });
        const result = await refreshStaleVideos(NOW);
        expect(result.imported).toBe(2);
        expect(mockListVideos).toHaveBeenNthCalledWith(2, { page: 2 });
    });

    it("leaves fresh and finished records untouched", async () => {
        await addProvider();
        const fresh = await addVideo({
            status: "processing",
            lastCheckedAt: new Date(NOW.getTime() - 1 * MIN),
        });
        const ready = await addVideo({
            status: "ready",
            lastCheckedAt: new Date(NOW.getTime() - HOUR),
        });
        mockListVideos.mockResolvedValue({
            items: [
                {
                    providerVideoId: ready.providerVideoId,
                    title: "t",
                    status: "ready",
                },
            ],
            hasMore: false,
        });
        const result = await refreshStaleVideos(NOW);
        expect(mockGetVideo).not.toHaveBeenCalled();
        expect(result.refreshed).toBe(0);
        const after: any = await StreamingVideoModel.findById(fresh._id).lean();
        expect(after.status).toBe("processing");
        expect(
            ((await StreamingVideoModel.findById(ready._id).lean()) as any)
                .status,
        ).toBe("ready");
    });

    it("keeps going when one provider fails and never logs secrets", async () => {
        await addProvider("p1");
        await addProvider("p2");
        const v1 = await addVideo({ providerId: "p1", status: "processing" });
        const v2 = await addVideo({ providerId: "p2", status: "processing" });
        mockGetConnector.mockImplementation((config: any) => ({
            getVideo: async (id: string) => {
                if (id === v1.providerVideoId) {
                    throw new Error("boom");
                }
                return { providerVideoId: id, title: "t", status: "ready" };
            },
            listVideos: async () => ({
                items: [
                    {
                        providerVideoId: v2.providerVideoId,
                        title: "t",
                        status: "ready",
                    },
                ],
                hasMore: false,
            }),
        }));

        const result = await refreshStaleVideos(NOW);

        expect(result.failed).toBe(1);
        expect(result.refreshed).toBe(1);
        const a: any = await StreamingVideoModel.findById(v1._id).lean();
        const b: any = await StreamingVideoModel.findById(v2._id).lean();
        expect(a.status).toBe("processing");
        expect(b.status).toBe("ready");
        const { logger } = jest.requireMock("../../logger");
        const logged = JSON.stringify(logger.error.mock.calls);
        expect(logged).toContain("boom");
        expect(logged).not.toContain("SECRET-KEY");
    });

    it("counts a provider whose listing fails and continues", async () => {
        await addProvider("p1");
        await addProvider("p2");
        mockListVideos
            .mockRejectedValueOnce(new Error("list down"))
            .mockResolvedValueOnce({
                items: [{ providerVideoId: "x", title: "X", status: "ready" }],
                hasMore: false,
            });
        const result = await refreshStaleVideos(NOW);
        expect(result.failed).toBe(1);
        expect(result.imported).toBe(1);
    });

    describe("videos deleted at the provider", () => {
        // Real clock: compared with the listing start.
        const longAgo = () => new Date(Date.now() - 2 * HOUR);
        const listing = (...ids: string[]) => ({
            items: ids.map((id) => ({
                providerVideoId: id,
                title: id,
                status: "ready",
            })),
            hasMore: false,
        });

        it("marks a ready video missing from a complete listing as error, without deleting it", async () => {
            await addProvider();
            const gone = await addVideo({
                status: "ready",
                createdAt: longAgo(),
                readyAt: new Date(NOW.getTime() - HOUR),
                lastCheckedAt: new Date(NOW.getTime() - HOUR),
            });
            const kept = await addVideo({
                status: "ready",
                createdAt: longAgo(),
            });
            mockListVideos.mockResolvedValue(listing(kept.providerVideoId));
            mockGetVideo.mockResolvedValue(null);

            const result = await refreshStaleVideos(NOW);

            const a: any = await StreamingVideoModel.findById(gone._id).lean();
            expect(a.status).toBe("error");
            expect(a.errorMessage).toBe("Video not found at provider");
            expect(a.lastCheckedAt).toEqual(NOW);
            const b: any = await StreamingVideoModel.findById(kept._id).lean();
            expect(b.status).toBe("ready");
            expect(result.missing).toBe(1);
            expect(mockGetVideo).toHaveBeenCalledWith(gone.providerVideoId);
            expect(await StreamingVideoModel.countDocuments({})).toBe(2);
        });

        it("does not flag a candidate the provider still has", async () => {
            await addProvider();
            const skipped = await addVideo({
                status: "ready",
                createdAt: longAgo(),
            });
            const kept = await addVideo({
                status: "ready",
                createdAt: longAgo(),
            });
            mockListVideos.mockResolvedValue(listing(kept.providerVideoId));
            mockGetVideo.mockResolvedValue({
                providerVideoId: skipped.providerVideoId,
                title: "t",
                status: "ready",
            });
            const result = await refreshStaleVideos(NOW);
            const after: any = await StreamingVideoModel.findById(
                skipped._id,
            ).lean();
            expect(after.status).toBe("ready");
            expect(result.missing).toBe(0);
        });

        it("does not flag a candidate when the confirmation fails", async () => {
            await addProvider();
            const v = await addVideo({ status: "ready", createdAt: longAgo() });
            mockListVideos.mockResolvedValue(listing("other"));
            mockGetVideo.mockRejectedValue(new Error("provider down"));
            const result = await refreshStaleVideos(NOW);
            const after: any = await StreamingVideoModel.findById(v._id).lean();
            expect(after.status).toBe("ready");
            expect(result.missing).toBe(0);
            expect(result.failed).toBe(1);
        });

        it.each([
            ["most videos are missing", 7, ["other"]],
            ["the listing is empty", 2, []],
        ])(
            "flags nothing and logs an error when %s",
            async (_, count, listed) => {
                await addProvider();
                const videos = [];
                for (let i = 0; i < count; i++) {
                    videos.push(
                        await addVideo({
                            status: "ready",
                            createdAt: longAgo(),
                        }),
                    );
                }
                mockListVideos.mockResolvedValue(listing(...listed));
                mockGetVideo.mockResolvedValue(null);
                const { logger } = jest.requireMock("../../logger");
                logger.error.mockClear();

                const result = await refreshStaleVideos(NOW);

                for (const v of videos) {
                    const after: any = await StreamingVideoModel.findById(
                        v._id,
                    ).lean();
                    expect(after.status).toBe("ready");
                }
                expect(result.missing).toBe(0);
                expect(JSON.stringify(logger.error.mock.calls)).toContain(
                    "misconfigur",
                );
            },
        );

        it("brings back a not-found video the provider has again", async () => {
            await addProvider();
            const v = await addVideo({
                status: "error",
                errorMessage: "Video not found at provider",
                lastCheckedAt: new Date(NOW.getTime() - 2 * HOUR),
            });
            mockListVideos.mockResolvedValue(listing(v.providerVideoId));
            mockGetVideo.mockResolvedValue({
                providerVideoId: v.providerVideoId,
                title: "t",
                status: "ready",
                durationSeconds: 9,
            });

            await refreshStaleVideos(NOW);

            const after: any = await StreamingVideoModel.findById(v._id).lean();
            expect(after.status).toBe("ready");
            expect(after.errorMessage).toBeUndefined();
            expect(after.readyAt).toEqual(NOW);
            expect(after.durationSeconds).toBe(9);
        });

        it("re-reads at most 50 not-found videos per run, oldest first, after an hour", async () => {
            await addProvider();
            for (let i = 0; i < 52; i++) {
                await addVideo({
                    providerVideoId: `old-${i}`,
                    status: "error",
                    errorMessage: "Video not found at provider",
                    lastCheckedAt: new Date(NOW.getTime() - (100 - i) * HOUR),
                });
            }
            await addVideo({
                providerVideoId: "recent",
                status: "error",
                errorMessage: "Video not found at provider",
                lastCheckedAt: new Date(NOW.getTime() - 10 * MIN),
            });
            await addVideo({
                providerVideoId: "failed",
                status: "error",
                errorMessage: "Video processing failed at provider",
            });
            mockGetVideo.mockResolvedValue(null);

            await refreshStaleVideos(NOW);

            const ids = mockGetVideo.mock.calls.map((c) => c[0]);
            expect(ids).toHaveLength(50);
            expect(ids[0]).toBe("old-0");
            expect(ids).not.toContain("old-50");
            expect(ids).not.toContain("recent");
            expect(ids).not.toContain("failed");
        });

        it("checks across all pages", async () => {
            await addProvider();
            const onPage2 = await addVideo({
                status: "ready",
                createdAt: longAgo(),
            });
            mockListVideos
                .mockResolvedValueOnce({ ...listing("other"), hasMore: true })
                .mockResolvedValueOnce(listing(onPage2.providerVideoId));
            await refreshStaleVideos(NOW);
            const after: any = await StreamingVideoModel.findById(
                onPage2._id,
            ).lean();
            expect(after.status).toBe("ready");
        });

        it("marks nothing when a page fails", async () => {
            await addProvider();
            const v = await addVideo({ status: "ready", createdAt: longAgo() });
            mockListVideos
                .mockResolvedValueOnce({ ...listing("other"), hasMore: true })
                .mockRejectedValueOnce(new Error("page 2 down"));
            const result = await refreshStaleVideos(NOW);
            const after: any = await StreamingVideoModel.findById(v._id).lean();
            expect(after.status).toBe("ready");
            expect(result.failed).toBe(1);
        });

        it("marks nothing when the listing is truncated by the page cap", async () => {
            await addProvider();
            const v = await addVideo({ status: "ready", createdAt: longAgo() });
            mockListVideos.mockResolvedValue({
                ...listing("other"),
                hasMore: true,
            });
            const result = await refreshStaleVideos(NOW);
            expect(mockListVideos).toHaveBeenCalledTimes(1000);
            const after: any = await StreamingVideoModel.findById(v._id).lean();
            expect(after.status).toBe("ready");
            expect(result.missing).toBe(0);
        });

        it("only looks at ready videos of the listed provider", async () => {
            await addProvider("p1");
            const processing = await addVideo({
                status: "processing",
                lastCheckedAt: NOW,
            });
            const otherProvider = await addVideo({
                providerId: "p2",
                status: "ready",
                createdAt: longAgo(),
            });
            const otherDomain = await addVideo({
                domain: new mongoose.Types.ObjectId(),
                status: "ready",
                createdAt: longAgo(),
            });
            mockListVideos.mockResolvedValue(listing());
            await refreshStaleVideos(NOW);
            for (const v of [processing, otherProvider, otherDomain]) {
                const after: any = await StreamingVideoModel.findById(
                    v._id,
                ).lean();
                expect(after.status).toBe(v.status);
            }
        });

        it("does not flag a video created after the listing started", async () => {
            await addProvider();
            const v = await addVideo({
                status: "ready",
                createdAt: new Date(Date.now() + HOUR),
            });
            mockListVideos.mockResolvedValue(listing());
            await refreshStaleVideos(NOW);
            const after: any = await StreamingVideoModel.findById(v._id).lean();
            expect(after.status).toBe("ready");
        });
    });
});
