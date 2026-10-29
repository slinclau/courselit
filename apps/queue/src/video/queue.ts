import { Queue } from "bullmq";
import redis from "../redis";

const videoQueue = new Queue("video", { connection: redis });

export default videoQueue;
