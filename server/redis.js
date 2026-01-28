import { createClient } from "redis";

export const pubClient = createClient();
export const subClient = pubClient.duplicate();

await pubClient.connect();
await subClient.connect();

console.log("Redis connected");
