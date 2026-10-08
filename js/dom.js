/**
 * Elementos de DOM (cache no boot) + utilitários de UI
 * Gerado por refatoração de script.js — comportamento preservado.
 */
import { assignScheduledFeedScroll, scheduledFeedScroll } from "./state.js";

export const composer = document.getElementById("composer");


export const input = document.getElementById("messageInput");


export const chat = document.getElementById("chat");


export const feed = document.querySelector(".feed");


export function scrollConversationToBottom() {
  if (!feed) {
    return;
  }

  feed.scrollTop = feed.scrollHeight;

  // O conteúdo pode ganhar altura depois da atualização do DOM (markdown,
  // fontes ou quebra de linha). Reaplica a posição no próximo frame.
  if (scheduledFeedScroll) {
    return;
  }

  assignScheduledFeedScroll(true);
  requestAnimationFrame(() => {
    assignScheduledFeedScroll(false);
    feed.scrollTop = feed.scrollHeight;
    requestAnimationFrame(() => {
      feed.scrollTop = feed.scrollHeight;
    });
  });
}


export const micButton = document.getElementById("micButton");


export const liveCallButton = document.getElementById("liveCallButton");


export const sendButton = document.getElementById("sendButton");


export const app = document.querySelector(".app");


export const drawerToggle = document.getElementById("drawerToggle");


export const drawerClose = document.getElementById("drawerClose");


export const drawerScrim = document.getElementById("drawerScrim");


export const drawerNewChat = document.getElementById("drawerNewChat");


export const drawerChats = document.getElementById("drawerChats");


export const drawerSettings = document.getElementById("drawerSettings");


export const settingsPanel = document.getElementById("settingsPanel");


export const settingsClose = document.getElementById("settingsClose");


export const settingsHome = document.getElementById("settingsHome");


export const settingsTitle = document.getElementById("settingsTitle");


export const settingsViews = {
  live: document.getElementById("settingsLive"),
  memory: document.getElementById("settingsMemory"),
  instructions: document.getElementById("settingsInstructions"),
  agent: document.getElementById("settingsAgent"),
  agentThinking: document.getElementById("settingsAgentThinking"),
  agentDeep: document.getElementById("settingsAgentDeep"),
  agentVision: document.getElementById("settingsAgentVision"),
  agentIntent: document.getElementById("settingsAgentIntent"),
  agentImagePrompt: document.getElementById("settingsAgentImagePrompt"),
  agentSpicy: document.getElementById("settingsAgentSpicy"),
  agentReminders: document.getElementById("settingsAgentReminders"),
  time: document.getElementById("settingsTime"),
  listen: document.getElementById("settingsListen"),
  reminders: document.getElementById("settingsReminders"),
  more: document.getElementById("settingsMore")
};


export const liveVoiceSelect = document.getElementById("liveVoiceSelect");


export const liveVoiceStatus = document.getElementById("liveVoiceStatus");


export const liveCallOpenButton = document.getElementById("liveCallOpen");


export const memoryToggle = document.getElementById("memoryToggle");


export const memoryList = document.getElementById("memoryList");


export const memoryStatus = document.getElementById("memoryStatus");


export const customInstructionsInput = document.getElementById("customInstructions");


export const instructionStatus = document.getElementById("instructionStatus");


export const systemPromptInput = document.getElementById("systemPromptInput");


export const systemPromptStatus = document.getElementById("systemPromptStatus");


export const reminderList = document.getElementById("reminderList");


export const reminderStatus = document.getElementById("reminderStatus");


export const pushStatusLine = document.getElementById("pushStatus");


export const reminderNotificationButton = document.getElementById("reminderNotification");


export const imageSpicyButton = document.getElementById("imageSpicyButton");


export const imageFeed = document.getElementById("imageFeed");


export const imageChat = document.getElementById("imageChat");


export const imageComposer = document.getElementById("imageComposer");


export const imagePromptInput = document.getElementById("imagePromptInput");


export const imageSendButton = document.getElementById("imageSendButton");


export const imageGallery = document.getElementById("imageGallery");


export const imageGalleryGrid = document.getElementById("imageGalleryGrid");


export const imageGalleryEmpty = document.getElementById("imageGalleryEmpty");


export const drawerSection = document.getElementById("drawerSection");


export const chatFeed = document.getElementById("chatFeed");


export const drawerImages = document.getElementById("drawerImages");


export const drawerChat = document.getElementById("drawerChat");


export const studioButton = document.getElementById("studioButton");


export const authPanel = document.getElementById("authPanel");


export const authError = document.getElementById("authError");


export const loginForm = document.getElementById("loginForm");


export const drawerEmail = document.getElementById("drawerEmail");


export const drawerAvatar = document.getElementById("drawerAvatar");


export const drawerLogout = document.getElementById("drawerLogout");


export const drawerAdmin = document.getElementById("drawerAdmin");


export const adminPanel = document.getElementById("adminPanel");


export const adminUsers = document.getElementById("adminUsers");


export const adminForm = document.getElementById("adminForm");


export const adminError = document.getElementById("adminError");


export const serverStatusValue = document.getElementById("serverStatusValue");


export const serverStatusPid = document.getElementById("serverStatusPid");


export const serverStatusUptime = document.getElementById("serverStatusUptime");


export const serverActionStatus = document.getElementById("serverActionStatus");


export const serverForceCheck = document.getElementById("serverForceCheck");



