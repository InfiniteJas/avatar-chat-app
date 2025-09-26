// server.js (ФИНАЛЬНАЯ ВЕРСИЯ С ИСПРАВЛЕННЫМ ВЕБ-ПОИСКОМ)
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
// // Используем ключ от универсального ресурса
// const BING_SEARCH_API_KEY = "6f6pWKgZJIax7N63ncfwdK0OIqjxAMmNmLDm8Crm7UpiDfd38bTbJQQJ99BIACHYHv6XJ3w3AAAEACOGAc8C";
// // Конечная точка универсального ресурса
// const BING_SEARCH_ENDPOINT = "https://myuniversalaikey.cognitiveservices.azure.com/";

const SEARCH_PROVIDER = "serpapi"; // "serpapi" | "tavily"
const SERPAPI_API_KEY = "5b428af6a0a873bbd5d882ce73d5b2aa95e16db84fecebeef032ba7ea7fd47fb";

const DB_WEBHOOK_URL = "https://gshsh.nitec-ai.kz/webhook/f305536a-f827-4c38-9b72-ace15bf3f3c1";
// const TAVILY_API_KEY  = "<OPTIONAL_TAVILY_KEY>";
/** ====================================================== */

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

/** ---------- Вспомогательные прокси в Azure OpenAI (Assistants API) ---------- */
const getAzureApiUrl = (p) =>
  `${AZURE_OPENAI_ENDPOINT.replace(/\/$/, '')}/openai/${p}?api-version=2024-05-01-preview`;

const getHeaders = () => ({
  'api-key': AZURE_OPENAI_API_KEY,
  'Content-Type': 'application/json',
});

const proxyRequest = async (req, res, method, azurePath) => {
  try {
    const response = await axios({
      method,
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

const proxyGetRequest = (req, res, azurePath) => {
  axios
    .get(getAzureApiUrl(azurePath), { headers: getHeaders() })
    .then((response) => res.status(response.status).json(response.data))
    .catch((error) => {
      const status = error.response ? error.response.status : 500;
      const data = error.response ? error.response.data : { message: error.message };
      console.error('Error proxying GET request:', data);
      res.status(status).json({ error: 'Proxy GET request failed', details: data });
    });
};

/** ---------- Роуты Assistants API ---------- */
app.post('/api/threads', (req, res) => proxyRequest(req, res, 'POST', 'threads'));
app.post('/api/threads/:threadId/messages', (req, res) =>
  proxyRequest(req, res, 'POST', `threads/${req.params.threadId}/messages`)
);
app.post('/api/threads/:threadId/runs', (req, res) =>
  proxyRequest(req, res, 'POST', `threads/${req.params.threadId}/runs`)
);
app.get('/api/threads/:threadId/runs/:runId', (req, res) =>
  proxyGetRequest(req, res, `threads/${req.params.threadId}/runs/${req.params.runId}`)
);
app.post('/api/threads/:threadId/runs/:runId/submit_tool_outputs', (req, res) =>
  proxyRequest(
    req,
    res,
    'POST',
    `threads/${req.params.threadId}/runs/${req.params.runId}/submit_tool_outputs`
  )
);
app.get('/api/threads/:threadId/messages', (req, res) =>
  proxyGetRequest(req, res, `threads/${req.params.threadId}/messages`)
);

/** ================== ВЕБ-ПОИСК (SERPAPI/TAVILY) ================== */
function formatResults(items = []) {
  if (!items.length) return 'По вашему запросу ничего не найдено.';
  return items
    .map(
      (it, i) =>
        `Источник ${i + 1}:\nЗаголовок: ${it.title}\nURL: ${it.url}\nФрагмент: ${
          it.snippet ? it.snippet.slice(0, 400) : ''
        }`
    )
    .join('\n\n');
}

// SerpAPI (Google)
async function searchSerpAPI(query) {
  if (!SERPAPI_API_KEY || SERPAPI_API_KEY.startsWith('<PASTE')) {
    throw new Error('SERPAPI_API_KEY не задан');
  }
  const url = 'https://serpapi.com/search.json';
  const params = {
    engine: 'google',
    q: query,
    num: 5,
    hl: 'ru',
    gl: 'ru',
    api_key: SERPAPI_API_KEY,
  };
  const { data } = await axios.get(url, { params, timeout: 20000 });
  const organic = (data.organic_results || []).map((r) => ({
    title: r.title,
    url: r.link,
    snippet: r.snippet || (r.snippet_highlighted_words || []).join(' '),
  }));
  return formatResults(organic);
}

// Tavily (опционально)
async function searchTavily(query) {
  if (!TAVILY_API_KEY || TAVILY_API_KEY.startsWith('<OPTIONAL')) {
    throw new Error('TAVILY_API_KEY не задан');
  }
  const url = 'https://api.tavily.com/search';
  const body = {
    query,
    search_depth: 'advanced',
    include_answer: true,
    max_results: 5,
  };
  const { data } = await axios.post(url, body, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TAVILY_API_KEY}`,
    },
    timeout: 20000,
  });

  const items = (data.results || []).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.content,
  }));
  const base = formatResults(items);
  return data.answer ? `${base}\n\nКраткий вывод: ${data.answer}` : base;
}

async function performSearch(query) {
  switch ((SEARCH_PROVIDER || '').toLowerCase()) {
    case 'tavily':
      return await searchTavily(query);
    case 'serpapi':
    default:
      return await searchSerpAPI(query);
  }
}

/** ---------- Обработчик кастомных функций ассистента ---------- */
app.post('/api/assistant', async (req, res) => {
  const { function_name, arguments: args } = req.body || {};

  console.log('\n=============================================');
  console.log('  >>> Вызов функции ассистента');
  console.log('  function:', function_name);
  console.log('  args:', JSON.stringify(args));
  console.log('=============================================');

  if (function_name === 'db_query') {
    try {
      const { message } = args || {}; // session_id больше не берём из args
      if (!message || typeof message !== 'string') {
        return res.json({ success: false, error: "message (string) is required" });
      }
  
      // 🔒 Жёстко задаём session_id = "12345"
      const payload = {
        sessionId: "12345",
        message: message
      };
  
      const dbResp = await axios.post(DB_WEBHOOK_URL, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 20000
      });
  
      // Пытаемся найти текст ответа в популярных полях
      const d = dbResp.data || {};
      const text =
        d.answer ||
        d.message ||
        d.result ||
        (typeof d === 'string' ? d : JSON.stringify(d));
  
      return res.json({ success: true, result: text || "Пустой ответ от сервиса." });
    } catch (error) {
      console.error("db_query error:", error.response?.data || error.message);
      return res.json({ success: false, error: "Ошибка при обращении к БД-сервису." });
    }
  }

  if (function_name === 'get_external_info') {
    try {
      const { source_model, user_query } = args || {};
      const response = await axios.post(
        'https://nitec-ai.kz/api/chat/completions',
        { model: source_model, stream: false, messages: [{ role: 'user', content: user_query }] },
        { headers: { Authorization: `Bearer ${NITEC_AI_BEARER_TOKEN}`, 'Content-Type': 'application/json' } }
      );
      const content = response.data.choices?.[0]?.message?.content || '';
      return res.json({ success: true, result: content });
    } catch (err) {
      console.error('get_external_info error:', err.response?.data || err.message);
      return res.json({ success: false, error: 'Ошибка при обращении к внешнему источнику.' });
    }
  }

  if (function_name === 'perform_web_search') {
    try {
      const { search_query } = args || {};
      if (!search_query || typeof search_query !== 'string') {
        return res.json({ success: false, error: 'search_query (string) is required' });
      }
      console.log(`-- Поиск [${SEARCH_PROVIDER}] по запросу: "${search_query}"`);
      const resultText = await performSearch(search_query);
      return res.json({ success: true, result: resultText });
    } catch (err) {
      console.error('perform_web_search error:', err.response?.data || err.message);
      return res.json({ success: false, error: 'Ошибка при выполнении веб-поиска.' });
    }
  }

  return res.status(400).json({ success: false, error: `Unknown function: ${function_name}` });
});

/** ---------- Запуск ---------- */
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Search provider: ${SEARCH_PROVIDER}`);
});
