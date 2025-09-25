// server.js
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Эти переменные нужно будет добавить в настройки Railway
const AZURE_OPENAI_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT;
const AZURE_OPENAI_API_KEY = process.env.AZURE_OPENAI_API_KEY;

// --- Настройка сервера ---
app.use(cors());
app.use(express.json());
// Отдаем все файлы из папки 'public' как статический контент (ваш фронтенд)
app.use(express.static('public'));

// --- Функции-помощники для проксирования ---
const getAzureApiUrl = (path) => `${AZURE_OPENAI_ENDPOINT}/openai/${path}?api-version=2024-05-01-preview`;
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
        console.error(`Error proxying to ${azurePath}:`, data);
        res.status(status).json({ error: 'Proxy request failed', details: data });
    }
};

// --- API эндпоинты для прокси ---

// Создание треда
app.post('/api/threads', (req, res) => proxyRequest(req, res, 'POST', 'threads'));

// Добавление сообщения в тред
app.post('/api/threads/:threadId/messages', (req, res) => proxyRequest(req, res, 'POST', `threads/${req.params.threadId}/messages`));

// Запуск ассистента
app.post('/api/threads/:threadId/runs', (req, res) => proxyRequest(req, res, 'POST', `threads/${req.params.threadId}/runs`));

// Проверка статуса запуска
app.get('/api/threads/:threadId/runs/:runId', (req, res) => {
    // Для GET запросов тело не нужно, поэтому проксируем немного иначе
    axios.get(getAzureApiUrl(`threads/${req.params.threadId}/runs/${req.params.runId}`), { headers: getHeaders() })
        .then(response => res.status(response.status).json(response.data))
        .catch(error => {
            const status = error.response ? error.response.status : 500;
            const data = error.response ? error.response.data : { message: error.message };
            console.error('Error proxying GET request:', data);
            res.status(status).json({ error: 'Proxy GET request failed', details: data });
        });
});

// Отправка результатов выполнения функций
app.post('/api/threads/:threadId/runs/:runId/submit_tool_outputs', (req, res) => proxyRequest(req, res, 'POST', `threads/${req.params.threadId}/runs/${req.params.runId}/submit_tool_outputs`));

// Получение сообщений из треда
app.get('/api/threads/:threadId/messages', (req, res) => {
    axios.get(getAzureApiUrl(`threads/${req.params.threadId}/messages`), { headers: getHeaders() })
        .then(response => res.status(response.status).json(response.data))
        .catch(error => {
            const status = error.response ? error.response.status : 500;
            const data = error.response ? error.response.data : { message: error.message };
            res.status(status).json({ error: 'Proxy GET request failed', details: data });
        });
});


// --- Запуск сервера ---
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
