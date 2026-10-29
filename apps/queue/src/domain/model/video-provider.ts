import { VideoProviderSchema } from "@courselit/orm-models";
import mongoose, { Model } from "mongoose";

const VideoProviderModel = (mongoose.models.VideoProvider ||
    mongoose.model("VideoProvider", VideoProviderSchema)) as Model<any>;

export default VideoProviderModel;
