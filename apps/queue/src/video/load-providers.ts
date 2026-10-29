import type { ProviderConfig } from "@courselit/common-models";
import VideoProviderModel from "../domain/model/video-provider";

export interface LoadedProvider {
    domain: string;
    providerId: string;
    config: ProviderConfig;
}

/** Loads every provider with its secrets. Secrets must never be logged. */
export async function loadAllProviders(): Promise<LoadedProvider[]> {
    const providers = await VideoProviderModel.find({})
        .select("+secrets")
        .lean();
    return providers.map((p: any) => ({
        domain: String(p.domain),
        providerId: p.providerId,
        config: {
            type: p.type,
            settings: p.settings || {},
            secrets: p.secrets || {},
        },
    }));
}
