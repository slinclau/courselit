import {
    InternalStreamingVideo,
    StreamingVideoSchema,
} from "@courselit/orm-models";
import mongoose, { Model } from "mongoose";

const StreamingVideoModel =
    (mongoose.models.StreamingVideo as
        | Model<InternalStreamingVideo>
        | undefined) ||
    mongoose.model<InternalStreamingVideo>(
        "StreamingVideo",
        StreamingVideoSchema,
    );

export type { InternalStreamingVideo };
export default StreamingVideoModel;
