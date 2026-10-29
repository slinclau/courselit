import { StreamingVideoSchema } from "@courselit/orm-models";
import mongoose, { Model } from "mongoose";

const StreamingVideoModel = (mongoose.models.StreamingVideo ||
    mongoose.model("StreamingVideo", StreamingVideoSchema)) as Model<any>;

export default StreamingVideoModel;
