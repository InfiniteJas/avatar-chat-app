// server.js (ВЕРСИЯ ДЛЯ ДЕМО С ХАРДКОДОМ)
require('dotenv').config(); // Оставляем на будущее
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// 🛑 ВНИМАНИЕ: КЛЮЧИ ЗАХАРДКОЖЕНЫ ДЛЯ ДЕМОНСТРАЦИИ!
// ЭТО НЕБЕЗОПАСНО ДЛЯ РАБОЧЕЙ ВЕРСИИ.
// ПОСЛЕ ДЕМО ЗАМЕНИТЕ ЭТИ СТРОКИ НА process.env.VAR_NAME
// И ДОБАВЬТЕ КЛЮЧИ В ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ НА RAILWAY.
const AZURE_OPENAI_ENDPOINT = "https://ass-mini.openai.azure.com/";
const AZURE_OPENAI_API_KEY = "ojOz45IiCJ45ETnaz4Q50bEyVmYLfjk2K2ex5fhtGsAndInu6olZJQQJ99BIACHYHv6XJ3w3AAABACOGs4er"; // <-- ИСПОЛЬЗУЙТЕ НОВЫЙ СГЕНЕРИРОВАННЫЙ КЛЮЧ!

// --- Настройка сервера ---
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Отдаем фронтенд

// --- Функции-помощники для проксирования ---
const getAzureApiUrl = (path) => `${AZURE_OPENAI_ENDPOINT}/openai/${path}?api-version=2024-05-01-preview`;
const getHeaders = () => ({ 'api-key': AZURE_OPENAI_API_KEY, 'Content-Type': 'application/json' });

const proxyRequest = async (req, res, method, azurePath) => {
    try {
        const response = await axios({
            method: method,
            url: getAzureApiApiUrl(azurePath),
            data: req.body,
            headers: getHeaders(),
        });
        res.status(response.status).json(response.data);
    } catch (error) {
        const status = error.response ? error.response.status : 500;
        const data = error.response ? error.response.data : { message: error.message };
        console.error(`Error proxying to ${azurePath}:`, data);
        res.status(status).json({ error: 'Proxy request failed', details: data });
    }
};

const proxyGetRequest = (req, res, azurePath) => {
     axios.get(getAzureApiUrl(azurePath), { headers: getHeaders() })
        .then(response => res.status(response.status).json(response.data))
        .catch(error => {
            const status = error.response ? error.response.status : 500;
            const data = error.response ? error.response.data : { message: error.message };
            console.error('Error proxying GET request:', data);
            res.status(status).json({ error: 'Proxy GET request failed', details: data });
        });
};


// --- API эндпоинты для прокси ---
app.post('/api/threads', (req, res) => proxyRequest(req, res, 'POST', 'threads'));
app.post('/api/threads/:threadId/messages', (req, res) => proxyRequest(req, res, 'POST', `threads/${req.params.threadId}/messages`));
app.post('/api/threads/:threadId/runs', (req, res) => proxyRequest(req, res, 'POST', `threads/${req.params.threadId}/runs`));
app.get('/api/threads/:threadId/runs/:runId', (req, res) => proxyGetRequest(req, res, `threads/${req.params.threadId}/runs/${req.params.runId}`));
app.post('/api/threads/:threadId/runs/:runId/submit_tool_outputs', (req, res) => proxyRequest(req, res, 'POST', `threads/${req.params.threadId}/runs/${req.params.runId}/submit_tool_outputs`));
app.get('/api/threads/:threadId/messages', (req, res) => proxyGetRequest(req, res, `threads/${req.params.threadId}/messages`));

// --- Запуск сервера ---
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
