import { io } from "socket.io-client";

// In AI Studio, the dev server and production app run on the same origin (port 3000)
const socket = io();

export default socket;
