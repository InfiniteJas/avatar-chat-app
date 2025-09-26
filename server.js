// server.js (ИТОГОВАЯ ВЕРСИЯ С WREN AI API)
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Azure OpenAI настройки
const AZURE_OPENAI_ENDPOINT = "https://a-ass55.openai.azure.com/";
const AZURE_OPENAI_API_KEY = "FBx0qou5mQpzUs5cW4itbIk42WlgAj8TpmAjbw5uXPDhp5ckYg2QJQQJ99BIACHYHv6XJ3w3AAABACOGYhoG";
const NITEC_AI_BEARER_TOKEN = "sk-196c1fe7e5be40b2b7b42bc235c49147";

// Настройки поиска
const SEARCH_PROVIDER = "serpapi";
const SERPAPI_API_KEY = "5b428af6a0a873bbd5d882ce73d5b2aa95e16db84fecebeef032ba7ea7fd47fb";

// Новый API для работы с базой данных
const WREN_AI_URL = "https://cloud.getwren.ai/api/v1/ask";
const WREN_API_TOKEN = "sk-Q2nNDxNKzoH77Q";
const PROJECT_ID = 10875;

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

async function performSearch(query) {
  return await searchSerpAPI(query);
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
      const { message } = args || {}; 
      if (!message || typeof message !== 'string') {
        return res.json({ success: false, error: "message (string) is required" });
      }

      // Формируем запрос для Wren AI
      const payload = {
        projectId: PROJECT_ID,
        question: message
      };

      console.log(`📤 Отправляем в Wren AI: ${JSON.stringify(payload)}`);

      const wrenResponse = await axios.post(WREN_AI_URL, payload, {
        headers: { 
          'Authorization': `Bearer ${WREN_API_TOKEN}`,
          'Content-Type': 'application/json' 
        },
        timeout: 30000
      });

      console.log(`📥 Ответ от Wren AI:`, wrenResponse.data);

      const responseData = wrenResponse.data || {};
      const summary = responseData.summary || 'Данные не найдены';

      return res.json({ 
        success: true, 
        result: summary,
        // Дополнительная информация для отладки
        sql: responseData.sql,
        threadId: responseData.threadId,
        id: responseData.id
      });

    } catch (error) {
      console.error("❌ db_query error:", error.response?.data || error.message);
      
      // Более детальная обработка ошибок
      let errorMessage = "Ошибка при обращении к системе аналитики";
      if (error.response?.status === 401) {
        errorMessage = "Ошибка авторизации в системе аналитики";
      } else if (error.response?.status === 404) {
        errorMessage = "Проект не найден в системе аналитики";
      } else if (error.code === 'ECONNABORTED') {
        errorMessage = "Превышено время ожидания ответа от системы";
      }

      return res.json({ success: false, error: errorMessage });
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
      console.error('❌ get_external_info error:', err.response?.data || err.message);
      return res.json({ success: false, error: 'Ошибка при обращении к внешнему источнику.' });
    }
  }

  if (function_name === 'perform_web_search') {
    try {
      const { search_query } = args || {};
      if (!search_query || typeof search_query !== 'string') {
        return res.json({ success: false, error: 'search_query (string) is required' });
      }
      console.log(`🔍 Поиск [${SEARCH_PROVIDER}] по запросу: "${search_query}"`);
      const resultText = await performSearch(search_query);
      return res.json({ success: true, result: resultText });
    } catch (err) {
      console.error('❌ perform_web_search error:', err.response?.data || err.message);
      return res.json({ success: false, error: 'Ошибка при выполнении веб-поиска.' });
    }
  }

  return res.status(400).json({ success: false, error: `Unknown function: ${function_name}` });
});

/** ---------- Запуск ---------- */
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  console.log(`🔍 Search provider: ${SEARCH_PROVIDER}`);
  console.log(`📊 Wren AI Project ID: ${PROJECT_ID}`);
});
