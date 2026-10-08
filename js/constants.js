/**
 * Constantes: chaves de localStorage, limites e metadados
 * Gerado por refatoração de script.js — comportamento preservado.
 */
export const MEMORY_KEY = "nexa_conversation";


export const MESSAGE_KEY_STORAGE_PREFIX = "nexa_message_key:";


export const CHATS_PUSH_DELAY_MS = 1500;


export const REASONING_KEY = "nexa_reasoning";


export const LIVE_VOICE_KEY = "nexa_live_voice";


export const MEMORY_ENABLED_KEY = "nexa_memory_enabled:";


export const INSTRUCTIONS_KEY = "nexa_custom_instructions:";


export const DEEP_MODE_KEY = "nexa_deep_mode:";


export const SPICY_MODE_KEY = "nexa_spicy_mode:";


export const DRAWER_KEY = "nexa_drawer";


export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;


export const MAX_FILE_BYTES = 2 * 1024 * 1024;


export const ALLOWED_FILE_EXTENSIONS = new Set([
  "txt", "md", "markdown", "csv", "json", "xml", "html", "htm",
  "css", "js", "ts", "jsx", "tsx", "py", "java", "c", "h", "cpp",
  "hpp", "cs", "go", "rs", "php", "rb", "sql", "yaml", "yml", "toml",
  "ini", "log"
]);


export const imageCache = new Map();


export const REASONING_ALIASES = {
  xhigh: "ultra",
  min: "minimum",
  max: "maximum",
};


export const REASONING_LABELS = {
  none: "Rápido",
  minimum: "Mínimo",
  low: "Baixo",
  medium: "Médio",
  high: "Alto",
  veryhigh: "Muito alto",
  maximum: "Máximo",
  ultra: "Ultra",
};


export const REASONING_LEVELS = {
  none: 0,
  minimum: 1,
  low: 2,
  medium: 3,
  high: 4,
  veryhigh: 5,
  maximum: 6,
  ultra: 7,
};


export const NOTICE_ITEMS = {
  memory: {
    className: "memory-notice",
    icon: "✦",
    text: "Memória atualizada com o que você me contou."
  },
  search: {
    className: "search-notice",
    icon: "⌕",
    text: "Pesquisei na web para responder."
  }
};


export const REMINDER_POLL_MS = 30000;


export const REMINDER_CURSOR_PREFIX = "nexa_reminder_cursor";


export const REMINDERS_CHAT_ID = "lembretes-da-nexa";


export const REMINDERS_CHAT_TITLE = "Lembretes";


export const IMAGE_CHATS_KEY = "nexa_image_chats";


export const ACTIVE_IMAGE_CHAT_KEY = "nexa_active_image_chat";


export const VIEW_MODE_KEY = "nexa_view_mode";



