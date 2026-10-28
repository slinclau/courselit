/**
 * @jest-environment node
 */

import mongoose from "mongoose";
import VideoProviderModel from "@models/VideoProvider";
import StreamingVideoModel from "@models/StreamingVideo";
import constants from "@/config/constants";
import { responses } from "@/config/strings";
import {
    getActiveProviderConfig,
    getProviderConfig,
    listVideoProviders,
    removeVideoProvider,
    saveVideoProvider,
    setActiveVideoProvider,
    testVideoProvider,
} from "../logic";

const mockTestConnection = jest.fn();
jest.mock("@courselit/video-providers", () => ({
    ...jest.requireActual("@courselit/video-providers"),
    getConnector: jest.fn(() => ({ testConnection: mockTestConnection })),
}));

describe("models", () => {
    const domain = new mongoose.Types.ObjectId();

    beforeAll(async () => {
        await VideoProviderModel.init();
        await StreamingVideoModel.init();
    });

    afterEach(async () => {
        await VideoProviderModel.deleteMany({});
        await StreamingVideoModel.deleteMany({});
    });

    it("does not return secrets unless explicitly selected", async () => {
        await VideoProviderModel.create({
            domain,
            providerId: "p1",
            type: "bunny",
            name: "Bunny",
            settings: { libraryId: "123", cdnHostname: "vz-x.b-cdn.net" },
            secrets: { apiKey: "super-secret" },
        });

        const plain = await VideoProviderModel.findOne({
            domain,
            providerId: "p1",
        }).lean();
        expect(plain).not.toBeNull();
        expect((plain as any).secrets).toBeUndefined();
        expect(plain!.settings).toEqual({
            libraryId: "123",
            cdnHostname: "vz-x.b-cdn.net",
        });
        expect(plain!.active).toBe(false);

        const doc = await VideoProviderModel.findOne({
            domain,
            providerId: "p1",
        });
        expect((doc as any).secrets).toBeUndefined();

        const withSecrets = await VideoProviderModel.findOne({
            domain,
            providerId: "p1",
        }).select("+secrets");
        expect(withSecrets!.secrets).toEqual({ apiKey: "super-secret" });
    });

    it("rejects an unknown provider type", async () => {
        await expect(
            VideoProviderModel.create({
                domain,
                providerId: "p2",
                type: "other",
                name: "X",
            }),
        ).rejects.toThrow();
    });

    it("rejects a duplicate {domain, providerId} provider", async () => {
        const base = { domain, type: "bunny", name: "A" };
        await VideoProviderModel.create({ ...base, providerId: "dup" });
        await expect(
            VideoProviderModel.create({ ...base, providerId: "dup" }),
        ).rejects.toThrow(/duplicate key/i);
    });

    it("rejects a duplicate {domain, providerId, providerVideoId} video", async () => {
        const base = {
            domain,
            providerId: "p1",
            providerVideoId: "guid-1",
            title: "T",
            createdBy: "u1",
        };
        const first = await StreamingVideoModel.create({
            ...base,
            videoId: "v1",
        });
        expect(first.status).toBe("uploading");
        expect(first.courseId).toBeNull();
        await expect(
            StreamingVideoModel.create({ ...base, videoId: "v2" }),
        ).rejects.toThrow(/duplicate key/i);
    });

    it("rejects a duplicate {domain, videoId}", async () => {
        const base = {
            domain,
            providerId: "p1",
            title: "T",
            createdBy: "u1",
            videoId: "same",
        };
        await StreamingVideoModel.create({ ...base, providerVideoId: "a" });
        await expect(
            StreamingVideoModel.create({ ...base, providerVideoId: "b" }),
        ).rejects.toThrow(/duplicate key/i);
    });
});

describe("video provider logic", () => {
    const domain = new mongoose.Types.ObjectId();
    const otherDomain = new mongoose.Types.ObjectId();
    const makeCtx = (permissions: string[], d = domain) =>
        ({
            user: { userId: "u1", permissions },
            subdomain: { _id: d },
        }) as any;
    const admin = makeCtx([constants.permissions.manageSettings]);
    const bunny = {
        type: "bunny" as const,
        name: "Bunny",
        settings: { libraryId: "123", cdnHostname: "vz-x.b-cdn.net" },
        secrets: {
            apiKey: "api-key-ABCD1234",
            readOnlyApiKey: "ro-key-WXYZ9876",
            tokenSecurityKey: "tok-key-QRST5555",
        },
    };

    // Creating with a client-chosen id is not allowed, so assign the id after.
    const seed = async (
        providerId: string,
        extra: Record<string, unknown> = {},
        ctx = admin,
    ) => {
        const created = await saveVideoProvider({ ...bunny, ...extra }, ctx);
        await VideoProviderModel.updateOne(
            { domain: ctx.subdomain._id, providerId: created.providerId },
            { $set: { providerId } },
        );
    };

    afterEach(async () => {
        await VideoProviderModel.deleteMany({});
        await StreamingVideoModel.deleteMany({});
        mockTestConnection.mockReset();
    });

    it("lists providers with only the last 4 chars of secrets", async () => {
        await seed("p1", {}, admin);
        const list = await listVideoProviders(admin);
        expect(list).toHaveLength(1);
        expect(list[0].secretsLast4).toEqual({
            apiKey: "1234",
            readOnlyApiKey: "9876",
            tokenSecurityKey: "5555",
        });
        const json = JSON.stringify(list);
        expect(json).not.toContain("api-key-ABCD1234");
        expect(json).not.toContain("ro-key-WXYZ9876");
        expect(json).not.toContain("tok-key-QRST5555");
        expect((list[0] as any).secrets).toBeUndefined();
    });

    it("counts the videos of each provider", async () => {
        await seed("p1", {}, admin);
        await StreamingVideoModel.create({
            domain,
            videoId: "v1",
            providerId: "p1",
            providerVideoId: "g1",
            title: "T",
            createdBy: "u1",
        });
        await StreamingVideoModel.create({
            domain: otherDomain,
            videoId: "v2",
            providerId: "p1",
            providerVideoId: "g2",
            title: "T",
            createdBy: "u1",
        });
        const [p] = await listVideoProviders(admin);
        expect(p.videoCount).toBe(1);
    });

    it("keeps stored secrets when saved without them", async () => {
        await seed("p1", {}, admin);
        const saved = await saveVideoProvider(
            {
                providerId: "p1",
                type: "bunny",
                name: "Renamed",
                settings: bunny.settings,
                secrets: { apiKey: "", readOnlyApiKey: "NEW-RO-key-0000" },
            },
            admin,
        );
        expect(saved.name).toBe("Renamed");
        expect(saved.secretsLast4).toEqual({
            apiKey: "1234",
            readOnlyApiKey: "0000",
            tokenSecurityKey: "5555",
        });
        const cfg = await getProviderConfig(domain.toString(), "p1");
        expect(cfg!.secrets.apiKey).toBe("api-key-ABCD1234");
        expect(cfg!.secrets.readOnlyApiKey).toBe("NEW-RO-key-0000");
    });

    it("ignores unknown setting and secret fields", async () => {
        const saved = await saveVideoProvider(
            {
                ...bunny,
                settings: { ...bunny.settings, evil: "x" },
                secrets: { ...bunny.secrets, evil: "y" },
            },
            admin,
        );
        expect(saved.settings).toEqual(bunny.settings);
        const cfg = await getProviderConfig(
            domain.toString(),
            saved.providerId,
        );
        expect(cfg!.secrets).not.toHaveProperty("evil");
    });

    it("makes the first provider active and keeps exactly one active", async () => {
        await seed("p1");
        await seed("p2", { name: "Second" });
        const [first, second] = await listVideoProviders(admin);
        expect(first.active).toBe(true);
        expect(second.active).toBe(false);

        await setActiveVideoProvider("p2", admin);
        const list = await listVideoProviders(admin);
        expect(list.filter((p) => p.active).map((p) => p.providerId)).toEqual([
            "p2",
        ]);
        const cfg = await getActiveProviderConfig(domain.toString());
        expect(cfg!.settings.libraryId).toBe("123");
    });

    it("does not touch the active provider of another domain", async () => {
        await seed("p1", {}, admin);
        const otherAdmin = makeCtx(
            [constants.permissions.manageSettings],
            otherDomain,
        );
        await seed("p9", {}, otherAdmin);
        await seed("p2", {}, admin);
        await setActiveVideoProvider("p2", admin);
        const others = await listVideoProviders(otherAdmin);
        expect(others).toHaveLength(1);
        expect(others[0].active).toBe(true);
    });

    it("throws when making an unknown provider active", async () => {
        await expect(setActiveVideoProvider("nope", admin)).rejects.toThrow();
    });

    it("refuses to remove a provider that has videos", async () => {
        await seed("p1", {}, admin);
        await StreamingVideoModel.create({
            domain,
            videoId: "v1",
            providerId: "p1",
            providerVideoId: "g1",
            title: "T",
            createdBy: "u1",
        });
        await expect(removeVideoProvider("p1", admin)).rejects.toThrow(
            responses.video_provider_has_videos,
        );
        expect(await VideoProviderModel.countDocuments({ domain })).toBe(1);
    });

    it("refuses to remove the active provider while others exist", async () => {
        await seed("p1", {}, admin);
        await seed("p2", {}, admin);
        await expect(removeVideoProvider("p1", admin)).rejects.toThrow();
        expect(await VideoProviderModel.countDocuments({ domain })).toBe(2);
    });

    it("removes an inactive provider, and the only provider", async () => {
        await seed("p1", {}, admin);
        await seed("p2", {}, admin);
        expect(await removeVideoProvider("p2", admin)).toBe(true);
        expect(await removeVideoProvider("p1", admin)).toBe(true);
        expect(await VideoProviderModel.countDocuments({ domain })).toBe(0);
    });

    it("reports connection test results without leaking secrets", async () => {
        await seed("p1", {}, admin);
        mockTestConnection.mockResolvedValueOnce({ ok: true, videoCount: 7 });
        const ok = await testVideoProvider("p1", admin);
        expect(ok.ok).toBe(true);
        expect(ok.message).toContain("7");

        mockTestConnection.mockResolvedValueOnce({
            ok: false,
            error: "rejected api-key-ABCD1234 bad",
        });
        const bad = await testVideoProvider("p1", admin);
        expect(bad.ok).toBe(false);
        expect(bad.message).not.toContain("api-key-ABCD1234");

        mockTestConnection.mockRejectedValueOnce(
            new Error("boom api-key-ABCD1234"),
        );
        const thrown = await testVideoProvider("p1", admin);
        expect(thrown.ok).toBe(false);
        expect(thrown.message).not.toContain("api-key-ABCD1234");
    });

    it("rejects users without manageSettings", async () => {
        const nobody = makeCtx([]);
        const calls = [
            () => listVideoProviders(nobody),
            () => saveVideoProvider({ ...bunny }, nobody),
            () => setActiveVideoProvider("p1", nobody),
            () => removeVideoProvider("p1", nobody),
            () => testVideoProvider("p1", nobody),
        ];
        for (const call of calls) {
            await expect(call()).rejects.toThrow(responses.action_not_allowed);
        }
    });

    it("does not create a provider with a client-chosen id", async () => {
        await expect(
            saveVideoProvider({ ...bunny, providerId: "chosen" }, admin),
        ).rejects.toThrow();
    });

    it("rejects an unknown type and a missing name", async () => {
        await expect(
            saveVideoProvider({ ...bunny, type: "mux" as any }, admin),
        ).rejects.toThrow();
        await expect(
            saveVideoProvider({ ...bunny, name: " " }, admin),
        ).rejects.toThrow();
    });
});
