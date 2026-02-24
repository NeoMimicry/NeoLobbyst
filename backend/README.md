# NeoLobbyst Server

Высокопроизводительный сервер для управления игровыми лобби с защитой от DDoS и системой авторизации.

## Возможности

- **JWT + API Key авторизация** - двухуровневая система безопасности
- **Rate Limiting** - защита от флуда (100 запросов/минуту по умолчанию)
- **Redis** - быстрое хранение данных лобби в памяти
- **Валидация** - проверка всех входящих данных через Joi
- **Автоочистка** - удаление неактивных лобби
- **Security Headers** - защита через Helmet.js
- **CORS** - настраиваемая политика доступа

## Установка

### Требования

- Node.js 18+
- Redis 6+

### Шаги установки

1. Установите зависимости:
```bash
npm install
```

2. Установите и запустите Redis:

**Windows:**
```bash
# Скачайте Redis с https://github.com/microsoftarchive/redis/releases
# Или используйте WSL/Docker
docker run -d -p 6379:6379 redis:alpine
```

**Linux/Mac:**
```bash
# Ubuntu/Debian
sudo apt-get install redis-server
sudo systemctl start redis

# Mac
brew install redis
brew services start redis
```

3. Создайте `.env` файл:
```bash
cp .env.example .env
```

4. Сгенерируйте секретные ключи:
```bash
# Linux/Mac/WSL
openssl rand -base64 32

# Windows PowerShell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
```

Вставьте сгенерированные ключи в `.env`:
```env
JWT_SECRET=ваш-сгенерированный-ключ-1
API_KEY_SECRET=ваш-сгенерированный-ключ-2
```

5. Запустите сервер:
```bash
npm start
```

## Конфигурация

### Переменные окружения

| Переменная | Описание | По умолчанию |
|-----------|----------|--------------|
| `PORT` | Порт сервера | 3000 |
| `NODE_ENV` | Окружение | development |
| `JWT_SECRET` | Секрет для JWT токенов | - |
| `API_KEY_SECRET` | Секрет для API ключей | - |
| `REDIS_HOST` | Хост Redis | localhost |
| `REDIS_PORT` | Порт Redis | 6379 |
| `REDIS_PASSWORD` | Пароль Redis | - |
| `RATE_LIMIT_WINDOW_MS` | Окно rate limit (мс) | 60000 |
| `RATE_LIMIT_MAX_REQUESTS` | Макс. запросов в окне | 100 |
| `LOBBY_MAX_INACTIVE_MS` | Таймаут неактивности лобби | 60000 |

### Production настройки

Для production рекомендуется:

1. Использовать HTTPS (через reverse proxy как Nginx)
2. Настроить `ALLOWED_ORIGINS` для CORS
3. Увеличить `RATE_LIMIT_MAX_REQUESTS` при необходимости
4. Использовать Redis с персистентностью
5. Настроить мониторинг (PM2, Docker, Kubernetes)

## API Endpoints

### Авторизация

#### POST `/api/auth/register`
Регистрация нового клиента и получение API ключа.

**Response:**
```json
{
  "ok": true,
  "clientId": "uuid",
  "apiKey": "base64-encoded-key",
  "token": "jwt-token"
}
```

### Лобби

Все endpoints требуют заголовок `X-API-Key`.

#### POST `/api/lobbies`
Создание нового лобби.

**Request:**
```json
{
  "lobbyId": "string",
  "hostName": "string",
  "region": "string",
  "maxPlayers": 10,
  "hasPassword": true,
  "version": "1.0.0",
  "password": "optional"
}
```

#### POST `/api/lobbies/:lobbyId/heartbeat`
Обновление статуса лобби.

**Request:**
```json
{
  "playerCount": 5
}
```

#### DELETE `/api/lobbies/:lobbyId`
Удаление лобби.

#### GET `/api/lobbies`
Получение списка всех активных лобби.

#### POST `/api/lobbies/:lobbyId/check-password`
Проверка пароля лобби.

**Request:**
```json
{
  "password": "string"
}
```

**Response:**
```json
{
  "ok": true,
  "valid": true
}
```

## Масштабирование

### Горизонтальное масштабирование

Для обработки десятков тысяч запросов:

1. **Load Balancer** (Nginx/HAProxy):
```nginx
upstream neolobbyst {
    least_conn;
    server 127.0.0.1:3000;
    server 127.0.0.1:3001;
    server 127.0.0.1:3002;
}

server {
    listen 80;
    location / {
        proxy_pass http://neolobbyst;
    }
}
```

2. **Redis Cluster** для высокой доступности

3. **PM2** для управления процессами:
```bash
npm install -g pm2
pm2 start server.js -i max
pm2 save
pm2 startup
```

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

```bash
docker build -t neolobbyst-server .
docker run -d -p 3000:3000 --env-file .env neolobbyst-server
```

## Мониторинг

Рекомендуемые инструменты:
- **PM2** - мониторинг процессов
- **Redis Commander** - мониторинг Redis
- **Prometheus + Grafana** - метрики
- **Sentry** - отслеживание ошибок

## Безопасность

Реализованные меры защиты:

1. **Rate Limiting** - защита от флуда
2. **Helmet.js** - security headers
3. **CORS** - контроль доступа
4. **Input Validation** - проверка данных
5. **API Keys** - аутентификация клиентов
6. **JWT Tokens** - сессии
7. **Request Size Limit** - защита от больших payload
8. **Ownership Verification** - проверка прав на лобби

## Лицензия

Open Source - см. LICENSE файл
