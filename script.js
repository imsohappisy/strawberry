document.addEventListener('DOMContentLoaded', () => {
    const chatMessages = document.getElementById('chat-messages');
    const userInput = document.getElementById('user-input');
    const sendBtn = document.getElementById('send-btn');
    const typingIndicator = document.getElementById('typing-indicator');

    let currentKeyIndex = 0;
    let conversationHistory = [];
    const systemInstruction = "너의 이름은 '베리(Berry)'야. 딸기(Strawberry)를 모티브로 한 아주 귀엽고 상큼하고 친절한 AI 어시스턴트야. 사용자를 존중하고 친근한 반말이나 존댓말을 자연스럽게 섞어 써. 너무 길지 않게 핵심만 다정하게 말하고, 문장 끝에 가끔 🍓 기호나 과일 관련 펀(pun)을 사용해. 절대 프로그램 코드가 노출되지 않도록 자연스러운 사람처럼 말해.";

    function formatTime(date) {
        const hours = date.getHours();
        const minutes = date.getMinutes();
        const ampm = hours >= 12 ? '오후' : '오전';
        const formattedHours = hours % 12 || 12;
        const formattedMinutes = minutes < 10 ? '0' + minutes : minutes;
        return `${ampm} ${formattedHours}:${formattedMinutes}`;
    }

    document.querySelector('.message-time').textContent = formatTime(new Date());

    function addMessage(text, isUser = false) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isUser ? 'user-message' : 'ai-message'}`;
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        let formattedText = text
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") 
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') 
            .replace(/\*(.*?)\*/g, '<em>$1</em>') 
            .replace(/\n/g, '<br>');
        contentDiv.innerHTML = formattedText; 
        const timeDiv = document.createElement('div');
        timeDiv.className = 'message-time';
        timeDiv.textContent = formatTime(new Date());
        messageDiv.appendChild(contentDiv);
        messageDiv.appendChild(timeDiv);
        chatMessages.appendChild(messageDiv);
        scrollToBottom();
    }

    function scrollToBottom() {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function showTyping() {
        typingIndicator.style.display = 'flex';
        scrollToBottom();
    }

    function hideTyping() {
        typingIndicator.style.display = 'none';
    }

    async function callGeminiAPI(userMessage) {
        // API 키 체크를 호출 시점에 수행
        if (typeof BERRY_CONFIG === 'undefined' || !BERRY_CONFIG.apiKeys?.length) {
            console.error('config.js 파일이 없거나 apiKeys가 비어있습니다.');
            return "앗! 제가 대답해드리려면 API 설정이 필요해요 🍓 (config.js 확인 필요)";
        }
        const apiKeys = BERRY_CONFIG.apiKeys;

        if (conversationHistory.length >= 10) {
            conversationHistory.splice(0, 2);
        }
        conversationHistory.push({ role: "user", parts: [{ text: userMessage }] });
        const systemTurn = [
            { role: "user", parts: [{ text: `[시스템 설정] ${systemInstruction}` }] },
            { role: "model", parts: [{ text: "알겠어요! 저는 베리예요 🍓 어떻게 도와드릴까요?" }] }
        ];
        const payload = { contents: [...systemTurn, ...conversationHistory] };

        const models = ["gemma-3-1b-it", "gemma-3-4b-it", "gemma-3-12b-it", "gemma-3-27b-it"];
        let lastErrorMsg = "";

        for (let m = 0; m < models.length; m++) {
            const model = models[(currentKeyIndex + m) % models.length];
            for (let k = 0; k < apiKeys.length; k++) {
                const apiKey = apiKeys[currentKeyIndex];
                currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
                try {
                    const response = await fetch(url, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(payload)
                    });
                    const data = await response.json();
                    if (response.ok) {
                        conversationHistory.push({ role: "model", parts: [{ text: data.candidates[0].content.parts[0].text }] });
                        return data.candidates[0].content.parts[0].text;
                    } else {
                        console.warn(`[${model} 실패]`, data.error?.message);
                        lastErrorMsg = data.error?.message || response.status;
                        continue;
                    }
                } catch (error) {
                    console.error("Network Error:", error);
                    lastErrorMsg = "네트워크 오류";
                    continue;
                }
            }
        }
        conversationHistory.pop();
        showQuotaModal(lastErrorMsg);
        return null;
    }

    async function handleUserInput() {
        const text = userInput.value.trim();
        if (text === '') return;
        addMessage(text, true);
        userInput.value = '';
        showTyping();
        const aiResponse = await callGeminiAPI(text);
        hideTyping();
        if (aiResponse) addMessage(aiResponse);
    }

    sendBtn.addEventListener('click', handleUserInput);
    userInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleUserInput(); });

    const quotaModal = document.getElementById('quota-modal');
    const modalCloseBtn = document.getElementById('modal-close-btn');

    function showQuotaModal(errorMsg) {
        const errorElem = document.getElementById('modal-error-msg');
        if (errorElem) {
            errorElem.textContent = errorMsg ? `오류 상세: ${errorMsg}` : '';
            errorElem.style.display = errorMsg ? 'block' : 'none';
        }
        quotaModal.style.display = 'flex';
    }

    modalCloseBtn.addEventListener('click', () => { quotaModal.style.display = 'none'; });
    quotaModal.addEventListener('click', (e) => { if (e.target === quotaModal) quotaModal.style.display = 'none'; });

    // 테마 토글 핸들러
    const themeToggle = document.getElementById('theme-toggle');
    const sunIcon = document.querySelector('.sun-icon');
    const moonIcon = document.querySelector('.moon-icon');

    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcons(savedTheme);

    themeToggle.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        updateThemeIcons(newTheme);
    });

    function updateThemeIcons(theme) {
        if (theme === 'dark') {
            sunIcon.style.display = 'none';
            moonIcon.style.display = 'block';
        } else {
            sunIcon.style.display = 'block';
            moonIcon.style.display = 'none';
        }
    }

    userInput.focus();
    const charCount = document.getElementById('char-count');
    const MAX_LEN = 20;
    userInput.addEventListener('input', () => {
        const remaining = MAX_LEN - userInput.value.length;
        charCount.textContent = remaining;
        charCount.className = remaining <= 3 ? 'danger' : remaining <= 7 ? 'warning' : '';
    });
});
