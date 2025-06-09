document.addEventListener('DOMContentLoaded', () => {
    // DOM 元素获取
    const chatWindow = document.getElementById('chat-window');
    const chatForm = document.getElementById('chat-form');
    const userInput = document.getElementById('user-input');
    const modelSelector = document.getElementById('model-selector');
    const systemPromptSwitch = document.getElementById('system-prompt-switch');
    const systemPromptText = document.getElementById('system-prompt-text');
    const apiKeyInput = document.getElementById('api-key');
    const thinkingIndicator = document.getElementById('thinking-indicator');

    let conversationHistory = [];

    // --- 事件监听 ---
    userInput.addEventListener('input', () => {
        userInput.style.height = 'auto';
        userInput.style.height = (userInput.scrollHeight) + 'px';
    });
    
    userInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            chatForm.dispatchEvent(new Event('submit'));
        }
    });

    systemPromptSwitch.addEventListener('change', () => {
        systemPromptText.disabled = !systemPromptSwitch.checked;
    });

    chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const userMessage = userInput.value.trim();
        const apiKey = apiKeyInput.value.trim();

        if (!apiKey) {
            alert('请输入您的 DeepSeek API Key！');
            return;
        }
        if (!userMessage) return;

        appendMessage(userMessage, 'user');
        conversationHistory.push({ role: 'user', content: userMessage });
        
        userInput.value = '';
        userInput.style.height = 'auto';
        thinkingIndicator.style.display = 'block';
        
        await getStreamedResponse(apiKey);
    });

    // --- 核心功能函数 ---

    // 安全地将 Markdown 渲染为 HTML
    function renderMarkdown(text) {
        // 使用 marked 解析 Markdown，然后使用 DOMPurify 清洗以防止 XSS
        return DOMPurify.sanitize(marked.parse(text));
    }

    // 添加消息到聊天窗口
    function appendMessage(text, type, options = {}) {
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message', `${type}-message`);

        if (type === 'bot') {
            if (options.reasoningId) {
                const reasoningDetails = document.createElement('details');
                reasoningDetails.className = 'reasoning-block';
                reasoningDetails.style.display = 'none'; 
                reasoningDetails.innerHTML = `
                    <summary>查看思维链 (Thinking Process)</summary>
                    <div class="reasoning-content" id="${options.reasoningId}"></div>
                `;
                messageDiv.appendChild(reasoningDetails);
            }
            
            const contentDiv = document.createElement('div');
            contentDiv.className = 'content';
            contentDiv.id = options.contentId;
            // 初始时，如果内容为空，则不渲染，等待流式输入
            if (text) contentDiv.innerHTML = renderMarkdown(text);
            messageDiv.appendChild(contentDiv);

        } else { // 用户消息直接显示纯文本
            messageDiv.textContent = text;
        }
        
        chatWindow.appendChild(messageDiv);
        chatWindow.scrollTop = chatWindow.scrollHeight;
        return messageDiv; // 返回创建的消息元素，用于后续操作
    }

    // 获取并处理流式响应
    async function getStreamedResponse(apiKey) {
        const selectedModel = modelSelector.value;
        const messages = [];

        if (systemPromptSwitch.checked && systemPromptText.value.trim()) {
            messages.push({ role: 'system', content: systemPromptText.value.trim() });
        }
        messages.push(...conversationHistory);

        const requestBody = {
            model: selectedModel,
            messages: messages,
            stream: true,
        };
        
        try {
            const response = await fetch('https://api.deepseek.com/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify(requestBody)
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`API Error: ${response.status} ${response.statusText} - ${errorData.error.message}`);
            }

            thinkingIndicator.style.display = 'none';
            
            const botMessageId = `bot-msg-${Date.now()}`;
            const reasoningId = `reasoning-${Date.now()}`;
            const isReasoner = selectedModel === 'deepseek-reasoner';

            const botMessageDiv = appendMessage('', 'bot', { 
                contentId: botMessageId,
                reasoningId: isReasoner ? reasoningId : null
            });

            const contentElement = document.getElementById(botMessageId);
            const reasoningElement = isReasoner ? document.getElementById(reasoningId) : null;
            
            let fullResponse = "";
            let accumulatedReasoning = "";

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n').filter(line => line.trim());
                
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const dataStr = line.substring(6);
                        if (dataStr === '[DONE]') break;
                        
                        try {
                            const data = JSON.parse(dataStr);
                            const delta = data.choices[0].delta;
                            
                            if (isReasoner && delta.reasoning_content) {
                                const reasoningBlock = reasoningElement.parentElement;
                                if (reasoningBlock.style.display === 'none') {
                                    reasoningBlock.style.display = 'block';
                                }
                                accumulatedReasoning += delta.reasoning_content;
                                reasoningElement.innerHTML = renderMarkdown(accumulatedReasoning);
                            } else if (delta.content) {
                                fullResponse += delta.content;
                                contentElement.innerHTML = renderMarkdown(fullResponse);
                            }

                            chatWindow.scrollTop = chatWindow.scrollHeight;
                        } catch (error) { console.error('Error parsing stream data:', error); }
                    }
                }
            }
            
            // 流结束后，对新生成的内容中的代码块应用语法高亮
            botMessageDiv.querySelectorAll('pre code').forEach(block => {
                hljs.highlightElement(block);
            });

            // 只将最终的 content 添加到对话历史中
            if (fullResponse) {
                conversationHistory.push({ role: 'assistant', content: fullResponse });
            }

        } catch (error) {
            thinkingIndicator.style.display = 'none';
            appendMessage(`**出错了**: \n\n\`\`\`\n${error.message}\n\`\`\``, 'bot');
            console.error('Fetch error:', error);
        }
    }
});