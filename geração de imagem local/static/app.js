const form = document.querySelector('#generate-form');
const promptInput = document.querySelector('#prompt');
const generateButton = document.querySelector('#generate-button');
const conversation = document.querySelector('#conversation');
const connectionStatus = document.querySelector('#connection-status');
const modelName = document.querySelector('#model-name');

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;'
  })[character]);
}

function scrollToLatest() {
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
}

function addUserMessage(prompt) {
  const message = document.createElement('div');
  message.className = 'user-message';
  message.innerHTML = `<div class="bubble">${escapeHtml(prompt)}</div>`;
  conversation.appendChild(message);
}

function addLoadingMessage() {
  const message = document.createElement('div');
  message.className = 'loading-message';
  message.innerHTML = '<span class="loader" aria-hidden="true"></span><span>Imaginando...</span>';
  conversation.appendChild(message);
  scrollToLatest();
  return message;
}

function addResult(result) {
  const message = document.createElement('div');
  message.className = 'assistant-message';
  const provider = result.provider ? escapeHtml(result.provider) : 'Novita AI';
  const duration = result.duration_ms ? `${escapeHtml(result.duration_ms)} ms` : '';
  message.innerHTML = `
    <div class="result-head"><span class="assistant-avatar" aria-hidden="true">✦</span><span>NEXA criou sua imagem</span></div>
    <div class="result-card">
      <a href="${escapeHtml(result.image_url)}" target="_blank" rel="noreferrer">
        <img src="${escapeHtml(result.image_url)}" alt="Imagem gerada a partir do prompt" loading="lazy">
      </a>
      <div class="result-meta">
        <span>${provider}</span>
        ${duration ? `<span>${duration}</span>` : ''}
        <a href="${escapeHtml(result.image_url)}" download>Baixar imagem</a>
      </div>
    </div>`;
  conversation.appendChild(message);
  scrollToLatest();
}

function addError(messageText) {
  const message = document.createElement('div');
  message.className = 'error-message';
  message.textContent = messageText;
  conversation.appendChild(message);
  scrollToLatest();
}

async function checkStatus() {
  try {
    const response = await fetch('api/status');
    const data = await response.json();
    const configured = data.status === 'configured';
    connectionStatus.classList.toggle('online', configured);
    connectionStatus.classList.toggle('starting', false);
    connectionStatus.classList.toggle('offline', !configured);
    connectionStatus.querySelector('span:last-child').textContent = configured
      ? 'Novita conectada'
      : 'configure a Novita';
    if (data.model) modelName.textContent = data.model;
  } catch (_) {
    connectionStatus.classList.remove('online', 'starting');
    connectionStatus.classList.add('offline');
    connectionStatus.querySelector('span:last-child').textContent = 'offline';
  }
}

async function generateImage(prompt) {
  const response = await fetch('api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Não foi possível gerar a imagem.');
  return data;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const prompt = promptInput.value.trim();
  if (!prompt || generateButton.disabled) return;

  addUserMessage(prompt);
  promptInput.value = '';
  promptInput.style.height = 'auto';
  generateButton.disabled = true;
  generateButton.querySelector('span:first-child').textContent = 'Gerando';
  const loading = addLoadingMessage();

  try {
    const result = await generateImage(prompt);
    loading.remove();
    addResult(result);
    checkStatus();
  } catch (error) {
    loading.remove();
    addError(error.message);
  } finally {
    generateButton.disabled = false;
    generateButton.querySelector('span:first-child').textContent = 'Gerar';
    promptInput.focus();
  }
});

promptInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

promptInput.addEventListener('input', () => {
  promptInput.style.height = 'auto';
  promptInput.style.height = `${Math.min(promptInput.scrollHeight, 180)}px`;
});

checkStatus();
window.setInterval(checkStatus, 5000);
