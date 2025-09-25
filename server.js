// server.js (ФИНАЛЬНАЯ ВЕРСИЯ С ОБРАБОТКОЙ ФУНКЦИЙ)
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 🛑 ВАШИ ДАННЫЕ ВСТАВЛЕНЫ ПРЯМО В КОД
const AZURE_OPENAI_ENDPOINT = "https://a-ass55.openai.azure.com/";
const AZURE_OPENAI_API_KEY = "FBx0qou5mQpzUs5cW4itbIk42WlgAj8TpmAjbw5uXPDhp5ckYg2QJQQJ99BIACHYHv6XJ3w3AAABACOGYhoG"; // Убедитесь, что это ваш актуальный ключ
const NITEC_AI_BEARER_TOKEN = "sk-196c1fe7e5be40b2b7b42bc235c49147"; // <-- ВАШ КЛЮЧ ДЛЯ NITEC-AI

// --- Настройка сервера ---
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

// --- Функции-помощники для проксирования ---
const getAzureApiUrl = (path) => `${AZURE_OPENAI_ENDPOINT.replace(/\/$/, '')}/openai/${path}?api-version=2024-05-01-preview`;
const getHeaders = () => ({ 'api-key': AZURE_OPENAI_API_KEY, 'Content-Type': 'application/json' });

const proxyRequest = async (req, res, method, azurePath) => {
    try {
        if (!AZURE_OPENAI_ENDPOINT || !AZURE_OPENAI_API_KEY) {
            console.error("Azure OpenAI credentials are not set in the code.");
            return res.status(500).json({ error: "Server configuration error: Credentials not set." });
        }
        const response = await axios({
            method: method,
            url: getAzureApiUrl(azurePath),
            data: req.body,
            headers: getHeaders(),
        });
        res.status(response.status).json(response.data);
    } catch (error) {
        const status = error.response ? error.response.status : 500;
        const data = error.response ? error.response.data : { message: error.message };
        console.error(`Error proxying to ${azurePath}:`, error.response ? error.response.data : "Unknown error");
        res.status(status).json({ error: 'Proxy request failed', details: data });
    }
};

const proxyGetRequest = (req, res, azurePath) => {
    if (!AZURE_OPENAI_ENDPOINT || !AZURE_OPENAI_API_KEY) {
        console.error("Azure OpenAI credentials are not set in the code.");
        return res.status(500).json({ error: "Server configuration error: Credentials not set." });
    }
    axios.get(getAzureApiUrl(azurePath), { headers: getHeaders() })
        .then(response => res.status(response.status).json(response.data))
        .catch(error => {
            const status = error.response ? error.response.status : 500;
            const data = error.response ? error.response.data : { message: error.message };
            console.error('Error proxying GET request:', error.response ? error.response.data : "Unknown error");
            res.status(status).json({ error: 'Proxy GET request failed', details: data });
        });
};

// --- API эндпоинты для общения с Ассистентом Azure ---
app.post('/api/threads', (req, res) => proxyRequest(req, res, 'POST', 'threads'));
app.post('/api/threads/:threadId/messages', (req, res) => proxyRequest(req, res, 'POST', `threads/${req.params.threadId}/messages`));
app.post('/api/threads/:threadId/runs', (req, res) => proxyRequest(req, res, 'POST', `threads/${req.params.threadId}/runs`));
app.get('/api/threads/:threadId/runs/:runId', (req, res) => proxyGetRequest(req, res, `threads/${req.params.threadId}/runs/${req.params.runId}`));
app.post('/api/threads/:threadId/runs/:runId/submit_tool_outputs', (req, res) => proxyRequest(req, res, 'POST', `threads/${req.params.threadId}/runs/${req.params.runId}/submit_tool_outputs`));
app.get('/api/threads/:threadId/messages', (req, res) => proxyGetRequest(req, res, `threads/${req.params.threadId}/messages`));


// +++++++++++++ НОВЫЙ БЛОК ДЛЯ ОБРАБОТКИ ВЫЗОВА ФУНКЦИЙ +++++++++++++
// Этот эндпоинт будет вызываться из chat.js, когда Ассистент захочет использовать функцию
app.post('/api/assistant', async (req, res) => {
    const { function_name, arguments } = req.body;

    if (function_name === 'get_external_info') {
        try {
            const { source_model, user_query } = arguments;

            console.log(`Получена команда от Ассистента: вызвать модель ${source_model} с запросом: "${user_query}"`);

            const nitecResponse = await axios.post(
                'https://nitec-ai.kz/api/chat/completions',
                {
                    model: source_model,
                    stream: false, // Получаем полный ответ, не по частям
                    messages: [{ role: 'user', content: user_query }]
                },
                {
                    headers: {
                        'Authorization': `Bearer ${NITEC_AI_BEARER_TOKEN}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
            
            const finalContent = nitecResponse.data.choices[0].message.content;
            console.log(`Получен ответ от ${source_model}: ${finalContent}`);

            // Возвращаем успешный результат обратно в chat.js
            return res.json({ success: true, result: finalContent });

        } catch (error) {
            console.error("Ошибка при вызове nitec-ai:", error.message);
            return res.json({ success: false, error: error.message });
        }
    }

    // Если вызвана какая-то другая неизвестная функция
    return res.status(400).json({ success: false, error: 'Unknown function called' });
});
// +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++


// --- Запуск сервера ---
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
