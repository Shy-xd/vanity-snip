// beler bi kaç ay önceki biriinin maini fast değil valla ama boost bandan çekebilir tm? ana skm sizin 
import WebSocket from "ws";
import fs from "fs";
import { connect } from "net";
import { connect as tlsConnect } from "tls";

const CONFIG = {
  TOKEN: "MTI4NzQwdGI", // token
  TARGET_GUILD_ID: "1457489493161541828", // sw id
  DISCORD_IP: '162.159.135.232', // ipyi siz çoğaltırsınız
  REQUEST_COUNT: 6 // İstek ayarlıcan burdan ananı sikerim
};

let mfaToken = "";
let targetVanity = "";
const guilds = {};
const monitorWebsockets = [];
const monitorTokens = [];
let heartbeatInterval = null;

const GUILD_UPDATE_PATTERN = Buffer.from('"GUILD_UPDATE"'); // Regex Fln anlarsın ya
const VANITY_REGEX = /"vanity_url_code":"([^"]+)"/;
const VANITY_NULL_REGEX = /"vanity_url_code":null/;
const GUILD_ID_REGEX = /"id":"(\d+)"/;

const BASE_HEADERS = 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0\r\n' +
  'X-Super-Properties: eyJvcyI6IldpbmRvd3MiLCJicm93c2VyIjoiRmlyZWZveCIsImRldmljZSI6IiIsInN5c3RlbV9sb2NhbGUiOiJ0ci1UUiIsImJyb3dzZXJfdXNlcl9hZ2VudCI6Ik1vemlsbGEvNS4wIChXaW5kb3dzIE5UIDEwLjA7IFdpbjY0OyB4NjQ7IHJ2OjEzMy4wKSBHZWNrby8yMDEwMDEwMSBGaXJlZm94LzEzMy4wIiwiYnJvd3Nlcl92ZXJzaW9uIjoiMTMzLjAiLCJvc192ZXJzaW9uIjoiMTAiLCJyZWZlcnJlciI6IiIsInJlZmVycmluZ19kb21haW4iOiIiLCJyZWZlcnJlcl9jdXJyZW50IjoiIiwicmVmZXJyaW5nX2RvbWFpbl9jdXJyZW50IjoiIiwicmVsZWFzZV9jaGFubmVsIjoic3RhYmxlIiwiY2xpZW50X2J1aWxkX251bWJlciI6MzU2MTQwLCJjbGllbnRfZXZlbnRfc291cmNlIjpudWxsfQ==\r\n';

function claimVanity(vanityCode) {
  if (!mfaToken || !vanityCode) return;

  const payload = `{"code":"${vanityCode}"}`;
  const contentLength = Buffer.byteLength(payload);
  
  const request = 
    `PATCH /api/v10/guilds/${CONFIG.TARGET_GUILD_ID}/vanity-url HTTP/1.1\r\n` +
    `Host: canary.discord.com\r\n` +
    `Authorization: ${CONFIG.TOKEN}\r\n` +
    `X-Discord-MFA-Authorization: ${mfaToken}\r\n` +
    `Content-Type: application/json\r\n` +
    `Content-Length: ${contentLength}\r\n` +
    `${BASE_HEADERS}` +
    `Connection: close\r\n\r\n` +
    payload;
  
  const requestBuffer = Buffer.from(request);
  const promises = [];
  
  for (let i = 0; i < CONFIG.REQUEST_COUNT; i++) {
    const promise = new Promise((resolve) => {
      const tcpSocket = connect({
        host: CONFIG.DISCORD_IP,
        port: 443,
        noDelay: true,
        keepAlive: false
      });

      tcpSocket.setNoDelay(true);
      tcpSocket.setTimeout(1000);

      const tlsSocket = tlsConnect({
        socket: tcpSocket,
        servername: 'canary.discord.com',
        rejectUnauthorized: false,
        minVersion: 'TLSv1.2', // bunuda TLSv1.3 yaparsınız
        maxVersion: 'TLSv1.3',
        ciphers: 'TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384', // vay ananı sikeyim az olmuş
        ecdhCurve: 'X25519:prime256v1:secp384r1',
        honorCipherOrder: true,
        requestCert: false,
        enableTrace: false
      });

      let responseData = '';
      let headerReceived = false;

      tlsSocket.on('secureConnect', () => {
        tlsSocket.write(requestBuffer);
      });
      
      tlsSocket.on('data', (chunk) => {
        responseData += chunk.toString();
        
        if (!headerReceived && responseData.includes('\r\n\r\n')) {
          headerReceived = true;
        }
      });

      tlsSocket.on('end', () => {
        try {
          if (!responseData) {
            resolve();
            return;
          }
          
          const bodyStart = responseData.indexOf('\r\n\r\n');
          if (bodyStart === -1) {
            resolve();
            return;
          }
          
          const body = responseData.slice(bodyStart + 4);
          if (!body) {
            resolve();
            return;
          }
          
          const jsonStart = body.indexOf('{');
          if (jsonStart === -1) {
            resolve();
            return;
          }
          
          const jsonEnd = body.lastIndexOf('}');
          if (jsonEnd === -1) {
            resolve();
            return;
          }
          
          const parsed = JSON.parse(body.slice(jsonStart, jsonEnd + 1));
          console.log(`[${i}]`, parsed);
          resolve(parsed);
        } catch (err) {
          resolve();
        } finally {
          tlsSocket.destroy();
        }
      });

      tlsSocket.on('timeout', () => {
        tlsSocket.destroy();
        resolve();
      });

      tlsSocket.on('error', () => {
        tlsSocket.destroy();
        resolve();
      });
    });
    
    promises.push(promise);
  }
  
  Promise.race(promises);
  console.log(`discord.gg/${vanityCode} - ${CONFIG.REQUEST_COUNT} istek gönderdim kanks`);
}

function handleGuildUpdate(buffer) {
  const idx = buffer.indexOf(GUILD_UPDATE_PATTERN);
  if (idx === -1) return false;
  
  const str = buffer.toString('utf8', idx);
  const guildIdMatch = GUILD_ID_REGEX.exec(str);
  
  if (guildIdMatch) {
    const guildId = guildIdMatch[1];
    const oldVanity = guilds[guildId];
    const vanityMatch = VANITY_REGEX.exec(str);
    const isNull = VANITY_NULL_REGEX.test(str);

    if (oldVanity && (isNull || (vanityMatch && vanityMatch[1] !== oldVanity))) {
      targetVanity = oldVanity;
      setImmediate(() => claimVanity(oldVanity));
    }

    if (vanityMatch && vanityMatch[1]) {
      guilds[guildId] = vanityMatch[1];
    } else if (isNull && oldVanity) {
      delete guilds[guildId];
    }
  }
  return true;
}

function connectMainWebSocket() {
  const ws = new WebSocket("wss://gateway.discord.gg/", {
    perMessageDeflate: false,
    skipUTF8Validation: true
  });

  ws.binaryType = 'nodebuffer';

  ws.on('open', () => {});

  ws.on('message', (data) => {
    try {
      if (handleGuildUpdate(data)) return;

      const message = JSON.parse(data.toString());
      const { op, d, t } = message;

      if (op === 10) {
        ws.send(JSON.stringify({
          op: 2,
          d: {
            token: CONFIG.TOKEN,
            intents: 1,
            properties: { os: "linux", browser: "firefox", device: "" }
          }
        }));

        if (heartbeatInterval) clearInterval(heartbeatInterval);
        heartbeatInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ op: 1, d: null }));
          }
        }, d.heartbeat_interval);
      }

      if (t === 'READY') {
        d.guilds.forEach(guild => {
          if (guild.vanity_url_code) {
            guilds[guild.id] = guild.vanity_url_code;
          }
        });
      }

      if (op === 7) ws.close();
    } catch (e) {}
  });

  ws.on('close', () => {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    setTimeout(connectMainWebSocket, 2000);
  });

  ws.on('error', () => {});
}

function connectMonitorWebSocket(token, index) {
  const ws = new WebSocket("wss://gateway.discord.gg/", {
    perMessageDeflate: false,
    skipUTF8Validation: true
  });

  ws.binaryType = 'nodebuffer';

  let monitorHeartbeat = null;

  ws.on('open', () => {});

  ws.on('message', (data) => {
    try {
      if (handleGuildUpdate(data)) return;

      const message = JSON.parse(data.toString());
      const { op, d, t } = message;

      if (op === 10) {
        ws.send(JSON.stringify({
          op: 2,
          d: {
            token: token,
            intents: 1,
            properties: { os: "Windows", browser: "Firefox", device: "shy" }
          }
        }));

        if (monitorHeartbeat) clearInterval(monitorHeartbeat);
        monitorHeartbeat = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ op: 1, d: null }));
          }
        }, d.heartbeat_interval);
      }

      if (t === 'READY') {
        d.guilds.forEach(guild => {
          if (guild.vanity_url_code) {
            guilds[guild.id] = guild.vanity_url_code;
          }
        });
      }

      if (op === 7) ws.close();
    } catch (e) {}
  });

  ws.on('close', () => {
    if (monitorHeartbeat) clearInterval(monitorHeartbeat);
    setTimeout(() => connectMonitorWebSocket(token, index), 2000);
  });

  ws.on('error', () => {});

  monitorWebsockets.push(ws);
}

function loadMonitorTokens() {
  try {
    const tokensData = fs.readFileSync('monitor_tokens.txt', 'utf8');
    const tokens = tokensData.split(/\r?\n/).filter(Boolean).filter(t => t.trim().length > 0);
    monitorTokens.push(...tokens);
  } catch (error) {}
}

function connectMonitorWebSockets() {
  if (monitorTokens.length === 0) return;
  
  monitorTokens.forEach((token, index) => {
    setTimeout(() => connectMonitorWebSocket(token, index + 1), index * 1000); // bakın monitör token fln var :d
  });
}

function loadMfaToken() {
  try {
    const token = fs.readFileSync("mfa.txt", "utf8").trim();
    if (token) {
      mfaToken = token;
    }
  } catch (e) {}
}

function watchMfaFile() {
  fs.watchFile("mfa.txt", { interval: 250 }, (curr, prev) => {
    if (curr.mtimeMs !== prev.mtimeMs) {
      loadMfaToken();
    }
  });
}

async function start() {
  loadMfaToken();
  loadMonitorTokens();
  
  try {
    watchMfaFile();
  } catch (e) {}
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  connectMainWebSocket();
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  connectMonitorWebSockets();
}

process.on('SIGINT', () => {
  monitorWebsockets.forEach(ws => ws.close());
  process.exit(0);
});

process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});

start();
// Koddan büyük birşey beklemeyin boost bandan çeker belki 