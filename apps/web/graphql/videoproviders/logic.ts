import { checkIfAuthenticated } from "@/lib/graphql";
import { responses } from "@/config/strings";
import constants from "@/config/constants";
import type GQLContext from "@models/GQLContext";
import VideoProviderModel from "@models/VideoProvider";
import StreamingVideoModel from "@models/StreamingVideo";
import { checkPermission } from "@courselit/utils";
import type {
    ProviderConfig,
    VideoProviderPublic,
    VideoProviderType,
} from "@courselit/common-models";
import {
    SECRET_FIELDS,
    SETTING_FIELDS,
    getConnector,
} from "@courselit/video-providers";

const { permissions } = constants;

const assertCanManageSettings = (ctx: GQLContext) => {
    checkIfAuthenticated(ctx);

    if (!checkPermission(ctx.user.permissions, [permissions.manageSettings])) {
        throw new Error(responses.action_not_allowed);
    }
};

const isSupportedType = (type: string): type is VideoProviderType =>
    Object.prototype.hasOwnProperty.call(SETTING_FIELDS, type);

const last4 = (value: string) => value.slice(-4);

const toPublic = (
    provider: {
        providerId: string;
        type: VideoProviderType;
        name: string;
        active: boolean;
        settings?: Record<string, string>;
        secrets?: Record<string, string>;
    },
    videoCount: number,
): VideoProviderPublic => {
    const secretsLast4: Record<string, string> = {};
    for (const field of SECRET_FIELDS[provider.type] || []) {
        const value = provider.secrets?.[field];
        if (typeof value === "string" && value) {
            secretsLast4[field] = last4(value);
        }
    }
    return {
        providerId: provider.providerId,
        type: provider.type,
        name: provider.name,
        active: provider.active,
        settings: { ...(provider.settings || {}) },
        secretsLast4,
        videoCount,
    };
};

const countVideos = (domain: unknown, providerId: string) =>
    StreamingVideoModel.countDocuments({ domain, providerId });

export const listVideoProviders = async (
    ctx: GQLContext,
): Promise<VideoProviderPublic[]> => {
    assertCanManageSettings(ctx);

    const providers = await VideoProviderModel.find({
        domain: ctx.subdomain._id,
    })
        .select("+secrets")
        .sort({ createdAt: 1 })
        .lean();

    return Promise.all(
        providers.map(async (provider) =>
            toPublic(
                provider as any,
                await countVideos(ctx.subdomain._id, provider.providerId),
            ),
        ),
    );
};

const pickFields = (
    fields: string[],
    input: Record<string, string> | undefined,
): Record<string, string> => {
    const result: Record<string, string> = {};
    for (const field of fields) {
        const value = input?.[field];
        if (typeof value === "string") {
            result[field] = value.trim();
        }
    }
    return result;
};

export const saveVideoProvider = async (
    {
        providerId,
        type,
        name,
        settings,
        secrets,
    }: {
        providerId?: string;
        type: VideoProviderType;
        name: string;
        settings: Record<string, string>;
        secrets: Record<string, string>;
    },
    ctx: GQLContext,
): Promise<VideoProviderPublic> => {
    assertCanManageSettings(ctx);

    if (!isSupportedType(type) || !name?.trim()) {
        throw new Error(responses.provider_invalid_configuration);
    }

    const domain = ctx.subdomain._id;
    const existing = providerId
        ? await VideoProviderModel.findOne({ domain, providerId }).select(
              "+secrets",
          )
        : null;
    if (providerId && !existing) {
        throw new Error(responses.item_not_found);
    }
    if (existing && existing.type !== type) {
        throw new Error(responses.provider_invalid_configuration);
    }

    const cleanSettings = pickFields(SETTING_FIELDS[type], settings);
    // An empty or absent secret keeps the stored one.
    const submittedSecrets = pickFields(SECRET_FIELDS[type], secrets);
    const mergedSecrets: Record<string, string> = {
        ...pickFields(SECRET_FIELDS[type], existing?.secrets),
    };
    for (const [field, value] of Object.entries(submittedSecrets)) {
        if (value) {
            mergedSecrets[field] = value;
        }
    }

    let saved;
    if (existing) {
        existing.name = name.trim();
        existing.settings = cleanSettings;
        existing.secrets = mergedSecrets;
        existing.markModified("settings");
        existing.markModified("secrets");
        saved = await existing.save();
    } else {
        const hasProviders = await VideoProviderModel.exists({ domain });
        saved = await VideoProviderModel.create({
            domain,
            ...(providerId ? { providerId } : {}),
            type,
            name: name.trim(),
            active: !hasProviders,
            settings: cleanSettings,
            secrets: mergedSecrets,
        });
    }

    return toPublic(
        { ...saved.toObject(), secrets: mergedSecrets } as any,
        await countVideos(domain, saved.providerId),
    );
};

export const setActiveVideoProvider = async (
    providerId: string,
    ctx: GQLContext,
): Promise<boolean> => {
    assertCanManageSettings(ctx);

    const domain = ctx.subdomain._id;
    const target = await VideoProviderModel.exists({ domain, providerId });
    if (!target) {
        throw new Error(responses.item_not_found);
    }

    await VideoProviderModel.updateMany(
        { domain, providerId: { $ne: providerId } },
        { $set: { active: false } },
    );
    await VideoProviderModel.updateOne(
        { domain, providerId },
        { $set: { active: true } },
    );
    return true;
};

export const removeVideoProvider = async (
    providerId: string,
    ctx: GQLContext,
): Promise<boolean> => {
    assertCanManageSettings(ctx);

    const domain = ctx.subdomain._id;
    const provider = await VideoProviderModel.findOne({ domain, providerId });
    if (!provider) {
        throw new Error(responses.item_not_found);
    }

    if ((await countVideos(domain, providerId)) > 0) {
        throw new Error(responses.video_provider_has_videos);
    }

    if (provider.active) {
        const others = await VideoProviderModel.countDocuments({
            domain,
            providerId: { $ne: providerId },
        });
        if (others > 0) {
            throw new Error(responses.video_provider_is_active);
        }
    }

    await VideoProviderModel.deleteOne({ domain, providerId });
    return true;
};

export const testVideoProvider = async (
    providerId: string,
    ctx: GQLContext,
): Promise<{ ok: boolean; message: string }> => {
    assertCanManageSettings(ctx);

    const config = await getProviderConfig(
        ctx.subdomain._id.toString(),
        providerId,
    );
    if (!config) {
        throw new Error(responses.item_not_found);
    }

    try {
        const result = await getConnector(config).testConnection();
        if (result.ok) {
            return {
                ok: true,
                message: `Connected. ${result.videoCount} video(s) found.`,
            };
        }
        return { ok: false, message: redact(result.error, config) };
    } catch (err: any) {
        return { ok: false, message: redact(err?.message, config) };
    }
};

/** Strips any stored secret value from a provider-originated message. */
const redact = (message: unknown, config: ProviderConfig): string => {
    let text = typeof message === "string" && message ? message : "Failed";
    for (const secret of Object.values(config.secrets)) {
        if (secret) {
            text = text.split(secret).join("***");
        }
    }
    return text;
};

/**
 * Server-only. Returns provider credentials; never import from client code
 * or return the result from a GraphQL resolver.
 */
export const getProviderConfig = async (
    domainId: string,
    providerId: string,
): Promise<ProviderConfig | null> => {
    const provider = await VideoProviderModel.findOne({
        domain: domainId,
        providerId,
    }).select("+secrets");
    return provider ? toConfig(provider) : null;
};

/** Server-only, see `getProviderConfig`. */
export const getActiveProviderConfig = async (
    domainId: string,
): Promise<(ProviderConfig & { providerId: string }) | null> => {
    const provider = await VideoProviderModel.findOne({
        domain: domainId,
        active: true,
    }).select("+secrets");
    return provider
        ? { ...toConfig(provider), providerId: provider.providerId }
        : null;
};

const toConfig = (provider: {
    type: VideoProviderType;
    settings?: Record<string, string>;
    secrets?: Record<string, string>;
}): ProviderConfig => ({
    type: provider.type,
    settings: { ...(provider.settings || {}) },
    secrets: { ...(provider.secrets || {}) },
});
