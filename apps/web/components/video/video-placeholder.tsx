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
    if (status === "ready" && thumbnailUrl) {
        return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
                src={thumbnailUrl}
                alt={STREAMING_VIDEO_THUMBNAIL_ALT}
                className="aspect-video w-full rounded-md object-cover"
            />
        );
    }

    let icon = <Clapperboard className="h-8 w-8" />;
    let text = "";
    if (status === "uploading") {
        icon = <Loader2 className="h-8 w-8 animate-spin" />;
        text = STREAMING_VIDEO_UPLOADING;
    } else if (status === "processing") {
        icon = <Loader2 className="h-8 w-8 animate-spin" />;
        text = STREAMING_VIDEO_PROCESSING;
    } else if (status === "error") {
        icon = <TriangleAlert className="h-8 w-8" />;
        text = STREAMING_VIDEO_ERROR;
    }

    return (
        <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-md bg-muted text-muted-foreground">
            {icon}
            {text && <p className="text-sm">{text}</p>}
        </div>
    );
}
