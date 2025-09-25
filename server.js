// server.js (ПОЛНАЯ И ПРОВЕРЕННАЯ ВЕРСИЯ С ХАРДКОДОМ)
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 🛑 ВАШИ ДАННЫЕ ВСТАВЛЕНЫ ПРЯМО В КОД
const AZURE_OPENAI_ENDPOINT = "https://a-ass55.openai.azure.com/";
const AZURE_OPENAI_API_KEY = "FBx0qou5mQpzUs5cW4itbIk42WlgAj8TpmAjbw5uXPDhp5ckYg2QJQQJ99BIACHYHv6XJ3w3AAABACOGYhoG"; // <-- НЕ ЗАБУДЬТЕ ВСТАВИТЬ СЮДА ВАШ КЛЮЧ

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
        if (!AZURE_OPENAI_ENDPOINT || AZURE_OPENAI_API_KEY === "FBx0qou5mQpzUs5cW4itbIk42WlgAj8TpmAjbw5uXPDhp5ckYg2QJQQJ99BIACHYHv6XJ3w3AAABACOGYhoG") {
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
    if (!AZURE_OPENAI_ENDPOINT || AZURE_OPENAI_API_KEY === "FBx0qou5mQpzUs5cW4itbIk42WlgAj8TpmAjbw5uXPDhp5ckYg2QJQQJ99BIACHYHv6XJ3w3AAABACOGYhoG") {
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

// --- API эндпоинты ---
app.post('/api/threads', (req, res) => proxyRequest(req, res, 'POST', 'threads'));
app.post('/api/threads/:threadId/messages', (req, res) => proxyRequest(req, res, 'POST', `threads/${req.params.threadId}/messages`));
// ВОТ ЭТОТ МАРШРУТ, СКОРЕЕ ВСЕГО, ОТСУТСТВОВАЛ В ВАШЕЙ ВЕРСИИ ФАЙЛА
app.post('/api/threads/:threadId/runs', (req, res) => proxyRequest(req, res, 'POST', `threads/${req.params.threadId}/runs`));
app.get('/api/threads/:threadId/runs/:runId', (req, res) => proxyGetRequest(req, res, `threads/${req.params.threadId}/runs/${req.params.runId}`));
app.post('/api/threads/:threadId/runs/:runId/submit_tool_outputs', (req, res) => proxyRequest(req, res, 'POST', `threads/${req.params.threadId}/runs/${req.params.runId}/submit_tool_outputs`));
app.get('/api/threads/:threadId/messages', (req, res) => proxyGetRequest(req, res, `threads/${req.params.threadId}/messages`));

// --- Запуск сервера ---
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
