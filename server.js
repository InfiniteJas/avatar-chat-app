// server.js (ФИНАЛЬНАЯ ВЕРСИЯ С ХАРДКОДОМ И ВСЕМИ ФУНКЦИЯМИ)
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 🛑 ВАШИ ДАННЫЕ ВСТАВЛЕНЫ ПРЯМО В КОД
const AZURE_OPENAI_ENDPOINT = "https://a-ass55.openai.azure.com/";
const AZURE_OPENAI_API_KEY = "FBx0qou5mQpzUs5cW4itbIk42WlgAj8TpmAjbw5uXPDhp5ckYg2QJQQJ99BIACHYHv6XJ3w3AAABACOGYhoG";
const NITEC_AI_BEARER_TOKEN = "sk-196c1fe7e5be40b2b7b42bc235c49147";
const BING_SEARCH_API_KEY = "6f6pWKgZJIax7N63ncfwdK0OIqjxAMmNmLDm8Crm7UpiDfd38bTbJQQJ99BIACHYHv6XJ3w3AAAEACOGAc8C";

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


// +++++++++++++ ОБНОВЛЕННЫЙ БЛОК ДЛЯ ОБРАБОТКИ ВСЕХ ФУНКЦИЙ +++++++++++++
app.post('/api/assistant', async (req, res) => {
    const { function_name, arguments } = req.body;

    console.log(`\n=============================================`);
    console.log(`  >>> ПОЛУЧЕН ЗАПРОС НА ВЫЗОВ ФУНКЦИИ <<<  `);
    console.log(`- Имя функции: ${function_name}`);
    console.log(`- Аргументы: ${JSON.stringify(arguments)}`);
    console.log(`=============================================`);

    // --- ОБРАБОТЧИК ДЛЯ NITEC-AI ---
    if (function_name === 'get_external_info') {
        try {
            const { source_model, user_query } = arguments;
            console.log(`--- Отправка запроса в nitec-ai.kz... ---`);
            const nitecResponse = await axios.post(
                'https://nitec-ai.kz/api/chat/completions',
                { model: source_model, stream: false, messages: [{ role: 'user', content: user_query }] },
                { headers: { 'Authorization': `Bearer ${NITEC_AI_BEARER_TOKEN}`, 'Content-Type': 'application/json' } }
            );
            const finalContent = nitecResponse.data.choices[0].message.content;
            console.log(`--- Получен успешный ответ от ${source_model} ---`);
            return res.json({ success: true, result: finalContent });
        } catch (error) {
            console.error("!!! ОШИБКА при вызове nitec-ai:", error.message);
            return res.json({ success: false, error: error.message });
        }
    }

    // --- НОВЫЙ ОБРАБОТЧИК ДЛЯ ВЕБ-ПОИСКА ---
    if (function_name === 'perform_web_search') {
        try {
            const { search_query } = arguments;
            console.log(`--- Отправка запроса в Bing Search API: "${search_query}" ---`);
            const bingResponse = await axios.get('https://api.bing.microsoft.com/v7.0/search', {
                headers: { 'Ocp-Apim-Subscription-Key': BING_SEARCH_API_KEY },
                params: { q: search_query, count: 3, mkt: 'ru-RU' } // Ищем 3 результата на русском
            });
            const searchResults = bingResponse.data.webPages.value
                .map((page, index) => `Источник ${index + 1}:\nЗаголовок: ${page.name}\nURL: ${page.url}\nФрагмент: ${page.snippet}`)
                .join('\n\n');
            
            console.log(`--- Получен успешный ответ от Bing Search ---`);
            return res.json({ success: true, result: searchResults || "По вашему запросу ничего не найдено." });
        } catch (error) {
            console.error("!!! ОШИБКА при вызове Bing Search:", error.message);
            return res.json({ success: false, error: "Ошибка при выполнении веб-поиска." });
        }
    }
    
    // Если вызвана какая-то другая неизвестная функция
    return res.status(400).json({ success: false, error: `Unknown function called: ${function_name}` });
});
// +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++


// --- Запуск сервера ---
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
