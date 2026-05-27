import * as dbStore from "./db-store";
import { hasDatabaseUrl } from "./prisma";
import * as memoryStore from "./store";

function hasDatabase() {
  return hasDatabaseUrl();
}

export async function listRooms() {
  return hasDatabase() ? dbStore.listRooms() : memoryStore.listRooms();
}

export async function getRoom(roomId: string) {
  return hasDatabase() ? dbStore.getRoom(roomId) : memoryStore.getRoom(roomId);
}

export async function createRoom(input: { title: string; ownerName?: string; mode?: "discussion" | "werewolf" }) {
  return hasDatabase() ? dbStore.createRoom(input) : memoryStore.createRoom(input);
}

export async function addAgent(
  roomId: string,
  input: { name: string; role: string; persona?: string; goal?: string; provider?: string; model?: string },
) {
  return hasDatabase() ? dbStore.addAgent(roomId, input) : memoryStore.addAgent(roomId, input);
}

export type AgentUpdate = {
  name?: string;
  role?: string;
  persona?: string;
  goal?: string;
  provider?: string;
  model?: string;
  temperature?: number;
  enabled?: boolean;
};

export async function updateAgent(roomId: string, agentId: string, input: AgentUpdate) {
  return hasDatabase() ? dbStore.updateAgent(roomId, agentId, input) : memoryStore.updateAgent(roomId, agentId, input);
}

export async function addMessage(roomId: string, input: { content: string; senderId?: string }) {
  return hasDatabase() ? dbStore.addMessage(roomId, input) : memoryStore.addMessage(roomId, input);
}

export async function startDiscussion(roomId: string) {
  return hasDatabase() ? dbStore.startDiscussion(roomId) : memoryStore.startDiscussion(roomId);
}