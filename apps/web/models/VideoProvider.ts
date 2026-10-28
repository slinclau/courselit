import {
    VideoProvider as InternalVideoProvider,
    VideoProviderSchema,
} from "@courselit/orm-models";
import mongoose, { Model } from "mongoose";

const VideoProviderModel =
    (mongoose.models.VideoProvider as
        | Model<InternalVideoProvider>
        | undefined) ||
    mongoose.model<InternalVideoProvider>("VideoProvider", VideoProviderSchema);

export type { InternalVideoProvider as VideoProvider };
export default VideoProviderModel;
