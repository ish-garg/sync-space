import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";

import { pubClient, subClient } from "./redis.js";
import { createAdapter } from "@socket.io/redis-adapter";

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" },
});

// Redis adapter (future multi-node scaling)
io.adapter(createAdapter(pubClient, subClient));

const WORLD_SIZE = 600;
const AUDIO_RANGE = 120; // pixels

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

io.on("connection", (socket) => {
  console.log("CONNECTED:", socket.id);

  socket.on("move", async ({ x, y }) => {
    try {
      const cx = clamp(x, 0, WORLD_SIZE);
      const cy = clamp(y, 0, WORLD_SIZE);

      // store exact positions
      await pubClient.hSet("world:users:pos", socket.id, `${cx},${cy}`);

      // ----- MULTIPLAYER RENDER STATE -----
      const all = await pubClient.hGetAll("world:users:pos");

      const players = Object.entries(all).map(([id, val]) => {
        const [px, py] = val.split(",").map(Number);
        return { id, x: px, y: py };
      });

      io.emit("players-update", players);

      // ----- WORLD-SPACE PROXIMITY FOR AUDIO -----
      const me = { id: socket.id, x: cx, y: cy };

      const nearby = players
        .filter(p => p.id !== socket.id)
        .filter(p => {
          const dx = p.x - me.x;
          const dy = p.y - me.y;
          return Math.sqrt(dx * dx + dy * dy) <= AUDIO_RANGE;
        })
        .map(p => p.id);

      console.log("AUDIO NEAR FOR", socket.id, "=>", nearby);

      socket.emit("proximity", nearby);

    } catch (err) {
      console.error("MOVE ERROR:", err);
    }
  });

  // -------- WEBRTC SIGNALING --------

  socket.on("webrtc-offer", ({ to, offer }) => {
    io.to(to).emit("webrtc-offer", { from: socket.id, offer });
  });

  socket.on("webrtc-answer", ({ to, answer }) => {
    io.to(to).emit("webrtc-answer", { from: socket.id, answer });
  });

  socket.on("webrtc-ice", ({ to, candidate }) => {
    io.to(to).emit("webrtc-ice", { from: socket.id, candidate });
  });

  socket.on("disconnect", async () => {
    try {
      await pubClient.hDel("world:users:pos", socket.id);
      console.log("DISCONNECTED:", socket.id);
    } catch (err) {
      console.error("DISCONNECT ERROR:", err);
    }
  });
});

server.listen(4000, () => {
  console.log("Server running on http://localhost:4000");
});
