"use client";

import { useState } from "react";
import { StreamingVideoStatus } from "@courselit/common-models";
import { Clapperboard, Loader2, TriangleAlert } from "lucide-react";
import {
    STREAMING_VIDEO_ERROR,
    STREAMING_VIDEO_PROCESSING,
    STREAMING_VIDEO_THUMBNAIL_ALT,
    STREAMING_VIDEO_UPLOADING,
} from "@ui-config/strings";

interface VideoPlaceholderProps {
    status: StreamingVideoStatus;
    thumbnailUrl?: string;
}

/** Presentational stand-in for a streaming video that cannot be played yet. */
export function VideoPlaceholder({
    status,
    thumbnailUrl,
}: VideoPlaceholderProps) {
    // A thumbnail that fails to load usually means the video is gone at the
    // provider: show it as unavailable rather than as a broken image.
    const [failedUrl, setFailedUrl] = useState<string>();
    const shownStatus =
        thumbnailUrl && failedUrl === thumbnailUrl ? "error" : status;

    if (shownStatus === "ready" && thumbnailUrl) {
        return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
                src={thumbnailUrl}
                alt={STREAMING_VIDEO_THUMBNAIL_ALT}
                className="aspect-video w-full rounded-md object-cover"
                onError={() => setFailedUrl(thumbnailUrl)}
            />
        );
    }

    let icon = <Clapperboard className="h-8 w-8" />;
    let text = "";
    if (shownStatus === "uploading") {
        icon = <Loader2 className="h-8 w-8 animate-spin" />;
        text = STREAMING_VIDEO_UPLOADING;
    } else if (shownStatus === "processing") {
        icon = <Loader2 className="h-8 w-8 animate-spin" />;
        text = STREAMING_VIDEO_PROCESSING;
    } else if (shownStatus === "error") {
        icon = <TriangleAlert className="h-8 w-8 text-destructive" />;
        text = STREAMING_VIDEO_ERROR;
    }

    return (
        <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-md bg-muted text-muted-foreground">
            {icon}
            {text && (
                <p
                    className={
                        shownStatus === "error"
                            ? "text-sm font-medium text-destructive"
                            : "text-sm"
                    }
                >
                    {text}
                </p>
            )}
        </div>
    );
}
