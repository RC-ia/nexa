/**
 * Estado mutável compartilhado da aplicação
 * Gerado por refatoração de script.js — comportamento preservado.
 */
export let scheduledFeedScroll = false;


export let abortController = null;


export let CHATS_KEY = "nexa_chats";


export let ACTIVE_CHAT_KEY = "nexa_active_chat";


export let pendingImage = null;


export let pendingFile = null;


export const history = [];


export let reasoningLevel = "none";


export let deepMode = false;


export let spicyMode = false;


export let imageMode = false;


export let chats = [];


export let activeChatId = null;


export let drawerOpen = false;


export let chatsPushTimer = null;


export let liveVoices = [];


export let liveVoiceSaved = "Kore";


export let nativeVoicePending = false;


export let reminderPollTimer = null;


export let pushToken = "";


export let viewMode = "chat";


export let imageGenerating = false;


export let imageChats = [];


export let activeImageChatId = null;


export let currentUser = null;


export let appStarted = false;


export let messageKey = "";


export let memoryEnabled = true;


export let customInstructions = "";





// ---- Setters de estado: reatribuições que vêm de outros módulos ----
// (imports são ligações vivas, mas só o módulo dono pode reatribuir)
export function assignACTIVE_CHAT_KEY(value) { ACTIVE_CHAT_KEY = value; return value; }
export function assignCHATS_KEY(value) { CHATS_KEY = value; return value; }
export function assignAbortController(value) { abortController = value; return value; }
export function assignActiveChatId(value) { activeChatId = value; return value; }
export function assignActiveImageChatId(value) { activeImageChatId = value; return value; }
export function assignAppStarted(value) { appStarted = value; return value; }
export function assignChats(value) { chats = value; return value; }
export function assignChatsPushTimer(value) { chatsPushTimer = value; return value; }
export function assignCurrentUser(value) { currentUser = value; return value; }
export function assignCustomInstructions(value) { customInstructions = value; return value; }
export function assignDeepMode(value) { deepMode = value; return value; }
export function assignDrawerOpen(value) { drawerOpen = value; return value; }
export function assignImageChats(value) { imageChats = value; return value; }
export function assignImageGenerating(value) { imageGenerating = value; return value; }
export function assignImageMode(value) { imageMode = value; return value; }
export function assignLiveVoiceSaved(value) { liveVoiceSaved = value; return value; }
export function assignLiveVoices(value) { liveVoices = value; return value; }
export function assignMemoryEnabled(value) { memoryEnabled = value; return value; }
export function assignMessageKey(value) { messageKey = value; return value; }
export function assignNativeVoicePending(value) { nativeVoicePending = value; return value; }
export function assignPendingFile(value) { pendingFile = value; return value; }
export function assignPendingImage(value) { pendingImage = value; return value; }
export function assignPushToken(value) { pushToken = value; return value; }
export function assignReasoningLevel(value) { reasoningLevel = value; return value; }
export function assignReminderPollTimer(value) { reminderPollTimer = value; return value; }
export function assignScheduledFeedScroll(value) { scheduledFeedScroll = value; return value; }
export function assignSpicyMode(value) { spicyMode = value; return value; }
export function assignViewMode(value) { viewMode = value; return value; }
