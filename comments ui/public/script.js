const chatWindow = document.getElementById('chat-window');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const showHistoryBtn = document.getElementById('show-history-btn');

// Get conversationId from URL
const urlParams = new URLSearchParams(window.location.search);
const conversationId = urlParams.get('conversationid');

if (!conversationId) {
    addSystemMessage('Warning: No conversationid provided in URL. Messages may not save correctly.');
}

// Event Listeners
sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

showHistoryBtn.addEventListener('click', loadHistory);

async function sendMessage() {
    const messageText = messageInput.value.trim();
    if (!messageText) return;

    // Optimistically show message
    addMessageToUI(messageText, new Date().toISOString(), true); // true = isSelf
    messageInput.value = '';

    try {
        const response = await fetch('/api/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ conversationId, message: messageText })
        });

        if (!response.ok) {
            throw new Error(await response.text());
        }
        console.log('Message saved successfully');
    } catch (error) {
        console.error('Failed to save message:', error);
        addSystemMessage('Failed to save message. Please try again.');
    }
}

async function loadHistory() {
    if (!conversationId) return;

    showHistoryBtn.textContent = 'Loading...';
    showHistoryBtn.disabled = true;

    try {
        const response = await fetch(`/api/history?conversationId=${conversationId}`);
        if (!response.ok) throw new Error(await response.text());

        const messages = await response.json();

        // Clear previous contents
        chatWindow.innerHTML = '';

        if (messages.length === 0) {
            chatWindow.innerHTML = '<div class="empty-state">No history found for this conversation.</div>';
        } else {
            messages.forEach(msg => {
                addMessageToUI(msg.message, msg.timestamp || new Date().toISOString());
            });
        }
    } catch (error) {
        console.error('Failed to load history:', error);
        addSystemMessage('Failed to load history.');
    } finally {
        showHistoryBtn.textContent = 'Show History';
        showHistoryBtn.disabled = false;
    }
}

function addMessageToUI(text, timestampInput) {
    // Remove empty state if present
    const emptyState = chatWindow.querySelector('.empty-state');
    if (emptyState) emptyState.remove();

    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message');

    // Robust Date Parsing
    let dateObj;
    try {
        if (timestampInput && typeof timestampInput === 'object' && timestampInput.value) {
            // Handle BigQuery object format { value: "..." }
            dateObj = new Date(timestampInput.value);
        } else {
            // Handle standard ISO string
            dateObj = new Date(timestampInput);
        }

        if (isNaN(dateObj.getTime())) {
            console.warn('Invalid Date detected:', timestampInput);
            dateObj = new Date(); // Fallback to now
        }
    } catch (e) {
        console.error('Date parsing error', e);
        dateObj = new Date();
    }

    const time = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    messageDiv.innerHTML = `
        ${escapeHtml(text)}
        <span class="timestamp">${time}</span>
    `;

    chatWindow.appendChild(messageDiv);
    scrollToBottom();
}

function addSystemMessage(text) {
    const div = document.createElement('div');
    div.classList.add('empty-state');
    div.textContent = text;
    chatWindow.appendChild(div);
    scrollToBottom();
}

function scrollToBottom() {
    chatWindow.scrollTop = chatWindow.scrollHeight;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
