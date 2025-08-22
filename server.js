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
const connectedControlPanels = new Set(); // sockets
const connectedScreens = new Map(); // screenId → Set<socket>

// -------------------- Helpers --------------------
function broadcastToControlPanels(event, data) {
  connectedControlPanels.forEach((controlSocket) => {
    controlSocket.emit(event, data);
  });
}

// New helper → send latest connected screens state
function broadcastConnectedScreens() {
  const screenData = Array.from(connectedScreens.entries()).map(([screenId, sockets]) => ({
    screenId,
    count: sockets.size
  }));

  broadcastToControlPanels("connected_screens_update", { screens: screenData });
}

function sendCommandToScreens(command, targetScreens, payload) {
  targetScreens.forEach((screenId) => {
    const screenSockets = connectedScreens.get(screenId);
    if (screenSockets && screenSockets.size > 0) {
      let index = 1;
      screenSockets.forEach((screenSocket) => {
        screenSocket.emit(command, payload);
        console.log(
          `✅ ${command} sent to Screen ${screenId} (socket ${index++} of ${screenSockets.size})`
        );
      });
    } else {
      console.log(`❌ Screen ${screenId} not connected`);
    }
  });
}

// -------------------- Routes --------------------
app.get("/health", (_, res) => {
  const screens = Array.from(connectedScreens.entries()).map(([screenId, sockets]) => ({
    screenId,
    instances: sockets.size
  }));

  res.json({
    status: "ok",
    connectedScreens: screens,
    controlPanels: connectedControlPanels.size
  });
});

// -------------------- Socket Events --------------------
io.on("connection", (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);

  // ---- Registration ----
  socket.on("register_screen", ({ screenId }) => {
    console.log(`📺 Registering socket for Screen ${screenId}`);

    socket.clientType = "screen";
    socket.screenId = screenId;

    // Get or create socket set for this screen
    let screenSockets = connectedScreens.get(screenId);
    if (!screenSockets) {
      screenSockets = new Set();
      connectedScreens.set(screenId, screenSockets);
    }

    // If already 3 instances, remove the oldest one
    if (screenSockets.size >= 3) {
      console.log(`⚠️ Maximum instances reached for ${screenId}. Removing oldest connection.`);
      const oldestSocket = Array.from(screenSockets)[0];
      screenSockets.delete(oldestSocket);
      oldestSocket.disconnect(true);
    }

    // Add the new socket
    screenSockets.add(socket);

    // Send full updated state instead of just one-screen event
    broadcastConnectedScreens();

    // Acknowledge registration
    socket.emit("registration_success", {
      screenId,
      instances: screenSockets.size,
      connectedScreens: Array.from(connectedScreens.keys())
    });
  });

  socket.on("register_control_panel", () => {
    console.log(`🎮 Control panel registered: ${socket.id}`);
    socket.clientType = "control_panel";
    connectedControlPanels.add(socket);

    // Send initial state immediately
    broadcastConnectedScreens();
  });

  // ---- Sync Commands ----
  socket.on("sync_play", ({ targetScreens, timestamp }) => {
    console.log(`▶️  Sync play for screens: ${targetScreens.join(", ")}`);
    sendCommandToScreens("play_command", targetScreens, { timestamp });
    socket.emit("sync_command_ack", { action: "play", targetScreens, timestamp });
  });

  socket.on("sync_pause", ({ targetScreens, timestamp }) => {
    console.log(`⏸️  Sync pause for screens: ${targetScreens.join(", ")}`);
    sendCommandToScreens("pause_command", targetScreens, { timestamp });
    socket.emit("sync_command_ack", { action: "pause", targetScreens, timestamp });
  });

  socket.on("sync_stop", ({ targetScreens, timestamp }) => {
    console.log(`⏹️  Sync stop for screens: ${targetScreens.join(", ")}`);
    sendCommandToScreens("stop_command", targetScreens, { timestamp });
    socket.emit("sync_command_ack", { action: "stop", targetScreens, timestamp });
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
      const screenSockets = connectedScreens.get(socket.screenId);
      if (screenSockets) {
        screenSockets.delete(socket);
        console.log(`📺 Instance of ${socket.screenId} disconnected (${screenSockets.size} left)`);

        // If no more instances, remove screen entirely
        if (screenSockets.size === 0) {
          connectedScreens.delete(socket.screenId);
        }

        // Always update control panels after disconnect
        broadcastConnectedScreens();
      }
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
