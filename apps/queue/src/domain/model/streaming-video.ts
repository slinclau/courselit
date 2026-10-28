import { StreamingVideoSchema } from "@courselit/orm-models";
import mongoose, { Model } from "mongoose";

const StreamingVideoModel =
    (mongoose.models.StreamingVideo as Model<any>) ||
    mongoose.model("StreamingVideo", StreamingVideoSchema);

export default StreamingVideoModel;
