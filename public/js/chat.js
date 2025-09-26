// Глобальные объекты
var speechRecognizer;
var avatarSynthesizer;
var peerConnection;
var peerConnectionDataChannel;
var messages = [];
var messageInitiated = false;
var dataSources = [];
var sentenceLevelPunctuations = ['.', '?', '!', ':', ';', '。', '？', '！', '：', '；'];
var enableDisplayTextAlignmentWithSpeech = true;
var isSpeaking = false;
var isReconnecting = false;
var speakingText = "";
var spokenTextQueue = [];
var repeatSpeakingSentenceAfterReconnection = true;
var sessionActive = false;
var userClosedSession = false;
var lastInteractionTime = new Date();
var lastSpeakTime;
var imgUrl = "";
var greeted = false;

// 🎯 НОВАЯ ГЛОБАЛЬНАЯ ПЕРЕМЕННАЯ ДЛЯ ВЫБРАННОГО ЯЗЫКА
var selectedLanguage = "ru"; // по умолчанию русский

// Assistant API переменные
var assistantId = 'asst_LMHsNblhuLgYt9I2RpMfm3Kr';
var threadId = null;
var runId = null;
var functionCallsEndpoint = '/api/assistant';

// ==== Chat UI helpers ====

function chatEl() {
    return document.getElementById('chatHistoryList');
}

function scrollChatToBottom() {
    const el = chatEl();
    if (!el) return;
    el.scrollTop = el.scrollHeight;
}

function renderMessageBubble(role, text, timestampSec) {
    const el = chatEl();
    if (!el) return;

    // --- helpers внутри функции ---
    // добавляет в container текст, превращая plain-URL в <a>
    function appendWithPlainLinks(container, raw) {
        const urlRe = /(https?:\/\/[^\s<>()]+|www\.[^\s<>()]+)/gi;
        let i = 0, m;
        while ((m = urlRe.exec(raw)) !== null) {
            if (m.index > i) container.appendChild(document.createTextNode(raw.slice(i, m.index)));

            let visible = m[0];
            let href = /^https?:\/\//i.test(visible) ? visible : 'https://' + visible;

            // срезаем хвостовую пунктуацию из href, но возвращаем её как текст
            const cut = href.match(/^(.*?)([)\].,!?:;]+)$/);
            let tail = "";
            if (cut) { href = cut[1]; tail = cut[2]; visible = visible.replace(/([)\].,!?:;]+)$/, ''); }

            const a = document.createElement('a');
            a.href = href;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.textContent = visible;
            container.appendChild(a);

            if (tail) container.appendChild(document.createTextNode(tail));
            i = m.index + m[0].length;
        }
        if (i < raw.length) container.appendChild(document.createTextNode(raw.slice(i)));
    }

    // сначала обрабатываем markdown-ссылки, остатки — через plain-URL
    function appendWithMarkdownThenLinks(container, raw) {
        const mdRe = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
        let i = 0, m;
        while ((m = mdRe.exec(raw)) !== null) {
            if (m.index > i) appendWithPlainLinks(container, raw.slice(i, m.index));
            const a = document.createElement('a');
            a.href = m[2];
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.textContent = m[1];
            container.appendChild(a);
            i = m.index + m[0].length;
        }
        if (i < raw.length) appendWithPlainLinks(container, raw.slice(i));
    }
    // --- /helpers ---

    const msg = document.createElement('div');
    msg.className = 'msg ' + (role === 'user' ? 'msg--user' : 'msg--assistant');

    const bubble = document.createElement('div');
    bubble.className = 'msg__bubble';

    // безопасно добавляем контент с кликабельными ссылками
    appendWithMarkdownThenLinks(bubble, String(text ?? '').trim());

    // (опционально) мини-таймстемп
    if (timestampSec) {
        const small = document.createElement('small');
        small.style.display = 'block';
        small.style.opacity = '0.6';
        small.style.marginTop = '4px';
        small.textContent = new Date(timestampSec * 1000).toLocaleTimeString();
        bubble.appendChild(small);
    }

    msg.appendChild(bubble);
    el.appendChild(msg);
}


function appendUserMessage(text) {
    renderMessageBubble('user', text);
    scrollChatToBottom();
}

function appendAssistantMessage(text) {
    renderMessageBubble('assistant', text);
    scrollChatToBottom();
}

// загрузка всей истории из backend-а (по текущему threadId)
async function fetchAndRenderThreadMessages() {
    const el = chatEl();
    if (!el || !threadId) return;
    try {
        const res = await fetch(`/api/threads/${threadId}/messages`);
        if (!res.ok) throw new Error('Failed to load messages');
        const payload = await res.json();

        // очищаем и рендерим по возрастанию времени
        el.innerHTML = '';
        const items = (payload.data || []).slice().sort((a, b) => a.created_at - b.created_at);

        for (const m of items) {
            const role = m.role === 'user' ? 'user' : 'assistant';
            const block = (m.content && m.content[0] && m.content[0].type === 'text')
                ? m.content[0].text.value
                : '';
            renderMessageBubble(role, block, m.created_at);
        }
        scrollChatToBottom();
    } catch (err) {
        console.error('fetchAndRenderThreadMessages error:', err);
    }
}


// Connect to avatar service
function connectAvatar() {
    const cogSvcRegion = document.getElementById('region').value;
    const cogSvcSubKey = document.getElementById('APIKey').value;
    if (cogSvcSubKey === '') {
        alert('Please fill in the API key of your speech resource.');
        return;
    }
    const privateEndpointEnabled = document.getElementById('enablePrivateEndpoint').checked;
    const privateEndpoint = document.getElementById('privateEndpoint').value.slice(8);
    if (privateEndpointEnabled && privateEndpoint === '') {
        alert('Please fill in the Azure Speech endpoint.');
        return;
    }
    let speechSynthesisConfig;
    if (privateEndpointEnabled) {
        speechSynthesisConfig = SpeechSDK.SpeechConfig.fromEndpoint(new URL(`wss://${privateEndpoint}/tts/cognitiveservices/websocket/v1?enableTalkingAvatar=true`), cogSvcSubKey);
    } else {
        speechSynthesisConfig = SpeechSDK.SpeechConfig.fromSubscription(cogSvcSubKey, cogSvcRegion);
    }
    speechSynthesisConfig.endpointId = document.getElementById('customVoiceEndpointId').value;
    const talkingAvatarCharacter = document.getElementById('talkingAvatarCharacter').value;
    const talkingAvatarStyle = document.getElementById('talkingAvatarStyle').value;
    const avatarConfig = new SpeechSDK.AvatarConfig(talkingAvatarCharacter, talkingAvatarStyle);
    avatarConfig.customized = document.getElementById('customizedAvatar').checked;
    avatarConfig.useBuiltInVoice = document.getElementById('useBuiltInVoice').checked;
    avatarSynthesizer = new SpeechSDK.AvatarSynthesizer(speechSynthesisConfig, avatarConfig);
    avatarSynthesizer.avatarEventReceived = function (s, e) {
        var offsetMessage = ", offset from session start: " + e.offset / 10000 + "ms.";
        if (e.offset === 0) {
            offsetMessage = "";
        }
        console.log("Event received: " + e.description + offsetMessage);
    };
    let speechRecognitionConfig;
    if (privateEndpointEnabled) {
        speechRecognitionConfig = SpeechSDK.SpeechConfig.fromEndpoint(new URL(`wss://${privateEndpoint}/stt/speech/universal/v2`), cogSvcSubKey);
    } else {
        speechRecognitionConfig = SpeechSDK.SpeechConfig.fromEndpoint(new URL(`wss://${cogSvcRegion}.stt.speech.microsoft.com/speech/universal/v2`), cogSvcSubKey);
    }
    speechRecognitionConfig.setProperty(SpeechSDK.PropertyId.SpeechServiceConnection_LanguageIdMode, "Continuous");
    var sttLocales = document.getElementById('sttLocales').value.split(',');
    var autoDetectSourceLanguageConfig = SpeechSDK.AutoDetectSourceLanguageConfig.fromLanguages(sttLocales);
    speechRecognizer = SpeechSDK.SpeechRecognizer.FromConfig(speechRecognitionConfig, autoDetectSourceLanguageConfig, SpeechSDK.AudioConfig.fromDefaultMicrophoneInput());

    if (!messageInitiated) {
        initMessages();
        messageInitiated = true;
    }
    document.getElementById('startSession').disabled = true;
    document.getElementById('configuration').hidden = true;
    const xhr = new XMLHttpRequest();
    if (privateEndpointEnabled) {
        xhr.open("GET", `https://${privateEndpoint}/tts/cognitiveservices/avatar/relay/token/v1`);
    } else {
        xhr.open("GET", `https://${cogSvcRegion}.tts.speech.microsoft.com/cognitiveservices/avatar/relay/token/v1`);
    }
    xhr.setRequestHeader("Ocp-Apim-Subscription-Key", cogSvcSubKey);
    xhr.addEventListener("readystatechange", function () {
        if (this.readyState === 4) {
            const responseData = JSON.parse(this.responseText);
            const iceServerUrl = responseData.Urls[0];
            const iceServerUsername = responseData.Username;
            const iceServerCredential = responseData.Password;
            setupWebRTC(iceServerUrl, iceServerUsername, iceServerCredential);
        }
    });
    xhr.send();
}

function disconnectAvatar() {
    if (avatarSynthesizer !== undefined) {
        avatarSynthesizer.close();
    }
    if (speechRecognizer !== undefined) {
        speechRecognizer.stopContinuousRecognitionAsync();
        speechRecognizer.close();
    }
    sessionActive = false;
}

function setupWebRTC(iceServerUrl, iceServerUsername, iceServerCredential) {
    peerConnection = new RTCPeerConnection({
        iceServers: [{
            urls: [iceServerUrl],
            username: iceServerUsername,
            credential: iceServerCredential
        }]
    });
    peerConnection.ontrack = function (event) {
        if (event.track.kind === 'audio') {
            let audioElement = document.createElement('audio');
            audioElement.id = 'audioPlayer';
            audioElement.srcObject = event.streams[0];
            audioElement.autoplay = false;
            audioElement.addEventListener('loadeddata', () => {
                audioElement.play();
            });
            audioElement.onplaying = () => {
                console.log(`WebRTC ${event.track.kind} channel connected.`);
            };
            remoteVideoDiv = document.getElementById('remoteVideo');
            for (var i = 0; i < remoteVideoDiv.childNodes.length; i++) {
                if (remoteVideoDiv.childNodes[i].localName === event.track.kind) {
                    remoteVideoDiv.removeChild(remoteVideoDiv.childNodes[i]);
                }
            }
            document.getElementById('remoteVideo').appendChild(audioElement);
        }
        if (event.track.kind === 'video') {
            let videoElement = document.createElement('video');
            videoElement.id = 'videoPlayer';
            videoElement.srcObject = event.streams[0];
            videoElement.autoplay = false;
            videoElement.addEventListener('loadeddata', () => {
                videoElement.play();
            });
            videoElement.playsInline = true;
            videoElement.style.width = '0.5px';
            document.getElementById('remoteVideo').appendChild(videoElement);
            if (repeatSpeakingSentenceAfterReconnection) {
                if (speakingText !== '') {
                    speakNext(speakingText, 0, true);
                }
            } else {
                if (spokenTextQueue.length > 0) {
                    speakNext(spokenTextQueue.shift());
                }
            }
            videoElement.onplaying = () => {
                remoteVideoDiv = document.getElementById('remoteVideo');
                for (var i = 0; i < remoteVideoDiv.childNodes.length; i++) {
                    if (remoteVideoDiv.childNodes[i].localName === event.track.kind) {
                        remoteVideoDiv.removeChild(remoteVideoDiv.childNodes[i]);
                    }
                }
                videoElement.style.width = '960px';
                document.getElementById('remoteVideo').appendChild(videoElement);
                console.log(`WebRTC ${event.track.kind} channel connected.`);

                // 🎯 АКТИВИРУЕМ ОБЕИЕ КНОПКИ МИКРОФОНА
                document.getElementById('microphoneRussian').disabled = false;
                document.getElementById('microphoneKazakh').disabled = false;
                document.getElementById('stopSession').disabled = false;
                document.getElementById('remoteVideo').style.width = '960px';
                document.getElementById('showTypeMessage').disabled = false;

                if (document.getElementById('useLocalVideoForIdle').checked) {
                    document.getElementById('localVideo').hidden = true;
                    if (lastSpeakTime === undefined) {
                        lastSpeakTime = new Date();
                    }
                }
                isReconnecting = false;
                setTimeout(() => { sessionActive = true; }, 5000);
            };
        }
    };
    peerConnection.addEventListener("datachannel", event => {
        peerConnectionDataChannel = event.channel;
        peerConnectionDataChannel.onmessage = e => {
            let subtitles = document.getElementById('subtitles');
            const webRTCEvent = JSON.parse(e.data);
            if (webRTCEvent.event.eventType === 'EVENT_TYPE_TURN_START' && document.getElementById('showSubtitles').checked) {
                subtitles.hidden = false;
                subtitles.innerHTML = speakingText;
            } else if (webRTCEvent.event.eventType === 'EVENT_TYPE_SESSION_END' || webRTCEvent.event.eventType === 'EVENT_TYPE_SWITCH_TO_IDLE') {
                subtitles.hidden = true;
                if (webRTCEvent.event.eventType === 'EVENT_TYPE_SESSION_END') {
                    if (document.getElementById('autoReconnectAvatar').checked && !userClosedSession && !isReconnecting) {
                        if (new Date() - lastInteractionTime < 300000) {
                            console.log(`[${(new Date()).toISOString()}] The WebSockets got disconnected, need reconnect.`);
                            isReconnecting = true;
                            peerConnectionDataChannel.onmessage = null;
                            if (avatarSynthesizer !== undefined) {
                                avatarSynthesizer.close();
                            }
                            connectAvatar();
                        }
                    }
                }
            }
            console.log("[" + (new Date()).toISOString() + "] WebRTC event received: " + e.data);
        };
    });
    var c = peerConnection.createDataChannel("eventChannel");
    peerConnection.oniceconnectionstatechange = e => {
        console.log("WebRTC status: " + peerConnection.iceConnectionState);
        if (peerConnection.iceConnectionState === 'disconnected') {
            if (document.getElementById('useLocalVideoForIdle').checked) {
                document.getElementById('localVideo').hidden = false;
                document.getElementById('remoteVideo').style.width = '0.1px';
            }
        }
    };
    peerConnection.addTransceiver('video', { direction: 'sendrecv' });
    peerConnection.addTransceiver('audio', { direction: 'sendrecv' });
    avatarSynthesizer.startAvatarAsync(peerConnection).then((r) => {
        if (r.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
            console.log("[" + (new Date()).toISOString() + "] Avatar started. Result ID: " + r.resultId);
        } else {
            console.log("[" + (new Date()).toISOString() + "] Unable to start avatar. Result ID: " + r.resultId);
            if (r.reason === SpeechSDK.ResultReason.Canceled) {
                let cancellationDetails = SpeechSDK.CancellationDetails.fromResult(r);
                if (cancellationDetails.reason === SpeechSDK.CancellationReason.Error) {
                    console.log(cancellationDetails.errorDetails);
                }
                console.log("Unable to start avatar: " + cancellationDetails.errorDetails);
            }
            document.getElementById('startSession').disabled = false;
            document.getElementById('configuration').hidden = false;
        }
    }).catch(
        (error) => {
            console.log("[" + (new Date()).toISOString() + "] Avatar failed to start. Error: " + error);
            document.getElementById('startSession').disabled = false;
            document.getElementById('configuration').hidden = false;
        }
    );
}

function initMessages() {
    messages = [];
    if (dataSources.length === 0) {
        let systemPrompt = document.getElementById('prompt').value;
        let systemMessage = {
            role: 'system',
            content: systemPrompt
        };
        messages.push(systemMessage);
    }
}

function htmlEncode(text) {
    const entityMap = {
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '/': '&#x2F;'
    };
    return String(text).replace(/[&<>"'\/]/g, (match) => entityMap[match]);
}

function speak(text, endingSilenceMs = 0) {
    if (isSpeaking) {
        spokenTextQueue.push(text);
        return;
    }
    speakNext(text, endingSilenceMs);
}

function speakNext(text, endingSilenceMs = 0, skipUpdatingChatHistory = false) {
    let ttsVoice = document.getElementById('ttsVoice').value;
    let ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='http://www.w3.org/2001/mstts' xml:lang='en-US'><voice name='${ttsVoice}'><mstts:leadingsilence-exact value='0'/>${htmlEncode(text)}</voice></speak>`;
    if (endingSilenceMs > 0) {
        ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='http://www.w3.org/2001/mstts' xml:lang='en-US'><voice name='${ttsVoice}'><mstts:leadingsilence-exact value='0'/>${htmlEncode(text)}<break time='${endingSilenceMs}ms' /></voice></speak>`;
    }
    lastSpeakTime = new Date();
    isSpeaking = true;
    speakingText = text;
    document.getElementById('stopSpeaking').disabled = false;
    avatarSynthesizer.speakSsmlAsync(ssml).then(
        (result) => {
            if (result.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
                console.log(`Speech synthesized to speaker for text [ ${text} ]. Result ID: ${result.resultId}`);
                lastSpeakTime = new Date();
            } else {
                console.log(`Error occurred while speaking the SSML. Result ID: ${result.resultId}`);
            }
            speakingText = '';
            if (spokenTextQueue.length > 0) {
                speakNext(spokenTextQueue.shift());
            } else {
                isSpeaking = false;
                document.getElementById('stopSpeaking').disabled = true;
            }
        }).catch(
            (error) => {
                console.log(`Error occurred while speaking the SSML: [ ${error} ]`);
                speakingText = '';
                if (spokenTextQueue.length > 0) {
                    speakNext(spokenTextQueue.shift());
                } else {
                    isSpeaking = false;
                    document.getElementById('stopSpeaking').disabled = true;
                }
            }
        );
}

function stopSpeaking() {
    lastInteractionTime = new Date();
    spokenTextQueue = [];
    avatarSynthesizer.stopSpeakingAsync().then(
        () => {
            isSpeaking = false;
            document.getElementById('stopSpeaking').disabled = true;
            console.log("[" + (new Date()).toISOString() + "] Stop speaking request sent.");
        }
    ).catch(
        (error) => {
            console.log("Error occurred while stopping speaking: " + error);
        }
    );
}

// 🎯 НОВАЯ ФУНКЦИЯ: Обработка пользовательского запроса с указанным языком
function handleUserQuery(userQuery, userQueryHTML = "", imgUrlPath = "", language = "ru") {
    lastInteractionTime = new Date();

    // 🎯 СОХРАНЯЕМ ВЫБРАННЫЙ ЯЗЫК
    selectedLanguage = language;
    console.log(`🌍 Пользователь выбрал язык: ${selectedLanguage}`);
    console.log(`🗣️ Пользователь сказал: "${userQuery}"`);

    if (isSpeaking) {
        stopSpeaking();
    }

    if (!threadId) {
        createThread(userQuery);
    } else {
        addMessageToThread(userQuery);
    }
}

async function createThread(userQuery) {
    try {
        const response = await fetch(`/api/threads`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messages: [{ role: 'user', content: userQuery }]
            })
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Proxy error: ${errorData.error || response.statusText}`);
        }
        const thread = await response.json();
        threadId = thread.id;
        fetchAndRenderThreadMessages();
        
        console.log('Thread created via proxy:', threadId);
        runAssistant();

    } catch (error) {
        console.error('Error creating thread:', error);
        displayError('Ошибка создания беседы');
    }
}

async function addMessageToThread(userQuery) {
    try {
        const response = await fetch(`/api/threads/${threadId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: 'user', content: userQuery })
        });
        if (!response.ok) throw new Error('Failed to add message');
        console.log('Message added to thread via proxy');
        
        runAssistant();
    } catch (error) {
        console.error('Error adding message:', error);
        displayError('Ошибка отправки сообщения');
    }
}

async function runAssistant() {
    try {
        const response = await fetch(`/api/threads/${threadId}/runs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assistant_id: assistantId })
        });
        if (!response.ok) throw new Error('Failed to run assistant');
        const run = await response.json();
        runId = run.id;
        console.log('Assistant run started via proxy:', runId);
        checkRunStatus();
    } catch (error) {
        console.error('Error running assistant:', error);
        displayError('Ошибка запуска ассистента');
    }
}

async function checkRunStatus() {
    try {
        const response = await fetch(`/api/threads/${threadId}/runs/${runId}`);
        if (!response.ok) throw new Error('Failed to check run status');
        const status = await response.json();
        console.log('Run status:', status.status);

        if (status.status === 'completed') {
            
            getAssistantResponse();
        } else if (status.status === 'requires_action') {
            
            handleFunctionCalls(status.required_action.submit_tool_outputs.tool_calls);
        } else if (status.status === 'in_progress' || status.status === 'queued') {
        
            setTimeout(checkRunStatus, 1000);
        } else if (status.status === 'failed') {
            
        } else {
            setTimeout(checkRunStatus, 1000);
        }

    } catch (error) {
        console.error('Error checking status:', error);
        displayError('Ошибка проверки статуса');
    }
}

async function handleFunctionCalls(toolCalls) {
    const toolOutputs = [];
    for (const toolCall of toolCalls) {
        if (toolCall.type === 'function') {
            try {
                console.log('Calling function via endpoint:', toolCall.function.name, "with arguments:", toolCall.function.arguments);
                const functionResponse = await fetch(functionCallsEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        function_name: toolCall.function.name,
                        arguments: JSON.parse(toolCall.function.arguments)
                    })
                });
                const result = await functionResponse.json();
                console.log('Function result:', result);

                toolOutputs.push({
                    tool_call_id: toolCall.id,
                    output: JSON.stringify(result.success ? result.result : { error: result.error })
                });
            } catch (error) {
                console.error('Error calling function:', error);
                toolOutputs.push({
                    tool_call_id: toolCall.id,
                    output: JSON.stringify({ error: error.message })
                });
            }
        }
    }
    submitToolOutputs(toolOutputs);
}

async function submitToolOutputs(toolOutputs) {
    try {
        const response = await fetch(`/api/threads/${threadId}/runs/${runId}/submit_tool_outputs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tool_outputs: toolOutputs })
        });
        if (!response.ok) throw new Error('Failed to submit tool outputs');
        console.log('Submitted tool outputs successfully');
        setTimeout(checkRunStatus, 1000);
    } catch (error) {
        console.error('Error submitting tool outputs:', error);
        displayError('Ошибка отправки результатов');
    }
}

async function getAssistantResponse() {
    try {
        const response = await fetch(`/api/threads/${threadId}/messages`);
        if (!response.ok) throw new Error('Failed to get messages');
        const messagesData = await response.json();
        const assistantMessage = messagesData.data.find(msg => msg.role === 'assistant' && msg.run_id === runId);

        if (assistantMessage && assistantMessage.content[0]) {
            const responseText = assistantMessage.content[0].text.value;
            
            console.log('Assistant response:', responseText.substring(0, 100) + "...");
            appendAssistantMessage(responseText);
            displayAndSpeakResponse(responseText, selectedLanguage);
        } else {
            const lastAssistantMessage = messagesData.data.find(msg => msg.role === 'assistant');
            if (lastAssistantMessage && lastAssistantMessage.content[0]) {
                const responseText = lastAssistantMessage.content[0].text.value;
                console.log('Assistant response (fallback):', responseText.substring(0, 100) + "...");
                
                appendAssistantMessage(responseText);
                displayAndSpeakResponse(responseText, selectedLanguage);
            } else {
                displayError('Не удалось получить ответ ассистента');
            }
        }
    } catch (error) {
        console.error('Error getting response:', error);
        displayError('Ошибка получения ответа');
    }
}

function cleanTextForTTS(rawText, lang) {
    let t = String(rawText);
    t = t.replace(/[\/\\]/g, ' ');
    t = t.replace(/[№%()\-–—_:;[\]{}<>«»]/g, ' ');
    t = t.replace(/\.{2,}/g, '.');
    t = t.replace(/!{2,}/g, '!');
    t = t.replace(/\?{2,}/g, '?');
    t = t.replace(/\s+/g, ' ').trim();
    console.log(`🧹 Очистка текста (${lang}): "${rawText}" → "${t}"`);
    return t;
}

// 🎯 ГЛАВНАЯ ФУНКЦИЯ: Озвучка с выбранным языком
function displayAndSpeakResponse(text, language) {
    let finalText = text;

    // Убрали приветствие - сразу используем полученный текст
    console.log(`🌍 Используем выбранный язык: ${language}`);

    // Очистка текста
    const cleaned = cleanTextForTTS(finalText, language);

    // 🎯 ВЫБОР ГОЛОСА ПО ЯЗЫКУ
    let ttsVoice, xmlLang;
    if (language === "kk") {
        ttsVoice = "kk-KZ-AigulNeural";
        xmlLang = "kk-KZ";
    } else {
        ttsVoice = "ru-RU-SvetlanaNeural";
        xmlLang = "ru-RU";
    }

    // Обновляем значение в UI
    document.getElementById('ttsVoice').value = ttsVoice;

    // Собираем SSML
    const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='http://www.w3.org/2001/mstts' xml:lang='${xmlLang}'>
        <voice name='${ttsVoice}'><mstts:leadingsilence-exact value='0'/>${htmlEncode(cleaned)}</voice>
    </speak>`;

    // Очередь озвучки
    if (isSpeaking) {
        spokenTextQueue.push({ text: cleaned, lang: language });
        return;
    }

    lastSpeakTime = new Date();
    isSpeaking = true;
    speakingText = cleaned;
    document.getElementById('stopSpeaking').disabled = false;

    console.log(`🔊 Voice: ${ttsVoice}, Lang: ${language}`);
    console.log(`🗣️ TTS text: "${cleaned}"`);

    avatarSynthesizer.speakSsmlAsync(ssml).then(
        () => {
            speakingText = '';
            if (spokenTextQueue.length > 0) {
                const nextItem = spokenTextQueue.shift();
                displayAndSpeakResponse(nextItem.text, nextItem.lang);
            } else {
                isSpeaking = false;
                document.getElementById('stopSpeaking').disabled = true;
            }
        }
    ).catch((error) => {
        console.error("Ошибка синтеза речи:", error);
        speakingText = '';
        if (spokenTextQueue.length > 0) {
            const nextItem = spokenTextQueue.shift();
            displayAndSpeakResponse(nextItem.text, nextItem.lang);
        } else {
            isSpeaking = false;
            document.getElementById('stopSpeaking').disabled = true;
        }
    });
}

function displayError(message) {
    console.error('Error:', message);
}

// 🎯 НОВЫЕ ФУНКЦИИ: Две кнопки микрофона
window.microphoneRussian = () => {
    console.log("🎤 Выбран русский микрофон");
    startMicrophone("ru");
};

window.microphoneKazakh = () => {
    console.log("🎤 Выбран казахский микрофон");
    startMicrophone("kk");
};

function startMicrophone(language) {
    lastInteractionTime = new Date();
    selectedLanguage = language;

    // Проверяем, какая кнопка активна
    const isRussianActive = (language === "ru");
    const buttonId = isRussianActive ? 'microphoneRussian' : 'microphoneKazakh';
    const otherButtonId = isRussianActive ? 'microphoneKazakh' : 'microphoneRussian';

    if (document.getElementById(buttonId).innerHTML.includes('Stop')) {
        // Останавливаем микрофон
        document.getElementById(buttonId).disabled = true;
        speechRecognizer.stopContinuousRecognitionAsync(
            () => {
                document.getElementById(buttonId).innerHTML = isRussianActive ? 'Русский' : 'Қазақша';
                document.getElementById(buttonId).disabled = false;
                document.getElementById(otherButtonId).disabled = false;

                selectedLanguage = 'ru';
                console.log('Язык сброшен на ru после остановки микрофона');
            }, (err) => {
                console.log("Failed to stop continuous recognition:", err);
                document.getElementById(buttonId).disabled = false;
            });
        return;
    }

    if (document.getElementById('useLocalVideoForIdle').checked) {
        if (!sessionActive) {
            connectAvatar();
        }
        setTimeout(() => {
            if (document.getElementById('audioPlayer')) {
                document.getElementById('audioPlayer').play();
            }
        }, 5000);
    } else {
        if (document.getElementById('audioPlayer')) {
            document.getElementById('audioPlayer').play();
        }
    }

    // Отключаем обе кнопки во время настройки
    document.getElementById('microphoneRussian').disabled = true;
    document.getElementById('microphoneKazakh').disabled = true;

    speechRecognizer.recognized = async (s, e) => {
        if (e.result.reason === SpeechSDK.ResultReason.RecognizedSpeech) {
            let userQuery = e.result.text.trim();
            if (userQuery === '') {
                return;
            }

            // Автостоп если не continuous режим
            // if (!document.getElementById('continuousConversation').checked) {
            //     document.getElementById(buttonId).disabled = true;
            //     speechRecognizer.stopContinuousRecognitionAsync(
            //         () => {
            //             document.getElementById(buttonId).innerHTML = isRussianActive ? '🎤 Русский' : '🎤 Қазақша';
            //             document.getElementById(buttonId).disabled = false;
            //             document.getElementById(otherButtonId).disabled = false;
            //         }, (err) => {
            //             console.log("Failed to stop continuous recognition:", err);
            //             document.getElementById(buttonId).disabled = false;
            //         });
            // }
            appendUserMessage(userQuery);
            // 🎯 ПЕРЕДАЕМ ВЫБРАННЫЙ ЯЗЫК В handleUserQuery
            handleUserQuery(userQuery, "", "", language);
        }
    };

    speechRecognizer.startContinuousRecognitionAsync(
        () => {
            document.getElementById(buttonId).innerHTML = isRussianActive ? 'Stop Русский' : 'Stop Қазақша';
            document.getElementById(buttonId).disabled = false;
            document.getElementById(otherButtonId).disabled = true; // Блокируем другую кнопку
        }, (err) => {
            console.log("Failed to start continuous recognition:", err);
            document.getElementById(buttonId).disabled = false;
            document.getElementById(otherButtonId).disabled = false;
        });
}

// Остальные вспомогательные функции
function checkHung() {
    let videoElement = document.getElementById('videoPlayer');
    if (videoElement !== null && videoElement !== undefined && sessionActive) {
        let videoTime = videoElement.currentTime;
        setTimeout(() => {
            if (videoElement.currentTime === videoTime) {
                if (sessionActive) {
                    sessionActive = false;
                    if (document.getElementById('autoReconnectAvatar').checked) {
                        if (new Date() - lastInteractionTime < 300000) {
                            console.log(`[${(new Date()).toISOString()}] The video stream got disconnected, need reconnect.`);
                            isReconnecting = true;
                            peerConnectionDataChannel.onmessage = null;
                            if (avatarSynthesizer !== undefined) {
                                avatarSynthesizer.close();
                            }
                            connectAvatar();
                        }
                    }
                }
            }
        }, 1000);
    }
}

function checkLastSpeak() {
    if (lastSpeakTime === undefined) {
        return;
    }
    let currentTime = new Date();
    if (currentTime - lastSpeakTime > 15000) {
        if (document.getElementById('useLocalVideoForIdle').checked && sessionActive && !isSpeaking) {
            disconnectAvatar();
            document.getElementById('localVideo').hidden = false;
            document.getElementById('remoteVideo').style.width = '0.1px';
            sessionActive = false;
        }
    }
}

window.onload = () => {
    setInterval(() => {
        checkHung();
        checkLastSpeak();
    }, 1000);
};

window.startSession = () => {
    lastInteractionTime = new Date();
    if (document.getElementById('useLocalVideoForIdle').checked) {
        document.getElementById('startSession').disabled = true;
        document.getElementById('configuration').hidden = true;
        document.getElementById('microphoneRussian').disabled = false;
        document.getElementById('microphoneKazakh').disabled = false;
        document.getElementById('stopSession').disabled = false;
        document.getElementById('localVideo').hidden = false;
        document.getElementById('remoteVideo').style.width = '0.1px';
        document.getElementById('showTypeMessage').disabled = false;
        return;
    }
    userClosedSession = false;
    connectAvatar();
};

window.stopSession = () => {
    lastInteractionTime = new Date();
    document.getElementById('startSession').disabled = false;
    document.getElementById('microphoneRussian').disabled = true;
    document.getElementById('microphoneKazakh').disabled = true;
    document.getElementById('stopSession').disabled = true;
    document.getElementById('configuration').hidden = false;
    document.getElementById('showTypeMessage').checked = false;
    document.getElementById('showTypeMessage').disabled = true;
    document.getElementById('userMessageBox').hidden = true;
    document.getElementById('uploadImgIcon').hidden = true;
    if (document.getElementById('useLocalVideoForIdle').checked) {
        document.getElementById('localVideo').hidden = true;
    }
    userClosedSession = true;
    threadId = null;
    runId = null;
    disconnectAvatar();
    const list = document.getElementById('chatHistoryList');
    if (list) list.innerHTML = '';
};

window.clearChatHistory = () => {
    lastInteractionTime = new Date();
    threadId = null;
    runId = null;
    initMessages();
    const list = document.getElementById('chatHistoryList');
    if (list) list.innerHTML = '';
};

window.updateTypeMessageBox = () => {
    if (document.getElementById('showTypeMessage').checked) {
        document.getElementById('userMessageBox').hidden = false;
        document.getElementById('uploadImgIcon').hidden = false;
        document.getElementById('userMessageBox').addEventListener('keyup', (e) => {
            if (e.key === 'Enter') {
                const userQuery = document.getElementById('userMessageBox').innerText;
                const messageBox = document.getElementById('userMessageBox');
                const childImg = messageBox.querySelector("#picInput");
                if (childImg) {
                    childImg.style.width = "200px";
                    childImg.style.height = "200px";
                }
                let userQueryHTML = messageBox.innerHTML.trim("");
                if (userQueryHTML.startsWith('<img')) {
                    userQueryHTML = "<br/>" + userQueryHTML;
                }
                if (userQuery !== '') {
                    appendUserMessage(userQuery.trim(''));
                    // 🎯 При вводе текста используем русский по умолчанию
                    handleUserQuery(userQuery.trim(''), userQueryHTML, imgUrl, selectedLanguage);
                    document.getElementById('userMessageBox').innerHTML = '';
                    imgUrl = "";
                }
            }
        });
        document.getElementById('uploadImgIcon').addEventListener('click', function () {
            imgUrl = "https://wallpaperaccess.com/full/528436.jpg";
            const userMessage = document.getElementById("userMessageBox");
            const childImg = userMessage.querySelector("#picInput");
            if (childImg) {
                userMessage.removeChild(childImg);
            }
            userMessage.innerHTML += '<br/><img id="picInput" src="https://wallpaperaccess.com/full/528436.jpg" style="width:100px;height:100px"/><br/><br/>';
        });
    } else {
        document.getElementById('userMessageBox').hidden = true;
        document.getElementById('uploadImgIcon').hidden = true;
        imgUrl = "";
    }
};

window.updateLocalVideoForIdle = () => {
    if (document.getElementById('useLocalVideoForIdle').checked) {
        document.getElementById('showTypeMessageCheckbox').hidden = true;
    } else {
        document.getElementById('showTypeMessageCheckbox').hidden = false;
    }
};

window.updatePrivateEndpoint = () => {
    if (document.getElementById('enablePrivateEndpoint').checked) {
        document.getElementById('showPrivateEndpointCheckBox').hidden = false;
    } else {
        document.getElementById('showPrivateEndpointCheckBox').hidden = true;
    }
};

window.updateCustomAvatarBox = () => {
    if (document.getElementById('customizedAvatar').checked) {
        document.getElementById('useBuiltInVoice').disabled = false;
    } else {
        document.getElementById('useBuiltInVoice').disabled = true;
        document.getElementById('useBuiltInVoice').checked = false;
    }
};
