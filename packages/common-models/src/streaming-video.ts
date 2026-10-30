export type StreamingVideoStatus =
    | "uploading"
    | "processing"
    | "ready"
    | "error";

export type VideoProviderType = "bunny";

export interface StreamingVideo {
    videoId: string;
    providerId: string;
    providerVideoId: string;
    courseId: string | null;
    title: string;
    status: StreamingVideoStatus;
    errorMessage?: string;
    durationSeconds?: number;
    thumbnailUrl?: string;
    createdBy: string;
    createdAt: Date;
    readyAt?: Date;
    lastCheckedAt?: Date;
}

export interface VideoProviderPublic {
    providerId: string;
    type: VideoProviderType;
    name: string;
    active: boolean;
    settings: Record<string, string>;
    secretsLast4: Record<string, string>;
    videoCount: number;
}

/** Lesson content of a `streaming_video` lesson; empty before upload. */
export interface StreamingVideoContent {
    videoId?: string;
}

export interface ProviderConfig {
    type: VideoProviderType;
    settings: Record<string, string>;
    secrets: Record<string, string>;
}

export interface ProviderVideo {
    providerVideoId: string;
    title: string;
    status: StreamingVideoStatus;
    durationSeconds?: number;
    thumbnailUrl?: string;
    groupId?: string;
    createdAt?: Date;
}

export interface UploadInstructions {
    protocol: "tus";
    endpoint: string;
    headers: Record<string, string>;
    metadata: Record<string, string>;
    expiresAt: Date;
}

export interface Playback {
    kind: "hls";
    url: string;
    expiresAt: Date;
}

export interface VideoProviderConnector {
    testConnection(): Promise<
        { ok: true; videoCount: number } | { ok: false; error: string }
    >;
    /** Returns the provider group id. */
    ensureGroup(key: string, title: string): Promise<string>;
    createUpload(input: {
        title: string;
        groupId?: string;
        filetype: string;
    }): Promise<{ providerVideoId: string; upload: UploadInstructions }>;
    /** null = not found at provider */
    getVideo(providerVideoId: string): Promise<ProviderVideo | null>;
    /**
     * Lists every video the provider hosts for this configuration (e.g. the
     * whole library), one page at a time from page 1. `hasMore` must be
     * false only on the last page, and a malformed response must throw.
     * Stored ready videos absent from a complete listing are only candidates
     * for deletion at the provider; each is confirmed with `getVideo` before
     * being flagged, so the pages need not form a consistent snapshot.
     */
    listVideos(input: {
        page: number;
    }): Promise<{ items: ProviderVideo[]; hasMore: boolean }>;
    /** null = reject */
    verifyWebhook(
        rawBody: string,
        headers: { get(name: string): string | null },
    ): { providerVideoId: string } | null;
    getPlayback(providerVideoId: string, ttlSeconds: number): Playback;
    /** Signs a stored (unsigned) thumbnail url for viewing in a browser. */
    getThumbnailUrl(
        providerVideoId: string,
        thumbnailUrl: string,
        ttlSeconds: number,
    ): string;
}

/**
 * Input of the provider-agnostic check for stored videos that a provider no
 * longer lists (deleted at the provider).
 */
export interface MissingAtProviderCheck {
    /** Stored videos of one provider. */
    stored: Array<
        Pick<StreamingVideo, "videoId" | "providerVideoId" | "status"> &
            Partial<Pick<StreamingVideo, "createdAt" | "readyAt">>
    >;
    /** Every `providerVideoId` seen while listing the provider. */
    providerVideoIds: ReadonlySet<string>;
    /** True only when every page was read and the last one said no more. */
    listingComplete: boolean;
    /** When the first page was requested. */
    listingStartedAt: Date;
}

/** Counts for one provider, used to refuse flagging on a likely misconfiguration. */
export interface MissingAtProviderCounts {
    /** Ready videos confirmed missing at the provider. */
    missing: number;
    /** Stored ready videos of the provider. */
    ready: number;
    /** Videos in the provider listing. */
    listed: number;
}
