// server.js (ПРАВИТЕЛЬСТВЕННЫЙ АССИСТЕНТ - ПОЛНАЯ СИСТЕМА)
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Azure OpenAI настройки
const AZURE_OPENAI_ENDPOINT = "https://a-ass55.openai.azure.com/";
const AZURE_OPENAI_API_KEY = "FBx0qou5mQpzUs5cW4itbIk42WlgAj8TpmAjbw5uXPDhp5ckYg2QJQQJ99BIACHYHv6XJ3w3AAABACOGYhoG";

// Nitec AI настройки
const NITEC_AI_ENDPOINT = "https://nitec-ai.kz/api/chat/completions";
const NITEC_AI_BEARER_TOKEN = "sk-196c1fe7e5be40b2b7b42bc235c49147";

// Поисковые системы
const SERPAPI_API_KEY = "5b428af6a0a873bbd5d882ce73d5b2aa95e16db84fecebeef032ba7ea7fd47fb";

// Возвращаем оригинальный DB webhook
const DB_WEBHOOK_URL = "http://100.70.129.186/webhook/f305536a-f827-4c38-9b72-ace15bf3f3c1";

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

/** ---------- Azure OpenAI Proxy Routes ---------- */
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

/** ---------- Utility Functions ---------- */

// SerpAPI поиск
async function performSerpAPISearch(query, focus = "general") {
  if (!SERPAPI_API_KEY) {
    throw new Error('SERPAPI_API_KEY не настроен');
  }

  let searchQuery = query;
  if (focus === "law") {
    searchQuery = `${query} законодательство Казахстан НПА кодекс`;
  } else if (focus === "practices") {
    searchQuery = `${query} международный опыт best practices мировая практика`;
  }

  const params = {
    engine: 'google',
    q: searchQuery,
    num: 5,
    hl: 'ru',
    gl: 'ru',
    api_key: SERPAPI_API_KEY,
  };

  try {
    const { data } = await axios.get('https://serpapi.com/search.json', { params, timeout: 20000 });
    const results = (data.organic_results || []).slice(0, 3).map((r, i) => 
      `${i + 1}. ${r.title}\n${r.snippet || 'Нет описания'}\nИсточник: ${r.link}`
    ).join('\n\n');
    
    return results || 'Результаты поиска не найдены';
  } catch (error) {
    console.error('SerpAPI search error:', error.message);
    return 'Ошибка при выполнении поиска';
  }
}

// Nitec AI запрос
async function callNitecAI(model, userQuery) {
  try {
    const response = await axios.post(NITEC_AI_ENDPOINT, {
      model: model,
      stream: false,
      messages: [{ role: 'user', content: userQuery }]
    }, {
      headers: {
        'Authorization': `Bearer ${NITEC_AI_BEARER_TOKEN}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    const content = response.data?.choices?.[0]?.message?.content || 'Ответ не получен';
    return content;
  } catch (error) {
    console.error(`Nitec AI (${model}) error:`, error.response?.data || error.message);
    return `Ошибка при обращении к модели ${model}`;
  }
}

// Оригинальный DB webhook запрос
async function callOriginalDB(message) {
  try {
    const payload = {
      sessionId: "12345", 
      message: message
    };

    console.log(`📤 Отправляем в оригинальную БД: ${JSON.stringify(payload)}`);

    const response = await axios.post(DB_WEBHOOK_URL, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000,  // Вернул 30 секунд
      // Добавляем настройки для лучшей совместимости
      maxRedirects: 5,
      validateStatus: function (status) {
        return status >= 200 && status < 300;
      }
    });

    console.log(`📥 Ответ от оригинальной БД:`, response.data);

    // БД возвращает массив объектов
    let responseData = response.data;
    
    // Если это массив - берем первый элемент
    if (Array.isArray(responseData) && responseData.length > 0) {
      responseData = responseData[0];
    }

    // Ищем ответ в правильных полях
    const result = responseData?.response ||
                   responseData?.answer || 
                   responseData?.message || 
                   responseData?.result || 
                   (typeof responseData === 'string' ? responseData : JSON.stringify(responseData)) ||
                   'Данные не найдены';

    return result;
  } catch (error) {
    console.error('Original DB error:', error.response?.data || error.message);
    console.error('Error details:', {
      code: error.code,
      status: error.response?.status,
      message: error.message
    });
    
    if (error.code === 'ECONNABORTED') {
      return 'Превышено время ожидания ответа от базы данных (30 сек)';
    }
    if (error.code === 'ECONNREFUSED') {
      return 'Не удается подключиться к базе данных - сервис недоступен';
    }
    if (error.code === 'ENOTFOUND') {
      return 'Не удается найти адрес базы данных';
    }
    
    return `Ошибка при обращении к базе данных: ${error.message}`;
  }
}

/** ---------- Assistant Function Handlers ---------- */
app.post('/api/assistant', async (req, res) => {
  const { function_name, arguments: args } = req.body || {};

  console.log('\n===========================================');
  console.log('>>> Правительственный ассистент');
  console.log(`Функция: ${function_name}`);
  console.log(`Аргументы: ${JSON.stringify(args)}`);
  console.log('===========================================');

  try {
    let result = '';

    switch (function_name) {
      case 'db_query':
        // База данных через оригинальный webhook
        const { message } = args || {};
        if (!message) {
          return res.json({ success: false, error: "message обязателен для db_query" });
        }
        result = await callOriginalDB(message);
        break;

      case 'law_based_answering':
        // Правовые вопросы через SerpAPI
        const { legal_query } = args || {};
        if (!legal_query) {
          return res.json({ success: false, error: "legal_query обязателен для law_based_answering" });
        }
        result = await performSerpAPISearch(legal_query, "law");
        break;

      case 'next_meeting_recommendation':
        // Рекомендации для встреч через Nitec AI
        const { meeting_topic } = args || {};
        if (!meeting_topic) {
          return res.json({ success: false, error: "meeting_topic обязателен для next_meeting_recommendation" });
        }
        result = await callNitecAI('1_recom_db', meeting_topic);
        break;

      case 'best_practices_search':
        // Международные практики через SerpAPI
        const { practice_query } = args || {};
        if (!practice_query) {
          return res.json({ success: false, error: "practice_query обязателен для best_practices_search" });
        }
        result = await performSerpAPISearch(practice_query, "practices");
        break;

      case 'overview_situation_kazakhstan':
        // Обзор ситуации в Казахстане через Nitec AI
        const { situation_query } = args || {};
        if (!situation_query) {
          return res.json({ success: false, error: "situation_query обязателен для overview_situation_kazakhstan" });
        }
        result = await callNitecAI('1_recom_andrei', situation_query);
        break;

      default:
        return res.status(400).json({ 
          success: false, 
          error: `Неизвестная функция: ${function_name}` 
        });
    }

    console.log(`✅ Результат (${function_name}):`, result.substring(0, 200) + '...');

    return res.json({ 
      success: true, 
      result: result 
    });

  } catch (error) {
    console.error(`❌ Ошибка функции ${function_name}:`, error.message);
    return res.json({ 
      success: false, 
      error: `Ошибка при выполнении функции ${function_name}` 
    });
  }
});

/** ---------- Server Start ---------- */
app.listen(PORT, () => {
  console.log(`🚀 Правительственный ассистент запущен на порту ${PORT}`);
  console.log(`📊 Original DB: ${DB_WEBHOOK_URL}`);
  console.log(`🤖 Nitec AI модели: 1_recom_db, 1_recom_andrei`);
  console.log(`🔍 SerpAPI активен для поиска`);
});
