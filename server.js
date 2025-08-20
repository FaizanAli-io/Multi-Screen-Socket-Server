import cors from "cors";
import { Server } from "socket.io";
import { createServer } from "http";
import express, { json } from "express";

// -------------------- Setup --------------------
const app = express();
const server = createServer(app);

const io = new Server(server, {
  cors: {
    origin: ["http://localhost:3000", "https://split-screen-fitness-display.vercel.app"],
    methods: ["GET", "POST"],
    credentials: true
  }
});

app.use(cors());
app.use(json());

// -------------------- State --------------------
const connectedScreens = new Map(); // screenId → socket
const connectedControlPanels = new Set(); // sockets

// -------------------- Helpers --------------------
function broadcastToControlPanels(event, data) {
  connectedControlPanels.forEach((controlSocket) => {
    controlSocket.emit(event, data);
  });
}

function sendCommandToScreens(command, targetScreens, payload) {
  targetScreens.forEach((screenId) => {
    const screenSocket = connectedScreens.get(screenId);
    if (screenSocket) {
      screenSocket.emit(command, payload);
      console.log(`✅ ${command} sent to ${screenId}`);
    } else {
      console.log(`❌ Screen ${screenId} not connected`);
    }
  });
}

// -------------------- Routes --------------------
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    connectedScreens: Array.from(connectedScreens.keys()),
    controlPanels: connectedControlPanels.size
  });
});

// -------------------- Socket Events --------------------
io.on("connection", (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);

  // ---- Registration ----
  socket.on("register_screen", ({ screenId }) => {
    console.log(`📺 Screen registered: ${screenId}`);
    connectedScreens.set(screenId, socket);

    socket.screenId = screenId;
    socket.clientType = "screen";

    // Notify control panels
    broadcastToControlPanels("screen_connected", { screenId });

    // Acknowledge registration
    socket.emit("registration_success", {
      screenId,
      connectedScreens: Array.from(connectedScreens.keys())
    });
  });

  socket.on("register_control_panel", () => {
    console.log(`🎮 Control panel registered: ${socket.id}`);
    connectedControlPanels.add(socket);
    socket.clientType = "control_panel";

    // Send initial state
    socket.emit("connected_screens_update", {
      screens: Array.from(connectedScreens.keys())
    });
  });

  // ---- Sync Commands ----
  socket.on("sync_play", ({ targetScreens, timestamp }) => {
    console.log(`▶️ Sync play for screens: ${targetScreens.join(", ")}`);
    sendCommandToScreens("play_command", targetScreens, { timestamp });

    socket.emit("sync_command_ack", { action: "play", targetScreens, timestamp });
  });

  socket.on("sync_pause", ({ targetScreens, timestamp }) => {
    console.log(`⏸️ Sync pause for screens: ${targetScreens.join(", ")}`);
    sendCommandToScreens("pause_command", targetScreens, { timestamp });

    socket.emit("sync_command_ack", { action: "pause", targetScreens, timestamp });
  });

  // ---- Status Updates ----
  socket.on("screen_status", ({ screenId, status }) => {
    console.log(`📊 Screen ${screenId} status: ${status}`);
    broadcastToControlPanels("screen_status_update", { screenId, status });
  });

  // ---- Disconnect ----
  socket.on("disconnect", () => {
    console.log(`❌ Client disconnected: ${socket.id}`);

    if (socket.clientType === "screen" && socket.screenId) {
      console.log(`📺❌ Screen disconnected: ${socket.screenId}`);
      connectedScreens.delete(socket.screenId);
      broadcastToControlPanels("screen_disconnected", { screenId: socket.screenId });
    }

    if (socket.clientType === "control_panel") {
      console.log(`🎮❌ Control panel disconnected: ${socket.id}`);
      connectedControlPanels.delete(socket);
    }
  });

  // ---- Error ----
  socket.on("error", (error) => {
    console.error(`⚠️ Socket error (${socket.id}):`, error);
  });
});

// -------------------- Graceful Shutdown --------------------
process.on("SIGINT", () => {
  console.log("🛑 Shutting down server...");
  io.close();
  server.close(() => {
    console.log("✅ Server closed");
    process.exit(0);
  });
});

// -------------------- Start Server --------------------
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 WebSocket server running on port ${PORT}`);
  console.log(`💓 Health check: http://localhost:${PORT}/health`);
});
