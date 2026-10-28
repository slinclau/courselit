import { VideoProviderSchema } from "@courselit/orm-models";
import mongoose, { Model } from "mongoose";

const VideoProviderModel =
    (mongoose.models.VideoProvider as Model<any>) ||
    mongoose.model("VideoProvider", VideoProviderSchema);

export default VideoProviderModel;
