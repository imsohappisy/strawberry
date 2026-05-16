document.addEventListener('DOMContentLoaded', () => {
    const chatMessages = document.getElementById('chat-messages');
    const userInput = document.getElementById('user-input');
    const sendBtn = document.getElementById('send-btn');
    const typingIndicator = document.getElementById('typing-indicator');

    // ── 상수 ──────────────────────────────────────────────
    const MAX_HISTORY = 20;   // user+model 쌍 기준 10회 = 20개
    const MAX_LEN = 30;      // [Fix] 20 → 300자로 실용적 상향
    const MODELS = [
        'gemini-2.5-flash',
        'gemini-2.5-pro',
        'gemini-2.0-flash',
        'gemma2-9b-it',
    ];
    const SYSTEM_INSTRUCTION =
        "너의 이름은 '베리(Berry)'야. 딸기(Strawberry)를 모티브로 한 아주 귀엽고 상큼하고 친절한 AI 어시스턴트야. " +
        "사용자를 존중하고 친근한 반말이나 존댓말을 자연스럽게 섞어 써. " +
        "너무 길지 않게 핵심만 다정하게 말하고, 문장 끝에 가끔 🍓 기호나 과일 관련 펀(pun)을 사용해. " +
        "절대 프로그램 코드가 노출되지 않도록 자연스러운 사람처럼 말해.";

    // ── 상태 ──────────────────────────────────────────────
    let currentKeyIndex = 0;
    let currentModelIndex = 0; // [Fix] 키/모델 인덱스 분리
    let conversationHistory = [];
    let isLoading = false;     // [Fix] 중복 전송 방지 플래그
    let abortController = null; // [Fix] 응답 취소용

    // ── 시간 포맷 ─────────────────────────────────────────
    function formatTime(date) {
        const h = date.getHours();
        const m = date.getMinutes();
        const ampm = h >= 12 ? '오후' : '오전';
        return `${ampm} ${h % 12 || 12}:${String(m).padStart(2, '0')}`;
    }

    const initialTimeElem = document.querySelector('.message-time');
    if (initialTimeElem) initialTimeElem.textContent = formatTime(new Date());

    // ── 마크다운 렌더링 ───────────────────────────────────
    // [Feat] 코드 블록, 인라인 코드 파싱 추가
    function renderMarkdown(text) {
        return text
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            // 코드 블록 (``` ... ```)
            .replace(/```([\w]*)\n?([\s\S]*?)```/g, (_, lang, code) =>
                `<pre style="background:var(--color-background-secondary);padding:10px 12px;border-radius:8px;overflow-x:auto;margin:6px 0"><code style="font-family:monospace;font-size:13px">${code.trim()}</code></pre>`)
            // 인라인 코드
            .replace(/`([^`]+)`/g, '<code style="background:var(--color-background-secondary);padding:1px 5px;border-radius:4px;font-family:monospace;font-size:13px">$1</code>')
            // 볼드 / 이탤릭
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            // 줄바꿈
            .replace(/\n/g, '<br>');
    }

    // ── 메시지 추가 ───────────────────────────────────────
    function addMessage(text, isUser = false) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isUser ? 'user-message' : 'ai-message'}`;

        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.innerHTML = renderMarkdown(text);

        const timeDiv = document.createElement('div');
        timeDiv.className = 'message-time';
        timeDiv.textContent = formatTime(new Date());

        // [Feat] AI 메시지에 복사 버튼 추가
        if (!isUser) {
            const copyBtn = document.createElement('button');
            copyBtn.className = 'copy-btn';
            copyBtn.title = '복사';
            copyBtn.innerHTML = '📋';
            copyBtn.style.cssText =
                'background:none;border:none;cursor:pointer;opacity:0.5;font-size:13px;padding:2px 4px;margin-left:4px;';
            copyBtn.addEventListener('click', () => {
                navigator.clipboard.writeText(text).then(() => {
                    copyBtn.innerHTML = '✅';
                    setTimeout(() => { copyBtn.innerHTML = '📋'; }, 1500);
                });
            });
            timeDiv.appendChild(copyBtn);
        }

        messageDiv.appendChild(contentDiv);
        messageDiv.appendChild(timeDiv);
        chatMessages.appendChild(messageDiv);
        scrollToBottom();
        return messageDiv;
    }

    function scrollToBottom() {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // ── 로딩 상태 ─────────────────────────────────────────
    function setLoading(state) {
        isLoading = state;
        sendBtn.disabled = state; // [Fix] 중복 전송 방지
        typingIndicator.style.display = state ? 'flex' : 'none';
        if (state) scrollToBottom();
    }

    // ── Gemini API 호출 ───────────────────────────────────
    async function callGeminiAPI(userMessage) {
        if (typeof BERRY_CONFIG === 'undefined' || !BERRY_CONFIG.apiKeys?.length) {
            return "앗! API 설정이 필요해요 🍓 (config.js 확인 필요)";
        }
        const apiKeys = BERRY_CONFIG.apiKeys;

        conversationHistory.push({ role: 'user', parts: [{ text: userMessage }] });

        // [Fix] 최대 20개(10쌍) 유지
        while (conversationHistory.length > MAX_HISTORY) {
            conversationHistory.shift();
        }

        const systemTurn = [
            { role: 'user',  parts: [{ text: `[시스템 설정] ${SYSTEM_INSTRUCTION}` }] },
            { role: 'model', parts: [{ text: '알겠어요! 저는 베리예요 🍓 어떻게 도와드릴까요?' }] },
        ];
        const payload = { contents: [...systemTurn, ...conversationHistory] };

        let lastErrorMsg = '';

        // [Fix] 모델/키 인덱스를 독립적으로 순회
        for (let m = 0; m < MODELS.length; m++) {
            const modelIndex = (currentModelIndex + m) % MODELS.length;
            const model = MODELS[modelIndex];

            for (let k = 0; k < apiKeys.length; k++) {
                const keyIndex = (currentKeyIndex + k) % apiKeys.length;
                const apiKey = apiKeys[keyIndex];
                const url =
                    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

                try {
                    // [Fix] AbortController 연결
                    abortController = new AbortController();
                    const response = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                        signal: abortController.signal,
                    });

                    const data = await response.json();

                    if (response.ok) {
                        // [Fix] candidates null 체크 및 SAFETY 블록 처리
                        const candidate = data.candidates?.[0];
                        if (!candidate || candidate.finishReason === 'SAFETY') {
                            lastErrorMsg = '안전 필터로 응답이 차단되었어요.';
                            continue;
                        }
                        const aiText = candidate.content?.parts?.[0]?.text;
                        if (!aiText) {
                            lastErrorMsg = '빈 응답을 받았어요.';
                            continue;
                        }

                        conversationHistory.push({ role: 'model', parts: [{ text: aiText }] });
                        // 다음 호출을 위해 인덱스 이동
                        currentKeyIndex = (keyIndex + 1) % apiKeys.length;
                        currentModelIndex = modelIndex; // 성공 모델 유지
                        return aiText;
                    } else {
                        console.warn(`[${model} / 키 #${keyIndex} 실패]`, data.error?.message);
                        lastErrorMsg = data.error?.message || String(response.status);
                    }
                } catch (error) {
                    if (error.name === 'AbortError') return null; // 취소된 요청
                    console.error('Network Error:', error);
                    lastErrorMsg = '네트워크 오류';
                }
            }
        }

        // 모든 시도 실패 → 히스토리 롤백
        conversationHistory.pop();
        showQuotaModal(lastErrorMsg);
        return null;
    }

    // ── 입력 처리 ─────────────────────────────────────────
    let lastInputText = ''; // [Fix] 실패 시 입력 복원용

    async function handleUserInput() {
        if (isLoading) return;
        const text = userInput.value.trim();
        if (!text) return;

        lastInputText = text;
        userInput.value = '';
        updateCharCount();
        addMessage(text, true);
        setLoading(true);

        const aiResponse = await callGeminiAPI(text);
        setLoading(false);
        abortController = null;

        if (aiResponse) {
            addMessage(aiResponse);
        }
    }

    sendBtn.addEventListener('click', handleUserInput);

    // [Fix] keypress(deprecated) → keydown + IME 조합 완료 체크
    userInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.isComposing && !e.shiftKey) {
            e.preventDefault();
            handleUserInput();
        }
    });

    // [Feat] 취소 버튼 (cancelBtn이 HTML에 있을 경우)
    const cancelBtn = document.getElementById('cancel-btn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            if (abortController) {
                abortController.abort();
                setLoading(false);
                // [Fix] 취소 시 원래 입력 복원
                userInput.value = lastInputText;
                updateCharCount();
            }
        });
    }

    // [Feat] 대화 초기화 버튼
    const clearBtn = document.getElementById('clear-btn');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            conversationHistory = [];
            // 초기 메시지(첫 번째)를 제외하고 이후 메시지 삭제
            const messages = chatMessages.querySelectorAll('.message');
            messages.forEach((m, i) => { if (i > 0) m.remove(); });
        });
    }

    // ── 모달 ──────────────────────────────────────────────
    const quotaModal = document.getElementById('quota-modal');
    const modalCloseBtn = document.getElementById('modal-close-btn');

    function showQuotaModal(errorMsg) {
        const errorElem = document.getElementById('modal-error-msg');
        if (errorElem) {
            errorElem.textContent = errorMsg ? `오류: ${errorMsg}` : '';
            errorElem.style.display = errorMsg ? 'block' : 'none';
        }
        // [Fix] 실패 시 입력 복원
        userInput.value = lastInputText;
        updateCharCount();
        if (quotaModal) quotaModal.style.display = 'flex';
    }

    modalCloseBtn?.addEventListener('click', () => { quotaModal.style.display = 'none'; });
    quotaModal?.addEventListener('click', (e) => {
        if (e.target === quotaModal) quotaModal.style.display = 'none';
    });

    // ── 테마 토글 ─────────────────────────────────────────
    const themeToggle = document.getElementById('theme-toggle');
    const sunIcon = document.querySelector('.sun-icon');
    const moonIcon = document.querySelector('.moon-icon');

    // [Fix] localStorage 접근 실패 대비 try-catch
    function getSavedTheme() {
        try {
            return localStorage.getItem('theme') ||
                (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        } catch {
            return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
    }

    function saveTheme(theme) {
        try { localStorage.setItem('theme', theme); } catch { /* ignore */ }
    }

    function updateThemeIcons(theme) {
        if (!sunIcon || !moonIcon) return;
        sunIcon.style.display  = theme === 'dark' ? 'none' : 'block';
        moonIcon.style.display = theme === 'dark' ? 'block' : 'none';
    }

    const savedTheme = getSavedTheme();
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcons(savedTheme);

    themeToggle?.addEventListener('click', () => {
        const cur = document.documentElement.getAttribute('data-theme');
        const next = cur === 'light' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', next);
        saveTheme(next);
        updateThemeIcons(next);
    });

    // ── 글자 수 카운터 ────────────────────────────────────
    const charCount = document.getElementById('char-count');

    function updateCharCount() {
        if (!charCount) return;
        const remaining = MAX_LEN - userInput.value.length;
        charCount.textContent = remaining;
        charCount.className = remaining <= 10 ? 'danger' : remaining <= 50 ? 'warning' : '';
    }

    userInput.addEventListener('input', updateCharCount);
    updateCharCount(); // 초기값 설정

    // maxlength 속성 동적 설정
    userInput.setAttribute('maxlength', MAX_LEN);

    userInput.focus();
});
